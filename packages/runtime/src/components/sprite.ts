import { defineComponent, type Vec2 } from '../core/Component';

export const SPRITE_SHAPES = ['square', 'circle'] as const;

export interface SpriteData {
  /** Picture ('' = a plain shape in `color`). */
  image: string;
  /** Shape when there's no picture (also the collider's shape). */
  shape: (typeof SPRITE_SHAPES)[number];
  /** The shape's colour (when there's no picture). */
  color: string;
  /** Tint over the picture (white = the picture's own colours). */
  tint: string;
  /** Width × height in meters. */
  size: Vec2;
  /** Repeat the picture across the size instead of stretching it (ground, walls). */
  tile: boolean;
  /** Mirror left-right (a character facing the other way). */
  flipX: boolean;
  /** Crisp pixels (pixel art) instead of smooth. */
  pixelArt: boolean;
  /** Drawn in front of lower layers (background 0, ground 1, player 2…). */
  layer: number;
  /** Sprite sheet: the picture is a grid of frames, this many across and down (1 × 1 = one picture). */
  columns: number;
  rows: number;
  /** The frame shown when nothing is animating (0 = top left, counting across). */
  frame: number;
  /** Frames per second for the animations. */
  fps: number;
  /** Named runs of frames. Characters use idle / walk / run / jump / fall by themselves. */
  animations?: SpriteAnimation[];
  /** Animation to play ('' = automatic: the character's movement, or the first one). */
  animation: string;
  /** Backgrounds: how far away it is (0 = with the world, 1 = as far as the sky: it doesn't move). */
  parallax?: number;
  /** 1 = solid, 0 = invisible (water, ghosts, a platform fading away). */
  opacity?: number;
}

export interface SpriteAnimation {
  name: string;
  /** First and last frame (inclusive). */
  from: number;
  to: number;
  loop: boolean;
}

export const Sprite = defineComponent<SpriteData>({
  type: 'Sprite',
  category: 'Rendering',
  label: 'Sprite',
  icon: 'image',
  description: 'A flat picture or shape for 2D games: characters, platforms, coins, backgrounds. Not affected by lights.',
  defaults: () => ({ image: '', shape: 'square', color: '#ffffff', tint: '#ffffff', size: [1, 1], tile: false, flipX: false, pixelArt: false, layer: 1, columns: 1, rows: 1, frame: 0, fps: 10, animations: [], animation: '', parallax: 0, opacity: 1 }),
  fields: {
    image: { kind: 'asset', label: 'Picture', assetType: 'texture' },
    shape: { kind: 'enum', label: 'Shape', options: SPRITE_SHAPES },
    color: { kind: 'color', label: 'Color' },
    tint: { kind: 'color', label: 'Tint' },
    size: { kind: 'vec2', label: 'Size (m)', step: 0.05, axes: ['W', 'H'] },
    tile: { kind: 'boolean', label: 'Repeat picture' },
    flipX: { kind: 'boolean', label: 'Mirror' },
    pixelArt: { kind: 'boolean', label: 'Pixel art (crisp)' },
    opacity: { kind: 'number', label: 'Opacity (1 = solid)', min: 0, max: 1, step: 0.05 },
    layer: { kind: 'number', label: 'Layer (front = higher)', min: -10, max: 20, step: 1 },
    parallax: { kind: 'number', label: 'Distance (parallax, 0 = near, 1 = sky)', min: 0, max: 1, step: 0.01 },
  },
});
