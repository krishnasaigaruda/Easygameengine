import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { Transform } from '../components/builtin';
import { ParticleSystem } from '../components/effects';
import { RenderSystem } from './RenderSystem';
import { EffectsSystem } from './EffectsSystem';

function setup() {
  const world = new World();
  const scene = new THREE.Scene();
  const render = new RenderSystem(scene);
  world.addSystem(render);
  const fx = new EffectsSystem(scene, render, { camera: () => new THREE.PerspectiveCamera(), viewportHeight: () => 720 });
  world.addSystem(fx);
  const run = (seconds: number, dt = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) world.update(dt);
  };
  return { world, fx, run, scene };
}

describe('EffectsSystem particles', () => {
  it('emits at its rate and keeps about rate × lifetime alive', () => {
    const { world, fx, run } = setup();
    const e = world.createEntity();
    e.add(Transform);
    e.add(ParticleSystem, { rate: 100, lifetime: 1, burst: 0 });
    run(3);
    expect(fx.particleCount).toBeGreaterThan(80);
    expect(fx.particleCount).toBeLessThan(125);
  });

  it('never exceeds max particles, and bursts fire once', () => {
    const { world, fx, run } = setup();
    const e = world.createEntity();
    e.add(Transform);
    e.add(ParticleSystem, { rate: 0, burst: 500, lifetime: 5, maxParticles: 200 });
    run(0.1);
    expect(fx.particleCount).toBe(200);
    run(6);
    expect(fx.particleCount).toBe(0); // burst does not repeat
  });

  it('freezes when paused (dt 0) and stops preview when disabled', () => {
    const { world, fx, run } = setup();
    const e = world.createEntity();
    e.add(Transform);
    e.add(ParticleSystem, { rate: 50, lifetime: 2 });
    run(0.5);
    const n = fx.particleCount;
    for (let i = 0; i < 60; i++) world.update(0); // paused frames
    expect(fx.particleCount).toBe(n);
    e.set(ParticleSystem, { previewInEditor: false });
    run(0.1);
    expect(fx.particleCount).toBe(0);
    fx.playing = true; // in a running game it shows regardless of preview
    run(0.5);
    expect(fx.particleCount).toBeGreaterThan(0);
  });

  it('negative gravity makes particles rise (smoke), positive makes them fall', () => {
    const { world, run, scene } = setup();
    const up = world.createEntity();
    up.add(Transform);
    up.add(ParticleSystem, { rate: 0, burst: 50, speed: 0, gravity: -0.5, lifetime: 2 });
    const down = world.createEntity();
    down.add(Transform);
    down.add(ParticleSystem, { rate: 0, burst: 50, speed: 0, gravity: 1, lifetime: 2 });
    run(1);
    const group = scene.getObjectByName('EGE:Effects')!;
    const avgY = (p: THREE.Points) => {
      const a = p.geometry.getAttribute('position');
      let s = 0;
      for (let i = 0; i < p.geometry.drawRange.count; i++) s += a.getY(i);
      return s / p.geometry.drawRange.count;
    };
    const [a, b] = group.children as THREE.Points[];
    expect(avgY(a)).toBeGreaterThan(1);
    expect(avgY(b)).toBeLessThan(-3);
  });
});
