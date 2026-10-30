import { defineComponent, type Vec3 } from '../core/Component';

export const BODY_TYPES = ['dynamic', 'static', 'kinematic'] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export interface RigidBodyData {
  type: BodyType;
  /** kg — only used by dynamic bodies. */
  mass: number;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  /** Keep the object upright (no tipping over). */
  lockRotation: boolean;
  /** Extra-precise collisions for fast objects (bullets, balls). */
  continuousCollision: boolean;
}

export const RigidBody = defineComponent<RigidBodyData>({
  type: 'RigidBody',
  category: 'Physics',
  label: 'Rigid Body',
  icon: 'atom',
  description: 'Lets physics move the object: it falls, bounces and can be pushed. Needs a Collider.',
  defaults: () => ({
    type: 'dynamic',
    mass: 1,
    linearDamping: 0,
    angularDamping: 0.05,
    gravityScale: 1,
    lockRotation: false,
    continuousCollision: false,
  }),
  fields: {
    type: { kind: 'enum', label: 'Type', options: BODY_TYPES },
    mass: { kind: 'number', label: 'Mass (kg)', min: 0.01, step: 0.1 },
    gravityScale: { kind: 'number', label: 'Gravity', min: -5, max: 5, step: 0.1 },
    linearDamping: { kind: 'number', label: 'Air drag', min: 0, max: 10, step: 0.05 },
    angularDamping: { kind: 'number', label: 'Spin drag', min: 0, max: 10, step: 0.05 },
    lockRotation: { kind: 'boolean', label: 'Stay upright' },
    continuousCollision: { kind: 'boolean', label: 'Fast object' },
  },
});

export const COLLIDER_SHAPES = ['auto', 'box', 'sphere', 'capsule', 'cylinder', 'mesh', 'convex'] as const;
export type ColliderShape = (typeof COLLIDER_SHAPES)[number];

export interface ColliderData {
  /** "auto" matches the object's visible shape (exact mesh for imported static models). */
  shape: ColliderShape;
  /** Box size in the object's local units (before the object's scale). */
  size: Vec3;
  /** Sphere/capsule/cylinder radius (local units). */
  radius: number;
  /** Capsule/cylinder total height (local units). */
  height: number;
  /** Shift from the object's origin (local units). */
  offset: Vec3;
  /** A trigger detects things passing through instead of blocking them. */
  isTrigger: boolean;
  friction: number;
  bounciness: number;
}

export const Collider = defineComponent<ColliderData>({
  type: 'Collider',
  category: 'Physics',
  label: 'Collider',
  icon: 'brick-wall',
  description: 'Makes the object solid. Without a Rigid Body it never moves (great for ground, walls, rocks).',
  defaults: () => ({
    shape: 'auto',
    size: [1, 1, 1],
    radius: 0.5,
    height: 2,
    offset: [0, 0, 0],
    isTrigger: false,
    friction: 0.6,
    bounciness: 0,
  }),
  fields: {
    shape: { kind: 'enum', label: 'Shape', options: COLLIDER_SHAPES },
    size: { kind: 'vec3', label: 'Box size', step: 0.05 },
    radius: { kind: 'number', label: 'Radius', min: 0.01, step: 0.05 },
    height: { kind: 'number', label: 'Height', min: 0.01, step: 0.05 },
    offset: { kind: 'vec3', label: 'Offset', step: 0.05 },
    isTrigger: { kind: 'boolean', label: 'Is trigger' },
    friction: { kind: 'number', label: 'Friction', min: 0, max: 2, step: 0.05 },
    bounciness: { kind: 'number', label: 'Bounciness', min: 0, max: 1, step: 0.05 },
  },
});

export interface CharacterControllerData {
  /** Read WASD / arrows / gamepad and move this character. */
  playerControlled: boolean;
  speed: number;
  runSpeed: number;
  /** Meters. */
  jumpHeight: number;
  gravity: number;
  /** Tallest step walked up without jumping (m). */
  stepHeight: number;
  /** Steepest walkable slope in degrees. */
  maxSlope: number;
  /** How fast the character turns to face where it walks. 0 = never turn. */
  turnSpeed: number;
  /** Capsule size (local units) and center relative to the object's origin. */
  radius: number;
  height: number;
  center: Vec3;
  /** Side-view games: never move along this axis (stays where it started). */
  lockAxis: 'none' | 'x' | 'z';
  /** 2D seen from above (Zelda-style): walk up / down / left / right, no falling or jumping. */
  topDown?: boolean;
  /** Sound played (looping) while walking on the ground, faster when running. */
  footsteps: string;
  footstepVolume: number;
}

export const CharacterController = defineComponent<CharacterControllerData>({
  type: 'CharacterController',
  category: 'Physics',
  label: 'Character Controller',
  icon: 'person',
  description: 'Walks, runs and jumps with WASD / arrows / gamepad. Climbs steps and slopes. Press Play to try.',
  defaults: () => ({
    playerControlled: true,
    speed: 4,
    runSpeed: 8,
    jumpHeight: 1.2,
    gravity: 1,
    stepHeight: 0.35,
    maxSlope: 45,
    turnSpeed: 10,
    radius: 0.35,
    height: 1.8,
    center: [0, 0.9, 0],
    lockAxis: 'none',
    topDown: false,
    footsteps: '',
    footstepVolume: 0.5,
  }),
  fields: {
    playerControlled: { kind: 'boolean', label: 'Player controlled' },
    speed: { kind: 'number', label: 'Walk speed', min: 0, max: 30, step: 0.1 },
    runSpeed: { kind: 'number', label: 'Run speed', min: 0, max: 30, step: 0.1 },
    jumpHeight: { kind: 'number', label: 'Jump height', min: 0, max: 10, step: 0.05 },
    gravity: { kind: 'number', label: 'Gravity', min: 0, max: 5, step: 0.05 },
    stepHeight: { kind: 'number', label: 'Step height', min: 0, max: 2, step: 0.05 },
    maxSlope: { kind: 'number', label: 'Max slope (°)', min: 0, max: 89, step: 1 },
    turnSpeed: { kind: 'number', label: 'Turn speed', min: 0, max: 30, step: 0.5 },
    radius: { kind: 'number', label: 'Radius', min: 0.05, step: 0.05 },
    height: { kind: 'number', label: 'Height', min: 0.1, step: 0.05 },
    center: { kind: 'vec3', label: 'Center', step: 0.05 },
    lockAxis: { kind: 'enum', label: 'Lock movement (2D)', options: ['none', 'x', 'z'] },
    topDown: { kind: 'boolean', label: 'Top-down (2D: walk in 4 directions)' },
    footsteps: { kind: 'asset', label: 'Footsteps sound', assetType: 'audio' },
    footstepVolume: { kind: 'number', label: 'Footsteps volume', min: 0, max: 1, step: 0.01 },
  },
});

export interface ClimbableData {
  /** Climbing speed in m/s. */
  speed: number;
}

export const Climbable = defineComponent<ClimbableData>({
  type: 'Climbable',
  category: 'Physics',
  label: 'Climbable',
  icon: 'trending-up',
  description: 'Characters climb it when they walk into it (ladders, vines, walls). Needs a Collider.',
  defaults: () => ({ speed: 2 }),
  fields: {
    speed: { kind: 'number', label: 'Climb speed', min: 0.1, max: 10, step: 0.1 },
  },
});

export interface WaterData {
  /** Swimming speed in m/s. */
  swimSpeed: number;
  /** How strongly water pushes swimmers up to the surface (0 = sink, 1 = float). */
  buoyancy: number;
  /** Slows things moving through the water. */
  drag: number;
}

export const Water = defineComponent<WaterData>({
  type: 'Water',
  category: 'Physics',
  label: 'Water',
  icon: 'waves',
  description: 'A volume characters swim in. Its top is the water surface. Needs a trigger Collider.',
  defaults: () => ({ swimSpeed: 2.2, buoyancy: 1, drag: 2 }),
  fields: {
    swimSpeed: { kind: 'number', label: 'Swim speed', min: 0.1, max: 10, step: 0.1 },
    buoyancy: { kind: 'number', label: 'Buoyancy', min: 0, max: 2, step: 0.05 },
    drag: { kind: 'number', label: 'Drag', min: 0, max: 10, step: 0.1 },
  },
});
