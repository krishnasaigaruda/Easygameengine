/*
 * Background removal for pictures (sprites, decals, icons). Works out the background colours
 * from the picture's border, then clears everything of those colours that touches the edge (or
 * every such pixel, or the parts the user clicks). Runs instantly in the browser; no download.
 */

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RemoveOptions {
  /** How different a colour may be from the background and still go (0–100). */
  tolerance: number;
  /** Only background that touches the edge (keeps the same colour inside the subject). */
  fromEdges: boolean;
  /** Spots the user clicked: their colour goes too, and (from edges) the area around them. */
  seeds?: { x: number; y: number }[];
  /** Fade the outline instead of a hard cut (photos; off for pixel art). */
  softEdges?: boolean;
}

type RGB = [number, number, number];

const MAX_DIST = Math.sqrt(3) * 255;
const dist = (d: Uint8ClampedArray, i: number, c: RGB) => (Math.hypot(d[i] - c[0], d[i + 1] - c[1], d[i + 2] - c[2]) / MAX_DIST) * 100;

/** The main colours along the border (up to 6; a checkerboard gives two). */
export function borderColors(px: Pixels): RGB[] {
  const { data, width: w, height: h } = px;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 16) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += data[i];
    b.g += data[i + 1];
    b.b += data[i + 2];
    buckets.set(key, b);
    total++;
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    if (h > 1) add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    if (w > 1) add(w - 1, y);
  }
  return [...buckets.values()]
    .filter((b) => b.n >= total * 0.04)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((b) => [b.r / b.n, b.g / b.n, b.b / b.n] as RGB);
}

/** A copy of the picture with the background made transparent. */
export function removeBackground(px: Pixels, o: RemoveOptions): Uint8ClampedArray {
  const { data, width: w, height: h } = px;
  const out = new Uint8ClampedArray(data);
  const palette = borderColors(px);
  const seeds = (o.seeds ?? []).filter((s) => s.x >= 0 && s.y >= 0 && s.x < w && s.y < h);
  for (const s of seeds) {
    const i = (s.y * w + s.x) * 4;
    palette.push([data[i], data[i + 1], data[i + 2]]);
  }
  const tol = Math.max(0, o.tolerance);
  const near = (i: number) => {
    if (data[i + 3] < 16) return 0;
    let best = Infinity;
    for (const c of palette) best = Math.min(best, dist(data, i, c));
    return best;
  };
  const gone = new Uint8Array(w * h);

  if (!o.fromEdges) {
    for (let p = 0; p < w * h; p++) if (near(p * 4) <= tol) gone[p] = 1;
  } else {
    // Spread from the border (and the clicked spots) through background-coloured pixels.
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    const visit = (p: number) => {
      if (gone[p] || near(p * 4) > tol) return;
      gone[p] = 1;
      queue[tail++] = p;
    };
    for (let x = 0; x < w; x++) {
      visit(x);
      visit((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      visit(y * w);
      visit(y * w + w - 1);
    }
    for (const s of seeds) visit(s.y * w + s.x);
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < w * (h - 1)) visit(p + w);
    }
  }

  for (let p = 0; p < w * h; p++) if (gone[p]) out[p * 4 + 3] = 0;

  if (o.softEdges && tol > 0) {
    // Outline pixels that are nearly background become see-through in proportion.
    for (let p = 0; p < w * h; p++) {
      if (gone[p]) continue;
      const x = p % w;
      const y = (p / w) | 0;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && gone[ny * w + nx]) {
            edge = true;
            break;
          }
        }
      if (!edge) continue;
      const d = near(p * 4);
      const k = Math.min(1, Math.max(0, (d - tol) / Math.max(tol, 4)));
      out[p * 4 + 3] = Math.round(out[p * 4 + 3] * (0.25 + 0.75 * k));
    }
  }
  return out;
}

/** The smallest box around everything that's left (null: nothing left). */
export function opaqueBounds(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; width: number; height: number } | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
