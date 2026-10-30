import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { MeshRenderer, Transform } from '../components/builtin';
import { CharacterController } from '../components/physics';
import { Terrain } from '../components/terrain';
import { Grass, Scatter } from '../components/foliage';
import { RenderSystem } from './RenderSystem';
import { TerrainSystem } from './TerrainSystem';
import { GrassSystem } from './GrassSystem';
import { ScatterSystem, mergeByMaterial } from './ScatterSystem';
import { PhysicsSystem } from '../physics/PhysicsSystem';
import { AssetManager } from '../assets/AssetManager';
import { MemoryResolver, makeTestGltfFiles } from '../assets/testModel';
import { loadPhysics } from '../core/loadPhysics';
import { encodeHeights, generateHeightmap } from '../terrain/heightmap';

// The model loader reports progress with ProgressEvent (a browser class).
globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;

const DT = 1 / 60;

async function setup() {
  const world = new World();
  const scene = new THREE.Scene();
  const render = new RenderSystem(scene);
  world.addSystem(render);
  const terrain = new TerrainSystem(render);
  world.addSystem(terrain);
  const camera = new THREE.PerspectiveCamera();
  const grass = new GrassSystem(render, terrain, { camera: () => camera });
  world.addSystem(grass);
  const scatter = new ScatterSystem(render, terrain);
  world.addSystem(scatter);
  const physics = new PhysicsSystem(await loadPhysics(), render, { terrain: (id) => terrain.heightmap(id), scatter: (e) => scatter.placements(e) });
  world.addSystem(physics);
  const land = world.createEntity({ name: 'Land' });
  land.add(Transform);
  land.add(Terrain, { size: 100, maxHeight: 10, resolution: 64, heights: encodeHeights(generateHeightmap(64, { preset: 'hills', seed: 2, roughness: 0.4, scale: 2 })) });
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s / DT); i++) {
      world.fixedUpdate(DT);
      world.update(DT);
    }
  };
  return { world, scene, terrain, grass, scatter, physics, land, run, camera };
}

describe('grass and scatter', () => {
  it('grass draws many blades around the camera, within its budget', async () => {
    const t = await setup();
    t.land.add(Grass, { density: 20, distance: 30 });
    t.run(DT);
    const n = t.grass.bladeCount(t.land.id);
    expect(n).toBeGreaterThan(10000);
    expect(n).toBeLessThanOrEqual(160_000 + 2 * Math.sqrt(160_000) + 1);
    t.land.set(Grass, { density: 120, distance: 120 }); // asks for far too many: thinned to the budget
    expect(t.grass.bladeCount(t.land.id)).toBeLessThanOrEqual(170_000);
  });

  it('grass can grow copies of a 3D grass model, within a triangle budget', async () => {
    const world = new World();
    const render = new RenderSystem(new THREE.Scene());
    world.addSystem(render);
    const terrain = new TerrainSystem(render);
    world.addSystem(terrain);
    const assets = new AssetManager();
    const resolver = new MemoryResolver();
    resolver.assets.set('tuft', { id: 'tuft', type: 'model', name: 'Tuft', main: 'Tri.gltf', files: makeTestGltfFiles() });
    assets.resolver = resolver;
    const camera = new THREE.PerspectiveCamera();
    const grass = new GrassSystem(render, terrain, { camera: () => camera, assets });
    world.addSystem(grass);
    const land = world.createEntity({ name: 'Land' });
    land.add(Transform);
    land.add(Terrain, { size: 100, resolution: 32 });
    land.add(Grass, { model: 'tuft', clumps: 4, clumpHeight: 0.8, distance: 20, painted: false });
    world.update(DT);
    expect(grass.bladeCount(land.id)).toBe(0); // still loading: nothing yet (not the blades)
    for (let i = 0; i < 50 && grass.bladeCount(land.id) === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const n = grass.bladeCount(land.id);
    expect(n).toBeGreaterThan(4 * 40 * 40 * 0.9); // 4 per m² over the 40 × 40 m around the camera
    const mesh = render.root.parent!.getObjectByName('EGE:Grass') as THREE.Mesh;
    expect(mesh.geometry.getAttribute('position').count).toBe(3); // the model's one triangle, not a blade tuft
    // Back to blades.
    land.set(Grass, { model: '' });
    expect(grass.bladeCount(land.id)).toBeGreaterThan(0);
  });

  it('scatter puts the requested number of things on the ground, the same way every time', async () => {
    const t = await setup();
    const forest = t.world.createEntity({ name: 'Forest', parent: t.land });
    forest.add(Transform);
    forest.add(Scatter, { shape: 'pine tree', count: 50, maxHeight: 1, maxSlope: 60, seed: 4 });
    t.run(DT);
    expect(t.scatter.count(forest.id)).toBe(50);
    const a = t.scatter.placements(forest);
    const b = t.scatter.placements(forest);
    expect(a).toEqual(b);
    for (const p of a.slice(0, 10)) expect(Math.abs(p.y - t.terrain.heightAt(t.land, p.x, p.z)!)).toBeLessThan(0.05);
  });

  it('tree trunks are solid; bushes are not', async () => {
    const t = await setup();
    const flat = t.world.createEntity({ name: 'Flat' });
    flat.add(Transform, { position: [500, 0, 0] });
    flat.add(Terrain, { size: 40, maxHeight: 1, resolution: 16, heights: '' });
    const tree = t.world.createEntity({ name: 'Tree', parent: flat });
    tree.add(Transform);
    tree.add(Scatter, { shape: 'pine tree', count: 1, area: 0.01, minScale: 1, maxScale: 1, maxHeight: 1 });
    const hero = t.world.createEntity({ name: 'Hero' });
    hero.add(Transform, { position: [500, 0.1, 3] });
    hero.add(CharacterController, { playerControlled: false });
    t.physics.setSimulating(true);
    t.run(0.3);
    // Walk straight at the trunk: the capsule may slide around it, but never through it.
    const closest = () => {
      let min = Infinity;
      for (let i = 0; i < 150; i++) {
        t.physics.setMoveIntent(hero, new THREE.Vector3(0, 0, -1));
        t.run(DT);
        const p = hero.require(Transform).position;
        min = Math.min(min, Math.hypot(p[0] - 500, p[2]));
      }
      return min;
    };
    expect(closest()).toBeGreaterThan(0.45); // trunk radius 0.2 + capsule radius 0.35, minus a little skin
    tree.set(Scatter, { shape: 'bush' });
    hero.set(Transform, { position: [500, 0.1, 3] });
    t.run(0.1);
    expect(closest()).toBeLessThan(0.2); // bushes don't block
  });

  it('painting: a dab fills the map, Shift-style erase clears it; painted plants appear only there', async () => {
    const { paintDab, encodePaint, decodePaint } = await import('../terrain/heightmap');
    const t = await setup();
    const map = decodePaint('', 64);
    expect(map.every((v) => v === 0)).toBe(true);
    paintDab(map, 64, 32, 32, 4, 1, false);
    expect(map[32 * 65 + 32]).toBe(255);
    const flowers = t.world.createEntity({ name: 'Flowers', parent: t.land });
    flowers.add(Transform);
    flowers.add(Scatter, { shape: 'flowers', placement: 'painted', density: 5, maxSlope: 89, paintMap: encodePaint(map) });
    t.run(DT);
    const placed = t.scatter.placements(flowers);
    expect(placed.length).toBeGreaterThan(20);
    for (const p of placed) expect(Math.hypot(p.x, p.z)).toBeLessThan(8); // all near the painted spot (centre)
    paintDab(map, 64, 32, 32, 6, 1, true);
    flowers.set(Scatter, { paintMap: encodePaint(map) });
    expect(t.scatter.placements(flowers)).toHaveLength(0);
  });

  it('keeps clear of houses and rocks when asked (not of the ground)', async () => {
    const t = await setup();
    const trees = t.world.createEntity({ name: 'Trees', parent: t.land });
    trees.add(Transform);
    trees.add(Scatter, { shape: 'round tree', count: 400, maxSlope: 89, maxHeight: 1 });
    const house = t.world.createEntity({ name: 'House' });
    house.add(Transform, { position: [0, 5, 0], scale: [10, 6, 10] });
    house.add(MeshRenderer, { shape: 'box' });
    const ground = t.world.createEntity({ name: 'Ground' });
    ground.add(Transform, { scale: [200, 1, 200] });
    ground.add(MeshRenderer, { shape: 'plane' });
    t.run(DT);
    const inHouse = (ps: { x: number; z: number }[]) => ps.filter((p) => Math.abs(p.x) < 5 && Math.abs(p.z) < 5).length;
    expect(inHouse(t.scatter.placements(trees))).toBeGreaterThan(0);
    trees.set(Scatter, { keepClear: true });
    const clear = t.scatter.placements(trees);
    expect(inHouse(clear)).toBe(0);
    expect(clear.length).toBeGreaterThan(300); // the big ground plane doesn't count
  });

  it('painted grass grows only after painting (the live map updates the blades)', async () => {
    const t = await setup();
    t.land.add(Grass, { painted: true });
    t.run(DT);
    const live = t.grass.paintData(t.land.id)!;
    expect(live.map.every((v) => v === 0)).toBe(true);
    const { paintDab } = await import('../terrain/heightmap');
    paintDab(live.map, live.resolution, 10, 10, 3, 1, false);
    live.changed();
    expect(live.map.some((v) => v > 0)).toBe(true);
  });
});

describe('Scatter model merging', () => {
  it('draws a many-piece model with one mesh per material', () => {
    const bark = new THREE.MeshStandardMaterial();
    const leaf = new THREE.MeshStandardMaterial();
    const at = (y: number) => new THREE.Matrix4().makeTranslation(0, y, 0);
    const parts = [
      { geometry: new THREE.BoxGeometry(), material: bark, local: at(0) },
      ...Array.from({ length: 50 }, (_, i) => ({ geometry: new THREE.SphereGeometry(0.3, 4, 3), material: leaf, local: at(2 + i * 0.01) })),
      { geometry: new THREE.BoxGeometry().toNonIndexed(), material: leaf, local: at(5) },
    ];
    const { parts: merged, owned } = mergeByMaterial(parts);
    expect(merged.length).toBe(2);
    expect(owned.length).toBe(1);
    const leaves = merged.find((p) => p.material === leaf)!;
    const box = new THREE.Box3().setFromBufferAttribute(leaves.geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(box.max.y).toBeCloseTo(5.5); // the pieces kept their places
    expect(parts[1].geometry.getAttribute('position').getY(0)).toBeCloseTo(0.3); // originals untouched
  });
});

