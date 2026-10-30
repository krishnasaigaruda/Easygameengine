import { describe, expect, it } from 'vitest';
import { detectGrid } from './spriteSheet';

/** A w×h picture with filled boxes (x, y, size) on a see-through background. */
function sheet(w: number, h: number, boxes: [number, number, number][], background = 0): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = background;
  for (const [bx, by, s] of boxes)
    for (let y = by; y < by + s; y++) for (let x = bx; x < bx + s; x++) data.set([200, 50, 50, 255], (y * w + x) * 4);
  return { data, width: w, height: h };
}

describe('detectGrid', () => {
  it('finds frames by the gaps between them', () => {
    // 4 across, 2 down, 16 px cells with a 10 px figure in each.
    const boxes: [number, number, number][] = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) boxes.push([c * 16 + 3, r * 16 + 3, 10]);
    expect(detectGrid(sheet(64, 32, boxes))).toEqual({ columns: 4, rows: 2 });
  });

  it('a strip of square frames packed edge to edge', () => {
    expect(detectGrid(sheet(96, 16, [], 255))).toEqual({ columns: 6, rows: 1 });
    expect(detectGrid(sheet(16, 64, [], 255))).toEqual({ columns: 1, rows: 4 });
  });

  it('a single picture stays one frame', () => {
    expect(detectGrid(sheet(40, 30, [[5, 5, 20]]))).toEqual({ columns: 1, rows: 1 });
    expect(detectGrid(sheet(40, 30, [], 255))).toEqual({ columns: 1, rows: 1 });
  });

  it('uneven pieces (one picture with parts) are not taken for frames', () => {
    // A wide gap then two parts close together: not a regular grid.
    expect(detectGrid(sheet(64, 16, [[2, 2, 6], [40, 2, 6], [50, 2, 6]]))).toEqual({ columns: 1, rows: 1 });
  });
});
