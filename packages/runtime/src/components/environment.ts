import { defineComponent } from '../core/Component';

/*
 * Environment components are all optional: a scene has none of them until you add them.
 * Only the first active one of each kind counts.
 */

export const SKY_TIMES = ['dawn', 'day', 'sunset', 'night'] as const;
export type SkyTime = (typeof SKY_TIMES)[number];

export interface SkyData {
  /** Time of day, 0–24 (14 = 2 pm). Stays fixed unless a Day/Night Cycle moves it. */
  hour: number;
  /** Compass direction the sun comes from at noon, in degrees. */
  sunDirection: number;
  /** Highest the sun gets at noon, in degrees above the horizon. */
  sunHeight: number;
  /** Optional skybox image (HDRI) for each time of day; '' = built-in colors. Blended in between. */
  dawnSkybox: string;
  daySkybox: string;
  sunsetSkybox: string;
  nightSkybox: string;
  skyboxBrightness: number;
  /** Built-in sky colors: top of the sky and the horizon, per time of day. */
  customColors: boolean;
  dawnTop: string;
  dawnHorizon: string;
  dayTop: string;
  dayHorizon: string;
  sunsetTop: string;
  sunsetHorizon: string;
  nightTop: string;
  nightHorizon: string;
  /** Below the horizon. */
  groundColor: string;
  sunSize: number;
  stars: boolean;
  moon: boolean;
  /** Cloud cover, 0 = clear sky, 1 = overcast. */
  clouds: number;
  cloudSpeed: number;
  /** Aim and color the scene's sun light (the first directional Light) to match the sky. */
  driveSunLight: boolean;
  /** Use the sky's colors to light the scene softly from all around. */
  skyLighting: boolean;
  skyLightIntensity: number;
}

export const SKY_DEFAULT_COLORS = {
  dawnTop: '#3c5a8f',
  dawnHorizon: '#f2b38a',
  dayTop: '#2f6fc6',
  dayHorizon: '#b8d3ec',
  sunsetTop: '#3b4a7e',
  sunsetHorizon: '#f2894b',
  nightTop: '#04070f',
  nightHorizon: '#111a2c',
};

export const Sky = defineComponent<SkyData>({
  type: 'Sky',
  label: 'Sky',
  icon: 'sun',
  category: 'Environment',
  description: 'A sky with a time of day. Give dawn, day, sunset and night their own skybox if you like; it blends between them.',
  defaults: () => ({
    hour: 14,
    sunDirection: 200,
    sunHeight: 62,
    dawnSkybox: '',
    daySkybox: '',
    sunsetSkybox: '',
    nightSkybox: '',
    skyboxBrightness: 1,
    customColors: false,
    ...SKY_DEFAULT_COLORS,
    groundColor: '#3a3a36',
    sunSize: 1,
    stars: true,
    moon: true,
    clouds: 0.35,
    cloudSpeed: 1,
    driveSunLight: true,
    skyLighting: true,
    skyLightIntensity: 0.9,
  }),
  fields: {
    hour: { kind: 'number', label: 'Time of day (h)', min: 0, max: 24, step: 0.05 },
    sunDirection: { kind: 'number', label: 'Sun direction (°)', min: 0, max: 360, step: 1 },
    sunHeight: { kind: 'number', label: 'Noon sun height (°)', min: 5, max: 90, step: 1 },
    clouds: { kind: 'number', label: 'Clouds', min: 0, max: 1, step: 0.01 },
    cloudSpeed: { kind: 'number', label: 'Cloud speed', min: 0, max: 10, step: 0.1 },
    stars: { kind: 'boolean', label: 'Stars at night' },
    moon: { kind: 'boolean', label: 'Moon at night' },
    sunSize: { kind: 'number', label: 'Sun size', min: 0.2, max: 5, step: 0.05 },
    dawnSkybox: { kind: 'asset', label: 'Dawn skybox', assetType: 'hdri' },
    daySkybox: { kind: 'asset', label: 'Day skybox', assetType: 'hdri' },
    sunsetSkybox: { kind: 'asset', label: 'Sunset skybox', assetType: 'hdri' },
    nightSkybox: { kind: 'asset', label: 'Night skybox', assetType: 'hdri' },
    skyboxBrightness: { kind: 'number', label: 'Skybox brightness', min: 0, max: 5, step: 0.05 },
    customColors: { kind: 'boolean', label: 'Custom sky colors' },
    dawnTop: { kind: 'color', label: 'Dawn top' },
    dawnHorizon: { kind: 'color', label: 'Dawn horizon' },
    dayTop: { kind: 'color', label: 'Day top' },
    dayHorizon: { kind: 'color', label: 'Day horizon' },
    sunsetTop: { kind: 'color', label: 'Sunset top' },
    sunsetHorizon: { kind: 'color', label: 'Sunset horizon' },
    nightTop: { kind: 'color', label: 'Night top' },
    nightHorizon: { kind: 'color', label: 'Night horizon' },
    groundColor: { kind: 'color', label: 'Below horizon' },
    driveSunLight: { kind: 'boolean', label: 'Control sun light' },
    skyLighting: { kind: 'boolean', label: 'Sky lighting' },
    skyLightIntensity: { kind: 'number', label: 'Sky light strength', min: 0, max: 3, step: 0.05 },
  },
});

/**
 * Which two times of day are showing at `hour`, and how far between them (0–1).
 * Night until 4:30, dawn around 6, day 8–16, sunset around 18, night from 19:30.
 */
export function skyTimesAt(hour: number): { a: SkyTime; b: SkyTime; blend: number } {
  const h = ((hour % 24) + 24) % 24;
  const keys: [number, SkyTime][] = [
    [0, 'night'],
    [4.5, 'night'],
    [6, 'dawn'],
    [8, 'day'],
    [16, 'day'],
    [18, 'sunset'],
    [19.5, 'night'],
    [24, 'night'],
  ];
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, a] = keys[i];
    const [h1, b] = keys[i + 1];
    if (h >= h0 && h <= h1) {
      const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
      return { a, b, blend: t * t * (3 - 2 * t) };
    }
  }
  return { a: 'night', b: 'night', blend: 0 };
}

export interface DayNightCycleData {
  /** Real minutes for one full day. */
  minutesPerDay: number;
  /** Also move the time while editing (handy to preview). */
  previewInEditor: boolean;
}

export const DayNightCycle = defineComponent<DayNightCycleData>({
  type: 'DayNightCycle',
  label: 'Day/Night Cycle',
  icon: 'sunrise',
  category: 'Environment',
  description: 'Moves the Sky\'s time of day forward while the game runs. Needs a Sky in the scene.',
  defaults: () => ({ minutesPerDay: 6, previewInEditor: false }),
  fields: {
    minutesPerDay: { kind: 'number', label: 'Minutes per day', min: 0.1, max: 1440, step: 0.1 },
    previewInEditor: { kind: 'boolean', label: 'Run while editing' },
  },
});

export const FOG_MODES = ['distance', 'exponential'] as const;

export interface FogData {
  /** distance: clear up to "start", fully foggy at "end". exponential: thickens smoothly with distance. */
  mode: (typeof FOG_MODES)[number];
  color: string;
  /** Use the sky's horizon color (when there is a Sky). */
  matchSky: boolean;
  start: number;
  end: number;
  /** Exponential mode thickness. */
  density: number;
  /** Height fog: thickest at this height (usually the ground)… */
  groundLevel: number;
  /** …and this many meters higher up it's half as thick, so from above the land stays clear (0 = same everywhere). */
  thinsOut: number;
}

export const Fog = defineComponent<FogData>({
  type: 'Fog',
  label: 'Fog',
  icon: 'cloud-fog',
  category: 'Environment',
  description: 'Mist or haze that fades distant things into the sky.',
  defaults: () => ({ mode: 'distance', color: '#b7cde0', matchSky: true, start: 60, end: 500, density: 0.004, groundLevel: 0, thinsOut: 40 }),
  fields: {
    mode: { kind: 'enum', label: 'Mode', options: FOG_MODES },
    color: { kind: 'color', label: 'Color' },
    matchSky: { kind: 'boolean', label: 'Match sky color' },
    start: { kind: 'number', label: 'Starts at (m)', min: 0, max: 5000, step: 1 },
    end: { kind: 'number', label: 'Full at (m)', min: 1, max: 10000, step: 1 },
    density: { kind: 'number', label: 'Density', min: 0, max: 0.2, step: 0.001 },
    groundLevel: { kind: 'number', label: 'Thickest at height (m)', min: -1000, max: 5000, step: 1 },
    thinsOut: { kind: 'number', label: 'Thins out over (m, 0 = never)', min: 0, max: 2000, step: 1 },
  },
});

export const TONE_MAPPINGS = ['ACES', 'AgX', 'Neutral', 'None'] as const;
export const ANTI_ALIASING = ['SMAA', 'FXAA', 'None'] as const;

export interface PostProcessingData {
  bloom: boolean;
  bloomStrength: number;
  bloomRadius: number;
  /** Only things brighter than this glow (0–1+). */
  bloomThreshold: number;
  toneMapping: (typeof TONE_MAPPINGS)[number];
  contrast: number;
  saturation: number;
  /** Negative = cooler / blue, positive = warmer / orange. */
  warmth: number;
  /** Darken the screen edges (0 = off). */
  vignette: number;
  antiAliasing: (typeof ANTI_ALIASING)[number];
  /** Cartoon outlines around shapes (0 = off, 1 = full). */
  outline: number;
  outlineColor: string;
  /** Outline thickness in screen pixels. */
  outlineWidth: number;
  /** Retro: big chunky pixels (1 = off). */
  pixelSize: number;
  /** Retro: fewer colours, shades per channel (0 = off). */
  colorLevels: number;
  /** Film grain (0 = off). */
  grain: number;
}

export const PostProcessing = defineComponent<PostProcessingData>({
  type: 'PostProcessing',
  label: 'Post Processing',
  icon: 'wand',
  category: 'Environment',
  description: 'Film-like finishing for the whole picture: glow, color grading, vignette, smoother edges.',
  defaults: () => ({
    bloom: true,
    bloomStrength: 0.3,
    bloomRadius: 0.5,
    bloomThreshold: 0.92,
    toneMapping: 'ACES',
    contrast: 1.05,
    saturation: 1.05,
    warmth: 0,
    vignette: 0.2,
    antiAliasing: 'SMAA',
    outline: 0,
    outlineColor: '#141414',
    outlineWidth: 1.5,
    pixelSize: 1,
    colorLevels: 0,
    grain: 0,
  }),
  fields: {
    bloom: { kind: 'boolean', label: 'Bloom (glow)' },
    bloomStrength: { kind: 'number', label: 'Bloom strength', min: 0, max: 3, step: 0.01 },
    bloomRadius: { kind: 'number', label: 'Bloom size', min: 0, max: 1, step: 0.01 },
    bloomThreshold: { kind: 'number', label: 'Bloom threshold', min: 0, max: 2, step: 0.01 },
    toneMapping: { kind: 'enum', label: 'Tone mapping', options: TONE_MAPPINGS },
    contrast: { kind: 'number', label: 'Contrast', min: 0.5, max: 1.5, step: 0.01 },
    saturation: { kind: 'number', label: 'Saturation', min: 0, max: 2, step: 0.01 },
    warmth: { kind: 'number', label: 'Warmth', min: -1, max: 1, step: 0.01 },
    vignette: { kind: 'number', label: 'Vignette', min: 0, max: 1, step: 0.01 },
    antiAliasing: { kind: 'enum', label: 'Smooth edges', options: ANTI_ALIASING },
    outline: { kind: 'number', label: 'Outlines (cartoon)', min: 0, max: 1, step: 0.01 },
    outlineColor: { kind: 'color', label: 'Outline color' },
    outlineWidth: { kind: 'number', label: 'Outline width (px)', min: 0.5, max: 4, step: 0.1 },
    pixelSize: { kind: 'number', label: 'Pixel size (retro)', min: 1, max: 16, step: 1 },
    colorLevels: { kind: 'number', label: 'Color levels (retro, 0 = all)', min: 0, max: 32, step: 1 },
    grain: { kind: 'number', label: 'Film grain', min: 0, max: 1, step: 0.01 },
  },
});

/** One-click looks for Post Processing (the Inspector shows them as buttons). */
export const LOOK_PRESETS: Record<string, Partial<PostProcessingData>> = {
  Realistic: { bloom: true, bloomStrength: 0.3, bloomRadius: 0.5, bloomThreshold: 0.92, toneMapping: 'ACES', contrast: 1.05, saturation: 1.05, warmth: 0.05, vignette: 0.2, antiAliasing: 'SMAA', outline: 0, pixelSize: 1, colorLevels: 0, grain: 0 },
  Cartoon: { bloom: false, toneMapping: 'Neutral', contrast: 1.1, saturation: 1.35, warmth: 0.05, vignette: 0, antiAliasing: 'SMAA', outline: 1, outlineColor: '#141414', outlineWidth: 1.5, pixelSize: 1, colorLevels: 0, grain: 0 },
  Retro: { bloom: false, toneMapping: 'Neutral', contrast: 1.1, saturation: 1.15, warmth: 0, vignette: 0.15, antiAliasing: 'None', outline: 0, pixelSize: 4, colorLevels: 6, grain: 0 },
  Horror: { bloom: true, bloomStrength: 0.25, bloomRadius: 0.6, bloomThreshold: 0.85, toneMapping: 'ACES', contrast: 1.2, saturation: 0.45, warmth: -0.35, vignette: 0.75, antiAliasing: 'SMAA', outline: 0, pixelSize: 1, colorLevels: 0, grain: 0.45 },
  Noir: { bloom: false, toneMapping: 'ACES', contrast: 1.35, saturation: 0, warmth: 0, vignette: 0.6, antiAliasing: 'SMAA', outline: 0, pixelSize: 1, colorLevels: 0, grain: 0.35 },
};

/** Sun direction (unit vector toward the sun) and elevation in degrees for a Sky's time of day. */
export function sunFromHour(sky: Pick<SkyData, 'hour' | 'sunDirection' | 'sunHeight'>): { dir: [number, number, number]; elevation: number } {
  const h = ((sky.hour % 24) + 24) % 24;
  // Day arc: rises at 6, highest at 12, sets at 18; below the horizon at night.
  const elevation = Math.sin(((h - 6) / 12) * Math.PI) * sky.sunHeight;
  const azimuth = sky.sunDirection + (h - 12) * 15;
  const el = (elevation * Math.PI) / 180;
  const az = (azimuth * Math.PI) / 180;
  return { dir: [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)], elevation };
}
