import { create } from 'zustand';
import { AUTO_TILE } from '@ege/runtime';

/** The tilemap brush (painting happens in the viewport while a Tilemap is selected). */
export interface TileBrushState {
  /** Painting in the viewport (off = normal selecting / moving). */
  active: boolean;
  /** Remove tiles instead of painting them (Shift does the same while held). */
  erase: boolean;
  /** The tile painted: a tileset tile number, or AUTO_TILE (edges and corners by themselves). */
  tile: number;
}

export const useTileBrush = create<TileBrushState>(() => ({ active: false, erase: false, tile: AUTO_TILE }));
