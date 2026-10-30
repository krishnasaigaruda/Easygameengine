import { defineComponent } from '../core/Component';

export interface GrassData {
  /** Blades per square meter. */
  density: number;
  /** Blade height in meters (each blade varies a little). */
  height: number;
  width: number;
  /** Color at the root and at the tip. */
  rootColor: string;
  tipColor: string;
  /** How far from the camera grass is drawn (meters). */
  distance: number;
  /** How much the wind bends it, and how fast. */
  wind: number;
  windSpeed: number;
  /** On a Terrain: only where this layer is painted (1 = base layer). 0 = everywhere. Ignored when painted. */
  onLayer: number;
  /** Grow only where you painted grass with the terrain's Grass brush. */
  painted: boolean;
  /** Where grass was painted (saved by the editor). */
  paintMap: string;
  /** No grass on slopes steeper than this (degrees). */
  maxSlope: number;
  /** Grow copies of this 3D model (a grass clump) instead of the built-in blades ('' = blades). */
  model: string;
  /** With a model: clumps per square meter… */
  clumps: number;
  /** …and how tall each clump is (meters; they vary a little). */
  clumpHeight: number;
}

export const Grass = defineComponent<GrassData>({
  type: 'Grass',
  label: 'Grass',
  icon: 'sprout',
  category: 'Environment',
  description: 'Thousands of grass blades swaying in the wind. Put it on a Terrain (grows on the base layer) or on a flat ground object.',
  defaults: () => ({
    density: 60,
    height: 0.45,
    width: 0.035,
    rootColor: '#2a4019',
    tipColor: '#7f9e45',
    model: '',
    clumps: 3,
    clumpHeight: 0.6,
    distance: 45,
    wind: 0.5,
    windSpeed: 1,
    onLayer: 1,
    painted: true,
    paintMap: '',
    maxSlope: 35,
  }),
  fields: {
    model: { kind: 'asset', label: 'Grass model (empty = blades)', assetType: 'model' },
    clumps: { kind: 'number', label: 'Clumps per m²', min: 0.1, max: 40, step: 0.1 },
    clumpHeight: { kind: 'number', label: 'Clump height (m)', min: 0.05, max: 5, step: 0.05 },
    density: { kind: 'number', label: 'Thickness (blades per m²)', min: 1, max: 300, step: 1 },
    height: { kind: 'number', label: 'Height (m)', min: 0.05, max: 3, step: 0.01 },
    width: { kind: 'number', label: 'Blade width (m)', min: 0.01, max: 0.5, step: 0.005 },
    rootColor: { kind: 'color', label: 'Root color' },
    tipColor: { kind: 'color', label: 'Tip color' },
    distance: { kind: 'number', label: 'Draw distance (m)', min: 5, max: 200, step: 1 },
    wind: { kind: 'number', label: 'Wind', min: 0, max: 2, step: 0.01 },
    windSpeed: { kind: 'number', label: 'Wind speed', min: 0, max: 5, step: 0.05 },
    painted: { kind: 'boolean', label: 'Only where painted' },
    onLayer: { kind: 'number', label: 'Only on layer (0 = all)', min: 0, max: 4, step: 1 },
    maxSlope: { kind: 'number', label: 'Max slope (°)', min: 0, max: 90, step: 1 },
  },
});

export const SCATTER_SHAPES = ['flowers', 'grass clump', 'fern', 'bush', 'fallen leaves', 'pebbles', 'rock', 'pine tree', 'round tree', 'model'] as const;
export const SCATTER_PLACEMENT = ['random', 'painted'] as const;
export type ScatterShape = (typeof SCATTER_SHAPES)[number];

export interface ScatterData {
  /** Built-in shape, or "model" to use a model from the Asset Store / your files. */
  shape: ScatterShape;
  model: string;
  /** Model: resize so each copy is about this tall before random sizing (0 = the model's own size). */
  fitHeight: number;
  count: number;
  /** Area: a square this many meters across, centred on the object (on a Terrain: its whole size if 0). */
  area: number;
  seed: number;
  minScale: number;
  maxScale: number;
  /** Lean with the ground instead of standing straight up. */
  alignToGround: boolean;
  /** Skip slopes steeper than this (degrees). */
  maxSlope: number;
  /** Skip spots higher than this fraction of a terrain's height (1 = no limit). */
  maxHeight: number;
  color: string;
  /** Players bump into them. */
  solid: boolean;
  /** Not drawn beyond this distance from the camera (meters). */
  drawDistance: number;
  /** random: "count" things spread over the area. painted: wherever you paint with the terrain's Plants brush. */
  placement: (typeof SCATTER_PLACEMENT)[number];
  /** Painted: how many per square meter where painted fully. */
  density: number;
  /** Where it was painted (saved by the editor). */
  paintMap: string;
  /** Not where other objects stand (houses, rocks, a lake): a little space around each. */
  keepClear: boolean;
}

export const Scatter = defineComponent<ScatterData>({
  type: 'Scatter',
  label: 'Scatter',
  icon: 'shuffle',
  category: 'Environment',
  description: 'Fills an area with trees, rocks or bushes (or any model) at random, sitting on the ground. Add several for different things.',
  defaults: () => ({
    shape: 'pine tree',
    model: '',
    fitHeight: 0,
    count: 120,
    area: 0,
    seed: 1,
    minScale: 0.7,
    maxScale: 1.4,
    alignToGround: false,
    maxSlope: 30,
    maxHeight: 0.6,
    color: '#3c6b2c',
    solid: true,
    drawDistance: 220,
    placement: 'random',
    density: 0.6,
    paintMap: '',
    keepClear: false,
  }),
  fields: {
    shape: { kind: 'enum', label: 'What', options: SCATTER_SHAPES },
    placement: { kind: 'enum', label: 'Placement', options: SCATTER_PLACEMENT },
    density: { kind: 'number', label: 'Per m² (painted)', min: 0.01, max: 30, step: 0.01 },
    model: { kind: 'asset', label: 'Model', assetType: 'model' },
    fitHeight: { kind: 'number', label: 'Model height (m, 0 = own)', min: 0, max: 200, step: 0.1 },
    color: { kind: 'color', label: 'Color' },
    count: { kind: 'number', label: 'How many', min: 1, max: 20000, step: 1 },
    area: { kind: 'number', label: 'Area (m, 0 = whole terrain)', min: 0, max: 4000, step: 1 },
    seed: { kind: 'number', label: 'Random seed', min: 0, max: 99999, step: 1 },
    minScale: { kind: 'number', label: 'Smallest size', min: 0.05, max: 20, step: 0.05 },
    maxScale: { kind: 'number', label: 'Largest size', min: 0.05, max: 20, step: 0.05 },
    alignToGround: { kind: 'boolean', label: 'Lean with the ground' },
    maxSlope: { kind: 'number', label: 'Max slope (°)', min: 0, max: 90, step: 1 },
    maxHeight: { kind: 'number', label: 'Max height (0–1)', min: 0, max: 1, step: 0.01 },
    solid: { kind: 'boolean', label: 'Solid' },
    drawDistance: { kind: 'number', label: 'Draw distance (m)', min: 10, max: 5000, step: 5 },
    keepClear: { kind: 'boolean', label: 'Keep clear of objects' },
  },
});
