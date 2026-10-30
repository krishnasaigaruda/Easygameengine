import type { ScatterData } from '../components/foliage';
import type { TerrainData } from '../components/terrain';
import { decodePaint, normalLocal, pointsPerSide, sampleLocal, type Heightmap } from './heightmap';

/** Most things a painted Scatter makes (keeps big painted fields fast). */
const MAX_PAINTED = 30000;

/** One scattered thing, in the owner's local space. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Turn around the up axis (radians). */
  yaw: number;
  scale: number;
  /** Ground normal (for "lean with the ground"). */
  normal: [number, number, number];
}

function rng(seed: number) {
  let s = (Math.floor(seed) * 2654435761 + 1) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Where everything goes. Deterministic (same settings → same spots), so drawing and physics
 * agree, and saving the scene only needs the settings.
 */
export function scatterPlacements(d: ScatterData, terrain?: { data: TerrainData; heights: Heightmap; offset?: [number, number] }): Placement[] {
  if (d.placement === 'painted') return terrain ? paintedPlacements(d, terrain) : [];
  const random = rng(d.seed);
  const area = d.area > 0 ? d.area : terrain ? terrain.data.size : 20;
  const out: Placement[] = [];
  const maxTries = d.count * 12;
  const maxSlopeCos = Math.cos((d.maxSlope * Math.PI) / 180);
  for (let tries = 0; out.length < d.count && tries < maxTries; tries++) {
    const x = (random() - 0.5) * area;
    const z = (random() - 0.5) * area;
    const yaw = random() * Math.PI * 2;
    const scale = d.minScale + (d.maxScale - d.minScale) * random();
    let y = 0;
    let normal: [number, number, number] = [0, 1, 0];
    if (terrain) {
      const t = terrain.data;
      const tx = x + (terrain.offset?.[0] ?? 0);
      const tz = z + (terrain.offset?.[1] ?? 0);
      if (Math.abs(tx) > t.size / 2 || Math.abs(tz) > t.size / 2) continue;
      const h = sampleLocal(terrain.heights, t.size, tx, tz);
      if (d.maxHeight < 1 && h > d.maxHeight) continue;
      normal = normalLocal(terrain.heights, t.size, t.maxHeight, tx, tz);
      if (normal[1] < maxSlopeCos) continue;
      y = h * t.maxHeight;
    }
    out.push({ x, y, z, yaw, scale, normal });
  }
  return out;
}

/** Painted: each grid cell grows as many as its paint says (same spots every time). */
function paintedPlacements(d: ScatterData, terrain: { data: TerrainData; heights: Heightmap; offset?: [number, number] }): Placement[] {
  const t = terrain.data;
  const res = terrain.heights.resolution;
  const map = decodePaint(d.paintMap, res);
  const n = pointsPerSide(res);
  const cell = t.size / res;
  const ox = terrain.offset?.[0] ?? 0;
  const oz = terrain.offset?.[1] ?? 0;
  const maxSlopeCos = Math.cos((d.maxSlope * Math.PI) / 180);
  const out: Placement[] = [];
  for (let gz = 0; gz < n && out.length < MAX_PAINTED; gz++) {
    for (let gx = 0; gx < n && out.length < MAX_PAINTED; gx++) {
      const paint = map[gz * n + gx] / 255;
      if (paint <= 0.02) continue;
      const random = rng(d.seed * 7919 + gz * n + gx + 1);
      const expected = d.density * cell * cell * paint;
      const count = Math.floor(expected + random());
      for (let k = 0; k < count; k++) {
        const tx = (gx + random() - 0.5) * cell - t.size / 2;
        const tz = (gz + random() - 0.5) * cell - t.size / 2;
        if (Math.abs(tx) > t.size / 2 || Math.abs(tz) > t.size / 2) continue;
        const normal = normalLocal(terrain.heights, t.size, t.maxHeight, tx, tz);
        if (normal[1] < maxSlopeCos) continue;
        const scale = d.minScale + (d.maxScale - d.minScale) * random();
        out.push({ x: tx - ox, y: sampleLocal(terrain.heights, t.size, tx, tz) * t.maxHeight, z: tz - oz, yaw: random() * Math.PI * 2, scale, normal });
      }
    }
  }
  return out;
}

/** A simple solid shape per scattered thing (trunks, rocks), in the owner's local space. */
export function scatterColliders(d: ScatterData, placements: Placement[]): { x: number; y: number; z: number; radius: number; height: number }[] {
  if (!d.solid || d.shape === 'bush' || d.shape === 'flowers' || d.shape === 'grass clump' || d.shape === 'fern') return [];
  return placements.map((p) => {
    const s = p.scale;
    switch (d.shape) {
      case 'rock':
        return { x: p.x, y: p.y + 0.35 * s, z: p.z, radius: 0.55 * s, height: 0.7 * s };
      case 'model':
        return { x: p.x, y: p.y + 0.8 * s, z: p.z, radius: 0.4 * s, height: 1.6 * s };
      default: // trees: the trunk
        return { x: p.x, y: p.y + 1.5 * s, z: p.z, radius: 0.2 * s, height: 3 * s };
    }
  });
}
