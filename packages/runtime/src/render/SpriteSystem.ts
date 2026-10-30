import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import type { AssetManager } from '../assets/AssetManager';
import { Sprite, type SpriteAnimation, type SpriteData } from '../components/sprite';
import { CharacterController } from '../components/physics';
import type { RenderSystem } from './RenderSystem';
import { litBy2DLights } from './light2d';

interface Visual {
  mesh: THREE.Mesh;
  key: string;
  token: number;
  lastX?: number;
  left?: boolean;
  /** Where it was last frame (for its speed). */
  prev?: THREE.Vector3;
  /** Smoothed movement (m/s), for characters picking their animation. */
  vx: number;
  vy: number;
  /** The animation playing and how far into it (seconds). */
  clip?: string;
  time: number;
  /** A one-off (a script's "animate"): plays once, then back to normal. */
  once?: string;
  shown: number;
}

/** Animation names characters use by themselves (first one found wins). */
const ROLE_NAMES: Record<string, string[]> = {
  idle: ['idle', 'stand', 'still'],
  walk: ['walk', 'move'],
  run: ['run', 'sprint', 'walk', 'move'],
  jump: ['jump', 'up', 'air'],
  fall: ['fall', 'down', 'jump', 'air'],
};

/**
 * Draws Sprite components: a flat picture or shape facing the camera's side (+Z), unlit. Sprite
 * sheets play their animations: characters pick idle / walk / run / jump / fall by themselves.
 */
export class SpriteSystem implements System {
  readonly name = 'sprites';
  readonly order = 900;
  private world: World | null = null;
  private readonly visuals = new Map<string, Visual>();
  private nextToken = 1;

  constructor(
    private readonly render: RenderSystem,
    private readonly assets: AssetManager,
    /** The camera being looked through (for parallax backgrounds). */
    private readonly camera?: () => THREE.Camera,
  ) {}

  attach(world: World): void {
    this.world = world;
  }

  detach(): void {
    for (const id of [...this.visuals.keys()]) this.remove(id);
    this.world = null;
  }

  lateUpdate(dt: number): void {
    if (!this.world) return;
    const seen = new Set<string>();
    for (const e of this.world.query(Sprite)) {
      seen.add(e.id);
      const d = e.require(Sprite);
      this.sync(e, d);
      const v = this.visuals.get(e.id);
      if (v) {
        this.animate(e, v, d, dt);
        this.parallax(v, d);
      }
    }
    for (const id of [...this.visuals.keys()]) if (!seen.has(id)) this.remove(id);
  }

  /** The sprite's mesh (editor picking, bounds). */
  meshOf(entityId: string): THREE.Mesh | undefined {
    return this.visuals.get(entityId)?.mesh;
  }

  private sync(e: Entity, d: SpriteData): void {
    const node = this.render.nodeOf(e);
    if (!node) return;
    const key = JSON.stringify(d);
    let v = this.visuals.get(e.id);
    if (v && e.has(CharacterController)) this.face(v, node, d);
    if (v && v.key === key && v.mesh.parent === node) return;
    if (v && v.key !== key) {
      // Only the sheet / animation settings or the opacity changed: no need to load the picture again.
      const was = JSON.parse(v.key) as SpriteData;
      if (sameLook(was, d) && v.mesh.parent === node) {
        v.key = key;
        (v.mesh.material as THREE.MeshBasicMaterial).opacity = d.opacity ?? 1;
        return;
      }
    }
    if (v && v.key === key && v.mesh.parent === node) return;
    if (!v) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), litBy2DLights(new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, toneMapped: false })));
      mesh.name = 'Sprite';
      v = { mesh, key: '', token: 0, vx: 0, vy: 0, time: 0, shown: -1 };
      this.visuals.set(e.id, v);
    }
    const { mesh } = v;
    if (mesh.parent !== node) node.add(mesh);
    const shapeChanged = !v.key || (JSON.parse(v.key) as SpriteData).shape !== d.shape;
    if (shapeChanged) {
      mesh.geometry.dispose();
      mesh.geometry = d.shape === 'circle' && !d.image ? new THREE.CircleGeometry(0.5, 40) : new THREE.PlaneGeometry(1, 1);
    }
    v.key = key;
    mesh.scale.set(d.size[0] * (d.flipX !== !!v.left ? -1 : 1), d.size[1], 1);
    // Layers: a hair in front of each other, and drawn in order.
    mesh.position.z = d.layer * 0.002;
    mesh.renderOrder = d.layer;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    // A picture shows its own colours (times the tint, white by default); a shape is its colour.
    mat.color.set(d.image ? (d.tint ?? '#ffffff') : d.color);
    mat.opacity = d.opacity ?? 1;
    const token = ++this.nextToken;
    v.token = token;
    if (!d.image) {
      mat.map = null;
      mat.needsUpdate = true;
      return;
    }
    void this.assets.loadTexture(d.image).then(
      (shared) => {
        if (this.visuals.get(e.id)?.token !== token) return;
        // Own copy: repeat and filtering differ per sprite.
        const tex = shared.clone();
        const sheet = isSheet(d);
        tex.wrapS = tex.wrapT = d.tile && !sheet ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        tex.repeat.set(d.tile && !sheet ? Math.max(0.01, d.size[0]) : 1, d.tile && !sheet ? Math.max(0.01, d.size[1]) : 1);
        // Sheets: no mipmaps (they'd bleed neighbouring frames in).
        if (sheet) tex.generateMipmaps = false;
        tex.magFilter = d.pixelArt ? THREE.NearestFilter : THREE.LinearFilter;
        tex.minFilter = d.pixelArt ? THREE.NearestFilter : sheet ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
        tex.needsUpdate = true;
        (mat.map as THREE.Texture | null)?.dispose();
        mat.map = tex;
        mat.needsUpdate = true;
        const vis = this.visuals.get(e.id);
        if (vis) {
          vis.shown = -1;
          this.showFrame(vis, d, vis.shown < 0 ? d.frame : vis.shown);
        }
      },
      () => {},
    );
  }

  /** Play an animation once (a script's "animate"), then go back to normal. False if there's none by that name. */
  playOnce(entity: Entity, name: string): boolean {
    const v = this.visuals.get(entity.id);
    const d = entity.get(Sprite);
    if (!v || !d || !findAnimation(d, name)) return false;
    v.once = name;
    v.clip = name;
    v.time = 0;
    return true;
  }

  /** Animation names of a sprite (for the editor and scripts). */
  clipsOf(entity: Entity): string[] {
    return (entity.get(Sprite)?.animations ?? []).map((a) => a.name);
  }

  private animate(e: Entity, v: Visual, d: SpriteData, dt: number): void {
    if (!isSheet(d)) return;
    const anims = d.animations ?? [];
    // Movement, for characters.
    const p = v.mesh.parent?.getWorldPosition(new THREE.Vector3());
    if (p && dt > 0) {
      if (v.prev) {
        const k = Math.min(1, dt * 12);
        v.vx += ((p.x - v.prev.x) / dt - v.vx) * k;
        v.vy += ((p.y - v.prev.y) / dt - v.vy) * k;
      }
      v.prev = p;
    }
    let want = d.animation;
    if (v.once) want = v.once;
    else if (!want && e.has(CharacterController) && anims.length) {
      // Seen from above, moving up or down is walking, not jumping.
      const topDown = !!e.get(CharacterController)?.topDown;
      want = topDown ? roleClip(anims, Math.hypot(v.vx, v.vy), 0) : roleClip(anims, v.vx, v.vy);
    }
    else if (!want) want = anims[0]?.name ?? '';
    const anim = want ? findAnimation(d, want) : undefined;
    if (!anim) return this.showFrame(v, d, d.frame);
    if (v.clip !== anim.name) {
      v.clip = anim.name;
      v.time = 0;
    }
    v.time += dt;
    const count = Math.max(1, anim.to - anim.from + 1);
    let i = Math.floor(v.time * Math.max(0.1, d.fps));
    if (i >= count) {
      if (v.once) {
        v.once = undefined;
        i = count - 1;
      } else i = anim.loop ? i % count : count - 1;
    }
    this.showFrame(v, d, anim.from + i);
  }

  /**
   * Distant backgrounds slide along with the camera: at distance p they move p of the way, so
   * they seem to scroll slower (p = 1 stays put, like the sky). Same in the editor and the game.
   */
  private parallax(v: Visual, d: SpriteData): void {
    const p = d.parallax ?? 0;
    const node = v.mesh.parent;
    const cam = this.camera?.();
    if (!node || !cam || p <= 0) {
      if (v.mesh.position.x !== 0 || v.mesh.position.y !== 0) v.mesh.position.set(0, 0, v.mesh.position.z);
      return;
    }
    node.updateWorldMatrix(true, false);
    cam.updateMatrixWorld();
    const at = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const world = at.clone().add(new THREE.Vector3(camPos.x * p, camPos.y * p, 0));
    const local = node.worldToLocal(world);
    v.mesh.position.set(local.x, local.y, v.mesh.position.z);
  }

  /** Show one frame of the sheet (0 = top left, counting across). */
  private showFrame(v: Visual, d: SpriteData, frame: number): void {
    const map = (v.mesh.material as THREE.MeshBasicMaterial).map;
    if (!map || !isSheet(d)) return;
    const cols = Math.max(1, Math.round(d.columns));
    const rows = Math.max(1, Math.round(d.rows));
    const f = Math.max(0, Math.min(cols * rows - 1, Math.round(frame)));
    if (f === v.shown && map.repeat.x === 1 / cols) return;
    v.shown = f;
    map.repeat.set(1 / cols, 1 / rows);
    map.offset.set((f % cols) / cols, 1 - (Math.floor(f / cols) + 1) / rows);
  }

  /** Turn a sprite to face left or right (a script's lookAt in 2D). */
  setFacing(entityId: string, left: boolean): void {
    const v = this.visuals.get(entityId);
    const d = this.world?.getById(entityId)?.get(Sprite);
    if (!v || !d || v.left === left) return;
    v.left = left;
    v.mesh.scale.x = d.size[0] * (d.flipX !== left ? -1 : 1);
  }

  /** Which way a sprite faces (carrying things in 2D). */
  facingLeft(entityId: string): boolean {
    return !!this.visuals.get(entityId)?.left;
  }

  /** Characters: the picture faces the way they walk (mirrored going left). */
  private face(v: Visual, node: THREE.Object3D, d: SpriteData): void {
    const x = node.getWorldPosition(new THREE.Vector3()).x;
    if (v.lastX !== undefined && Math.abs(x - v.lastX) > 1e-3) {
      const left = x < v.lastX;
      if (left !== v.left) {
        v.left = left;
        v.mesh.scale.x = d.size[0] * (d.flipX !== left ? -1 : 1);
      }
    }
    v.lastX = x;
  }

  private remove(id: string): void {
    const v = this.visuals.get(id);
    if (!v) return;
    v.mesh.removeFromParent();
    v.mesh.geometry.dispose();
    const mat = v.mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.visuals.delete(id);
  }
}

const isSheet = (d: SpriteData) => !!d.image && (Math.round(d.columns ?? 1) > 1 || Math.round(d.rows ?? 1) > 1);

function findAnimation(d: SpriteData, name: string): SpriteAnimation | undefined {
  const n = name.trim().toLowerCase();
  return (d.animations ?? []).find((a) => a.name.trim().toLowerCase() === n);
}

/** What a character is doing, as an animation name it has. */
function roleClip(anims: SpriteAnimation[], vx: number, vy: number): string {
  const role = vy > 1.5 ? 'jump' : vy < -2 ? 'fall' : Math.abs(vx) > 4.5 ? 'run' : Math.abs(vx) > 0.3 ? 'walk' : 'idle';
  const names = anims.map((a) => a.name.trim().toLowerCase());
  for (const word of ROLE_NAMES[role]) {
    const i = names.findIndex((n) => n === word || n.includes(word));
    if (i >= 0) return anims[i].name;
  }
  // Nothing for that: stand still if possible, else the first.
  const idle = names.findIndex((n) => ROLE_NAMES.idle.some((w) => n.includes(w)));
  return anims[Math.max(0, idle)].name;
}

/** Same picture and look (only the animation settings differ). */
function sameLook(a: SpriteData, b: SpriteData): boolean {
  const strip = (d: SpriteData) => ({ ...d, frame: 0, fps: 0, animations: [], animation: '', opacity: 1 });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
