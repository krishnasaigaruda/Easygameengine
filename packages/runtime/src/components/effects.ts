import { defineComponent } from '../core/Component';

export interface ParticleSystemData {
  /** Keep making new particles. */
  emit: boolean;
  /** Particles per second. */
  rate: number;
  /** Particles all at once when it starts. */
  burst: number;
  /** Seconds each particle lives. */
  lifetime: number;
  /** Starting speed (m/s). */
  speed: number;
  /** Cone angle in degrees around the object's up direction (180 = every direction). */
  spread: number;
  /** Size in meters at birth / at death. */
  size: number;
  sizeEnd: number;
  color: string;
  colorEnd: string;
  opacity: number;
  opacityEnd: number;
  /** Gravity multiplier: 1 falls like rocks, 0 floats, negative rises (smoke, flames). */
  gravity: number;
  /** Particles start anywhere inside this radius. */
  radius: number;
  maxParticles: number;
  /** Bright, glowing look (fire, sparks, magic). Off for smoke and dust. */
  glow: boolean;
  /** Run while editing so you can see it. */
  previewInEditor: boolean;
}

export const ParticleSystem = defineComponent<ParticleSystemData>({
  type: 'ParticleSystem',
  label: 'Particle System',
  icon: 'sparkles',
  category: 'Effects',
  description: 'Fire, smoke, sparkles, dust, rain, magic. Use the preset buttons below to start.',
  defaults: () => ({
    emit: true,
    rate: 40,
    burst: 0,
    lifetime: 1.2,
    speed: 1.6,
    spread: 18,
    size: 0.45,
    sizeEnd: 0.08,
    color: '#ffc46b',
    colorEnd: '#ff3d1f',
    opacity: 0.9,
    opacityEnd: 0,
    gravity: -0.15,
    radius: 0.15,
    maxParticles: 400,
    glow: true,
    previewInEditor: true,
  }),
  fields: {
    emit: { kind: 'boolean', label: 'Emitting' },
    rate: { kind: 'number', label: 'Rate (per s)', min: 0, max: 2000, step: 1 },
    burst: { kind: 'number', label: 'Burst', min: 0, max: 2000, step: 1 },
    lifetime: { kind: 'number', label: 'Lifetime (s)', min: 0.05, max: 30, step: 0.05 },
    speed: { kind: 'number', label: 'Speed', min: 0, max: 50, step: 0.1 },
    spread: { kind: 'number', label: 'Spread (°)', min: 0, max: 180, step: 1 },
    size: { kind: 'number', label: 'Start size', min: 0.005, max: 20, step: 0.01 },
    sizeEnd: { kind: 'number', label: 'End size', min: 0, max: 20, step: 0.01 },
    color: { kind: 'color', label: 'Start color' },
    colorEnd: { kind: 'color', label: 'End color' },
    opacity: { kind: 'number', label: 'Start opacity', min: 0, max: 1, step: 0.01 },
    opacityEnd: { kind: 'number', label: 'End opacity', min: 0, max: 1, step: 0.01 },
    gravity: { kind: 'number', label: 'Gravity', min: -3, max: 3, step: 0.05 },
    radius: { kind: 'number', label: 'Start radius', min: 0, max: 50, step: 0.05 },
    maxParticles: { kind: 'number', label: 'Max particles', min: 1, max: 20000, step: 10 },
    glow: { kind: 'boolean', label: 'Glow' },
    previewInEditor: { kind: 'boolean', label: 'Preview in editor' },
  },
});

/** One-click looks for the Inspector. */
export const PARTICLE_PRESETS: Record<string, Partial<ParticleSystemData>> = {
  Fire: { rate: 60, burst: 0, lifetime: 1, speed: 1.4, spread: 14, size: 0.55, sizeEnd: 0.08, color: '#ffc46b', colorEnd: '#ff2d12', opacity: 0.9, opacityEnd: 0, gravity: -0.2, radius: 0.18, glow: true },
  Smoke: { rate: 14, burst: 0, lifetime: 4, speed: 0.7, spread: 20, size: 0.6, sizeEnd: 2.2, color: '#6f7178', colorEnd: '#b9bcc4', opacity: 0.45, opacityEnd: 0, gravity: -0.06, radius: 0.25, glow: false },
  Sparkles: { rate: 25, burst: 0, lifetime: 1.4, speed: 0.8, spread: 180, size: 0.12, sizeEnd: 0, color: '#fff3c4', colorEnd: '#e0b23a', opacity: 1, opacityEnd: 0, gravity: 0, radius: 0.6, glow: true },
  Dust: { rate: 6, burst: 0, lifetime: 6, speed: 0.15, spread: 180, size: 0.05, sizeEnd: 0.05, color: '#d9cdb4', colorEnd: '#d9cdb4', opacity: 0.6, opacityEnd: 0, gravity: -0.005, radius: 4, glow: false },
  Rain: { rate: 600, burst: 0, lifetime: 1.2, speed: 9, spread: 2, size: 0.04, sizeEnd: 0.04, color: '#9fb6cc', colorEnd: '#9fb6cc', opacity: 0.55, opacityEnd: 0.4, gravity: 1, radius: 12, glow: false, maxParticles: 2000 },
  Snow: { rate: 120, burst: 0, lifetime: 8, speed: 0.4, spread: 180, size: 0.07, sizeEnd: 0.07, color: '#ffffff', colorEnd: '#ffffff', opacity: 0.95, opacityEnd: 0.6, gravity: 0.03, radius: 12, glow: false, maxParticles: 2000 },
  Magic: { rate: 50, burst: 0, lifetime: 1.6, speed: 1.2, spread: 180, size: 0.18, sizeEnd: 0, color: '#9fd1ff', colorEnd: '#b46bff', opacity: 1, opacityEnd: 0, gravity: -0.3, radius: 0.3, glow: true },
  Fireflies: { rate: 8, burst: 0, lifetime: 5, speed: 0.25, spread: 180, size: 0.08, sizeEnd: 0.08, color: '#d9ff7a', colorEnd: '#9dff4a', opacity: 1, opacityEnd: 0, gravity: -0.01, radius: 6, glow: true },
  Embers: { rate: 18, burst: 0, lifetime: 2.5, speed: 1.2, spread: 25, size: 0.06, sizeEnd: 0.02, color: '#ffb347', colorEnd: '#ff3d1f', opacity: 1, opacityEnd: 0, gravity: -0.15, radius: 0.4, glow: true },
  'Falling Leaves': { rate: 6, burst: 0, lifetime: 7, speed: 0.3, spread: 180, size: 0.16, sizeEnd: 0.16, color: '#c98a3a', colorEnd: '#8a5a22', opacity: 1, opacityEnd: 0.6, gravity: 0.05, radius: 5, glow: false },
  Steam: { rate: 20, burst: 0, lifetime: 2.2, speed: 1.1, spread: 12, size: 0.3, sizeEnd: 1.4, color: '#f2f4f7', colorEnd: '#dfe3ea', opacity: 0.35, opacityEnd: 0, gravity: -0.12, radius: 0.15, glow: false },
  'Waterfall Mist': { rate: 80, burst: 0, lifetime: 1.6, speed: 2.2, spread: 60, size: 0.5, sizeEnd: 1.6, color: '#e6f3ff', colorEnd: '#cfe6f7', opacity: 0.4, opacityEnd: 0, gravity: 0.15, radius: 1.5, glow: false, maxParticles: 1500 },
  Portal: { rate: 90, burst: 0, lifetime: 1.2, speed: 0.4, spread: 180, size: 0.16, sizeEnd: 0, color: '#c38bff', colorEnd: '#4fb6ff', opacity: 1, opacityEnd: 0, gravity: -0.05, radius: 1, glow: true },
  'Healing Aura': { rate: 30, burst: 0, lifetime: 1.6, speed: 0.6, spread: 15, size: 0.14, sizeEnd: 0, color: '#9dffb0', colorEnd: '#3cd16b', opacity: 1, opacityEnd: 0, gravity: -0.25, radius: 0.7, glow: true },
  Confetti: { rate: 0, burst: 160, lifetime: 2.5, speed: 6, spread: 50, size: 0.12, sizeEnd: 0.12, color: '#ff5ea8', colorEnd: '#4fd1ff', opacity: 1, opacityEnd: 0.8, gravity: 0.6, radius: 0.2, glow: false },
  'Muzzle Flash': { rate: 0, burst: 24, lifetime: 0.12, speed: 4, spread: 18, size: 0.25, sizeEnd: 0.02, color: '#fff2b0', colorEnd: '#ff9b2e', opacity: 1, opacityEnd: 0, gravity: 0, radius: 0.02, glow: true },
  'Dust Cloud': { rate: 0, burst: 60, lifetime: 1.6, speed: 2, spread: 80, size: 0.5, sizeEnd: 1.6, color: '#b8a582', colorEnd: '#cbbd9e', opacity: 0.6, opacityEnd: 0, gravity: 0.05, radius: 0.3, glow: false },
  Explosion: { rate: 0, burst: 300, lifetime: 0.9, speed: 7, spread: 180, size: 0.5, sizeEnd: 0.05, color: '#ffe08a', colorEnd: '#ff3d1f', opacity: 1, opacityEnd: 0, gravity: 0.4, radius: 0.2, glow: true },
};

export interface LabelData {
  /** Text above the object. {formulas} update while playing. */
  text: string;
  /** Text height in meters. */
  size: number;
  /** Meters above the object's origin. */
  height: number;
  color: string;
  background: string;
  backgroundOpacity: number;
  /** Visible through walls. */
  alwaysOnTop: boolean;
}

export const Label = defineComponent<LabelData>({
  type: 'Label',
  label: 'Label',
  icon: 'message',
  category: 'Rendering',
  description: 'Floating text above an object that always faces the camera: names, signs, hints.',
  defaults: () => ({ text: 'Hello', size: 0.3, height: 2.2, color: '#ffffff', background: '#121417', backgroundOpacity: 0.6, alwaysOnTop: false }),
  fields: {
    text: { kind: 'formula', label: 'Text', insert: 'text' },
    size: { kind: 'number', label: 'Size (m)', min: 0.02, max: 20, step: 0.01 },
    height: { kind: 'number', label: 'Height', min: -20, max: 50, step: 0.05 },
    color: { kind: 'color', label: 'Color' },
    background: { kind: 'color', label: 'Background' },
    backgroundOpacity: { kind: 'number', label: 'Background opacity', min: 0, max: 1, step: 0.01 },
    alwaysOnTop: { kind: 'boolean', label: 'Show through walls' },
  },
});
