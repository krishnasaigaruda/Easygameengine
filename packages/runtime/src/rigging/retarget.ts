import * as THREE from 'three';
import { boneKey } from '../render/ModelSystem';

/*
 * Retargeting by pose: play an animation on its own skeleton, see how far each bone turns away from
 * its rest pose (in world space), and turn the matching bone of another skeleton by the same
 * amount. Works between skeletons with different rest angles and bone names (Mesh2Motion, Mixamo,
 * Rigify…), as long as both are standing in a similar rest pose (T- or A-pose).
 */

const CHAINS = ['spine', 'neck'];

function bonesOf(root: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.push(o as THREE.Bone);
  });
  return out;
}

/** Which source bone drives each target bone (by meaning: hips, left upper arm, spine…). */
export function mapBones(source: THREE.Object3D, target: THREE.Object3D): Map<THREE.Bone, THREE.Bone> {
  const index = (root: THREE.Object3D) => {
    const byKey = new Map<string, THREE.Bone>();
    const chains = new Map<string, THREE.Bone[]>();
    for (const b of bonesOf(root)) {
      const key = boneKey(b.name);
      // A "root" bone above the hips isn't the hips.
      if (key === 'hips' && /^root$/i.test(b.name.replace(/^.*[:|]/, '')) && bonesOf(b).some((c) => c !== b && boneKey(c.name) === 'hips')) continue;
      const chain = CHAINS.find((c) => key === c || new RegExp(`^${c}\\d+$`).test(key));
      if (chain) chains.set(chain, [...(chains.get(chain) ?? []), b]);
      else if (!byKey.has(key)) byKey.set(key, b);
    }
    return { byKey, chains };
  };
  const src = index(source);
  const tgt = index(target);
  const map = new Map<THREE.Bone, THREE.Bone>();
  for (const [key, b] of tgt.byKey) {
    const s = src.byKey.get(key);
    if (s) map.set(b, s);
  }
  // Spines and necks have different numbers of bones: match them along the chain.
  for (const [name, list] of tgt.chains) {
    const from = src.chains.get(name);
    if (!from?.length) continue;
    list.forEach((b, i) => {
      const k = list.length === 1 ? from.length - 1 : Math.round((i / (list.length - 1)) * (from.length - 1));
      map.set(b, from[k]);
    });
  }
  return map;
}

/** Enough matching bones to call it the same kind of body? */
export function sameBodyPlan(map: Map<THREE.Bone, THREE.Bone>): boolean {
  const keys = new Set([...map.keys()].map((b) => boneKey(b.name)));
  return ['hips', 'leftupperarm', 'rightupperarm', 'leftupperleg', 'rightupperleg', 'head'].every((k) => keys.has(k));
}

/**
 * Which way a skeleton faces, as a rotation: x from its right hip to its left hip, y up its spine.
 * Two skeletons can face different ways (or be rigged lying down): turns are converted between them.
 */
function facing(byKey: (k: string) => THREE.Object3D | undefined): THREE.Quaternion | null {
  const at = (k: string) => byKey(k)?.getWorldPosition(new THREE.Vector3());
  const l = at('leftupperleg');
  const r = at('rightupperleg');
  const hips = at('hips');
  const head = at('head');
  if (!l || !r || !hips || !head) return null;
  const x = l.clone().sub(r).normalize();
  const up = head.clone().sub(hips);
  const z = new THREE.Vector3().crossVectors(x, up).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * Clips made for `sourceRoot`'s skeleton, as clips for `targetRoot`'s. Both should be in their
 * rest pose. `fps` keys a second.
 */
export function retargetByPose(clips: THREE.AnimationClip[], sourceRoot: THREE.Object3D, targetRoot: THREE.Object3D, fps = 24): THREE.AnimationClip[] {
  const map = mapBones(sourceRoot, targetRoot);
  if (!map.size) return [];
  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);
  // From the source's way of facing to the target's: a turn of the source's arm becomes the same
  // turn as seen from the target's body.
  const keyOf = (pairs: [THREE.Bone, THREE.Bone][], side: 0 | 1) => (k: string) => pairs.find((p) => boneKey(p[0].name) === k)?.[side];
  const pairs = [...map];
  const fs = facing(keyOf(pairs, 1));
  const ft = facing(keyOf(pairs, 0));
  const turn = fs && ft ? ft.clone().multiply(fs.clone().invert()) : new THREE.Quaternion();
  const unturn = turn.clone().invert();
  const worldQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
  const restSrc = new Map<THREE.Bone, THREE.Quaternion>();
  for (const s of map.values()) restSrc.set(s, worldQ(s));
  const targets = bonesOf(targetRoot);
  const restTgtWorld = new Map(targets.map((b) => [b, worldQ(b)] as const));
  const restTgtLocal = new Map(targets.map((b) => [b, b.quaternion.clone()] as const));
  const restSrcPos = new Map<THREE.Bone, THREE.Vector3>();
  for (const s of map.values()) restSrcPos.set(s, s.getWorldPosition(new THREE.Vector3()));

  // Hips: the target moves as far as the source, scaled by how tall the hips are.
  const hipsT = targets.find((b) => boneKey(b.name) === 'hips' && map.has(b));
  const hipsS = hipsT ? map.get(hipsT)! : undefined;
  const floor = (root: THREE.Object3D) => new THREE.Box3().setFromPoints(bonesOf(root).map((b) => b.getWorldPosition(new THREE.Vector3()))).min.y;
  const scale = hipsT && hipsS ? (hipsT.getWorldPosition(new THREE.Vector3()).y - floor(targetRoot)) / Math.max(1e-6, hipsS.getWorldPosition(new THREE.Vector3()).y - floor(sourceRoot)) : 1;
  const hipsParentInv = hipsT?.parent ? hipsT.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const hipsRestWorld = hipsT?.getWorldPosition(new THREE.Vector3());
  // Every source bone in the source rest pose (to put the skeleton back after).
  const srcBones = bonesOf(sourceRoot);
  const srcRestLocal = srcBones.map((b) => [b, b.position.clone(), b.quaternion.clone()] as const);

  const mixer = new THREE.AnimationMixer(sourceRoot);
  const out: THREE.AnimationClip[] = [];
  const delta = new THREE.Quaternion();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    // Once, holding the end (a loop would wrap back to the start at exactly its length).
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const n = Math.max(1, Math.ceil(clip.duration * fps));
    const times: number[] = [];
    const rot = new Map<THREE.Bone, number[]>();
    const hipsPos: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (clip.duration * i) / n;
      times.push(t);
      mixer.setTime(t);
      sourceRoot.updateMatrixWorld(true);
      // Parents first, so each bone knows how its parent is turned right now.
      const worldNow = new Map<THREE.Object3D, THREE.Quaternion>();
      const parentWorld = (b: THREE.Object3D): THREE.Quaternion => {
        const p = b.parent;
        if (!p) return new THREE.Quaternion();
        // A copy: callers change it.
        return (worldNow.get(p) ?? restTgtWorld.get(p as THREE.Bone) ?? worldQ(p)).clone();
      };
      for (const b of targets) {
        const s = map.get(b);
        if (!s) {
          worldNow.set(b, parentWorld(b).multiply(restTgtLocal.get(b)!));
          continue;
        }
        delta.copy(worldQ(s)).multiply(restSrc.get(s)!.clone().invert());
        delta.premultiply(turn).multiply(unturn);
        const world = delta.clone().multiply(restTgtWorld.get(b)!);
        worldNow.set(b, world);
        const local = parentWorld(b).invert().multiply(world);
        (rot.get(b) ?? rot.set(b, []).get(b)!).push(local.x, local.y, local.z, local.w);
      }
      if (hipsS && hipsT && hipsRestWorld) {
        const moved = hipsS.getWorldPosition(new THREE.Vector3()).sub(restSrcPos.get(hipsS)!).applyQuaternion(turn).multiplyScalar(scale);
        const local = hipsRestWorld.clone().add(moved).applyMatrix4(hipsParentInv);
        hipsPos.push(local.x, local.y, local.z);
      }
    }
    action.stop();
    mixer.uncacheAction(clip);
    const tracks: THREE.KeyframeTrack[] = [...rot].map(([b, v]) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v));
    if (hipsT && hipsPos.length) tracks.push(new THREE.VectorKeyframeTrack(`${hipsT.name}.position`, times, hipsPos));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  for (const [b, p, q] of srcRestLocal) {
    b.position.copy(p);
    b.quaternion.copy(q);
  }
  sourceRoot.updateMatrixWorld(true);
  return out;
}
