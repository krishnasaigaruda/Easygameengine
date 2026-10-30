import { defineComponent } from '../core/Component';
import { TERRAIN_PRESETS, type TerrainPreset } from '../terrain/heightmap';

export interface TerrainData {
  /** Width and depth in meters (square, centred on the object). */
  size: number;
  /** How tall the highest point can be, in meters. */
  maxHeight: number;
  /** Detail: grid cells per side (more = finer shapes, slower). */
  resolution: number;
  /** Heights (saved by the editor's sculpt tools; '' = flat). */
  heights: string;
  /** Paint weights for the 8 layers ('' = all base layer). */
  splat: string;
  /** Layers: a material (from the Asset Store) and/or a color, repeating every `tiling` meters. */
  layer1Material: string;
  layer1Color: string;
  layer2Material: string;
  layer2Color: string;
  layer3Material: string;
  layer3Color: string;
  layer4Material: string;
  layer4Color: string;
  /** Extra layers to paint with (dirt, gravel, fallen leaves, moss…). */
  layer5Material: string;
  layer5Color: string;
  layer6Material: string;
  layer6Color: string;
  layer7Material: string;
  layer7Color: string;
  layer8Material: string;
  layer8Color: string;
  tiling: number;
  /** Per layer: how big one repeat of its picture is (m); 0 = use `tiling`. Pebbles want small, grass big. */
  layer1Size: number;
  layer2Size: number;
  layer3Size: number;
  layer4Size: number;
  layer5Size: number;
  layer6Size: number;
  layer7Size: number;
  layer8Size: number;
  /** Footsteps sound when walking where this layer shows most ('' = the character's own). */
  layer1Steps: string;
  layer2Steps: string;
  layer3Steps: string;
  layer4Steps: string;
  layer5Steps: string;
  layer6Steps: string;
  layer7Steps: string;
  layer8Steps: string;
  /** Paint rock (layer 3) on steep slopes and snow (layer 4) up high automatically. */
  autoPaint: boolean;
  /** Slopes steeper than this (degrees) become rock. */
  rockSlope: number;
  /** Above this fraction of the max height becomes snow (1 = never). */
  snowLine: number;
  /** Last generator settings (for "Generate again"). */
  preset: TerrainPreset;
  seed: number;
  roughness: number;
  features: number;
  castShadows: boolean;
}

export const Terrain = defineComponent<TerrainData>({
  type: 'Terrain',
  label: 'Terrain',
  icon: 'mountain',
  category: 'Environment',
  description: 'Hills, mountains and valleys you can generate in one click, then sculpt and paint. Players can walk on it.',
  defaults: () => ({
    size: 200,
    maxHeight: 18,
    resolution: 128,
    heights: '',
    splat: '',
    layer1Material: '',
    layer1Color: '#5f7a3a',
    layer2Material: '',
    layer2Color: '#7a6448',
    layer3Material: '',
    layer3Color: '#7b7b78',
    layer4Material: '',
    layer4Color: '#f1f3f5',
    layer5Material: '',
    layer5Color: '#6b5a45',
    layer6Material: '',
    layer6Color: '#8a8478',
    layer7Material: '',
    layer7Color: '#6e5232',
    layer8Material: '',
    layer8Color: '#4f6a35',
    tiling: 6,
    layer1Size: 0,
    layer2Size: 0,
    layer3Size: 0,
    layer4Size: 0,
    layer5Size: 0,
    layer6Size: 0,
    layer7Size: 0,
    layer8Size: 0,
    layer1Steps: '',
    layer2Steps: '',
    layer3Steps: '',
    layer4Steps: '',
    layer5Steps: '',
    layer6Steps: '',
    layer7Steps: '',
    layer8Steps: '',
    autoPaint: true,
    rockSlope: 38,
    snowLine: 1.1,
    preset: 'flat',
    seed: 1,
    roughness: 0.5,
    features: 3,
    castShadows: true,
  }),
  fields: {
    size: { kind: 'number', label: 'Size (m)', min: 4, max: 4000, step: 1 },
    maxHeight: { kind: 'number', label: 'Max height (m)', min: 0, max: 1000, step: 0.5 },
    resolution: { kind: 'number', label: 'Detail', min: 16, max: 512, step: 16 },
    layer1Material: { kind: 'asset', label: 'Base layer', assetType: 'material' },
    layer1Color: { kind: 'color', label: 'Base color' },
    layer2Material: { kind: 'asset', label: 'Layer 2 (path)', assetType: 'material' },
    layer2Color: { kind: 'color', label: 'Layer 2 color' },
    layer3Material: { kind: 'asset', label: 'Layer 3 (rock)', assetType: 'material' },
    layer3Color: { kind: 'color', label: 'Layer 3 color' },
    layer4Material: { kind: 'asset', label: 'Layer 4 (snow)', assetType: 'material' },
    layer4Color: { kind: 'color', label: 'Layer 4 color' },
    layer5Material: { kind: 'asset', label: 'Layer 5', assetType: 'material' },
    layer5Color: { kind: 'color', label: 'Layer 5 color' },
    layer6Material: { kind: 'asset', label: 'Layer 6', assetType: 'material' },
    layer6Color: { kind: 'color', label: 'Layer 6 color' },
    layer7Material: { kind: 'asset', label: 'Layer 7', assetType: 'material' },
    layer7Color: { kind: 'color', label: 'Layer 7 color' },
    layer8Material: { kind: 'asset', label: 'Layer 8', assetType: 'material' },
    layer8Color: { kind: 'color', label: 'Layer 8 color' },
    tiling: { kind: 'number', label: 'Texture size (m)', min: 0.25, max: 100, step: 0.25 },
    layer1Size: { kind: 'number', label: 'Layer 1 size (m, 0 = Texture size)', min: 0, max: 100, step: 0.25 },
    layer2Size: { kind: 'number', label: 'Layer 2 size (m, 0 = Texture size)', min: 0, max: 100, step: 0.25 },
    layer3Size: { kind: 'number', label: 'Layer 3 size (m, 0 = Texture size)', min: 0, max: 100, step: 0.25 },
    layer4Size: { kind: 'number', label: 'Layer 4 size (m, 0 = Texture size)', min: 0, max: 100, step: 0.25 },
    layer5Size: { kind: 'number', label: 'Layer 5 size (m, 0 = Texture size)', min: 0, max: 100, step: 0.25 },
    layer6Size: { kind: 'number', label: 'Layer 6 size (m, 0 = Texture size)', min: 0, max: 100, step: 0.25 },
    layer7Size: { kind: 'number', label: 'Layer 7 size (m, 0 = Texture size)', min: 0, max: 100, step: 0.25 },
    layer8Size: { kind: 'number', label: 'Layer 8 size (m, 0 = Texture size)', min: 0, max: 100, step: 0.25 },
    layer1Steps: { kind: 'asset', label: 'Layer 1 footsteps', assetType: 'audio' },
    layer2Steps: { kind: 'asset', label: 'Layer 2 footsteps', assetType: 'audio' },
    layer3Steps: { kind: 'asset', label: 'Layer 3 footsteps', assetType: 'audio' },
    layer4Steps: { kind: 'asset', label: 'Layer 4 footsteps', assetType: 'audio' },
    layer5Steps: { kind: 'asset', label: 'Layer 5 footsteps', assetType: 'audio' },
    layer6Steps: { kind: 'asset', label: 'Layer 6 footsteps', assetType: 'audio' },
    layer7Steps: { kind: 'asset', label: 'Layer 7 footsteps', assetType: 'audio' },
    layer8Steps: { kind: 'asset', label: 'Layer 8 footsteps', assetType: 'audio' },
    autoPaint: { kind: 'boolean', label: 'Auto rock & snow' },
    rockSlope: { kind: 'number', label: 'Rock on slopes over (°)', min: 5, max: 85, step: 1 },
    snowLine: { kind: 'number', label: 'Snow above (0–1, 1.1 = none)', min: 0, max: 1.1, step: 0.01 },
    castShadows: { kind: 'boolean', label: 'Cast shadows' },
  },
});

export { TERRAIN_PRESETS };
