import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { adaptClips, bindModel, bonesBox, fitSkeleton } from './autoRig';
import { SkeletonType } from './skeletons';

/** A little chain standing up: root → hips → spine → head → head tip. */
function chain(): THREE.Bone {
  const make = (name: string, y: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.y = y;
    return b;
  };
  const root = make('root', 0);
  const hips = make('hips', 0.4);
  const spine = make('spine_01', 0.4);
  const head = make('head', 0.4);
  const tip = make('head_tip', 0.4);
  root.add(hips);
  hips.add(spine);
  spine.add(head);
  head.add(tip);
  return root;
}

describe('rig & animate', () => {
  it('fits a skeleton inside a model: same height, standing on its base', () => {
    const root = chain();
    const box = new THREE.Box3(new THREE.Vector3(-1, 2, -1), new THREE.Vector3(1, 6, 1)); // 4 m tall, base at y=2
    const k = fitSkeleton(root, box);
    const fitted = bonesBox(root);
    expect(k).toBeCloseTo((4 * 0.97) / 1.6);
    expect(fitted.min.y).toBeCloseTo(2);
    expect(fitted.max.y - fitted.min.y).toBeCloseTo(4 * 0.97);
  });

  it('binds a model to the skeleton: each part follows its bone', () => {
    const root = chain();
    const model = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3, 1, 16, 1).translate(0, 0.8, 0), new THREE.MeshStandardMaterial());
    const group = bindModel(model, root, SkeletonType.Snake);
    const mesh = group.getObjectByName('Body') as THREE.SkinnedMesh;
    expect(mesh.isSkinnedMesh).toBe(true);
    // Every vertex's weights add up to 1.
    const w = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < w.count; i += 7) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 3);
    // Bend the head: the top moves, the bottom stays.
    const pos = mesh.geometry.getAttribute('position');
    const at = (i: number) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    let top = 0;
    let bottom = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > pos.getY(top)) top = i;
      if (pos.getY(i) < pos.getY(bottom)) bottom = i;
    }
    const top0 = at(top);
    const bottom0 = at(bottom);
    root.getObjectByName('head')!.rotation.z = Math.PI / 2;
    group.updateMatrixWorld(true);
    mesh.skeleton.update();
    expect(at(top).distanceTo(top0)).toBeGreaterThan(0.2);
    expect(at(bottom).distanceTo(bottom0)).toBeLessThan(1e-4);
  });

  it('keeps the fitted proportions: only the hips move in borrowed clips, scaled to size', () => {
    const clip = new THREE.AnimationClip('Walk', 1, [
      new THREE.VectorKeyframeTrack('hips.position', [0, 1], [0, 1, 0, 0, 1.1, 0]),
      new THREE.VectorKeyframeTrack('spine_01.position', [0, 1], [0, 0.4, 0, 0, 0.4, 0]),
      new THREE.QuaternionKeyframeTrack('spine_01.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.995]),
    ]);
    const [out] = adaptClips([clip], SkeletonType.Fox, 2);
    expect(out.tracks.map((t) => t.name)).toEqual(['hips.position', 'spine_01.quaternion']);
    expect(out.tracks[0].values[1]).toBeCloseTo(2);
  });
});

describe('pose editor', () => {
  it('builds a clip from poses: only bones that move, looping back to the start', async () => {
    const { capturePose, applyPose, buildPoseClip } = await import('./poses');
    const root = chain();
    const head = root.getObjectByName('head')!;
    const start = capturePose(root, 0);
    head.rotation.z = 1;
    const middle = capturePose(root, 0.5);
    const clip = buildPoseClip('Nod', [middle, start], true);
    expect(clip.name).toBe('Nod');
    expect(clip.tracks.map((t) => t.name)).toEqual(['head.quaternion']); // the rest never moves
    expect(clip.duration).toBeGreaterThan(0.5); // a loop comes back to the first pose
    // Play it: halfway it nods, and the start pose comes back.
    applyPose(root, start);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.setTime(0.5);
    expect(new THREE.Euler().setFromQuaternion(head.quaternion).z).toBeCloseTo(1, 3);
    mixer.setTime(0);
    expect(new THREE.Euler().setFromQuaternion(head.quaternion).z).toBeCloseTo(0, 3);
  });
});

describe('pose tools', () => {
  it('reaches: dragging the tip of a chain bends the bones above it onto the point', async () => {
    const { reachTo } = await import('./poses');
    const root = chain(); // root → hips → spine → head → tip, 0.4 apart, straight up
    root.updateMatrixWorld(true);
    const tip = root.getObjectByName('head_tip')!;
    const target = new THREE.Vector3(0.4, 1.2, 0); // within reach of spine + head (0.8 long)
    reachTo(tip, target, 2);
    expect(tip.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(0.01);
    // Bones further up don't move.
    expect(root.getObjectByName('spine_01')!.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0.8);
  });

  it('gives the pose between keys, and turns a clip into editable keys', async () => {
    const { capturePose, poseAt, clipToKeys } = await import('./poses');
    const root = chain();
    const head = root.getObjectByName('head')!;
    const a = capturePose(root, 0);
    head.rotation.z = 1;
    const b = capturePose(root, 1);
    const mid = poseAt([a, b], 0.5, false)!;
    const q = new THREE.Quaternion(...mid.rotations.head);
    expect(new THREE.Euler().setFromQuaternion(q).z).toBeCloseTo(0.5, 2);
    const clip = new THREE.AnimationClip('Nod', 1, [new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 1], [...a.rotations.head, ...b.rotations.head])]);
    const keys = clipToKeys(clip, a, 4);
    expect(keys.map((k) => k.time)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...keys[4].rotations.head)).z).toBeCloseTo(1, 3);
  });
});

describe('auto-fit', () => {
  it('moves the joints into the middle of the body parts, and pulls a too-long arm back inside', async () => {
    const { autoFitSkeleton, measuringMesh, simplifyHands } = await import('./autoFit');
    // A body (0.4 wide, 1.8 tall) with an arm out to the left at 1.35 m, 0.12 thick, reaching x = 0.8.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.3).translate(0, 0.9, 0));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.12).translate(0.5, 1.35, 0));
    const model = new THREE.Group();
    model.add(body, arm);
    // A skeleton whose arm is too high (1.5 m) and too long (hand at 0.95, past the fingertips).
    const bone = (name: string, x: number, y: number, parent?: THREE.Bone) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, 0);
      parent?.add(b);
      return b;
    };
    const root = bone('root', 0, 0);
    const hips = bone('pelvis', 0, 0.9, root);
    const spine = bone('spine_01', 0, 0.55, hips);
    const shoulder = bone('upperarm_l', 0.25, 0.05, spine);
    const elbow = bone('lowerarm_l', 0.3, 0, shoulder);
    const hand = bone('hand_l', 0.4, 0, elbow);
    bone('index_01_l', 0.05, 0, hand);
    simplifyHands(root, 'simple');
    expect(root.getObjectByName('index_01_l')).toBeUndefined();
    autoFitSkeleton(root, measuringMesh(model));
    const at = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    expect(at(elbow).y).toBeCloseTo(1.35, 1); // down into the arm
    expect(Math.abs(at(elbow).z)).toBeLessThan(0.02);
    expect(at(hand).x).toBeLessThan(0.8); // back inside the arm
    expect(at(hand).y).toBeCloseTo(1.35, 1);
    expect(Math.abs(at(spine).x)).toBeLessThan(0.02); // the spine stays in the middle of the body
  });
});
