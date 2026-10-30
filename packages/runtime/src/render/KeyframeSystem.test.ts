import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { Transform } from '../components/builtin';
import { Keyframes, type Keyframe } from '../components/keyframes';
import { RenderSystem } from './RenderSystem';
import { KeyframeSystem, keyframeTime, sampleKeyframes } from './KeyframeSystem';

const key = (time: number, x: number, turn = 0): Keyframe => ({ time, position: [x, 0, 0], rotation: [0, turn, 0], scale: [1, 1, 1] });

describe('keyframes', () => {
  it('blends between keys (steady or smooth) and turns the short way round', () => {
    const keys = [key(0, 0, 170), key(2, 10, -170)];
    expect(sampleKeyframes(keys, 1, 'linear')!.position[0]).toBeCloseTo(5);
    expect(sampleKeyframes(keys, 0.5, 'smooth')!.position[0]).toBeLessThan(2.5); // eases in
    expect(sampleKeyframes(keys, 5, 'linear')!.position[0]).toBe(10); // past the end: last pose
    // 170° to -170° is 20° through 180°, not 340° the long way: halfway faces straight back.
    const r = sampleKeyframes(keys, 1, 'linear')!.rotation.map((d) => (d * Math.PI) / 180);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
    expect(q.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))).toBeLessThan(0.01);
  });

  it('once / loop / ping-pong timing', () => {
    expect(keyframeTime(3, 2, 'once')).toBe(2);
    expect(keyframeTime(3, 2, 'loop')).toBeCloseTo(1);
    expect(keyframeTime(3, 2, 'ping-pong')).toBeCloseTo(1);
    expect(keyframeTime(1.5, 2, 'ping-pong')).toBeCloseTo(1.5);
  });

  it('plays while the game runs; scripts stop, restart and reverse it; the editor previews without saving', () => {
    const world = new World();
    const render = new RenderSystem(new THREE.Scene());
    world.addSystem(render);
    const keyframes = new KeyframeSystem(render);
    world.addSystem(keyframes);
    const door = world.createEntity({ name: 'Door' });
    door.add(Transform);
    door.add(Keyframes, { keys: [key(0, 0), key(1, 4)], loop: 'once', easing: 'linear', playOnStart: true });
    const run = (s: number) => {
      for (let i = 0; i < Math.round(s * 60); i++) world.update(1 / 60);
    };
    // Editing: a preview poses the drawing only.
    keyframes.preview(door.id, 0.5);
    world.update(1 / 60);
    expect(render.nodeOf(door)!.position.x).toBeCloseTo(2);
    expect(door.require(Transform).position[0]).toBe(0);
    keyframes.preview(door.id, null);

    keyframes.setRunning(true);
    run(0.5);
    expect(door.require(Transform).position[0]).toBeCloseTo(2, 0);
    run(1);
    expect(door.require(Transform).position[0]).toBeCloseTo(4); // once: stays at the end
    keyframes.control(door, 'reverse');
    run(2);
    expect(door.require(Transform).position[0]).toBeCloseTo(0);
    keyframes.control(door, 'restart');
    run(0.25);
    keyframes.control(door, 'stop');
    const stopped = door.require(Transform).position[0];
    run(1);
    expect(door.require(Transform).position[0]).toBe(stopped);
  });
});
