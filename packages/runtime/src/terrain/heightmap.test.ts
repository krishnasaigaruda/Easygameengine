import { describe, expect, it } from 'vitest';
import { heightmapFromPixels } from './heightmap';

describe('heightmapFromPixels', () => {
  it('reads brightness as height, edge to edge, at the terrain resolution', () => {
    // 4×4 picture: black on the left half, white on the right.
    const side = 4;
    const px = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) px.set(x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * side + x) * 4);
    const h = heightmapFromPixels(px, side, 8);
    const n = 9;
    expect(h.data.length).toBe(n * n);
    expect(h.data[4 * n + 0]).toBeCloseTo(0, 5);
    expect(h.data[4 * n + 8]).toBeCloseTo(1, 5);
    // Lightly smoothed across the step.
    expect(h.data[4 * n + 4]).toBeGreaterThan(0);
    expect(h.data[4 * n + 4]).toBeLessThan(1);
  });
});
