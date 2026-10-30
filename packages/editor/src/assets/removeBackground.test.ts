import { describe, expect, it } from 'vitest';
import { borderColors, opaqueBounds, removeBackground, type Pixels } from './removeBackground';

/** A w×h picture filled by `color(x, y)`. */
function picture(w: number, h: number, color: (x: number, y: number) => [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = color(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
}
const alpha = (px: Pixels, out: Uint8ClampedArray, x: number, y: number) => out[(y * px.width + x) * 4 + 3];

describe('removeBackground', () => {
  it('clears a plain background and keeps the subject', () => {
    const px = picture(10, 10, (x, y) => (x >= 3 && x < 7 && y >= 3 && y < 7 ? [200, 30, 30] : [255, 255, 255]));
    const out = removeBackground(px, { tolerance: 10, fromEdges: true });
    expect(alpha(px, out, 0, 0)).toBe(0);
    expect(alpha(px, out, 5, 5)).toBe(255);
    expect(opaqueBounds(out, 10, 10)).toEqual({ x: 3, y: 3, width: 4, height: 4 });
  });

  it('handles a checkerboard ("transparent" background in a screenshot)', () => {
    const px = picture(16, 16, (x, y) => (x >= 6 && x < 10 && y >= 6 && y < 10 ? [40, 60, 200] : ((x >> 1) + (y >> 1)) % 2 ? [204, 204, 204] : [255, 255, 255]));
    expect(borderColors(px)).toHaveLength(2);
    const out = removeBackground(px, { tolerance: 8, fromEdges: true });
    expect(alpha(px, out, 1, 0)).toBe(0);
    expect(alpha(px, out, 2, 0)).toBe(0);
    expect(alpha(px, out, 7, 7)).toBe(255);
  });

  it('keeps background-coloured parts inside the subject, unless clicked or "everywhere"', () => {
    // A red ring with a white hole in the middle.
    const px = picture(12, 12, (x, y) => (x >= 2 && x < 10 && y >= 2 && y < 10 && !(x >= 5 && x < 7 && y >= 5 && y < 7) ? [200, 30, 30] : [255, 255, 255]));
    expect(alpha(px, removeBackground(px, { tolerance: 10, fromEdges: true }), 5, 5)).toBe(255);
    expect(alpha(px, removeBackground(px, { tolerance: 10, fromEdges: true, seeds: [{ x: 5, y: 5 }] }), 5, 5)).toBe(0);
    expect(alpha(px, removeBackground(px, { tolerance: 10, fromEdges: false }), 6, 6)).toBe(0);
  });

  it('a higher tolerance takes similar colours too', () => {
    const px = picture(8, 8, (x) => (x < 4 ? [255, 255, 255] : [235, 235, 235]));
    // Border has both shades, so both go; a subject-free picture ends up empty.
    expect(opaqueBounds(removeBackground(px, { tolerance: 2, fromEdges: true }), 8, 8)).toBeNull();
  });
});
