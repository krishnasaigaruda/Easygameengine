import * as THREE from 'three';
import { setFlat } from './flatCamera';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import {
  Camera,
  Light,
  MeshRenderer,
  Transform,
  type CameraData,
  type LightData,
  type MeshRendererData,
  type MeshShape,
} from '../components/builtin';
import type { SceneSettings } from '../scene/SceneData';
import type { AssetManager } from '../assets/AssetManager';

const DEG = Math.PI / 180;
/** Sun shadow resolution (Quality setting). */
let shadowMapSize = 2048;
/** Point/spot "intensity 1" in three.js units. */
export const LAMP_SCALE = 12;

/** Visual objects owned by one entity, each living under the entity's node. */
interface EntityVisuals {
  node: THREE.Group;
  mesh?: THREE.Mesh;
  /** The mesh's own material (used when no material asset is set). */
  ownMaterial?: THREE.MeshStandardMaterial;
  /** Material asset currently requested for the mesh. */
  materialAsset?: string;
  light?: THREE.Light;
  camera?: THREE.PerspectiveCamera;
}

/** Unit-sized shapes shared by all meshes (never disposed per entity). */
const geometryCache = new Map<MeshShape, THREE.BufferGeometry>();
function geometryFor(shape: MeshShape): THREE.BufferGeometry {
  let g = geometryCache.get(shape);
  if (g) return g;
  switch (shape) {
    case 'box':
      g = new THREE.BoxGeometry(1, 1, 1);
      break;
    case 'sphere':
      g = new THREE.SphereGeometry(0.5, 48, 24);
      break;
    case 'plane':
      g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      break;
    case 'cylinder':
      g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
      break;
    case 'capsule':
      g = new THREE.CapsuleGeometry(0.5, 1, 8, 24);
      break;
    case 'cone':
      g = new THREE.ConeGeometry(0.5, 1, 32);
      break;
    case 'torus':
      g = new THREE.TorusGeometry(0.4, 0.15, 24, 64);
      break;
  }
  geometryCache.set(shape, g);
  return g;
}

/**
 * Mirrors the World into a Three.js scene graph. Structure changes arrive as world events;
 * transforms are synced every frame because scripts mutate them directly.
 */
/** Quality: shadow detail for sun lights (existing lights are updated too). */
export function setShadowMapSize(size: number, scene?: THREE.Object3D): void {
  shadowMapSize = size;
  scene?.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (!l.isDirectionalLight || l.shadow.mapSize.x === size) return;
    l.shadow.mapSize.set(size, size);
    l.shadow.map?.dispose();
    l.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  });
}

export class RenderSystem implements System {
  readonly name = 'render';
  readonly order = 1000;
  /** All entity nodes live under this group; editor helpers go elsewhere in the scene. */
  readonly root = new THREE.Group();
  private readonly scene: THREE.Scene;
  private readonly assets: AssetManager | null;
  private readonly visuals = new Map<string, EntityVisuals>();
  private settings: SceneSettings | null = null;
  private envToken = 0;
  private world: World | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(scene: THREE.Scene, assets: AssetManager | null = null) {
    this.scene = scene;
    this.assets = assets;
    this.root.name = 'EGE:World';
    scene.add(this.root);
  }

  attach(world: World): void {
    this.world = world;
    const ev = world.events;
    this.unsubscribers = [
      ev.on('entityCreated', ({ entity }) => this.createVisuals(entity)),
      ev.on('entityDestroyed', ({ entity }) => this.destroyVisuals(entity)),
      ev.on('hierarchyChanged', ({ entity }) => this.reparent(entity)),
      ev.on('entityEnabledChanged', ({ entity }) => this.applyEnabled(entity)),
      ev.on('entityRenamed', ({ entity }) => {
        const v = this.visuals.get(entity.id);
        if (v) v.node.name = entity.name;
      }),
      ev.on('componentAdded', ({ entity, type }) => this.refreshComponent(entity, type)),
      ev.on('componentChanged', ({ entity, type }) => this.refreshComponent(entity, type)),
      ev.on('componentRemoved', ({ entity, type }) => this.refreshComponent(entity, type)),
    ];
    if (this.assets) {
      this.unsubscribers.push(
        this.assets.events.on('changed', ({ id }) => {
          for (const e of world.query(MeshRenderer)) {
            const v = this.visuals.get(e.id);
            if (v?.materialAsset === id) {
              v.materialAsset = undefined; // force re-fetch
              this.updateMesh(v, e.get(MeshRenderer));
            }
          }
          if (this.settings?.environment.asset === id) this.applySettings(this.settings);
        }),
      );
    }
    for (const e of world.all()) this.createVisuals(e);
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    if (this.world) for (const e of [...this.world.all()].reverse()) this.destroyVisuals(e);
    this.world = null;
  }

  lateUpdate(): void {
    if (this.world) for (const e of this.world.all()) this.syncTransform(e);
  }

  /** The Three object representing an entity (for picking, gizmos, attaching effects). */
  nodeOf(entity: Entity): THREE.Object3D | undefined {
    return this.visuals.get(entity.id)?.node;
  }

  /** Find which entity a clicked Three object belongs to. */
  entityFromObject(object: THREE.Object3D | null): Entity | undefined {
    for (let o = object; o; o = o.parent) {
      const id = o.userData.entityId as string | undefined;
      if (id) return this.world?.getById(id);
    }
    return undefined;
  }

  /** The primary camera of an active entity, if the scene has one. */
  sceneCamera(): THREE.PerspectiveCamera | undefined {
    if (!this.world) return undefined;
    let fallback: THREE.PerspectiveCamera | undefined;
    for (const e of this.world.query(Camera)) {
      if (!e.activeInHierarchy) continue;
      const cam = this.visuals.get(e.id)?.camera;
      if (!cam) continue;
      if (e.require(Camera).primary) return cam;
      fallback ??= cam;
    }
    return fallback;
  }

  applySettings(settings: SceneSettings): void {
    this.settings = settings;
    const color = new THREE.Color(settings.background);
    // 2D lights: a dark scene has a dark backdrop too (not lit by the lights, like a night sky).
    const dark = settings.dimension === '2d' ? Math.min(1, Math.max(0, settings.darkness2D ?? 0)) : 0;
    if (dark > 0) color.multiplyScalar(1 - dark);
    const f = settings.fog;
    this.scene.fog = f.enabled ? new THREE.Fog(f.color, f.near, f.far) : null;
    const env = settings.environment;
    const token = ++this.envToken;
    if (!env.asset || !this.assets) {
      this.scene.environment = null;
      this.scene.background = color;
      return;
    }
    this.assets
      .loadEnvironment(env.asset)
      .then((tex) => {
        if (token !== this.envToken) return; // a newer setting won
        this.scene.environment = tex;
        this.scene.environmentIntensity = env.intensity;
        this.scene.background = env.showAsBackground ? tex : color;
        this.scene.backgroundBlurriness = env.blur;
        this.scene.backgroundIntensity = env.intensity;
      })
      .catch((err: unknown) => {
        if (token !== this.envToken) return;
        this.scene.environment = null;
        this.scene.background = color;
        console.error('[EGE] Sky failed to load:', err instanceof Error ? err.message : err);
      });
    // Keep the old sky until the new one is ready, but apply intensity changes immediately.
    this.scene.environmentIntensity = env.intensity;
    this.scene.backgroundBlurriness = env.blur;
  }

  private createVisuals(entity: Entity): void {
    if (this.visuals.has(entity.id)) return;
    const node = new THREE.Group();
    node.name = entity.name;
    node.userData.entityId = entity.id;
    this.visuals.set(entity.id, { node });
    this.parentNodeOf(entity).add(node);
    for (const type of entity.componentTypes()) this.refreshComponent(entity, type);
    this.applyEnabled(entity);
    this.syncTransform(entity);
  }

  private destroyVisuals(entity: Entity): void {
    const v = this.visuals.get(entity.id);
    if (!v) return;
    this.disposeMesh(v);
    this.disposeLight(v);
    v.camera?.removeFromParent();
    v.node.removeFromParent();
    this.visuals.delete(entity.id);
  }

  private parentNodeOf(entity: Entity): THREE.Object3D {
    const parent = entity.parent;
    return (parent && this.visuals.get(parent.id)?.node) || this.root;
  }

  private reparent(entity: Entity): void {
    const v = this.visuals.get(entity.id);
    if (v) this.parentNodeOf(entity).add(v.node); // add() removes from the old parent
  }

  private applyEnabled(entity: Entity): void {
    const v = this.visuals.get(entity.id);
    if (v) v.node.visible = entity.enabled; // Three hides children of invisible parents
  }

  private syncTransform(entity: Entity): void {
    const v = this.visuals.get(entity.id);
    const t = entity.get(Transform);
    if (!v || !t) return;
    v.node.position.fromArray(t.position);
    v.node.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG);
    v.node.scale.fromArray(t.scale);
  }

  private refreshComponent(entity: Entity, type: string): void {
    const v = this.visuals.get(entity.id);
    if (!v) return;
    switch (type) {
      case MeshRenderer.type:
        this.updateMesh(v, entity.get(MeshRenderer));
        break;
      case Light.type:
        this.updateLight(v, entity.get(Light));
        break;
      case Camera.type:
        this.updateCamera(v, entity.get(Camera));
        break;
      case Transform.type:
        this.syncTransform(entity);
        break;
    }
  }

  private updateMesh(v: EntityVisuals, data: MeshRendererData | undefined): void {
    if (!data) return this.disposeMesh(v);
    if (!v.mesh) {
      v.ownMaterial = new THREE.MeshStandardMaterial();
      v.mesh = new THREE.Mesh(geometryFor(data.shape), v.ownMaterial);
      v.node.add(v.mesh);
    }
    const mesh = v.mesh;
    mesh.geometry = geometryFor(data.shape);
    const own = v.ownMaterial!;
    own.color.set(data.color);
    own.roughness = data.roughness;
    own.metalness = data.metalness;
    const opacity = data.opacity ?? 1;
    own.transparent = opacity < 1;
    own.opacity = opacity;
    own.depthWrite = opacity >= 1;
    mesh.castShadow = data.castShadow;
    mesh.receiveShadow = data.receiveShadow;

    const wanted = (this.assets && data.material) || '';
    if (wanted === (v.materialAsset ?? '')) return;
    v.materialAsset = wanted;
    if (!wanted) {
      mesh.material = own;
      return;
    }
    this.assets!.loadMaterial(wanted)
      .then((mat) => {
        if (v.materialAsset === wanted && v.mesh === mesh) mesh.material = mat;
      })
      .catch((err: unknown) => {
        if (v.materialAsset !== wanted) return;
        mesh.material = own;
        console.error('[EGE] Material failed to load:', err instanceof Error ? err.message : err);
      });
  }

  private disposeMesh(v: EntityVisuals): void {
    if (!v.mesh) return;
    v.ownMaterial?.dispose(); // material assets are shared and owned by the AssetManager
    v.mesh.removeFromParent();
    v.mesh = undefined;
    v.ownMaterial = undefined;
    v.materialAsset = undefined;
  }

  private updateLight(v: EntityVisuals, data: LightData | undefined): void {
    if (!data) return this.disposeLight(v);
    // Changing kind means a different Three class; rebuild.
    if (v.light && v.light.userData.kind !== data.kind) this.disposeLight(v);
    if (!v.light) {
      v.light = createLight(data.kind);
      v.light.userData.kind = data.kind;
      v.node.add(v.light);
      // Directional/spot lights aim at a target; put it 1m "forward" (-Z) of the entity so
      // rotating the entity aims the light.
      if (v.light instanceof THREE.DirectionalLight || v.light instanceof THREE.SpotLight) {
        v.light.target.position.set(0, 0, -1);
        v.node.add(v.light.target);
      }
    }
    const light = v.light;
    light.color.set(data.color);
    light.intensity = data.intensity;
    if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
      // Lamps use physical units (candela); scale so "1" is a normal lamp a few meters across.
      light.intensity = data.intensity * LAMP_SCALE;
      light.distance = data.range;
    }
    if (light instanceof THREE.SpotLight) light.angle = Math.min(data.angle, 89) * DEG;
    if (light instanceof THREE.HemisphereLight) light.groundColor.set(data.groundColor);
    light.castShadow =
      data.castShadow && !(light instanceof THREE.HemisphereLight || light instanceof THREE.AmbientLight);
  }

  private disposeLight(v: EntityVisuals): void {
    if (!v.light) return;
    const l = v.light;
    if (l instanceof THREE.DirectionalLight || l instanceof THREE.SpotLight) l.target.removeFromParent();
    l.dispose();
    l.removeFromParent();
    v.light = undefined;
  }

  private updateCamera(v: EntityVisuals, data: CameraData | undefined): void {
    if (!data) {
      v.camera?.removeFromParent();
      v.camera = undefined;
      return;
    }
    if (!v.camera) {
      v.camera = new THREE.PerspectiveCamera();
      v.node.add(v.camera);
    }
    v.camera.fov = data.fov;
    v.camera.near = data.near;
    v.camera.far = data.far;
    setFlat(v.camera, data.orthographic ? (data.viewHeight ?? 12) : null);
    v.camera.userData.viewHeight = data.viewHeight ?? 12; // what was asked for (pixel-perfect rounds it)
  }
}

function createLight(kind: LightData['kind']): THREE.Light {
  switch (kind) {
    case 'directional': {
      const l = new THREE.DirectionalLight();
      l.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      const cam = l.shadow.camera;
      cam.left = cam.bottom = -30;
      cam.right = cam.top = 30;
      cam.near = 0.5;
      cam.far = 200;
      l.shadow.bias = -0.0005;
      l.shadow.normalBias = 0.02;
      return l;
    }
    case 'point':
      return new THREE.PointLight();
    case 'spot': {
      const l = new THREE.SpotLight();
      l.penumbra = 0.3;
      return l;
    }
    case 'hemisphere':
      return new THREE.HemisphereLight();
    case 'ambient':
      return new THREE.AmbientLight();
  }
}
