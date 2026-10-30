import * as THREE from 'three';

/** One model inside a model file that holds several (an asset pack). */
export interface ModelPart {
  /** Where it is in the file: child numbers from the top, joined by "/" ("0/3"). */
  path: string;
  name: string;
}

const MAX_PARTS = 256;

/**
 * The separate models inside one file: asset packs put a row of plants, rocks or props side by
 * side. Empty when it's one model (a character, a house, a table whose legs touch its top).
 */
export function findModelParts(root: THREE.Object3D): ModelPart[] {
  let skinned = false;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  if (skinned) return []; // characters: body, clothes and hair belong together
  // Wrappers (a scene node, an "Armature" or "RootNode") around the real contents.
  let container = root;
  let path: number[] = [];
  while (container.children.length === 1 && !(container as THREE.Mesh).isMesh) {
    container = container.children[0];
    path = [...path, 0];
  }
  const candidates = container.children
    .map((child, i) => ({ child, path: [...path, i] }))
    .filter(({ child }) => hasMesh(child));
  if (candidates.length < 2 || candidates.length > MAX_PARTS) return [];

  root.updateMatrixWorld(true);
  const boxes = candidates.map(({ child }) => new THREE.Box3().setFromObject(child));
  if (boxes.some((b) => b.isEmpty())) return [];
  // Separate models stand apart; pieces of one model touch (a wall and its roof, legs and a top).
  const grown = boxes.map((b) => {
    const size = b.getSize(new THREE.Vector3());
    return b.clone().expandByScalar(Math.max(size.x, size.y, size.z) * 0.01 + 1e-6);
  });
  let apart = 0;
  for (let i = 0; i < boxes.length; i++) if (grown.every((g, j) => j === i || !g.intersectsBox(boxes[i]))) apart++;
  if (apart < boxes.length * 0.6) return [];

  const seen = new Map<string, number>();
  return candidates.map(({ child, path: p }, i) => {
    // "Bush_01" reads "Bush 01".
    const base = child.name.replace(/[_\s]+/g, ' ').trim() || `Part ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { path: p.join('/'), name: n > 1 ? `${base} ${n}` : base };
  });
}

/** The node at a part's path (undefined if the file changed). */
export function partNode(root: THREE.Object3D, path: string): THREE.Object3D | undefined {
  let node: THREE.Object3D | undefined = root;
  for (const step of path.split('/')) {
    if (!node || step === '') return undefined;
    node = node.children[Number(step)];
  }
  return node;
}

/** A part's box where it sits in the file (nothing is changed). */
export function partBounds(root: THREE.Object3D, path: string): THREE.Box3 {
  const node = partNode(root, path);
  if (!node) return new THREE.Box3();
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(node);
}

/**
 * Take one part out of a copy of the file: it keeps its size and turn, and stands with its bottom
 * centre on the origin (not off to the side, where it was in the pack). Null if it isn't there.
 */
export function extractPart(copy: THREE.Object3D, path: string): THREE.Object3D | null {
  const node = partNode(copy, path);
  if (!node) return null;
  copy.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(node);
  const holder = new THREE.Group();
  holder.name = node.name || 'Part';
  node.matrixWorld.decompose(node.position, node.quaternion, node.scale);
  node.removeFromParent();
  holder.add(node);
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3());
    node.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  }
  return holder;
}

function hasMesh(o: THREE.Object3D): boolean {
  let found = false;
  o.traverse((x) => {
    if ((x as THREE.Mesh).isMesh) found = true;
  });
  return found;
}
