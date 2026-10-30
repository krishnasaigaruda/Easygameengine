/*
 * Terrain heightmaps: a square grid of (resolution + 1)² heights from 0 to 1, row by row
 * (rows go along +Z, columns along +X), saved in scene files as compact base64 text.
 * Paint (splat) maps use the same grid with one weight per point for each of the 8 layers.
 */

export interface Heightmap {
  /** Cells per side; there are resolution + 1 points per side. */
  resolution: number;
  /** (resolution + 1)² heights, 0–1. */
  data: Float32Array;
}

export const pointsPerSide = (resolution: number) => resolution + 1;

export function flatHeightmap(resolution: number, height = 0): Heightmap {
  const n = pointsPerSide(resolution);
  return { resolution, data: new Float32Array(n * n).fill(height) };
}

// ── encoding ────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * A heightmap from picture pixels (RGBA, side × side): brightness is height. Edge-to-edge, so a
 * picture of any size fits the terrain; light blurring removes the steps of 8-bit images.
 */
export function heightmapFromPixels(rgba: Uint8ClampedArray, side: number, resolution: number): Heightmap {
  const n = pointsPerSide(resolution);
  const raw = new Float32Array(n * n);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const sx = Math.min(side - 1, Math.round((x / (n - 1)) * (side - 1)));
      const sz = Math.min(side - 1, Math.round((z / (n - 1)) * (side - 1)));
      const i = (sz * side + sx) * 4;
      raw[z * n + x] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) / 255;
    }
  const data = new Float32Array(n * n);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      let sum = 0;
      let count = 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          sum += raw[zz * n + xx];
          count++;
        }
      data[z * n + x] = sum / count;
    }
  return { resolution, data };
}

/** Heights → base64 of 16-bit values (little-endian). */
export function encodeHeights(h: Heightmap): string {
  const u = new Uint16Array(h.data.length);
  for (let i = 0; i < u.length; i++) u[i] = Math.round(Math.min(1, Math.max(0, h.data[i])) * 65535);
  const bytes = new Uint8Array(u.length * 2);
  for (let i = 0; i < u.length; i++) {
    bytes[i * 2] = u[i] & 0xff;
    bytes[i * 2 + 1] = u[i] >> 8;
  }
  return toBase64(bytes);
}

/** base64 → heights. Empty or damaged text gives a flat map; other sizes are resampled. */
export function decodeHeights(text: string, resolution: number): Heightmap {
  const n = pointsPerSide(resolution);
  if (!text) return flatHeightmap(resolution);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(text);
  } catch {
    return flatHeightmap(resolution);
  }
  const count = bytes.length >> 1;
  const side = Math.round(Math.sqrt(count));
  if (side * side !== count || side < 2) return flatHeightmap(resolution);
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) data[i] = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) / 65535;
  const h = { resolution: side - 1, data };
  return side === n ? h : resample(h, resolution);
}

/** Texture layers a terrain can paint with. */
export const SPLAT_LAYERS = 8;

/**
 * Splat weights ↔ base64: one weight (0–255) per layer per point, stored as two blocks of 4
 * channels (layers 1–4, then 5–8) so each block is one RGBA texture. Empty = all first layer.
 * Older 4-layer data still loads (layers 5–8 start empty).
 */
export function encodeSplat(splat: Uint8Array): string {
  return toBase64(splat);
}

export function decodeSplat(text: string, resolution: number): Uint8Array {
  const n = pointsPerSide(resolution);
  const empty = () => {
    const s = new Uint8Array(n * n * SPLAT_LAYERS);
    for (let i = 0; i < n * n; i++) s[i * 4] = 255;
    return s;
  };
  if (!text) return empty();
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(text);
  } catch {
    return empty();
  }
  const blocks = (len: number) => {
    for (const b of [2, 1]) {
      const side = Math.round(Math.sqrt(len / (4 * b)));
      if (side >= 2 && side * side * 4 * b === len) return { side, b };
    }
    return null;
  };
  const shape = blocks(bytes.length);
  if (!shape) return empty();
  const { side, b } = shape;
  const out = new Uint8Array(n * n * SPLAT_LAYERS);
  for (let block = 0; block < b; block++) {
    const src = bytes.subarray(block * side * side * 4, (block + 1) * side * side * 4);
    const dst = out.subarray(block * n * n * 4, (block + 1) * n * n * 4);
    if (side === n) {
      dst.set(src);
      continue;
    }
    for (let c = 0; c < 4; c++) {
      const ch = new Float32Array(side * side);
      for (let i = 0; i < ch.length; i++) ch[i] = src[i * 4 + c] / 255;
      const r = resample({ resolution: side - 1, data: ch }, resolution);
      for (let i = 0; i < n * n; i++) dst[i * 4 + c] = Math.round(r.data[i] * 255);
    }
  }
  return out;
}

/** Index of one layer's weight at one point in a splat map (see decodeSplat for the layout). */
export function splatIndex(n: number, point: number, layer: number): number {
  return layer < 4 ? point * 4 + layer : n * n * 4 + point * 4 + (layer - 4);
}

// ── sampling ────────────────────────────────────────────────────────────────

/** Height (0–1) at grid coordinates (fractional), clamped to the edges. */
export function sampleGrid(h: Heightmap, gx: number, gz: number): number {
  const n = pointsPerSide(h.resolution);
  const x = Math.min(n - 1, Math.max(0, gx));
  const z = Math.min(n - 1, Math.max(0, gz));
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(n - 1, x0 + 1);
  const z1 = Math.min(n - 1, z0 + 1);
  const fx = x - x0;
  const fz = z - z0;
  const d = h.data;
  const a = d[z0 * n + x0] * (1 - fx) + d[z0 * n + x1] * fx;
  const b = d[z1 * n + x0] * (1 - fx) + d[z1 * n + x1] * fx;
  return a * (1 - fz) + b * fz;
}

/**
 * Height (0–1) at a local position on a terrain of `size` meters centred on its origin
 * (x and z from -size/2 to size/2).
 */
export function sampleLocal(h: Heightmap, size: number, x: number, z: number): number {
  const g = h.resolution / size;
  return sampleGrid(h, (x + size / 2) * g, (z + size / 2) * g);
}

/** Surface normal (unit) at a local position, for a terrain `maxHeight` meters tall. */
export function normalLocal(h: Heightmap, size: number, maxHeight: number, x: number, z: number): [number, number, number] {
  const e = size / h.resolution;
  const hx = (sampleLocal(h, size, x + e, z) - sampleLocal(h, size, x - e, z)) * maxHeight;
  const hz = (sampleLocal(h, size, x, z + e) - sampleLocal(h, size, x, z - e)) * maxHeight;
  const nx = -hx;
  const ny = 2 * e;
  const nz = -hz;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

export function resample(h: Heightmap, resolution: number): Heightmap {
  const n = pointsPerSide(resolution);
  const out = new Float32Array(n * n);
  const k = h.resolution / resolution;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out[z * n + x] = sampleGrid(h, x * k, z * k);
  return { resolution, data: out };
}

// ── generation ──────────────────────────────────────────────────────────────

/** 'image': heights read from a picture (a heightmap: bright = high). */
export const TERRAIN_PRESETS = ['flat', 'hills', 'mountains', 'valley', 'island', 'plateaus', 'image'] as const;
export type TerrainPreset = (typeof TERRAIN_PRESETS)[number];

/** Small seeded value noise (deterministic, no dependencies). */
function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  let s = (seed * 2654435761) >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h: number, x: number, y: number) => {
    const g = h & 7;
    const u = g < 4 ? x : y;
    const v = g < 4 ? y : x;
    return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v);
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  /** Gradient noise, roughly -1..1. */
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa, xf, yf) * (1 - u) + grad(ba, xf - 1, yf) * u;
    const x2 = grad(ab, xf, yf - 1) * (1 - u) + grad(bb, xf - 1, yf - 1) * u;
    return (x1 * (1 - v) + x2 * v) * 0.5;
  };
  /** Layered noise (fractal), roughly -1..1. */
  const fbm = (x: number, y: number, octaves: number, roughness: number) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= roughness;
      freq *= 2;
    }
    return sum / norm;
  };
  return { noise, fbm };
}

/** Good starting heights and snow for each kind of landscape (meters, snow line 0–1; >1 = none). */
export const PRESET_LOOK: Record<TerrainPreset, { maxHeight: number; snowLine: number; rockSlope: number }> = {
  flat: { maxHeight: 10, snowLine: 1.1, rockSlope: 45 },
  hills: { maxHeight: 18, snowLine: 1.1, rockSlope: 40 },
  mountains: { maxHeight: 70, snowLine: 0.72, rockSlope: 36 },
  valley: { maxHeight: 55, snowLine: 0.78, rockSlope: 36 },
  island: { maxHeight: 22, snowLine: 1.1, rockSlope: 42 },
  plateaus: { maxHeight: 28, snowLine: 1.1, rockSlope: 34 },
  image: { maxHeight: 40, snowLine: 1.1, rockSlope: 38 },
};

export interface GenerateOptions {
  preset: TerrainPreset;
  seed: number;
  /** 0–1: how bumpy the small detail is. */
  roughness: number;
  /** How many hills fit across (bigger = more, smaller features). */
  scale: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Make a whole landscape in one go. Heights are normalised to use the full 0–1 range. */
export function generateHeightmap(resolution: number, o: GenerateOptions): Heightmap {
  const n = pointsPerSide(resolution);
  const { fbm } = makeNoise(o.seed);
  const out = new Float32Array(n * n);
  const rough = 0.35 + o.roughness * 0.3;
  if (o.preset === 'flat' || o.preset === 'image') return { resolution, data: out };
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const u = x / (n - 1); // 0..1
      const v = z / (n - 1);
      const px = u * o.scale;
      const pz = v * o.scale;
      const cx = u - 0.5;
      const cz = v - 0.5;
      const r = Math.hypot(cx, cz) * 2; // 0 centre, 1 edge middle
      let h: number;
      switch (o.preset) {
        case 'hills':
          // Smooth, rounded hills: fewer octaves, gentle detail.
          h = 0.5 + fbm(px * 0.7, pz * 0.7, 4, rough * 0.7) * 0.9;
          break;
        case 'mountains': {
          // Ridged noise: sharp peaks and ridgelines.
          const ridge = 1 - Math.abs(fbm(px * 0.8, pz * 0.8, 6, rough + 0.1) * 1.6);
          h = Math.pow(Math.max(0, ridge), 2.2) * 0.85 + (fbm(px * 2, pz * 2, 3, rough) * 0.5 + 0.5) * 0.15;
          break;
        }
        case 'valley': {
          // A wide, gentle valley floor running along Z, mountains rising on both sides.
          const wander = fbm(pz * 0.35 + 7, 3, 3, 0.5) * 0.12;
          const side = Math.abs(cx - wander) * 2; // 0 valley centre, 1 sides
          const walls = smooth(0.18, 0.95, side);
          const ridge = 1 - Math.abs(fbm(px * 0.9, pz * 0.9, 6, rough + 0.1) * 1.6);
          const peaks = Math.pow(Math.max(0, ridge), 1.6);
          const floor = (fbm(px * 1.5, pz * 1.5, 4, rough) * 0.5 + 0.5) * 0.04;
          h = floor + walls * (0.25 + peaks * 0.75);
          break;
        }
        case 'island': {
          const falloff = 1 - smooth(0.45, 1, r + fbm(px * 0.5, pz * 0.5, 3, 0.5) * 0.2);
          h = falloff * (0.35 + (fbm(px, pz, 5, rough) * 0.5 + 0.5) * 0.65);
          break;
        }
        case 'plateaus': {
          const base = fbm(px * 0.7, pz * 0.7, 5, rough) * 0.5 + 0.5;
          const steps = 5;
          const stepped = Math.floor(base * steps) / steps;
          const t = base * steps - Math.floor(base * steps);
          h = stepped + smooth(0.75, 1, t) / steps;
          break;
        }
        default:
          h = 0;
      }
      out[z * n + x] = h;
    }
  }
  // Normalise to 0–1 (island keeps 0 as sea level).
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (o.preset === 'island') lo = 0;
  const span = hi - lo || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, (out[i] - lo) / span);
  return { resolution, data: out };
}

// ── brushes ─────────────────────────────────────────────────────────────────

export const TERRAIN_BRUSHES = ['raise', 'lower', 'smooth', 'flatten', 'paint'] as const;
export type TerrainBrush = (typeof TERRAIN_BRUSHES)[number];

export interface BrushStroke {
  brush: TerrainBrush;
  /** Centre in grid coordinates. */
  gx: number;
  gz: number;
  /** Radius in grid cells. */
  radius: number;
  /** 0–1 per application. */
  strength: number;
  /** flatten: target height 0–1. */
  target?: number;
  /** paint: which layer (0–7). */
  layer?: number;
  /**
   * paint: 0 = even coverage, 1 = natural patches. The strength follows a noise pattern (a
   * different one per layer), so layers painted over each other mix like real ground.
   */
  breakup?: number;
  /** Size of the patches, in grid cells. */
  breakupScale?: number;
}

function hash2(x: number, z: number, seed: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Patchy 0–1 mask for the breakup brush (two octaves, high contrast). */
export function breakupMask(x: number, z: number, scale: number, seed: number): number {
  const s = Math.max(0.5, scale);
  const n = valueNoise(x / s, z / s, seed) * 0.65 + valueNoise((x / s) * 2.7, (z / s) * 2.7, seed + 9) * 0.35;
  const t = Math.min(1, Math.max(0, (n - 0.35) / 0.3));
  return t * t * (3 - 2 * t);
}

/** Grid points the brush touches, with soft falloff (1 centre → 0 edge). */
function* footprint(n: number, s: BrushStroke): Generator<[number, number]> {
  const r = Math.max(0.5, s.radius);
  const x0 = Math.max(0, Math.floor(s.gx - r));
  const x1 = Math.min(n - 1, Math.ceil(s.gx + r));
  const z0 = Math.max(0, Math.floor(s.gz - r));
  const z1 = Math.min(n - 1, Math.ceil(s.gz + r));
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - s.gx, z - s.gz) / r;
      if (d >= 1) continue;
      const f = 0.5 + 0.5 * Math.cos(d * Math.PI); // smooth bump
      yield [z * n + x, f];
    }
  }
}

/** Apply one brush dab to heights (or to the splat map for "paint"). Returns the touched bounds. */
export function applyBrush(h: Heightmap, splat: Uint8Array | null, s: BrushStroke): { x0: number; x1: number; z0: number; z1: number } {
  const n = pointsPerSide(h.resolution);
  const d = h.data;
  if (s.brush === 'smooth') {
    const copy = d.slice();
    for (const [i, f] of footprint(n, s)) {
      const x = i % n;
      const z = (i - x) / n;
      let sum = 0;
      let cnt = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          sum += copy[zz * n + xx];
          cnt++;
        }
      }
      d[i] = copy[i] + (sum / cnt - copy[i]) * Math.min(1, f * s.strength * 2);
    }
  } else if (s.brush === 'paint') {
    if (splat) {
      const layer = Math.min(SPLAT_LAYERS - 1, Math.max(0, s.layer ?? 0));
      const breakup = Math.min(1, Math.max(0, s.breakup ?? 0));
      for (const [i, f] of footprint(n, s)) {
        const x = i % n;
        const mask = breakup > 0 ? 1 - breakup + breakup * breakupMask(x, (i - x) / n, s.breakupScale ?? 6, layer * 17.3) : 1;
        const a = Math.min(1, f * s.strength * mask);
        let total = 0;
        for (let c = 0; c < SPLAT_LAYERS; c++) {
          const k = splatIndex(n, i, c);
          const cur = splat[k] / 255;
          const next = c === layer ? cur + (1 - cur) * a : cur * (1 - a);
          splat[k] = Math.round(next * 255);
          total += splat[k];
        }
        if (total === 0) splat[splatIndex(n, i, layer)] = 255;
      }
    }
  } else {
    for (const [i, f] of footprint(n, s)) {
      if (s.brush === 'raise') d[i] = Math.min(1, d[i] + f * s.strength * 0.02);
      else if (s.brush === 'lower') d[i] = Math.max(0, d[i] - f * s.strength * 0.02);
      else if (s.brush === 'flatten') d[i] += ((s.target ?? d[i]) - d[i]) * Math.min(1, f * s.strength);
    }
  }
  const r = Math.ceil(s.radius) + 1;
  return {
    x0: Math.max(0, Math.floor(s.gx) - r),
    x1: Math.min(n - 1, Math.ceil(s.gx) + r),
    z0: Math.max(0, Math.floor(s.gz) - r),
    z1: Math.min(n - 1, Math.ceil(s.gz) + r),
  };
}

// ── paint maps (grass / plants: how much grows where, 0–255 per grid point) ──

export function encodePaint(map: Uint8Array): string {
  return toBase64(map);
}

/** Paint map for a terrain grid; empty or wrong-sized text gives an empty (nothing painted) map. */
export function decodePaint(text: string, resolution: number): Uint8Array {
  const n = pointsPerSide(resolution);
  if (!text) return new Uint8Array(n * n);
  try {
    const bytes = fromBase64(text);
    if (bytes.length === n * n) return bytes;
    const side = Math.round(Math.sqrt(bytes.length));
    if (side * side !== bytes.length || side < 2) return new Uint8Array(n * n);
    const f = new Float32Array(bytes.length);
    for (let i = 0; i < f.length; i++) f[i] = bytes[i] / 255;
    const r = resample({ resolution: side - 1, data: f }, resolution);
    const out = new Uint8Array(n * n);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(r.data[i] * 255);
    return out;
  } catch {
    return new Uint8Array(n * n);
  }
}

/** Paint (or erase) a soft round dab into a paint map. Grid coordinates, like applyBrush. */
export function paintDab(map: Uint8Array, resolution: number, gx: number, gz: number, radius: number, strength: number, erase: boolean): void {
  const n = pointsPerSide(resolution);
  const r = Math.max(0.5, radius);
  for (let z = Math.max(0, Math.floor(gz - r)); z <= Math.min(n - 1, Math.ceil(gz + r)); z++) {
    for (let x = Math.max(0, Math.floor(gx - r)); x <= Math.min(n - 1, Math.ceil(gx + r)); x++) {
      const d = Math.hypot(x - gx, z - gz) / r;
      if (d >= 1) continue;
      const f = (0.5 + 0.5 * Math.cos(d * Math.PI)) * strength;
      const i = z * n + x;
      map[i] = erase ? Math.max(0, map[i] - Math.ceil(f * 255)) : Math.min(255, map[i] + Math.ceil(f * 255));
    }
  }
}
