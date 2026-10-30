import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { extractPart, findModelParts, partBounds } from './modelParts';

const box = (name: string, x: number, y = 0.5, size: [number, number, number] = [1, 1, 1]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size));
  m.name = name;
  m.position.set(x, y, 0);
  return m;
};

/** A pack: plants side by side, inside a wrapper node like exporters make. */
function pack(): THREE.Group {
  const root = new THREE.Group();
  const wrapper = new THREE.Group();
  wrapper.name = 'RootNode';
  root.add(wrapper);
  wrapper.add(box('Fern', 0), box('Grass', 3), box('Grass', 6), box('Flower', 9));
  return root;
}

describe('model packs', () => {
  it('finds the separate models side by side', () => {
    const parts = findModelParts(pack());
    expect(parts.map((p) => p.name)).toEqual(['Fern', 'Grass', 'Grass 2', 'Flower']);
    expect(parts[1].path).toBe('0/1');
  });

  it('leaves one model alone: a table whose legs touch its top', () => {
    const root = new THREE.Group();
    root.add(box('Top', 0, 1.05, [2, 0.1, 1]));
    for (const [x, z] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) {
      const leg = box('Leg', x, 0.5, [0.1, 1, 0.1]);
      leg.position.z = z;
      root.add(leg);
    }
    expect(findModelParts(root)).toEqual([]);
    expect(findModelParts(box('Rock', 0))).toEqual([]);
  });

  it('leaves characters alone', () => {
    const root = pack();
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry());
    root.children[0].add(skinned);
    expect(findModelParts(root)).toEqual([]);
  });

  it('takes one out, standing on its own origin', () => {
    const root = pack();
    root.scale.setScalar(2);
    expect(partBounds(root, '0/2').min.x).toBeCloseTo(11);
    const part = extractPart(root, '0/2')!;
    const b = new THREE.Box3().setFromObject(part);
    expect(b.min.y).toBeCloseTo(0);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0);
    expect(b.max.y - b.min.y).toBeCloseTo(2); // keeps the file's scale
    expect(extractPart(root, '0/9')).toBeNull();
  });
});
