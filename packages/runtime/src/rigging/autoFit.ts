import * as THREE from 'three';
import { mergeModel } from './autoRig';

/*
 * Automatic skeleton fitting: after the skeleton is sized to the model, every joint is moved into
 * the middle of the body part around it, from the hips outward (a joint takes the joints below it
 * along). Hands, feet and heads that stick out of the model are pulled back inside it.
 */

export type HandStyle = 'simple' | 'thumb' | 'fingers';

const FINGER = /thumb|index|middle|ring|pinky|finger/i;

/**
 * Fewer finger bones (fingers then move with the hand): 'simple' keeps no fingers, 'thumb' keeps
 * the thumb and the middle finger, 'fingers' keeps them all. Tip ("leaf") bones of removed fingers go too.
 */
export function simplifyHands(root: THREE.Object3D, style: HandStyle): void {
  if (style === 'fingers') return;
  const remove: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone || !FINGER.test(o.name)) return;
    // Only the first bone of each finger (its children go with it).
    if (FINGER.test(o.parent?.name ?? '')) return;
    if (style === 'thumb' && /thumb|middle/i.test(o.name)) return;
    remove.push(o);
  });
  for (const o of remove) o.removeFromParent();
  root.updateMatrixWorld(true);
}

/** A see-through copy of the model to measure it with rays from inside and outside. */
export function measuringMesh(model: THREE.Object3D): THREE.Mesh {
  const { geometry } = mergeModel(model);
  model.updateMatrixWorld(true);
  geometry.applyMatrix4(model.matrixWorld);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Directions across a bone (perpendicular to it), in opposite pairs. */
function across(dir: THREE.Vector3, count = 6): THREE.Vector3[] {
  const helper = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, helper).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI;
    const d = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
    out.push(d, d.clone().negate());
  }
  return out;
}

/**
 * Where the middle of the body part around a point is, measured across `dir` (the bone's
 * direction). null: there's no model around it within `reach`.
 */
export function middleAround(mesh: THREE.Mesh, point: THREE.Vector3, dir: THREE.Vector3, reach: number): THREE.Vector3 | null {
  const ray = new THREE.Raycaster();
  ray.far = reach;
  const dirs = across(dir);
  const first = dirs.map((d) => {
    ray.set(point, d);
    return ray.intersectObject(mesh, false)[0] ?? null;
  });
  // Inside the body part: most ways out hit its surface (a gap, like under a shirt, may let one
  // out). Centre between each opposite pair that hits on both sides.
  let pairs = 0;
  const shift = new THREE.Vector3();
  for (let i = 0; i < dirs.length; i += 2) {
    if (!first[i] || !first[i + 1]) continue;
    shift.addScaledVector(dirs[i], (first[i]!.distance - first[i + 1]!.distance) / 2);
    pairs++;
  }
  if (pairs >= dirs.length / 4) return point.clone().addScaledVector(shift, 1 / pairs);
  // Outside (e.g. above the arm): go into the nearest part and take the middle of it.
  let best: THREE.Intersection | null = null;
  let bestDir: THREE.Vector3 | null = null;
  first.forEach((h, i) => {
    if (h && (!best || h.distance < best.distance)) {
      best = h;
      bestDir = dirs[i];
    }
  });
  if (!best || !bestDir) return null;
  const entry = (best as THREE.Intersection).point;
  ray.far = reach * 2;
  ray.set(entry.clone().addScaledVector(bestDir, reach * 1e-3), bestDir);
  const exit = ray.intersectObject(mesh, false)[0];
  return exit ? entry.clone().add(exit.point).multiplyScalar(0.5) : entry.clone();
}

/** Move a joint (and everything below it) by a world-space offset. */
function shiftJoint(bone: THREE.Object3D, worldOffset: THREE.Vector3): void {
  const parent = bone.parent!;
  parent.updateWorldMatrix(true, false);
  const world = bone.getWorldPosition(new THREE.Vector3()).add(worldOffset);
  bone.position.copy(parent.worldToLocal(world));
  bone.updateMatrixWorld(true);
}

/**
 * Put every joint in the middle of the model's body part around it. The skeleton should already
 * be sized and standing in the model (fitSkeleton).
 */
export function autoFitSkeleton(root: THREE.Bone, mesh: THREE.Mesh, passes = 3): void {
  root.updateMatrixWorld(true);
  const box = mesh.geometry.boundingBox ?? new THREE.Box3().setFromObject(mesh);
  const height = Math.max(1e-6, box.max.y - box.min.y);
  const reach = height * 0.2;
  // Top-down: the hips first, then out along the limbs.
  const order: THREE.Bone[] = [];
  const queue: THREE.Object3D[] = [root];
  while (queue.length) {
    const b = queue.shift()!;
    for (const c of b.children) {
      if (!(c as THREE.Bone).isBone) continue;
      order.push(c as THREE.Bone);
      queue.push(c);
    }
  }
  const p = new THREE.Vector3();
  const j = new THREE.Vector3();
  for (const bone of order) {
    const parent = bone.parent as THREE.Bone;
    // Where the body branches (hips: two legs and the spine; chest: two arms and the neck) it isn't
    // one limb to centre in: those joints keep their place; the ones further out are centred.
    if (parent.children.filter((c) => (c as THREE.Bone).isBone).length > 1) continue;
    const isLeaf = !bone.children.some((c) => (c as THREE.Bone).isBone);
    let centred = 0;
    for (let step = 0; step < 14 && centred < passes; step++) {
      parent.getWorldPosition(p);
      bone.getWorldPosition(j);
      const length = j.distanceTo(p);
      // The root's first joint (hips) stands straight up from the feet.
      const along = length > height * 1e-3 && parent !== root;
      const dir = along ? j.clone().sub(p).normalize() : new THREE.Vector3(0, 1, 0);
      const middle = middleAround(mesh, j, dir, reach);
      if (!middle) {
        // No model around it: it sticks out (a hand past the fingertips). Pull it back along the bone.
        if (!along) break;
        shiftJoint(bone, p.clone().sub(j).multiplyScalar(isLeaf ? 0.15 : 0.08));
        continue;
      }
      // Only across the bone: its place along the limb stays.
      const offset = middle.sub(j);
      offset.addScaledVector(dir, -offset.dot(dir));
      centred++;
      if (offset.length() < height * 1e-4) break;
      shiftJoint(bone, offset);
    }
  }
}

