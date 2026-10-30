/**
 * Assets are files the game uses (models, textures, skies, sounds, materials). The runtime never
 * cares where they live: an AssetResolver turns an asset id into URLs. The editor resolves from
 * IndexedDB blobs; exported games resolve to files next to index.html.
 */

export const ASSET_TYPES = ['model', 'texture', 'hdri', 'audio', 'material', 'script', 'data'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export interface ResolvedAsset {
  id: string;
  type: AssetType;
  name: string;
  /** Path of the main file inside the asset, e.g. "scene.gltf" (empty for data-only assets). */
  main: string;
  /** Every file path inside the asset (main + supporting files). */
  files: string[];
  /** URL for a file inside the asset (the main file or e.g. "textures/wood.jpg"). */
  url(path: string): string | undefined;
  /** JSON payload for data-only assets (materials). */
  data?: unknown;
}

export interface AssetResolver {
  resolve(id: string): Promise<ResolvedAsset | undefined>;
}

export const MATERIAL_SHADERS = ['standard', 'water', 'lava', 'glass', 'ice', 'toon', 'unlit', 'hologram', 'forcefield'] as const;
export type MaterialShader = (typeof MATERIAL_SHADERS)[number];

/** A material: PBR from texture assets, or one of the built-in shaders (water, lava, toon…). */
export interface MaterialAssetData {
  /** How it's drawn. "standard" is realistic PBR; the others are special shaders. */
  shader: MaterialShader;
  color: string;
  /** Second color: deep water, lava crust, toon shadow tint. */
  color2: string;
  /** Glow color and strength (neon signs, lava, holograms). */
  emissive: string;
  emissiveStrength: number;
  /** 1 = solid, 0 = invisible. */
  opacity: number;
  /** Faceted low-poly look. */
  flatShading: boolean;
  /** Draw both sides of thin surfaces (leaves, flags, planes seen from below). */
  doubleSided: boolean;
  /** Shader animation speed. */
  speed: number;
  /** Shader pattern size in meters (waves, lava cells). */
  patternScale: number;
  /** Shader effect strength (wave height, bumps, flicker). */
  strength: number;
  /** Toon: number of light bands. */
  toonSteps: number;
  roughness: number;
  metalness: number;
  /** Texture asset ids ('' = none). */
  map: string;
  normalMap: string;
  roughnessMap: string;
  metalnessMap: string;
  aoMap: string;
  /** Height (displacement) picture: where the surface is high. Terrains use it to blend layers. */
  heightMap: string;
  /** How many times textures repeat across a surface. */
  tiling: [number, number];
  normalScale: number;
}

export function defaultMaterialData(): MaterialAssetData {
  return {
    shader: 'standard',
    color2: '#0b3b4f',
    emissive: '#000000',
    emissiveStrength: 1,
    opacity: 1,
    flatShading: false,
    doubleSided: false,
    speed: 1,
    patternScale: 4,
    strength: 1,
    toonSteps: 3,
    color: '#ffffff',
    roughness: 1,
    metalness: 0,
    map: '',
    normalMap: '',
    roughnessMap: '',
    metalnessMap: '',
    aoMap: '',
    heightMap: '',
    tiling: [1, 1],
    normalScale: 1,
  };
}

/** Where an asset came from — kept so exported games can credit authors. */
export interface AssetCredit {
  provider: 'objaverse' | 'polyhaven' | 'ambientcg' | 'smithsonian' | 'openverse' | 'commons' | 'web' | 'user';
  sourceId?: string;
  author?: string;
  license?: string;
  url?: string;
}

const EXTENSIONS: Record<string, AssetType> = {
  glb: 'model',
  gltf: 'model',
  fbx: 'model',
  obj: 'model',
  png: 'texture',
  jpg: 'texture',
  jpeg: 'texture',
  webp: 'texture',
  avif: 'texture',
  ktx2: 'texture',
  hdr: 'hdri',
  exr: 'hdri',
  mp3: 'audio',
  ogg: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  easy: 'script',
  json5: 'script',
};

export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Asset type implied by a file name, or undefined for supporting files (.bin, .mtl…). */
export function assetTypeForFile(path: string): AssetType | undefined {
  return EXTENSIONS[extensionOf(path)];
}
