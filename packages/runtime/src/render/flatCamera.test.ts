import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isFlat, setFlat } from './flatCamera';

describe('flat (2D) camera', () => {
  it('shows a fixed height of the world, and clicks go straight in (not from one point)', () => {
    const cam = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
    cam.position.set(0, 0, 20);
    cam.updateMatrixWorld();
    setFlat(cam, 10);
    expect(isFlat(cam)).toBe(true);
    // Top edge of the screen is 5 m up, wherever things are.
    const top = new THREE.Vector3(0, 1, 0).unproject(cam);
    expect(top.y).toBeCloseTo(5);
    // Two clicks at different places: parallel rays.
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0.5, 0.5), cam);
    const a = ray.ray.clone();
    ray.setFromCamera(new THREE.Vector2(-0.5, 0), cam);
    expect(a.direction.angleTo(ray.ray.direction)).toBeLessThan(1e-6);
    expect(a.origin.x).toBeCloseTo(5); // half the 20 m wide view (aspect 2)
    // And back to normal 3D.
    setFlat(cam, null);
    expect(isFlat(cam)).toBe(false);
    expect((cam as unknown as { isPerspectiveCamera: boolean }).isPerspectiveCamera).toBe(true);
  });
});
