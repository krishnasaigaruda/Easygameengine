import * as THREE from 'three';
import { Transform, type TransformData } from '../components/builtin';
import type { Entity } from './Entity';
import type { Vec3 } from './Component';

const DEG = Math.PI / 180;
const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();

/** Matrix of a Transform relative to its parent. */
export function localMatrix(t: TransformData, out = new THREE.Matrix4()): THREE.Matrix4 {
  euler.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, 'XYZ');
  return out.compose(pos.fromArray(t.position), quat.setFromEuler(euler), scl.fromArray(t.scale));
}

/** Matrix from an entity's local space to world space (walks up the parent chain). */
export function worldMatrixOf(entity: Entity, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.identity();
  const chain: Entity[] = [];
  for (let e: Entity | null = entity; e; e = e.parent) chain.push(e);
  const m = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i].get(Transform);
    if (t) out.multiply(localMatrix(t, m));
  }
  return out;
}

/** World matrix of the entity's parent (identity for top-level entities). */
export function parentWorldMatrixOf(entity: Entity, out = new THREE.Matrix4()): THREE.Matrix4 {
  return entity.parent ? worldMatrixOf(entity.parent, out) : out.identity();
}

/**
 * Turns a world-space position/rotation into a local Transform position/rotation (degrees)
 * under the entity's current parent. Scale is left alone.
 */
export function worldPoseToLocal(
  entity: Entity,
  worldPos: THREE.Vector3,
  worldQuat: THREE.Quaternion,
): { position: Vec3; rotation: Vec3 } {
  const t = entity.get(Transform);
  const local = new THREE.Matrix4().compose(worldPos, worldQuat, new THREE.Vector3(1, 1, 1));
  if (entity.parent) local.premultiply(parentWorldMatrixOf(entity).invert());
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  local.decompose(p, q, new THREE.Vector3());
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const r = (v: number, k = 1e4) => Math.round(v * k) / k;
  return {
    position: [r(p.x), r(p.y), r(p.z)],
    rotation: t ? [r(e.x / DEG, 1e3), r(e.y / DEG, 1e3), r(e.z / DEG, 1e3)] : [0, 0, 0],
  };
}
