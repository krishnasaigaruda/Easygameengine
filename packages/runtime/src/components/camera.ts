import { defineComponent } from '../core/Component';

export const CAMERA_MODES = ['third-person', 'first-person', 'top-down', 'side-view', 'look-around'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export interface FollowCameraData {
  /**
   * third-person: behind the target, mouse orbits. first-person: from the target's eyes.
   * top-down: high above, looking down. side-view: from the side (platformers).
   * look-around: stays where you put it; the mouse turns it within limits (security rooms, FNAF-style).
   */
  mode: CameraMode;
  /** Object to follow by name ('' = the player). */
  target: string;
  /** Meters behind the target. */
  distance: number;
  /** Height of the point the camera looks at, above the target's origin. */
  height: number;
  /** Over-the-shoulder offset to the right (negative = left shoulder). */
  shoulder: number;
  /** Starting downward tilt in degrees. */
  pitch: number;
  minPitch: number;
  maxPitch: number;
  /** Degrees turned per pixel of mouse movement. */
  sensitivity: number;
  /** Capture the mouse when the player clicks the game (Esc releases it). */
  lockMouse: boolean;
  /** Move closer instead of going through walls. */
  avoidWalls: boolean;
  /** How quickly the camera catches up (higher = snappier). */
  smoothing: number;
  /** look-around: how far it can turn left/right from where it starts (degrees). */
  yawRange: number;
  /** look-around: turn by moving the mouse toward the screen edges (instead of capturing it). */
  edgePan: boolean;
}

export const FollowCamera = defineComponent<FollowCameraData>({
  type: 'FollowCamera',
  category: 'Camera',
  label: 'Camera Controller',
  icon: 'video',
  description: 'Makes a Camera move: third-person, first-person, top-down, side view, or look-around. Without it, a camera stays still.',
  defaults: () => ({
    mode: 'third-person',
    target: '',
    distance: 4.5,
    height: 1.5,
    shoulder: 0.6,
    pitch: 12,
    minPitch: -35,
    maxPitch: 70,
    sensitivity: 0.18,
    lockMouse: true,
    avoidWalls: true,
    smoothing: 14,
    yawRange: 60,
    edgePan: true,
  }),
  fields: {
    mode: { kind: 'enum', label: 'Mode', options: CAMERA_MODES },
    target: { kind: 'entity', label: 'Follow' },
    distance: { kind: 'number', label: 'Distance', min: 0.5, max: 30, step: 0.1 },
    height: { kind: 'number', label: 'Look height', min: -2, max: 5, step: 0.05 },
    shoulder: { kind: 'number', label: 'Shoulder offset', min: -3, max: 3, step: 0.05 },
    pitch: { kind: 'number', label: 'Start tilt (°)', min: -60, max: 80, step: 1 },
    minPitch: { kind: 'number', label: 'Lowest tilt (°)', min: -89, max: 0, step: 1 },
    maxPitch: { kind: 'number', label: 'Highest tilt (°)', min: 0, max: 89, step: 1 },
    sensitivity: { kind: 'number', label: 'Mouse speed', min: 0.01, max: 1, step: 0.01 },
    lockMouse: { kind: 'boolean', label: 'Capture mouse' },
    avoidWalls: { kind: 'boolean', label: 'Avoid walls' },
    smoothing: { kind: 'number', label: 'Smoothing', min: 1, max: 40, step: 0.5 },
    yawRange: { kind: 'number', label: 'Turn range (°)', min: 0, max: 180, step: 1 },
    edgePan: { kind: 'boolean', label: 'Turn at screen edges' },
  },
});
