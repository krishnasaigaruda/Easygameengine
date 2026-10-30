import { create } from 'zustand';
import type { TerrainBrush } from '@ege/runtime';

/** Sculpt brushes, plus painting: ground texture, grass, and plants (flowers, rocks, any model). */
export type TerrainTool = TerrainBrush | 'grass' | 'plants';

/** The terrain brush being used in the viewport (null = normal selecting/moving). */
export interface TerrainBrushState {
  brush: TerrainTool | null;
  /** Radius in meters. */
  size: number;
  /** 0–1. */
  strength: number;
  /** Texture painting: which layer (0–7). */
  layer: number;
  /** Plants: which plant type (a Scatter object under the terrain) to paint. */
  plant: string | null;
  /** Texture painting: 0 = even, 1 = natural patches (mix several textures by painting them over each other). */
  breakup: number;
  /** Size of those patches in meters. */
  patchSize: number;
}

export const useTerrainBrush = create<TerrainBrushState>(() => ({ brush: null, size: 6, strength: 0.5, layer: 1, plant: null, breakup: 0, patchSize: 2.5 }));
