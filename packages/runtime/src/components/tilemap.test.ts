import { describe, expect, it } from 'vitest';
import { AUTO_TILE, cellKey, solidRuns, tileFor } from './tilemap';

const map = (cells: [number, number, number][]) => Object.fromEntries(cells.map(([x, y, t]) => [cellKey(x, y), t]));

describe('tilemap', () => {
  it('manual tiles show the tile they were painted with', () => {
    expect(tileFor({ cells: map([[0, 0, 5]]), columns: 4, autoTile: 0 }, 0, 0)).toBe(5);
    expect(tileFor({ cells: {}, columns: 4, autoTile: 0 }, 0, 0)).toBe(-1);
  });

  it('auto-tiles pick corners, edges and middle from the 3×3 block', () => {
    // A 3×3 block of auto cells, tileset 8 across, block starting at tile 2.
    const cells: [number, number, number][] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push([x, y, AUTO_TILE]);
    const d = { cells: map(cells), columns: 8, autoTile: 2 };
    expect(tileFor(d, 0, 2)).toBe(2); // top-left
    expect(tileFor(d, 1, 2)).toBe(3); // top
    expect(tileFor(d, 2, 2)).toBe(4); // top-right
    expect(tileFor(d, 1, 1)).toBe(2 + 8 + 1); // middle
    expect(tileFor(d, 0, 0)).toBe(2 + 16); // bottom-left
    expect(tileFor(d, 2, 0)).toBe(2 + 16 + 2); // bottom-right
  });

  it('a one-tile-high platform shows the top row', () => {
    const d = { cells: map([[0, 0, AUTO_TILE], [1, 0, AUTO_TILE], [2, 0, AUTO_TILE]]), columns: 3, autoTile: 0 };
    expect([0, 1, 2].map((x) => tileFor(d, x, 0))).toEqual([0, 1, 2]);
  });

  it('solid runs merge neighbours in a row', () => {
    const runs = solidRuns(map([[0, 0, 1], [1, 0, 1], [2, 0, 1], [5, 0, 1], [0, 1, 1]]));
    expect(runs).toContainEqual({ x0: 0, x1: 2, y: 0 });
    expect(runs).toContainEqual({ x0: 5, x1: 5, y: 0 });
    expect(runs).toContainEqual({ x0: 0, x1: 0, y: 1 });
    expect(runs).toHaveLength(3);
  });
});
