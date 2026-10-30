import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { asFoliage } from './foliageMaterial';
import { bushParts, fallenLeavesParts, fernParts, flowerParts, grassClumpParts, pebblesParts } from './plantParts';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { Scatter, type ScatterData } from '../components/foliage';
import { Terrain } from '../components/terrain';
import { scatterPlacements, type Placement } from '../terrain/scatter';
import { decodePaint, encodePaint } from '../terrain/heightmap';
import type { RenderSystem } from './RenderSystem';
import type { TerrainSystem } from './TerrainSystem';
import type { AssetManager } from '../assets/AssetManager';

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Each copy gets its own color (flower heads). */
  tinted?: boolean;
  /** Colors the copies cycle through when tinted (default: flower colors). */
  palette?: THREE.Color[];
  /** Transform inside one instance (model hierarchy, or a built-in part's offset). */
  local: THREE.Matrix4;
}

/**
 * One draw per material instead of one per mesh: a downloaded tree made of 200 pieces with 2
 * materials becomes 2 parts. The merged geometries are new (the asset's own stay untouched).
 */
export function mergeByMaterial(parts: Part[]): { parts: Part[]; owned: THREE.BufferGeometry[] } {
  const groups = new Map<THREE.Material, Part[]>();
  const out: Part[] = [];
  for (const p of parts) {
    if (p.tinted || Array.isArray(p.material)) {
      out.push(p);
      continue;
    }
    let g = groups.get(p.material);
    if (!g) groups.set(p.material, (g = []));
    g.push(p);
  }
  const owned: THREE.BufferGeometry[] = [];
  for (const [material, list] of groups) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    // Every piece gets the same attributes, as plain float arrays (pieces missing one get a
    // neutral value: white vertex colors, zero texture coordinates) — dropping an attribute
    // instead would strip the textures off the whole model.
    const sizes = new Map<string, number>();
    for (const p of list) for (const [n, attr] of Object.entries(p.geometry.attributes)) if (!sizes.has(n)) sizes.set(n, attr.itemSize);
    const indexed = list.every((p) => p.geometry.index);
    const pieces = list.map((p) => {
      let src = indexed || !p.geometry.index ? p.geometry : p.geometry.toNonIndexed();
      if (sizes.has('normal') && !src.getAttribute('normal')) {
        src = src.clone();
        src.computeVertexNormals();
      }
      const g = new THREE.BufferGeometry();
      const count = src.getAttribute('position').count;
      for (const [n, size] of sizes) {
        const attr = src.getAttribute(n);
        const out = new Float32Array(count * size);
        if (attr) {
          for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) out[i * size + c] = attr.getComponent(i, c);
        } else if (n.startsWith('color')) out.fill(1);
        g.setAttribute(n, new THREE.BufferAttribute(out, size));
      }
      if (indexed && src.index) g.setIndex(Array.from(src.index.array));
      if (!sizes.has('normal')) g.computeVertexNormals();
      g.applyMatrix4(p.local);
      return g;
    });
    const merged = mergeGeometries(pieces, false);
    for (const g of pieces) g.dispose();
    if (!merged) {
      out.push(...list);
      continue;
    }
    owned.push(merged);
    out.push({ geometry: merged, material, local: new THREE.Matrix4() });
  }
  return { parts: out, owned };
}

/** The same order every time, shuffled (so drawing the first N copies thins evenly). */
function shuffled<T>(list: T[], seed: number): T[] {
  const a = [...list];
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const j = (x >>> 0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface ScatterVisual {
  group: THREE.Group;
  key: string;
}

/** Built-in low-poly shapes (no download needed). Each is 1 unit tall-ish, origin at the base. */
function builtinParts(shape: ScatterData['shape'], color: string): Part[] {
  const c = new THREE.Color(color);
  const bark = new THREE.MeshStandardMaterial({ color: '#5a3d27', roughness: 1, flatShading: true });
  const leaf = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true });
  const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
  switch (shape) {
    case 'round tree':
      return [
        { geometry: new THREE.CylinderGeometry(0.14, 0.22, 2.4, 7), material: bark, local: at(0, 1.2, 0) },
        { geometry: new THREE.IcosahedronGeometry(1.5, 1), material: leaf, local: at(0, 3.3, 0, 1, 0.9, 1) },
      ];
    case 'rock': {
      const g = new THREE.IcosahedronGeometry(0.6, 1);
      const pos = g.getAttribute('position');
      const r = (i: number) => 0.75 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.5;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * r(i), pos.getY(i) * r(i + 7) * 0.7, pos.getZ(i) * r(i + 3));
      g.computeVertexNormals();
      return [{ geometry: g, material: new THREE.MeshStandardMaterial({ color: color === '#3c6b2c' ? '#7b7b78' : c, roughness: 1, flatShading: true }), local: at(0, 0.25, 0) }];
    }
    case 'bush':
      return bushParts(c);
    case 'flowers':
      return flowerParts(new THREE.Color('#4f7a34'));
    case 'grass clump':
      return grassClumpParts(c);
    case 'fern':
      return fernParts(c);
    case 'fallen leaves':
      return fallenLeavesParts();
    case 'pebbles':
      return pebblesParts();
    default: // pine tree
      return [
        { geometry: new THREE.CylinderGeometry(0.12, 0.2, 1.6, 6), material: bark, local: at(0, 0.8, 0) },
        { geometry: new THREE.ConeGeometry(1.3, 2.4, 8), material: leaf, local: at(0, 2.4, 0) },
        { geometry: new THREE.ConeGeometry(1.0, 2.0, 8), material: leaf, local: at(0, 3.5, 0) },
        { geometry: new THREE.ConeGeometry(0.65, 1.6, 8), material: leaf, local: at(0, 4.5, 0) },
      ];
  }
}

/** Triangles one Scatter may draw in total (all copies). */
const TRIANGLE_BUDGET = 1_500_000;
/** Beyond this share of the draw distance, chunks draw fewer and fewer copies (down to THIN_MIN). */
/** Thinning starts this far out (share of the draw distance): close by, every plant stays. */
const THIN_FROM = 0.65;
/** Plants seen only this close (flowers, leaves, pebbles) never thin: popping would show. */
const NO_THIN_BELOW = 90;
const THIN_MIN = 0.2;
const THIN_STEPS = 4;
/** Chunk size in meters (each chunk is culled on its own). */
const CHUNK = 32;
/** Only scattered things this close cast shadows. */
const SHADOW_DISTANCE = 70;

const FLOWER_COLORS = ['#f4f1e8', '#ffd84d', '#e25b7a', '#a77bff', '#ff8f4d', '#7fc8ff'].map((c) => new THREE.Color(c));

/** Scatter components: many copies of a shape or model, drawn as instanced meshes. */
export class ScatterSystem implements System {
  readonly name = 'scatter';
  readonly order = 1015;
  private world: World | null = null;
  private readonly visuals = new Map<string, ScatterVisual>();
  private unsubscribers: (() => void)[] = [];
  private token = 0;

  constructor(
    private readonly render: RenderSystem,
    private readonly terrain: TerrainSystem,
    private readonly assets: AssetManager | null = null,
    /** For draw distance (optional: without it everything is drawn). */
    private readonly camera?: () => THREE.Camera,
    /** Quality: multiplies draw and shadow distances. */
    private readonly drawScale?: () => number,
  ) {}

  attach(world: World): void {
    this.world = world;
    const ev = world.events;
    const sync = ({ entity, type }: { entity: Entity; type: string }) => {
      if (type === Scatter.type) this.sync(entity);
      // A terrain changed: everything scattered on it (itself or its children) follows the ground.
      if (type === Terrain.type) for (const c of [entity, ...entity.children]) this.sync(c);
    };
    this.unsubscribers = [
      ev.on('componentAdded', sync),
      ev.on('componentChanged', sync),
      ev.on('componentRemoved', sync),
      ev.on('entityDestroyed', ({ entity }) => this.remove(entity.id)),
    ];
    for (const e of world.all()) this.sync(e);
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    for (const id of [...this.visuals.keys()]) this.remove(id);
    this.world = null;
  }

  /** The terrain things scatter on: the same object, or its parent. */
  private ground(e: Entity): Entity | null {
    if (e.has(Terrain)) return e;
    return e.parent?.has(Terrain) ? e.parent : null;
  }

  /** Where an entity's scattered things are, in its own space (shared with physics). */
  placements(e: Entity, override?: ScatterData): Placement[] {
    const d = override ?? e.get(Scatter);
    if (!d) return [];
    const g = this.ground(e);
    const t = g?.get(Terrain);
    const heights = g && t ? this.terrain.heightmap(g.id) : null;
    if (!g || !t || !heights) return this.clear(e, d, scatterPlacements(d));
    // A child of the terrain: sample the terrain where the child's spots really are.
    const off = g === e ? [0, 0, 0] : (e.get('Transform') as { position: [number, number, number] } | undefined)?.position ?? [0, 0, 0];
    return this.clear(e, d, scatterPlacements({ ...d, area: d.area > 0 ? d.area : t.size }, { data: t, heights, offset: [off[0], off[2]] }).map((p) => ({ ...p, y: p.y - off[1] })));
  }

  /** Keep clear: the spots not under or right by another object. */
  private clear(e: Entity, d: ScatterData, all: Placement[]): Placement[] {
    if (!d.keepClear) return all;
    const boxes = this.obstacles(e, d);
    const node = this.render.nodeOf(e);
    if (!boxes.length || !node) return all;
    node.updateWorldMatrix(true, false);
    const p = new THREE.Vector3();
    return all.filter((s) => {
      p.set(s.x, s.y, s.z).applyMatrix4(node.matrixWorld);
      return !boxes.some((b) => p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z);
    });
  }

  /** What plants keep clear of: the footprints of the other things you can see, with room around. */
  private obstacles(e: Entity, d: ScatterData): THREE.Box3[] {
    // Big plants need more room (a tree's crown reaches out about half its height).
    const reach = d.shape === 'model' ? d.fitHeight * 0.45 : d.shape.includes('tree') ? 3 : 0;
    const out: THREE.Box3[] = [];
    const ground = this.ground(e);
    for (const o of this.world?.all() ?? []) {
      if (o === e || o === ground || o.has(Terrain) || o.has(Scatter)) continue;
      if (!o.has('MeshRenderer') && !o.has('ModelRenderer')) continue;
      const node = this.render.nodeOf(o);
      if (!node) continue;
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) continue;
      const size = box.getSize(new THREE.Vector3());
      // A ground or floor plane covers everything: not something to keep clear of.
      if (size.x > 80 || size.z > 80) continue;
      out.push(box.expandByScalar(Math.min(3, 0.5 + Math.max(size.x, size.z) * 0.25) + reach));
    }
    return out;
  }

  /** Grow again where what they keep clear of moved (after a batch of changes). */
  refresh(): void {
    for (const e of this.world?.all() ?? []) if (e.has(Scatter)) this.sync(e);
  }

  /** Painting plants: the live paint map (edit it, then call changed() to regrow). */
  paintData(e: Entity): { map: Uint8Array; resolution: number; changed: () => void } | null {
    const d = e.get(Scatter);
    const g = this.ground(e);
    const t = g?.get(Terrain);
    if (!d || !t || d.placement !== 'painted') return null;
    const res = Math.round(t.resolution);
    let live = this.livePaint.get(e.id);
    if (!live || live.res !== res) {
      live = { map: decodePaint(d.paintMap, res), res };
      this.livePaint.set(e.id, live);
    }
    const map = live.map;
    return {
      map,
      resolution: res,
      changed: () => {
        // Regrow from the live map without touching the saved data (saved when the stroke ends).
        const now = performance.now();
        if (now - (this.lastRegrow.get(e.id) ?? 0) < 90) return;
        this.lastRegrow.set(e.id, now);
        this.regrow(e, { ...d, paintMap: encodePaint(map) });
      },
    };
  }

  private readonly livePaint = new Map<string, { map: Uint8Array; res: number }>();
  private readonly lastRegrow = new Map<string, number>();

  /** Instances drawn for an entity (tests). */
  count(entityId: string): number {
    const g = this.visuals.get(entityId)?.group;
    return (g?.children ?? []).reduce((n, chunk) => {
      const m = chunk.children[0] as THREE.InstancedMesh | undefined;
      return n + ((m?.userData.full as number | undefined) ?? m?.count ?? 0);
    }, 0);
  }

  private sync(e: Entity): void {
    const d = e.get(Scatter);
    if (!d) return this.remove(e.id);
    const node = this.render.nodeOf(e);
    if (!node) return;
    const g = this.ground(e);
    const t = g?.get(Terrain);
    const clear = d.keepClear ? this.obstacles(e, d).map((b) => [b.min.x, b.min.z, b.max.x, b.max.z].map((v) => Math.round(v * 2) / 2).join(',')).join(';') : '';
    const key = JSON.stringify(d) + JSON.stringify(e.get('Transform') ?? null) + (t ? `|${t.size}|${t.maxHeight}|${t.heights.length}|${t.heights.slice(-64)}` : '') + clear;
    const v = this.visuals.get(e.id);
    if (v && v.key === key && v.group.parent === node) return;
    // The saved paint changed (stroke ended, undo): forget the live copy.
    if (this.livePaint.has(e.id) && d.paintMap !== encodePaint(this.livePaint.get(e.id)!.map)) this.livePaint.delete(e.id);
    this.regrow(e, d, key);
  }

  private regrow(e: Entity, d: ScatterData, key = this.visuals.get(e.id)?.key ?? ''): void {
    const node = this.render.nodeOf(e);
    if (!node) return;
    this.remove(e.id);
    const group = new THREE.Group();
    group.name = 'EGE:Scatter';
    node.add(group);
    this.visuals.set(e.id, { group, key });
    const placements = this.placements(e, d);
    const token = ++this.token;
    if (d.shape === 'model') {
      if (!d.model || !this.assets) return;
      void this.assets
        .instantiate(d.model)
        .then(({ object }) => {
          const current = this.visuals.get(e.id);
          if (token !== this.token && current?.group !== group) return;
          object.updateMatrixWorld(true);
          // Downloaded models come in any size: fit to the wanted height, base on the ground, centred.
          const box = new THREE.Box3().setFromObject(object);
          const h = box.max.y - box.min.y;
          const k = d.fitHeight > 0 && h > 1e-6 ? d.fitHeight / h : 1;
          const c = box.getCenter(new THREE.Vector3());
          const fit = d.fitHeight > 0 ? new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z)) : new THREE.Matrix4();
          const parts: Part[] = [];
          object.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) parts.push({ geometry: m.geometry, material: m.material as THREE.Material, local: fit.clone().multiply(m.matrixWorld) });
          });
          for (const part of parts) part.material = asFoliage(part.material);
          const merged = mergeByMaterial(parts);
          group.userData.owned = merged.owned;
          this.fill(group, merged.parts, placements, d);
        })
        .catch((err: unknown) => console.error('[EGE] Scatter model failed to load:', err instanceof Error ? err.message : err));
    } else {
      this.fill(group, builtinParts(d.shape, d.color), placements, d);
    }
    this.world?.events.emit('entityVisualsChanged', { entity: e });
  }

  private fill(group: THREE.Group, parts: Part[], all: Placement[], d: ScatterData): void {
    // Detail budget: a very detailed model painted many times would bring any GPU to its knees.
    const trisEach = parts.reduce((n, p) => n + (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute('position').count) / 3, 0);
    let placements = all;
    if (trisEach * all.length > TRIANGLE_BUDGET) {
      const keep = Math.max(1, Math.floor(TRIANGLE_BUDGET / Math.max(1, trisEach)));
      const step = all.length / keep;
      placements = Array.from({ length: keep }, (_, i) => all[Math.floor(i * step)]);
      console.error(
        `[EGE] "${group.parent?.name ?? 'Scatter'}": each copy has ${Math.round(trisEach).toLocaleString()} triangles, too many for ${all.length} copies. Showing ${keep}. Use a lighter (game-ready) model for big areas.`,
      );
    }
    // Split into chunks so the GPU only draws what's on screen and near enough.
    const chunks = new Map<string, Placement[]>();
    for (const p of placements) {
      const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      let list = chunks.get(key);
      if (!list) chunks.set(key, (list = []));
      list.push(p);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let index = 0;
    for (const [key, cell] of chunks) {
      const list = shuffled(cell, key.length * 31 + cell.length);
      const chunk = new THREE.Group();
      chunk.name = 'EGE:ScatterChunk';
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        list.forEach((p, i) => {
          q.setFromAxisAngle(up, p.yaw);
          if (d.alignToGround) q.premultiply(new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(...p.normal)));
          m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale)).multiply(part.local);
          mesh.setMatrixAt(i, m);
          if (part.tinted) {
            const colors = part.palette ?? FLOWER_COLORS;
            mesh.setColorAt(i, colors[(index + i) % colors.length]);
          }
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere(); // lets three skip chunks that are off screen
        chunk.add(mesh);
      }
      index += list.length;
      group.add(chunk);
    }
    group.userData.drawDistance = d.drawDistance;
  }

  /** Every frame: hide far-away chunks; only near ones cast shadows. */
  lateUpdate(): void {
    const cam = this.camera?.();
    if (!cam) return;
    cam.updateWorldMatrix(true, false);
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const far = this.drawScale?.() ?? 1;
    const center = new THREE.Vector3();
    for (const v of this.visuals.values()) {
      const dist = (v.group.userData.drawDistance ?? 250) * far;
      for (const chunk of v.group.children) {
        const first = chunk.children[0] as THREE.InstancedMesh | undefined;
        if (!first?.boundingSphere) continue;
        center.copy(first.boundingSphere.center).applyMatrix4(chunk.matrixWorld);
        const d = Math.max(0, center.distanceTo(camPos) - first.boundingSphere.radius);
        // Margins on both switches, so chunks at the line don't flicker as the camera moves.
        chunk.visible = chunk.visible ? d < dist * 1.05 : d < dist;
        if (!chunk.visible) continue;
        const shadowLine = SHADOW_DISTANCE * far;
        const had = chunk.userData.shadows as boolean | undefined;
        const shadows = had ? d < shadowLine * 1.15 : d < shadowLine;
        chunk.userData.shadows = shadows;
        // Far away, fewer copies (they're tiny on screen); the order is shuffled so it thins evenly.
        // In a few fixed steps that only change past a margin: thinning smoothly with distance would
        // make plants pop in and out all the time as you walk.
        const t = dist < NO_THIN_BELOW ? 0 : THREE.MathUtils.clamp((d / dist - THIN_FROM) / (1 - THIN_FROM), 0, 1);
        const level = (chunk.userData.thinLevel as number | undefined) ?? Math.round(t * THIN_STEPS);
        const exact = t * THIN_STEPS;
        // A full step past the line before switching, so walking back and forth doesn't flip it.
        const nextLevel = Math.abs(exact - level) >= 1 ? Math.round(exact) : level;
        chunk.userData.thinLevel = nextLevel;
        const share = 1 - (nextLevel / THIN_STEPS) * (1 - THIN_MIN);
        for (const c of chunk.children) {
          const mesh = c as THREE.InstancedMesh;
          mesh.castShadow = shadows;
          const full = (mesh.userData.full ??= mesh.count) as number;
          mesh.count = Math.max(1, Math.ceil(full * share));
        }
      }
    }
  }

  private remove(id: string): void {
    const v = this.visuals.get(id);
    if (!v) return;
    v.group.removeFromParent();
    for (const chunk of v.group.children) for (const c of chunk.children) (c as THREE.InstancedMesh).dispose();
    for (const g of (v.group.userData.owned ?? []) as THREE.BufferGeometry[]) g.dispose();
    this.visuals.delete(id);
  }
}
