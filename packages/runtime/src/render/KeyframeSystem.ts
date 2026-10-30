import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import type { Vec3 } from '../core/Component';
import { Transform } from '../components/builtin';
import { Keyframes, keyframesDuration, type Keyframe, type KeyframesData } from '../components/keyframes';
import type { RenderSystem } from './RenderSystem';

const DEG = Math.PI / 180;

/** The pose at time t (keys sorted by time). */
export function sampleKeyframes(keys: readonly Keyframe[], t: number, easing: KeyframesData['easing']): { position: Vec3; rotation: Vec3; scale: Vec3 } | null {
  if (!keys.length) return null;
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  if (t <= sorted[0].time) return clonePose(sorted[0]);
  const last = sorted[sorted.length - 1];
  if (t >= last.time) return clonePose(last);
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].time < t) i++;
  const a = sorted[i];
  const b = sorted[i + 1];
  let f = (t - a.time) / Math.max(1e-6, b.time - a.time);
  if (easing === 'smooth') f = f * f * (3 - 2 * f);
  const lerp = (x: Vec3, y: Vec3): Vec3 => [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f];
  // Turn the short way round (quaternions), then back to degrees.
  const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(a.rotation[0] * DEG, a.rotation[1] * DEG, a.rotation[2] * DEG));
  const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.rotation[0] * DEG, b.rotation[1] * DEG, b.rotation[2] * DEG));
  const e = new THREE.Euler().setFromQuaternion(qa.slerp(qb, f));
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { position: lerp(a.position, b.position), rotation: [r(e.x / DEG), r(e.y / DEG), r(e.z / DEG)], scale: lerp(a.scale, b.scale) };
}

function clonePose(k: Keyframe): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  return { position: [...k.position], rotation: [...k.rotation], scale: [...k.scale] };
}

/** Where in the animation a running clock is (once / loop / ping-pong). */
export function keyframeTime(clock: number, duration: number, loop: KeyframesData['loop']): number {
  if (duration <= 0) return 0;
  if (loop === 'once') return Math.min(clock, duration);
  if (loop === 'loop') return clock % duration;
  const cycle = clock % (2 * duration);
  return cycle <= duration ? cycle : 2 * duration - cycle;
}

interface Playback {
  clock: number;
  playing: boolean;
  direction: 1 | -1;
}

/**
 * Plays Keyframes components while the game runs (moving the object's Transform), and lets the
 * editor preview any moment without changing what's saved.
 */
export class KeyframeSystem implements System {
  readonly name = 'keyframes';
  /** After RenderSystem (1000): editor previews pose the node after it was placed. */
  readonly order = 1001;
  private world: World | null = null;
  private running = false;
  private readonly playback = new Map<string, Playback>();
  private readonly previews = new Map<string, number>();

  constructor(private readonly render: RenderSystem) {}

  attach(world: World): void {
    this.world = world;
  }

  detach(): void {
    this.world = null;
    this.playback.clear();
    this.previews.clear();
  }

  setRunning(on: boolean): void {
    this.running = on;
    this.playback.clear();
    if (!on || !this.world) return;
    for (const e of this.world.query(Keyframes)) {
      this.playback.set(e.id, { clock: 0, playing: e.require(Keyframes).playOnStart, direction: 1 });
    }
  }

  /** Scripts: play (from where it is), stop, restart or go backwards. */
  control(e: Entity, command: string): boolean {
    if (!e.has(Keyframes)) return false;
    let p = this.playback.get(e.id);
    if (!p) this.playback.set(e.id, (p = { clock: 0, playing: false, direction: 1 }));
    const duration = keyframesDuration(e.require(Keyframes).keys);
    switch (command) {
      case 'stop':
        p.playing = false;
        break;
      case 'restart':
        p.clock = 0;
        p.direction = 1;
        p.playing = true;
        break;
      case 'reverse':
        p.direction = -1;
        p.clock = Math.min(p.clock, duration);
        p.playing = true;
        break;
      default:
        p.direction = 1;
        if (e.require(Keyframes).loop === 'once' && p.clock >= duration) p.clock = 0;
        p.playing = true;
    }
    return true;
  }

  /** Editor: show the object at this moment of its animation (null = back to normal). */
  preview(entityId: string, time: number | null): void {
    if (time === null) this.previews.delete(entityId);
    else this.previews.set(entityId, time);
  }

  update(dt: number): void {
    const w = this.world;
    if (!w || !this.running || dt <= 0) return;
    for (const e of w.query(Keyframes)) {
      const p = this.playback.get(e.id);
      const k = e.require(Keyframes);
      if (!p?.playing || !e.activeInHierarchy || k.keys.length < 2) continue;
      const duration = keyframesDuration(k.keys);
      p.clock += dt * k.speed * p.direction;
      if (p.clock < 0) {
        p.clock = 0;
        p.playing = false;
      }
      if (k.loop === 'once' && p.clock >= duration) {
        p.clock = duration;
        p.playing = false;
      }
      const pose = sampleKeyframes(k.keys, keyframeTime(p.clock, duration, k.loop), k.easing);
      if (pose) e.set(Transform, pose);
    }
  }

  /** Editor previews draw the object posed without touching its saved Transform. */
  lateUpdate(): void {
    const w = this.world;
    if (!w || this.running) return;
    for (const [id, time] of this.previews) {
      const e = w.getById(id);
      const k = e?.get(Keyframes);
      const node = e && this.render.nodeOf(e);
      if (!k || !node) continue;
      const pose = sampleKeyframes(k.keys, time, k.easing);
      if (!pose) continue;
      node.position.set(...pose.position);
      node.rotation.set(pose.rotation[0] * DEG, pose.rotation[1] * DEG, pose.rotation[2] * DEG);
      node.scale.set(...pose.scale);
    }
  }
}
