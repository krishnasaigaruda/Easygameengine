import * as THREE from 'three';

/** One pose on the timeline: every bone's turn (and the hips' place) at a moment. */
export interface PoseKey {
  time: number;
  rotations: Record<string, [number, number, number, number]>;
  /** Root / hips movement (jumps, crouches), bone name → local position. */
  positions: Record<string, [number, number, number]>;
}

/** The skeleton's current pose, as a key at `time` (bones that move: rotations; `moving` bones: position too). */
export function capturePose(root: THREE.Object3D, time: number, moving: string[] = []): PoseKey {
  const rotations: PoseKey['rotations'] = {};
  const positions: PoseKey['positions'] = {};
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    rotations[o.name] = [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w];
    if (moving.includes(o.name)) positions[o.name] = [o.position.x, o.position.y, o.position.z];
  });
  return { time, rotations, positions };
}

/** Put the skeleton in a key's pose. */
export function applyPose(root: THREE.Object3D, key: PoseKey): void {
  root.traverse((o) => {
    const q = key.rotations[o.name];
    if (q) o.quaternion.set(q[0], q[1], q[2], q[3]);
    const p = key.positions[o.name];
    if (p) o.position.set(p[0], p[1], p[2]);
  });
  root.updateMatrixWorld(true);
}

/**
 * An animation clip through the poses (sorted by time). Bones that never change are left out, so
 * the clip is small. A loop ends on its first pose.
 */
export function buildPoseClip(name: string, keys: PoseKey[], loop: boolean, length?: number): THREE.AnimationClip {
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  if (!sorted.length) return new THREE.AnimationClip(name, 0, []);
  const last = Math.max(sorted[sorted.length - 1].time, 1e-3);
  // A loop comes back to its first pose at `length` (or a little after the last key).
  const end = length !== undefined && length > last + 0.01 ? length : last + Math.max(0.2, last / Math.max(1, sorted.length - 1));
  const frames = loop && sorted.length > 1 ? [...sorted, { ...sorted[0], time: end }] : sorted;
  const times = frames.map((k) => k.time);
  if (!loop && length !== undefined && length > times[times.length - 1]) {
    // Hold the last pose until the end.
    frames.push({ ...frames[frames.length - 1], time: length });
    times.push(length);
  }
  const tracks: THREE.KeyframeTrack[] = [];
  const bones = new Set(sorted.flatMap((k) => Object.keys(k.rotations)));
  for (const bone of bones) {
    const values = frames.flatMap((k) => k.rotations[bone] ?? sorted[0].rotations[bone] ?? [0, 0, 0, 1]);
    // Skip bones that hold still the whole time.
    let changes = false;
    for (let i = 4; i < values.length && !changes; i++) if (Math.abs(values[i] - values[i % 4]) > 1e-4) changes = true;
    if (changes || frames.length === 1) tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  const moved = new Set(sorted.flatMap((k) => Object.keys(k.positions)));
  for (const bone of moved) {
    const values = frames.flatMap((k) => k.positions[bone] ?? sorted[0].positions[bone] ?? [0, 0, 0]);
    tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, times, values));
  }
  return new THREE.AnimationClip(name, times[times.length - 1], tracks);
}

/** The pose at time t between the keys (smooth turns), as one full key. A loop blends back to the first key. */
export function poseAt(keys: PoseKey[], t: number, loop: boolean, length?: number): PoseKey | null {
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  if (!sorted.length) return null;
  const clip = buildPoseClip('pose', sorted, loop, length);
  return { ...sampleClipPose(clip, sorted[0], Math.min(Math.max(0, t), clip.duration)), time: t };
}

/** A clip's pose at time t: `base` (a full pose) with the clip's tracks applied. */
export function sampleClipPose(clip: THREE.AnimationClip, base: PoseKey, t: number): PoseKey {
  const key: PoseKey = { time: t, rotations: { ...base.rotations }, positions: { ...base.positions } };
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const v = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant().evaluate(t) as unknown as number[];
    if (prop === 'quaternion') key.rotations[bone] = [v[0], v[1], v[2], v[3]];
    else if (prop === 'position') key.positions[bone] = [v[0], v[1], v[2]];
  }
  return key;
}

/** Turn a ready-made clip into editable keys (`perSecond` keys a second). */
export function clipToKeys(clip: THREE.AnimationClip, base: PoseKey, perSecond = 6): PoseKey[] {
  const n = Math.max(1, Math.round(clip.duration * perSecond));
  const keys: PoseKey[] = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.round(((clip.duration * i) / n) * 100) / 100;
    keys.push(sampleClipPose(clip, base, t));
  }
  return keys;
}

/**
 * Drag a joint to a point: the bones above it turn so it reaches there (a hand bends the elbow and
 * shoulder, a foot the knee and hip). `links` = how many bones up the chain may turn.
 */
export function reachTo(end: THREE.Object3D, target: THREE.Vector3, links = 2, iterations = 16): void {
  const chain: THREE.Object3D[] = [];
  for (let b = end.parent; b && chain.length < links && (b as THREE.Bone).isBone && (b.parent as THREE.Bone | null)?.isBone; b = b.parent) chain.push(b);
  const endPos = new THREE.Vector3();
  const jointPos = new THREE.Vector3();
  const toEnd = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const world = new THREE.Quaternion();
  const parentWorld = new THREE.Quaternion();
  for (let i = 0; i < iterations; i++) {
    for (const joint of chain) {
      joint.updateWorldMatrix(true, true);
      end.getWorldPosition(endPos);
      joint.getWorldPosition(jointPos);
      toEnd.subVectors(endPos, jointPos);
      toTarget.subVectors(target, jointPos);
      if (toEnd.lengthSq() < 1e-10 || toTarget.lengthSq() < 1e-10) continue;
      turn.setFromUnitVectors(toEnd.normalize(), toTarget.normalize());
      joint.getWorldQuaternion(world);
      joint.parent!.getWorldQuaternion(parentWorld);
      joint.quaternion.copy(parentWorld.invert().multiply(turn.multiply(world)));
    }
    end.updateWorldMatrix(true, false);
    if (end.getWorldPosition(endPos).distanceTo(target) < 1e-4) break;
  }
  end.parent?.updateMatrixWorld(true);
}
