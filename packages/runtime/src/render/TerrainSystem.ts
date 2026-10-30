import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { Terrain, type TerrainData } from '../components/terrain';
import {
  applyBrush,
  decodeHeights,
  decodeSplat,
  encodeHeights,
  encodeSplat,
  pointsPerSide,
  sampleLocal,
  SPLAT_LAYERS,
  splatIndex,
  type BrushStroke,
  type Heightmap,
} from '../terrain/heightmap';
import type { RenderSystem } from './RenderSystem';
import type { AssetManager } from '../assets/AssetManager';
import { TerrainLayerTextures } from './terrainLayers';

interface TerrainVisual {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  heights: Heightmap;
  splat: Uint8Array;
  /** Layers 1–4 and 5–8 (two RGBA textures over the same splat data). */
  splatTex: THREE.DataTexture;
  splatTex2: THREE.DataTexture;
  layers: TerrainLayerTextures;
  /** What the mesh was built from (to skip rebuilds). */
  key: string;
  heightsText: string;
  splatText: string;
  layerIds: string[];
  uniforms: Record<string, THREE.IUniform>;
  /** Heights as a float texture (for grass), made on demand. */
  heightTex?: THREE.DataTexture;
  /** Bumped whenever the heights change. */
  version: number;
}

/** Draws Terrain components: a heightmap mesh with up to 8 painted, blended texture layers. */
export class TerrainSystem implements System {
  readonly name = 'terrain';
  readonly order = 1010;
  private world: World | null = null;
  private readonly visuals = new Map<string, TerrainVisual>();
  private readonly render: RenderSystem;
  private readonly assets: AssetManager | null;
  private unsubscribers: (() => void)[] = [];

  constructor(render: RenderSystem, assets: AssetManager | null = null) {
    this.render = render;
    this.assets = assets;
  }

  attach(world: World): void {
    this.world = world;
    const ev = world.events;
    const sync = ({ entity, type }: { entity: Entity; type: string }) => type === Terrain.type && this.sync(entity);
    this.unsubscribers = [
      ev.on('componentAdded', sync),
      ev.on('componentChanged', sync),
      ev.on('componentRemoved', sync),
      ev.on('entityDestroyed', ({ entity }) => this.remove(entity.id)),
      ev.on('entityCreated', ({ entity }) => this.sync(entity)),
    ];
    for (const e of world.all()) this.sync(e);
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    for (const id of [...this.visuals.keys()]) this.remove(id);
    this.world = null;
  }

  /** The terrain's live heights (for physics, scatter, grass, brushes). */
  heightmap(entityId: string): Heightmap | null {
    return this.visuals.get(entityId)?.heights ?? null;
  }

  /** Heights and paint as textures, plus a version that changes with every edit (grass reads these). */
  textures(entityId: string): { heights: THREE.DataTexture; splat: THREE.DataTexture; resolution: number; version: number } | null {
    const v = this.visuals.get(entityId);
    if (!v) return null;
    const n = pointsPerSide(v.heights.resolution);
    if (!v.heightTex || v.heightTex.image.width !== n) {
      v.heightTex?.dispose();
      v.heightTex = new THREE.DataTexture(v.heights.data, n, n, THREE.RedFormat, THREE.FloatType);
      // Nearest: float textures can't always be smoothed by the GPU; grass blends them itself.
      v.heightTex.magFilter = v.heightTex.minFilter = THREE.NearestFilter;
      v.heightTex.needsUpdate = true;
    }
    return { heights: v.heightTex, splat: v.splatTex, resolution: v.heights.resolution, version: v.version };
  }

  /** The mesh (editor raycasts it for brushes). */
  meshOf(entityId: string): THREE.Mesh | null {
    return this.visuals.get(entityId)?.mesh ?? null;
  }

  /** Ground height in world space under a world x/z, or null if outside the terrain. */
  heightAt(entity: Entity, x: number, z: number): number | null {
    const v = this.visuals.get(entity.id);
    const d = entity.get(Terrain);
    if (!v || !d) return null;
    v.mesh.updateWorldMatrix(true, false);
    const local = v.mesh.worldToLocal(new THREE.Vector3(x, 0, z));
    if (Math.abs(local.x) > d.size / 2 || Math.abs(local.z) > d.size / 2) return null;
    const y = sampleLocal(v.heights, d.size, local.x, local.z) * d.maxHeight;
    return v.mesh.localToWorld(new THREE.Vector3(local.x, y, local.z)).y;
  }

  /** Which paint layer (0–7) shows most at a world x/z, or -1 outside the terrain. */
  layerAt(entity: Entity, x: number, z: number): number {
    const v = this.visuals.get(entity.id);
    const d = entity.get(Terrain);
    if (!v || !d) return -1;
    v.mesh.updateWorldMatrix(true, false);
    const local = v.mesh.worldToLocal(new THREE.Vector3(x, 0, z));
    if (Math.abs(local.x) > d.size / 2 || Math.abs(local.z) > d.size / 2) return -1;
    const n = v.heights.resolution + 1;
    const gx = Math.round(((local.x + d.size / 2) / d.size) * (n - 1));
    const gz = Math.round(((local.z + d.size / 2) / d.size) * (n - 1));
    const point = gz * n + gx;
    let best = 0;
    for (let l = 1; l < SPLAT_LAYERS; l++) if (v.splat[splatIndex(n, point, l)] > v.splat[splatIndex(n, point, best)]) best = l;
    return best;
  }

  /**
   * Editor brushes: apply one dab at a world point, updating the mesh right away.
   * Call `commit` when the stroke ends to get the data to save.
   */
  sculpt(entity: Entity, worldPoint: THREE.Vector3, stroke: Omit<BrushStroke, 'gx' | 'gz' | 'radius'> & { radius: number }): void {
    const v = this.visuals.get(entity.id);
    const d = entity.get(Terrain);
    if (!v || !d) return;
    v.mesh.updateWorldMatrix(true, false);
    const local = v.mesh.worldToLocal(worldPoint.clone());
    const g = v.heights.resolution / d.size;
    const s: BrushStroke = {
      ...stroke,
      gx: (local.x + d.size / 2) * g,
      gz: (local.z + d.size / 2) * g,
      radius: stroke.radius * g,
      target: stroke.target !== undefined ? stroke.target / Math.max(0.001, d.maxHeight) : undefined,
      // Patches about 2.5 m across, whatever the terrain's detail.
      breakupScale: (stroke.breakupScale ?? 2.5) * g,
    };
    const bounds = applyBrush(v.heights, stroke.brush === 'paint' ? v.splat : null, s);
    if (stroke.brush === 'paint') {
      v.splatTex.needsUpdate = true;
      v.splatTex2.needsUpdate = true;
    }
    else this.writeHeights(v, d, bounds);
  }

  /** Height (meters, local) at a world point — for the flatten brush's target. */
  localHeightAt(entity: Entity, worldPoint: THREE.Vector3): number {
    const v = this.visuals.get(entity.id);
    const d = entity.get(Terrain);
    if (!v || !d) return 0;
    const local = v.mesh.worldToLocal(worldPoint.clone());
    return sampleLocal(v.heights, d.size, local.x, local.z) * d.maxHeight;
  }

  /** The sculpted/painted data, ready to store on the component. */
  commit(entity: Entity): { heights: string; splat: string } | null {
    const v = this.visuals.get(entity.id);
    if (!v) return null;
    v.heightsText = encodeHeights(v.heights);
    v.splatText = encodeSplat(v.splat);
    return { heights: v.heightsText, splat: v.splatText };
  }

  // ── building ──────────────────────────────────────────────────────────────

  private sync(e: Entity): void {
    const d = e.get(Terrain);
    if (!d) return this.remove(e.id);
    const node = this.render.nodeOf(e);
    if (!node) return;
    let v = this.visuals.get(e.id);
    const key = `${d.size}|${d.resolution}|${d.maxHeight}`;
    if (!v || v.key !== key || v.mesh.parent !== node) {
      this.remove(e.id);
      v = this.build(e, d, node);
    } else {
      // Same shape: only reload what changed (undo of a stroke, generate…).
      if (d.heights !== v.heightsText) {
        v.heights = decodeHeights(d.heights, Math.round(d.resolution));
        v.heightsText = d.heights;
        this.writeHeights(v, d);
      }
      if (d.splat !== v.splatText) {
        v.splat.set(decodeSplat(d.splat, Math.round(d.resolution)));
        v.splatText = d.splat;
        v.splatTex.needsUpdate = true;
        v.splatTex2.needsUpdate = true;
      }
    }
    this.applyLayers(v, d);
    v.mesh.castShadow = d.castShadows;
  }

  private build(e: Entity, d: TerrainData, node: THREE.Object3D): TerrainVisual {
    const res = Math.max(4, Math.min(512, Math.round(d.resolution)));
    const geo = new THREE.PlaneGeometry(d.size, d.size, res, res).rotateX(-Math.PI / 2);
    const n = pointsPerSide(res);
    const splat = decodeSplat(d.splat, res);
    const block = (i: number) => {
      const t = new THREE.DataTexture(splat.subarray(i * n * n * 4, (i + 1) * n * n * 4), n, n, THREE.RGBAFormat);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    const splatTex = block(0);
    const splatTex2 = block(1);
    const layers = new TerrainLayerTextures();
    const uniforms: Record<string, THREE.IUniform> = {
      uSplat: { value: splatTex },
      uSplat2: { value: splatTex2 },
      uAlbedo: { value: layers.albedo },
      uDetail: { value: layers.detail },
      uTint: { value: Array.from({ length: SPLAT_LAYERS }, () => new THREE.Color()) },
      uMaxHeight: { value: d.maxHeight },
      uTiling: { value: d.tiling },
      uLayerTiling: { value: new Array<number>(SPLAT_LAYERS).fill(d.tiling) },
      uAuto: { value: d.autoPaint ? 1 : 0 },
      uRockSlope: { value: d.rockSlope },
      uSnowLine: { value: d.snowLine },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uMaxHeight;\nvarying vec2 vTerrainUv;\nvarying vec3 vTerrainWorld;\nvarying float vTerrainHeight;\nvarying vec3 vTerrainNormal;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vTerrainUv = uv;
          vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTerrainHeight = position.y / max(uMaxHeight, 0.001);
          vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uSplat, uSplat2;
          uniform highp sampler2DArray uAlbedo, uDetail;
          uniform vec3 uTint[${SPLAT_LAYERS}];
          uniform float uTiling, uAuto, uRockSlope, uSnowLine;
          uniform float uLayerTiling[${SPLAT_LAYERS}];
          varying vec2 vTerrainUv;
          varying vec3 vTerrainWorld;
          varying float vTerrainHeight;
          varying vec3 vTerrainNormal;
          vec2 gTerrainNormal;
          float gTerrainRough;
          float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float tNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `{
            vec2 suv = vec2(vTerrainUv.x, 1.0 - vTerrainUv.y);
            vec4 wA = texture2D(uSplat, suv);
            vec4 wB = texture2D(uSplat2, suv);
            if (uAuto > 0.5) {
              float slope = degrees(acos(clamp(vTerrainNormal.y, 0.0, 1.0)));
              float rock = smoothstep(uRockSlope - 5.0, uRockSlope + 5.0, slope);
              float snow = smoothstep(uSnowLine - 0.04, uSnowLine + 0.04, vTerrainHeight) * (1.0 - rock * 0.6);
              wA = mix(wA, vec4(0.0, 0.0, 1.0, 0.0), rock);
              wB *= 1.0 - rock;
              wA = mix(wA, vec4(0.0, 0.0, 0.0, 1.0), snow);
              wB *= 1.0 - snow;
            }
            float w[${SPLAT_LAYERS}] = float[${SPLAT_LAYERS}](wA.x, wA.y, wA.z, wA.w, wB.x, wB.y, wB.z, wB.w);
            // Height blending: where layers meet, the higher surface wins (stones above dirt).
            vec4 det[${SPLAT_LAYERS}];
            float best = 0.0;
            for (int i = 0; i < ${SPLAT_LAYERS}; i++) {
              if (w[i] > 0.003) {
                det[i] = texture(uDetail, vec3(vTerrainWorld.xz / uLayerTiling[i], float(i)));
                best = max(best, det[i].a + w[i]);
              }
            }
            vec3 c = vec3(0.0);
            vec2 nxy = vec2(0.0);
            float rough = 0.0;
            float total = 0.0;
            for (int i = 0; i < ${SPLAT_LAYERS}; i++) {
              if (w[i] <= 0.003) continue;
              float k = max(det[i].a + w[i] - best + 0.2, 0.0) * w[i];
              c += k * uTint[i] * texture(uAlbedo, vec3(vTerrainWorld.xz / uLayerTiling[i], float(i))).rgb;
              nxy += k * (det[i].rg * 2.0 - 1.0);
              rough += k * det[i].b;
              total += k;
            }
            total = max(total, 0.0001);
            c /= total;
            // Large soft patches of light and dark, so the repeating picture doesn't show.
            float macro = tNoise(vTerrainWorld.xz * 0.045) * 0.6 + tNoise(vTerrainWorld.xz * 0.19) * 0.4;
            c *= mix(0.82, 1.14, macro);
            gTerrainNormal = nxy / total;
            // Ground is matte: scanned roughness maps run dark, which reads as wet plastic on a terrain.
            gTerrainRough = mix(0.6, 1.0, clamp(rough / total, 0.0, 1.0));
            diffuseColor.rgb *= c;
          }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gTerrainRough;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            // Surface detail from the layers' normal maps, on top of the hills' own shape.
            vec3 Nw = normalize(vTerrainNormal);
            vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
            vec3 B = normalize(cross(Nw, T));
            vec3 nt = vec3(gTerrainNormal, sqrt(max(0.0, 1.0 - dot(gTerrainNormal, gTerrainNormal))));
            vec3 nW = normalize(T * nt.x + B * nt.y + Nw * nt.z);
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'ege-terrain';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'EGE:Terrain';
    node.add(mesh);
    const v: TerrainVisual = {
      mesh,
      heights: decodeHeights(d.heights, res),
      splat,
      splatTex,
      splatTex2,
      layers,
      key: `${d.size}|${d.resolution}|${d.maxHeight}`,
      heightsText: d.heights,
      splatText: d.splat,
      layerIds: Array.from({ length: SPLAT_LAYERS }, () => ''),
      uniforms,
      version: 0,
    };
    this.visuals.set(e.id, v);
    this.writeHeights(v, d);
    this.world?.events.emit('entityVisualsChanged', { entity: e });
    return v;
  }

  /** Copy heights into the mesh (optionally only a region) and fix up normals. */
  private writeHeights(v: TerrainVisual, d: TerrainData, region?: { x0: number; x1: number; z0: number; z1: number }): void {
    const pos = v.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = pointsPerSide(v.heights.resolution);
    const x0 = region?.x0 ?? 0;
    const x1 = region?.x1 ?? n - 1;
    const z0 = region?.z0 ?? 0;
    const z1 = region?.z1 ?? n - 1;
    // PlaneGeometry rows run from -Z to +Z after the rotation, same as the heightmap.
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) pos.setY(z * n + x, v.heights.data[z * n + x] * d.maxHeight);
    pos.needsUpdate = true;
    v.version++;
    if (v.heightTex) {
      if (v.heightTex.image.data !== v.heights.data) v.heightTex.image.data = v.heights.data;
      v.heightTex.needsUpdate = true;
    }
    v.mesh.geometry.computeVertexNormals();
    v.mesh.geometry.computeBoundingBox();
    v.mesh.geometry.computeBoundingSphere();
  }

  private applyLayers(v: TerrainVisual, d: TerrainData): void {
    const u = v.uniforms;
    u.uMaxHeight.value = d.maxHeight;
    u.uTiling.value = Math.max(0.05, d.tiling);
    const sizes = u.uLayerTiling.value as number[];
    for (let i = 0; i < SPLAT_LAYERS; i++) {
      const own = (d as unknown as Record<string, number>)[`layer${i + 1}Size`] ?? 0;
      sizes[i] = Math.max(0.05, own > 0 ? own : d.tiling);
    }
    u.uAuto.value = d.autoPaint ? 1 : 0;
    u.uRockSlope.value = d.rockSlope;
    u.uSnowLine.value = d.snowLine;
    const tints = u.uTint.value as THREE.Color[];
    const data = d as unknown as Record<string, string>;
    for (let i = 0; i < SPLAT_LAYERS; i++) {
      const matId = data[`layer${i + 1}Material`] ?? '';
      const color = data[`layer${i + 1}Color`] ?? '#ffffff';
      // A layer with a material shows the material as it is; the color tints plain layers only
      // (a green tint over a green photo would turn it nearly black).
      if (!matId) tints[i].set(color);
      if (v.layerIds[i] === matId) continue;
      v.layerIds[i] = matId;
      if (!matId || !this.assets) {
        v.layers.setLayer(i, null);
        continue;
      }
      this.assets
        .loadMaterial(matId)
        .then((m) => {
          if (v.layerIds[i] !== matId) return;
          const std = m as THREE.MeshStandardMaterial;
          tints[i].copy(std.color ?? new THREE.Color(1, 1, 1));
          v.layers.setLayer(i, std);
        })
        .catch((err: unknown) => console.error('[EGE] Terrain layer failed to load:', err instanceof Error ? err.message : err));
    }
  }

  private remove(id: string): void {
    const v = this.visuals.get(id);
    if (!v) return;
    v.mesh.removeFromParent();
    v.mesh.geometry.dispose();
    v.mesh.material.dispose();
    v.splatTex.dispose();
    v.splatTex2.dispose();
    v.layers.dispose();
    v.heightTex?.dispose();
    this.visuals.delete(id);
  }
}
