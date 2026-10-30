import { defineComponent } from '../core/Component';

/** A cell painted with auto-tiling: its look comes from its neighbours (edges, corners, middle). */
export const AUTO_TILE = -1;

export interface TilemapData {
  /** The tileset picture: a grid of tiles. */
  tileset: string;
  /** Tiles across and down in the tileset. */
  columns: number;
  rows: number;
  /** Size of one tile in the world (meters). */
  tileSize: number;
  /** Painted cells, "x,y" (x right, y up) → tile number in the tileset (AUTO_TILE = auto-tiled). */
  cells: Record<string, number>;
  /** Auto-tiling uses a 3 × 3 block of the tileset starting at this tile (top-left corner piece). */
  autoTile: number;
  /** Painted tiles are solid ground and walls. */
  solid: boolean;
  /** Crisp pixels (pixel art). */
  pixelArt: boolean;
  /** Drawn in front of lower layers (background 0, ground 1, player 2…). */
  layer: number;
}

export const Tilemap = defineComponent<TilemapData>({
  type: 'Tilemap',
  category: 'Rendering',
  label: 'Tilemap',
  icon: 'grid',
  description: 'Paint a 2D level from a tileset: pick a tile and paint in the viewport. Auto-tiling picks edges and corners by itself.',
  defaults: () => ({ tileset: '', columns: 1, rows: 1, tileSize: 1, cells: {}, autoTile: 0, solid: true, pixelArt: true, layer: 1 }),
  fields: {
    tileset: { kind: 'asset', label: 'Tileset', assetType: 'texture' },
    tileSize: { kind: 'number', label: 'Tile size (m)', min: 0.1, max: 10, step: 0.05 },
    solid: { kind: 'boolean', label: 'Solid' },
    pixelArt: { kind: 'boolean', label: 'Pixel art (crisp)' },
    layer: { kind: 'number', label: 'Layer (front = higher)', min: -10, max: 20, step: 1 },
  },
});

export const cellKey = (x: number, y: number) => `${x},${y}`;

export function parseCell(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/**
 * The tileset tile a cell shows. Auto-tiled cells pick from the 3 × 3 block by which sides have
 * neighbours: top row where nothing is above, bottom row where nothing is below (a one-tile-high
 * strip shows the top row), left / right column at the ends.
 */
export function tileFor(d: Pick<TilemapData, 'cells' | 'columns' | 'autoTile'>, x: number, y: number): number {
  const t = d.cells[cellKey(x, y)];
  if (t === undefined) return -1;
  if (t !== AUTO_TILE) return t;
  const has = (dx: number, dy: number) => d.cells[cellKey(x + dx, y + dy)] !== undefined;
  const up = has(0, 1);
  const down = has(0, -1);
  const left = has(-1, 0);
  const right = has(1, 0);
  const col = left && right ? 1 : !left && right ? 0 : left && !right ? 2 : 1;
  const row = !up ? 0 : !down ? 2 : 1;
  const cols = Math.max(1, Math.round(d.columns));
  return d.autoTile + row * cols + col;
}

/** Painted cells merged into horizontal runs, row by row (one solid box each). */
export function solidRuns(cells: Record<string, number>): { x0: number; x1: number; y: number }[] {
  const rows = new Map<number, number[]>();
  for (const key of Object.keys(cells)) {
    const [x, y] = parseCell(key);
    let r = rows.get(y);
    if (!r) rows.set(y, (r = []));
    r.push(x);
  }
  const out: { x0: number; x1: number; y: number }[] = [];
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let start = xs[0];
    let prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (x === prev + 1) {
        prev = x;
        continue;
      }
      out.push({ x0: start, x1: prev, y });
      start = prev = x;
    }
  }
  return out;
}
