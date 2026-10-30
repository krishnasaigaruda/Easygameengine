import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import SkinningAlgorithm from './SkinningAlgorithm';
import { SkeletonType, skeletonInfo } from './skeletons';

/*
 * Rig & animate: put a ready-made skeleton inside any model, work out which bone moves which part
 * of it (Mesh2Motion's skinning solver), and give it a library of free animations — like Mixamo,
 * but in the browser. The result is a normal animated model the Animator can use.
 */

export interface SkeletonTemplate {
  type: SkeletonType;
  /** The skeleton (root bone and children) in its rest pose, meters, standing on y = 0. */
  root: THREE.Bone;
  /** All clips from the packs loaded so far. */
  clips: THREE.AnimationClip[];
}

/** The first pack of a skeleton type: its skeleton and clips (more packs: loadMoreClips). */
export async function loadSkeletonTemplate(type: SkeletonType, loader = new GLTFLoader()): Promise<SkeletonTemplate> {
  const info = skeletonInfo(type);
  if (!info) throw new Error(`Unknown skeleton type "${type}"`);
  const gltf = await loader.loadAsync(info.packs[0]);
  const scene = cloneSkinned(gltf.scene);
  scene.updateMatrixWorld(true);
  let root: THREE.Bone | undefined;
  scene.traverse((o) => {
    if (!root && (o as THREE.Bone).isBone && !(o.parent as THREE.Bone | null)?.isBone) root = o as THREE.Bone;
  });
  if (!root) throw new Error('That animation pack has no skeleton');
  // Bake the armature's own transform into the bones, so the skeleton stands on its own.
  const holder = new THREE.Group();
  root.parent!.updateWorldMatrix(true, false);
  const world = root.parent!.matrixWorld.clone();
  holder.add(root);
  root.applyMatrix4(world);
  holder.updateMatrixWorld(true);
  // Feet on y = 0.
  const box = bonesBox(root);
  root.position.y -= box.min.y;
  holder.updateMatrixWorld(true);
  return { type, root, clips: gltf.animations };
}

/** The other packs' clips (e.g. human add-ons and motion capture). */
export async function loadMoreClips(type: SkeletonType, loader = new GLTFLoader()): Promise<THREE.AnimationClip[]> {
  const info = skeletonInfo(type);
  const out: THREE.AnimationClip[] = [];
  for (const url of info?.packs.slice(1) ?? []) {
    try {
      out.push(...(await loader.loadAsync(url)).animations);
    } catch {
      // a pack failed: the others still count
    }
  }
  return out;
}

/** Box around a skeleton's joints. */
export function bonesBox(root: THREE.Object3D): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) box.expandByPoint(o.getWorldPosition(p));
  });
  return box;
}

/** One geometry for the whole model (in its own space), keeping its materials as groups. */
export function mergeModel(model: THREE.Object3D): { geometry: THREE.BufferGeometry; materials: THREE.Material[] } {
  model.updateMatrixWorld(true);
  const toModel = model.matrixWorld.clone().invert();
  const parts: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.applyMatrix4(toModel.clone().multiply(mesh.matrixWorld));
    g.clearGroups();
    parts.push(g);
    materials.push(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
  });
  if (!parts.length) throw new Error('That model has nothing to rig');
  const geometry = mergeGeometries(parts, true);
  for (const g of parts) g.dispose();
  if (!geometry) throw new Error('Could not combine the model\'s parts');
  return { geometry, materials };
}

/**
 * Put the skeleton inside the model: same height, feet on the model's base, centred. Joints can
 * then be moved by hand (in the editor) before binding.
 */
export function fitSkeleton(root: THREE.Bone, modelBox: THREE.Box3): number {
  const box = bonesBox(root);
  const height = Math.max(1e-6, box.max.y - box.min.y);
  // The joints stop below the top of the head (the top joint is inside it): aim a little lower.
  const k = ((modelBox.max.y - modelBox.min.y) * 0.97) / height;
  scaleSkeleton(root, k);
  const now = bonesBox(root);
  const c = modelBox.getCenter(new THREE.Vector3());
  const nc = now.getCenter(new THREE.Vector3());
  root.position.x += c.x - nc.x;
  root.position.z += c.z - nc.z;
  root.position.y += modelBox.min.y - now.min.y;
  root.updateMatrixWorld(true);
  return k;
}

/** Scale a skeleton's proportions (joint distances), not its bones' own scale. */
export function scaleSkeleton(root: THREE.Bone, k: number): void {
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) o.position.multiplyScalar(k);
  });
  root.updateMatrixWorld(true);
}

/** Make the model a skinned mesh driven by the (fitted) skeleton. */
export function bindModel(model: THREE.Object3D, root: THREE.Bone, type: SkeletonType): THREE.Group {
  const { geometry, materials } = mergeModel(model);
  root.updateMatrixWorld(true);
  const solver = new SkinningAlgorithm(root, type);
  solver.set_geometry(geometry);
  const [indices, weights] = solver.calculate_indexes_and_weights();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const mesh = new THREE.SkinnedMesh(geometry, materials.length > 1 ? materials : materials[0]);
  mesh.name = 'Body';
  const group = new THREE.Group();
  group.name = 'Rigged';
  group.add(root);
  group.add(mesh);
  group.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return group;
}

/**
 * Clips made for the template skeleton, played on the fitted one: rotations carry over; only the
 * tracking bone (hips) moves, scaled to the new size, so the fitted proportions stay.
 */
export function adaptClips(clips: THREE.AnimationClip[], type: SkeletonType, scale: number): THREE.AnimationClip[] {
  const tracking = skeletonInfo(type)?.trackingBone ?? 'hips';
  return clips.map((clip) => {
    const tracks = clip.tracks
      .filter((t) => !t.name.endsWith('.position') || t.name.startsWith(`${tracking}.`) || t.name.startsWith('root.'))
      .map((t) => {
        if (!t.name.endsWith('.position')) return t.clone();
        const c = t.clone();
        for (let i = 0; i < c.values.length; i++) c.values[i] *= scale;
        return c;
      });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
}

/** The rigged model as a .glb file (with the chosen clips), ready to add to the project. */
export async function exportRigged(group: THREE.Object3D, clips: THREE.AnimationClip[]): Promise<Blob> {
  const out = (await new GLTFExporter().parseAsync(group, { binary: true, animations: clips, onlyVisible: false })) as ArrayBuffer;
  return new Blob([out], { type: 'model/gltf-binary' });
}
