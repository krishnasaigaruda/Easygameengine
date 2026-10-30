import type { Pixels } from './removeBackground';

/*
 * Finding the frames of a sprite sheet: by the see-through gaps between them, or, for frames
 * packed edge to edge, by the picture being a strip of square frames.
 */

/** Runs of columns (or rows) that have something in them. */
function runs(filled: boolean[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = -1;
  filled.forEach((f, i) => {
    if (f && start < 0) start = i;
    if (!f && start >= 0) {
      out.push({ start, end: i - 1 });
      start = -1;
    }
  });
  if (start >= 0) out.push({ start, end: filled.length - 1 });
  return out;
}

/** Do these runs sit one per equal cell (a regular grid)? */
function regular(r: { start: number; end: number }[], length: number): boolean {
  const cell = length / r.length;
  const centre = (run: { start: number; end: number }) => (run.start + run.end) / 2;
  return r.every(
    (run, i) =>
      Math.floor(centre(run) / cell) === i &&
      run.end - run.start < cell &&
      // Frames are evenly spaced: about one cell from the last one.
      (i === 0 || Math.abs(centre(run) - centre(r[i - 1]) - cell) < cell * 0.25),
  );
}

/** How many frames across and down a sheet has (1 × 1 = a single picture). */
export function detectGrid(px: Pixels): { columns: number; rows: number } {
  const { data, width: w, height: h } = px;
  const cols = new Array<boolean>(w).fill(false);
  const rowsFilled = new Array<boolean>(h).fill(false);
  let seeThrough = false;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        cols[x] = true;
        rowsFilled[y] = true;
      } else seeThrough = true;
    }
  let columns = 1;
  let rows = 1;
  const across = runs(cols);
  const down = runs(rowsFilled);
  if (seeThrough) {
    if (across.length > 1 && regular(across, w)) columns = across.length;
    if (down.length > 1 && regular(down, h)) rows = down.length;
  }
  if (columns === 1 && rows === 1 && across.length <= 1 && down.length <= 1) {
    // No gaps at all (packed edge to edge): a strip of square frames.
    if (w >= h * 2 && w % h === 0) columns = w / h;
    else if (h >= w * 2 && h % w === 0) rows = h / w;
  }
  return { columns, rows };
}
