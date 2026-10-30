import { defineComponent, type Vec3 } from '../core/Component';

export interface Keyframe {
  /** Seconds from the start. */
  time: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export const KEYFRAME_LOOPS = ['once', 'loop', 'ping-pong'] as const;
export const KEYFRAME_EASINGS = ['smooth', 'linear'] as const;

export interface KeyframesData {
  /** The poses to pass through, in time order (the editor's timeline adds them). */
  keys: Keyframe[];
  /** once: stop at the last key. loop: start over. ping-pong: go back and forth. */
  loop: (typeof KEYFRAME_LOOPS)[number];
  /** smooth: eases in and out of every key. linear: steady speed. */
  easing: (typeof KEYFRAME_EASINGS)[number];
  playOnStart: boolean;
  speed: number;
}

export const Keyframes = defineComponent<KeyframesData>({
  type: 'Keyframes',
  label: 'Keyframes',
  icon: 'activity',
  category: 'Rendering',
  description:
    'Moves, turns and scales the object through poses over time: doors, platforms, a bobbing flag. Use the timeline: pick a time, move the object, "Add key". Scripts: { keyframes: "play" }.',
  defaults: () => ({ keys: [], loop: 'loop', easing: 'smooth', playOnStart: true, speed: 1 }),
  fields: {
    loop: { kind: 'enum', label: 'Repeat', options: KEYFRAME_LOOPS },
    easing: { kind: 'enum', label: 'Motion', options: KEYFRAME_EASINGS },
    playOnStart: { kind: 'boolean', label: 'Play on start' },
    speed: { kind: 'number', label: 'Speed', min: 0, max: 10, step: 0.05 },
  },
});

/** How long the animation is: the last key's time. */
export function keyframesDuration(keys: readonly Keyframe[]): number {
  return keys.length ? Math.max(...keys.map((k) => k.time)) : 0;
}
