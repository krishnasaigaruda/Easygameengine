import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mapBones, retargetByPose, sameBodyPlan } from './retarget';

/** A tiny humanoid: hips → spine… → head, arms and legs. `twist` turns the arms' rest pose. */
function body(names: Record<string, string>, spines: number, twist = 0): THREE.Bone {
  const bone = (name: string, x: number, y: number, parent?: THREE.Bone) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, 0);
    parent?.add(b);
    return b;
  };
  const hips = bone(names.hips, 0, 1);
  let top = hips;
  for (let i = 0; i < spines; i++) top = bone(`${names.spine}${i === 0 && names.spine === 'Spine' ? '' : i + (names.spine === 'Spine' ? 0 : 1)}`.replace(/^Spine0$/, 'Spine'), 0, 0.2, top);
  bone(names.head, 0, 0.3, top);
  for (const side of ['l', 'r'] as const) {
    const dx = side === 'l' ? 1 : -1;
    const arm = bone(names[`arm_${side}`], 0.2 * dx, 0, top);
    arm.rotation.z = twist * dx;
    bone(names[`hand_${side}`], 0.3 * dx, 0, arm);
    const leg = bone(names[`leg_${side}`], 0.1 * dx, -0.1, hips);
    bone(names[`foot_${side}`], 0, -0.8, leg);
  }
  hips.updateMatrixWorld(true);
  return hips;
}

const M2M = { hips: 'pelvis', spine: 'spine_0', head: 'head', arm_l: 'upperarm_l', arm_r: 'upperarm_r', hand_l: 'hand_l', hand_r: 'hand_r', leg_l: 'thigh_l', leg_r: 'thigh_r', foot_l: 'foot_l', foot_r: 'foot_r' };
const MIXAMO = { hips: 'mixamorigHips', spine: 'Spine', head: 'mixamorigHead', arm_l: 'mixamorigLeftArm', arm_r: 'mixamorigRightArm', hand_l: 'mixamorigLeftHand', hand_r: 'mixamorigRightHand', leg_l: 'mixamorigLeftUpLeg', leg_r: 'mixamorigRightUpLeg', foot_l: 'mixamorigLeftFoot', foot_r: 'mixamorigRightFoot' };

describe('retarget by pose', () => {
  it('matches bones by meaning, spines along the chain', () => {
    const map = mapBones(body(M2M, 3), body(MIXAMO, 2));
    const names = new Map([...map].map(([t, s]) => [t.name, s.name]));
    expect(names.get('mixamorigLeftArm')).toBe('upperarm_l');
    expect(names.get('mixamorigRightUpLeg')).toBe('thigh_r');
    expect(names.get('Spine')).toBe('spine_01');
    expect(names.get('Spine1')).toBe('spine_03');
    expect(sameBodyPlan(map)).toBe(true);
  });

  it('turns the target arm as far as the source arm, whatever its rest angle', () => {
    const source = body(M2M, 3);
    const target = body(MIXAMO, 2, 0.6); // arms rest at a different angle
    const armS = source.getObjectByName('upperarm_l')!;
    const raised = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1).multiply(armS.quaternion);
    const clip = new THREE.AnimationClip('Raise', 1, [new THREE.QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [...armS.quaternion.toArray(), ...raised.toArray()])]);
    const restWorld = target.getObjectByName('mixamorigLeftArm')!.getWorldQuaternion(new THREE.Quaternion());
    const [out] = retargetByPose([clip], source, target, 4);
    expect(out.tracks.some((t) => t.name === 'mixamorigLeftArm.quaternion')).toBe(true);
    // Play the result on the target: the arm turned 1 radian from its own rest.
    const mixer = new THREE.AnimationMixer(target);
    const action = mixer.clipAction(out);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(1);
    target.updateMatrixWorld(true);
    const now = target.getObjectByName('mixamorigLeftArm')!.getWorldQuaternion(new THREE.Quaternion());
    expect(now.angleTo(restWorld)).toBeCloseTo(1, 2);
  });
});

describe('retarget between skeletons facing different ways', () => {
  it('a raised arm stays a raised arm when the target faces sideways', () => {
    const source = body(M2M, 3);
    const holder = new THREE.Group();
    const target = body(MIXAMO, 2);
    holder.add(target);
    holder.rotation.y = Math.PI / 2; // faces +X instead of +Z
    holder.updateMatrixWorld(true);
    const armS = source.getObjectByName('upperarm_l')!;
    // Swing the arm forward: around the up axis (the hand goes toward the source's front, +Z).
    const raised = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -1).multiply(armS.quaternion);
    const clip = new THREE.AnimationClip('Raise', 1, [new THREE.QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [...armS.quaternion.toArray(), ...raised.toArray()])]);
    source.updateMatrixWorld(true);
    const handS0 = source.getObjectByName('hand_l')!.getWorldPosition(new THREE.Vector3());
    const [out] = retargetByPose([clip], source, holder, 4);
    // Hand of the source after: moved toward +Z (its front) and down a bit.
    const ms = new THREE.AnimationMixer(source);
    const as = ms.clipAction(clip);
    as.setLoop(THREE.LoopOnce, 1);
    as.clampWhenFinished = true;
    as.play();
    ms.setTime(1);
    source.updateMatrixWorld(true);
    const moveS = source.getObjectByName('hand_l')!.getWorldPosition(new THREE.Vector3()).sub(handS0);
    const handT0 = target.getObjectByName('mixamorigLeftHand')!.getWorldPosition(new THREE.Vector3());
    const mt = new THREE.AnimationMixer(holder);
    const at = mt.clipAction(out);
    at.setLoop(THREE.LoopOnce, 1);
    at.clampWhenFinished = true;
    at.play();
    mt.setTime(1);
    holder.updateMatrixWorld(true);
    const moveT = target.getObjectByName('mixamorigLeftHand')!.getWorldPosition(new THREE.Vector3()).sub(handT0);
    // The same move, turned with the body (source +Z front is the target's +X front).
    const expected = moveS.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    expect(moveT.distanceTo(expected)).toBeLessThan(0.02);
  });
});
