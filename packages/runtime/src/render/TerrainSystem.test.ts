import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { Transform } from '../components/builtin';
import { CharacterController } from '../components/physics';
import { Terrain } from '../components/terrain';
import { RenderSystem } from './RenderSystem';
import { TerrainSystem } from './TerrainSystem';
import { PhysicsSystem } from '../physics/PhysicsSystem';
import { loadPhysics } from '../core/loadPhysics';
import { SPLAT_LAYERS, applyBrush, decodeHeights, decodeSplat, encodeHeights, encodeSplat, flatHeightmap, generateHeightmap, pointsPerSide, splatIndex } from '../terrain/heightmap';

const DT = 1 / 60;

/** A ramp: low at -X/-Z, high at +X (and a little higher toward +Z), so orientation mistakes show. */
function rampHeights(res: number): string {
  const n = pointsPerSide(res);
  const data = new Float32Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) data[z * n + x] = (x / (n - 1)) * 0.8 + (z / (n - 1)) * 0.2;
  return encodeHeights({ resolution: res, data });
}

async function setup() {
  const rapier = await loadPhysics();
  const world = new World();
  const render = new RenderSystem(new THREE.Scene());
  world.addSystem(render);
  const terrain = new TerrainSystem(render);
  world.addSystem(terrain);
  const physics = new PhysicsSystem(rapier, render, { terrain: (id) => terrain.heightmap(id) });
  world.addSystem(physics);
  const ground = world.createEntity({ name: 'Land' });
  ground.add(Transform);
  ground.add(Terrain, { size: 100, maxHeight: 20, resolution: 32, heights: rampHeights(32) });
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s / DT); i++) {
      world.fixedUpdate(DT);
      world.update(DT);
    }
  };
  return { world, terrain, physics, ground, run };
}

describe('terrain', () => {
  it('the mesh follows the heightmap (high side at +X)', async () => {
    const { terrain, ground } = await setup();
    expect(terrain.heightAt(ground, 49, 0)!).toBeGreaterThan(15);
    expect(terrain.heightAt(ground, -49, 0)!).toBeLessThan(5);
    expect(terrain.heightAt(ground, 0, 49)!).toBeGreaterThan(terrain.heightAt(ground, 0, -49)!);
    expect(terrain.heightAt(ground, 80, 0)).toBeNull(); // off the edge
  });

  it('is solid: physics ground matches what you see, everywhere', async () => {
    const { world, physics, terrain, ground, run } = await setup();
    physics.setSimulating(true);
    for (const [x, z] of [[30, -20], [-30, 25], [0, 0]] as const) {
      const hero = world.createEntity({ name: `Hero ${x}` });
      hero.add(Transform, { position: [x, 40, z] });
      hero.add(CharacterController, { playerControlled: false, center: [0, 0.9, 0] });
      run(4); // falling 40 m takes a while
      const feet = hero.require(Transform).position[1];
      expect(Math.abs(feet - terrain.heightAt(ground, x, z)!)).toBeLessThan(0.35);
    }
  });

  it('sculpting raises the ground under the brush, and commits to saved data', async () => {
    const { terrain, ground } = await setup();
    const before = terrain.heightAt(ground, 0, 0)!;
    for (let i = 0; i < 20; i++) terrain.sculpt(ground, new THREE.Vector3(0, 0, 0), { brush: 'raise', radius: 8, strength: 1 });
    expect(terrain.heightAt(ground, 0, 0)!).toBeGreaterThan(before + 4);
    expect(terrain.heightAt(ground, 30, 30)!).toBeCloseTo(decodeHeights(ground.require(Terrain).heights, 32).data.length ? terrain.heightAt(ground, 30, 30)! : 0);
    const saved = terrain.commit(ground)!;
    ground.set(Terrain, saved);
    expect(decodeHeights(ground.require(Terrain).heights, 32).data.some((v) => v > 0.9)).toBe(true);
  });

  it('generates every preset into the 0–1 range', () => {
    for (const preset of ['hills', 'mountains', 'valley', 'island', 'plateaus'] as const) {
      const h = generateHeightmap(64, { preset, seed: 3, roughness: 0.5, scale: 4 });
      const max = Math.max(...h.data);
      expect(max).toBeGreaterThan(0.9);
      expect(Math.min(...h.data)).toBeGreaterThanOrEqual(0);
    }
    // Valley: low in the middle, high at the sides.
    const v = generateHeightmap(64, { preset: 'valley', seed: 3, roughness: 0.5, scale: 4 });
    const n = 65;
    expect(v.data[32 * n + 32]).toBeLessThan(v.data[32 * n + 2]);
  });
});

describe('terrain paint layers', () => {
  it('reads old 4-layer paint and paints any of the 8 layers', () => {
    const res = 8;
    const n = pointsPerSide(res);
    // Old projects: 4 weights per point, all on layer 2.
    const old = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) old[i * 4 + 1] = 255;
    const splat = decodeSplat(encodeSplat(old), res);
    expect(splat.length).toBe(n * n * SPLAT_LAYERS);
    expect(splat[splatIndex(n, 10, 1)]).toBe(255);
    expect(splat[splatIndex(n, 10, 5)]).toBe(0);
    // Paint layer 6 fully in the middle: it takes over, the others fade out.
    const mid = Math.floor(n / 2);
    applyBrush(flatHeightmap(res), splat, { brush: 'paint', gx: mid, gz: mid, radius: 2, strength: 1, layer: 5 });
    const p = mid * n + mid;
    expect(splat[splatIndex(n, p, 5)]).toBe(255);
    expect(splat[splatIndex(n, p, 1)]).toBe(0);
    // Round trip keeps all 8 layers.
    expect(decodeSplat(encodeSplat(splat), res)).toEqual(splat);
  });

  it('breakup paints natural patches instead of an even coat', () => {
    const res = 64;
    const n = pointsPerSide(res);
    const paint = (breakup: number) => {
      const splat = decodeSplat('', res);
      applyBrush(flatHeightmap(res), splat, { brush: 'paint', gx: 32, gz: 32, radius: 80, strength: 1, layer: 5, breakup, breakupScale: 4 });
      const inner: number[] = [];
      for (let z = 24; z <= 40; z++) for (let x = 24; x <= 40; x++) inner.push(splat[splatIndex(n, z * n + x, 5)]);
      return inner;
    };
    const even = paint(0);
    const patchy = paint(1);
    expect(Math.min(...even)).toBeGreaterThan(200); // solid in the middle
    expect(Math.min(...patchy)).toBeLessThan(60); // gaps
    expect(Math.max(...patchy)).toBeGreaterThan(200); // and full patches
  });
});

