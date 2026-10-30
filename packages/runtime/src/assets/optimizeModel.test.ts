import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { shareRepeatedShapes } from './optimizeModel';

describe('optimize model', () => {
  it('keeps each repeated shape once; every copy keeps its own place', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 5; i++) {
      // Separate but identical geometries, like a file that repeats a plank 5 times.
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.3), mat);
      plank.position.set(i, 0, 0);
      root.add(plank);
    }
    root.add(new THREE.Mesh(new THREE.SphereGeometry(1), mat));
    const report = shareRepeatedShapes(root);
    expect(report).toEqual({ parts: 6, shapes: 2 });
    const planks = root.children.slice(0, 5) as THREE.Mesh[];
    expect(new Set(planks.map((p) => p.geometry)).size).toBe(1);
    expect(planks.map((p) => p.position.x)).toEqual([0, 1, 2, 3, 4]);
  });
});
