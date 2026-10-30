import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import type { AssetManager } from '../assets/AssetManager';
import { Tilemap, parseCell, tileFor, type TilemapData } from '../components/tilemap';
import type { RenderSystem } from './RenderSystem';
import { litBy2DLights } from './light2d';

interface Visual {
  mesh: THREE.Mesh;
  /** What the mesh was built from (rebuilt when it changes). */
  key: string;
  image: string;
  token: number;
  /** Tileset size in pixels (for keeping tiles from bleeding into each other). */
  px: { w: number; h: number } | null;
}

/** Draws Tilemap components: one mesh per tilemap, every painted cell a quad from the tileset. */
export class TilemapSystem implements System {
  readonly name = 'tilemaps';
  readonly order = 905;
  private world: World | null = null;
  private readonly visuals = new Map<string, Visual>();
  private nextToken = 1;

  constructor(
    private readonly render: RenderSystem,
    private readonly assets: AssetManager,
  ) {}

  attach(world: World): void {
    this.world = world;
  }

  detach(): void {
    for (const id of [...this.visuals.keys()]) this.remove(id);
    this.world = null;
  }

  /** The tilemap's mesh (editor picking, bounds). */
  meshOf(entityId: string): THREE.Mesh | undefined {
    return this.visuals.get(entityId)?.mesh;
  }

  lateUpdate(): void {
    if (!this.world) return;
    const seen = new Set<string>();
    for (const e of this.world.query(Tilemap)) {
      seen.add(e.id);
      this.sync(e, e.require(Tilemap));
    }
    for (const id of [...this.visuals.keys()]) if (!seen.has(id)) this.remove(id);
  }

  private sync(e: Entity, d: TilemapData): void {
    const node = this.render.nodeOf(e);
    if (!node) return;
    let v = this.visuals.get(e.id);
    if (!v) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), litBy2DLights(new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, toneMapped: false })));
      mesh.name = 'Tilemap';
      v = { mesh, key: '', image: '', token: 0, px: null };
      this.visuals.set(e.id, v);
    }
    if (v.mesh.parent !== node) node.add(v.mesh);
    const mat = v.mesh.material as THREE.MeshBasicMaterial;
    if (v.image !== d.tileset) {
      v.image = d.tileset;
      v.px = null;
      v.key = '';
      const token = ++this.nextToken;
      v.token = token;
      (mat.map as THREE.Texture | null)?.dispose();
      mat.map = null;
      mat.color.set(d.tileset ? '#ffffff' : '#6b8f4e');
      mat.needsUpdate = true;
      if (d.tileset)
        void this.assets.loadTexture(d.tileset).then(
          (shared) => {
            const vis = this.visuals.get(e.id);
            if (vis?.token !== token) return;
            const tex = shared.clone();
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.generateMipmaps = false;
            tex.needsUpdate = true;
            const img = tex.image as { width?: number; height?: number } | undefined;
            vis.px = { w: img?.width ?? 1, h: img?.height ?? 1 };
            mat.map = tex;
            mat.needsUpdate = true;
            vis.key = ''; // rebuild with the real pixel size
          },
          () => {},
        );
    }
    const filter = d.pixelArt ? THREE.NearestFilter : THREE.LinearFilter;
    if (mat.map && (mat.map.magFilter !== filter || mat.map.minFilter !== filter)) {
      mat.map.magFilter = mat.map.minFilter = filter;
      mat.map.needsUpdate = true;
    }
    v.mesh.position.z = d.layer * 0.002;
    v.mesh.renderOrder = d.layer;
    const key = JSON.stringify([d.cells, d.columns, d.rows, d.tileSize, d.autoTile, !!v.px]);
    if (key === v.key) return;
    v.key = key;
    v.mesh.geometry.dispose();
    v.mesh.geometry = buildGeometry(d, v.px);
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

/** One quad per painted cell, its corner of the tileset mapped on. */
function buildGeometry(d: TilemapData, px: { w: number; h: number } | null): THREE.BufferGeometry {
  const keys = Object.keys(d.cells);
  const cols = Math.max(1, Math.round(d.columns));
  const rows = Math.max(1, Math.round(d.rows));
  const s = d.tileSize;
  const pos = new Float32Array(keys.length * 12);
  const uv = new Float32Array(keys.length * 8);
  const index: number[] = [];
  // Half a pixel in, so neighbouring tiles never bleed in at the edges.
  const ix = px ? 0.5 / px.w : 0;
  const iy = px ? 0.5 / px.h : 0;
  keys.forEach((key, i) => {
    const [x, y] = parseCell(key);
    const t = Math.max(0, tileFor(d, x, y));
    const c = t % cols;
    const r = Math.floor(t / cols) % rows;
    const u0 = c / cols + ix;
    const u1 = (c + 1) / cols - ix;
    const v1 = 1 - r / rows - iy;
    const v0 = 1 - (r + 1) / rows + iy;
    pos.set([x * s, y * s, 0, (x + 1) * s, y * s, 0, (x + 1) * s, (y + 1) * s, 0, x * s, (y + 1) * s, 0], i * 12);
    uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
