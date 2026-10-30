import { defineComponent } from '../core/Component';

export interface Light2DData {
  color: string;
  /** How far the light reaches (m). */
  radius: number;
  intensity: number;
  /** Torches and candles: how much it flickers (0 = steady). */
  flicker: number;
}

export const Light2D = defineComponent<Light2DData>({
  type: 'Light2D',
  category: 'Rendering',
  label: 'Light (2D)',
  icon: 'lightbulb',
  description: 'Lights up sprites and tilemaps around it in a 2D game. Make the scene darker (Scene Settings: Darkness) to see it.',
  defaults: () => ({ color: '#ffd9a0', radius: 5, intensity: 1.2, flicker: 0 }),
  fields: {
    color: { kind: 'color', label: 'Color' },
    radius: { kind: 'number', label: 'Reach (m)', min: 0.1, max: 100, step: 0.1 },
    intensity: { kind: 'number', label: 'Brightness', min: 0, max: 5, step: 0.05 },
    flicker: { kind: 'number', label: 'Flicker', min: 0, max: 1, step: 0.01 },
  },
});
