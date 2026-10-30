import { defineComponent, type Vec3 } from '../core/Component';

export interface TransformData {
  position: Vec3;
  /** Euler angles in degrees (XYZ order) — friendlier than radians/quaternions. */
  rotation: Vec3;
  scale: Vec3;
}

export const Transform = defineComponent<TransformData>({
  type: 'Transform',
  label: 'Transform',
  icon: 'move-3d',
  description: 'Where the object is, how it is turned, and how big it is.',
  required: true,
  defaults: () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }),
  fields: {
    position: { kind: 'vec3', label: 'Position', step: 0.1 },
    rotation: { kind: 'vec3', label: 'Rotation', step: 1 },
    scale: { kind: 'vec3', label: 'Scale', step: 0.1 },
  },
});

export const MESH_SHAPES = [
  'box',
  'sphere',
  'plane',
  'cylinder',
  'capsule',
  'cone',
  'torus',
] as const;
export type MeshShape = (typeof MESH_SHAPES)[number];

export interface MeshRendererData {
  shape: MeshShape;
  /** Material asset id; when set it replaces color/roughness/metalness. */
  material: string;
  color: string;
  roughness: number;
  metalness: number;
  /** 1 = solid, lower = see-through (water, glass). */
  opacity: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

export const MeshRenderer = defineComponent<MeshRendererData>({
  type: 'MeshRenderer',
  category: 'Rendering',
  label: 'Mesh',
  icon: 'box',
  description: 'Makes the object visible as a shape with a material.',
  defaults: () => ({
    shape: 'box',
    material: '',
    color: '#cccccc',
    roughness: 0.6,
    metalness: 0,
    opacity: 1,
    castShadow: true,
    receiveShadow: true,
  }),
  fields: {
    shape: { kind: 'enum', label: 'Shape', options: MESH_SHAPES },
    material: { kind: 'asset', label: 'Material', assetType: 'material' },
    color: { kind: 'color', label: 'Color' },
    roughness: { kind: 'number', label: 'Roughness', min: 0, max: 1, step: 0.01 },
    metalness: { kind: 'number', label: 'Metalness', min: 0, max: 1, step: 0.01 },
    opacity: { kind: 'number', label: 'Opacity', min: 0, max: 1, step: 0.01 },
    castShadow: { kind: 'boolean', label: 'Cast shadows' },
    receiveShadow: { kind: 'boolean', label: 'Receive shadows' },
  },
});

export const LIGHT_KINDS = ['directional', 'point', 'spot', 'hemisphere', 'ambient'] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];

export interface LightData {
  kind: LightKind;
  color: string;
  intensity: number;
  /** Point/spot: how far the light reaches (0 = infinite). */
  range: number;
  /** Spot: cone angle in degrees. */
  angle: number;
  /** Hemisphere: light coming from the ground. */
  groundColor: string;
  castShadow: boolean;
}

export const Light = defineComponent<LightData>({
  type: 'Light',
  category: 'Rendering',
  label: 'Light',
  icon: 'lightbulb',
  description: 'Lights up the scene. "Directional" works like the sun.',
  defaults: () => ({
    kind: 'directional',
    color: '#ffffff',
    intensity: 1,
    range: 0,
    angle: 45,
    groundColor: '#555555',
    castShadow: false,
  }),
  fields: {
    kind: { kind: 'enum', label: 'Type', options: LIGHT_KINDS },
    color: { kind: 'color', label: 'Color' },
    intensity: { kind: 'number', label: 'Intensity', min: 0, max: 20, step: 0.1 },
    range: { kind: 'number', label: 'Range', min: 0, step: 0.5 },
    angle: { kind: 'number', label: 'Spot angle', min: 1, max: 90, step: 1 },
    groundColor: { kind: 'color', label: 'Ground color' },
    castShadow: { kind: 'boolean', label: 'Cast shadows' },
  },
});

export interface CameraData {
  fov: number;
  near: number;
  far: number;
  /** The camera the game renders through when playing. */
  primary: boolean;
  /** Flat view (2D games): no perspective, things look the same size near and far. */
  orthographic?: boolean;
  /** Flat view: how many meters fit from the bottom of the screen to the top. */
  viewHeight?: number;
}

export const Camera = defineComponent<CameraData>({
  type: 'Camera',
  category: 'Camera',
  label: 'Camera',
  icon: 'video',
  description: 'What the player sees when the game runs.',
  defaults: () => ({ fov: 60, near: 0.1, far: 2000, primary: true, orthographic: false, viewHeight: 12 }),
  fields: {
    orthographic: { kind: 'boolean', label: 'Flat (2D)' },
    viewHeight: { kind: 'number', label: 'View height (m)', min: 1, max: 500, step: 0.5 },
    fov: { kind: 'number', label: 'Field of view', min: 10, max: 120, step: 1 },
    near: { kind: 'number', label: 'Near clip', min: 0.01, step: 0.01 },
    far: { kind: 'number', label: 'Far clip', min: 1, step: 10 },
    primary: { kind: 'boolean', label: 'Main camera' },
  },
});

export interface ModelRendererData {
  /** Model asset id ('' = none). */
  model: string;
  /** Animation clip to play ('' = none). */
  animation: string;
  animationSpeed: number;
  playAnimation: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Resize so the model is this many meters tall (0 = keep its own size). Handy for downloaded models. */
  fitHeight: number;
  /** Move the model so its bottom sits on this object's origin, centred (it stands on the ground). */
  standOnGround: boolean;
  /** Turn the model around its up axis (degrees) — for models that face the wrong way. */
  turn: number;
  /** One model out of a file that holds several (an asset pack); '' = all of it. */
  part?: string;
}

export const ModelRenderer = defineComponent<ModelRendererData>({
  type: 'ModelRenderer',
  category: 'Rendering',
  label: 'Model',
  icon: 'shapes',
  description: 'Shows an imported 3D model and can play its animations.',
  defaults: () => ({
    model: '',
    animation: '',
    animationSpeed: 1,
    playAnimation: true,
    castShadow: true,
    receiveShadow: true,
    fitHeight: 0,
    standOnGround: false,
    turn: 0,
    part: '',
  }),
  fields: {
    model: { kind: 'asset', label: 'Model', assetType: 'model' },
    part: { kind: 'modelPart', label: 'Part', modelField: 'model' },
    animation: { kind: 'animation', label: 'Animation', modelField: 'model' },
    animationSpeed: { kind: 'number', label: 'Speed', min: 0, max: 3, step: 0.05 },
    playAnimation: { kind: 'boolean', label: 'Play' },
    castShadow: { kind: 'boolean', label: 'Cast shadows' },
    receiveShadow: { kind: 'boolean', label: 'Receive shadows' },
    fitHeight: { kind: 'number', label: 'Fit to height (m, 0 = own size)', min: 0, max: 500, step: 0.1 },
    standOnGround: { kind: 'boolean', label: 'Stand on ground' },
    turn: { kind: 'number', label: 'Turn (°)', min: -180, max: 180, step: 1 },
  },
});

export interface AnimatorData {
  /** Clip names ('' = find one by its name: "idle", "walk", "run", "jump"). */
  idle: string;
  walk: string;
  run: string;
  jump: string;
  /** In water (a Water volume): moving, and floating still. */
  swim: string;
  swimIdle: string;
  /** On a ladder / wall (Climbable): climbing (played backwards going down), and holding on. */
  climb: string;
  climbIdle: string;
  /** Played once when scripts ask ({ animate: "'attack'" }) or traits react (hit, defeated). */
  attack: string;
  hurt: string;
  die: string;
  /** Use the animations of another model too (e.g. a Mixamo animation pack): matched to this skeleton by bone names. */
  clipsFrom: string;
  /** Speed (m/s) the walk clip was made for: faster walking plays it faster, so feet don't slide. */
  walkSpeed: number;
  /** Speed (m/s) the run clip was made for. Halfway between walk and run speed it switches to running. */
  runSpeed: number;
  /** Seconds to blend from one clip to the next. */
  blend: number;
  /** Keep the clips walking on the spot (some clips move the body forward by themselves). */
  inPlace: boolean;
  /** Turn the model toward where it is going (the object itself doesn't turn). */
  faceMovement: boolean;
  /** On slopes, lower the body so both feet touch the ground (needs foot bones). */
  feetOnGround: boolean;
}

export const Animator = defineComponent<AnimatorData>({
  type: 'Animator',
  category: 'Rendering',
  label: 'Animator',
  icon: 'footprints',
  description:
    'Plays idle, walk, run, jump, swim and climb by itself from how the object moves, and attack / hurt / defeated when asked ({ animate: "\'attack\'" }) or when hit. Needs an animated model on this object or a child.',
  defaults: () => ({ idle: '', walk: '', run: '', jump: '', swim: '', swimIdle: '', climb: '', climbIdle: '', attack: '', hurt: '', die: '', clipsFrom: '', walkSpeed: 1.5, runSpeed: 4.5, blend: 0.25, inPlace: true, faceMovement: true, feetOnGround: true }),
  fields: {
    idle: { kind: 'animation', label: 'Standing', modelField: '' },
    walk: { kind: 'animation', label: 'Walking', modelField: '' },
    run: { kind: 'animation', label: 'Running', modelField: '' },
    jump: { kind: 'animation', label: 'In the air', modelField: '' },
    swim: { kind: 'animation', label: 'Swimming', modelField: '' },
    swimIdle: { kind: 'animation', label: 'Floating (still in water)', modelField: '' },
    climb: { kind: 'animation', label: 'Climbing', modelField: '' },
    climbIdle: { kind: 'animation', label: 'Holding on (climbing, still)', modelField: '' },
    clipsFrom: { kind: 'asset', label: 'Animations from (model)', assetType: 'model' },
    attack: { kind: 'animation', label: 'Attack', modelField: '' },
    hurt: { kind: 'animation', label: 'Hurt', modelField: '' },
    die: { kind: 'animation', label: 'Defeated', modelField: '' },
    walkSpeed: { kind: 'number', label: 'Walk clip speed (m/s)', min: 0.2, max: 10, step: 0.1 },
    runSpeed: { kind: 'number', label: 'Run clip speed (m/s)', min: 0.5, max: 20, step: 0.1 },
    blend: { kind: 'number', label: 'Blend (s)', min: 0, max: 1, step: 0.05 },
    inPlace: { kind: 'boolean', label: 'Walk on the spot' },
    faceMovement: { kind: 'boolean', label: 'Face where it walks' },
    feetOnGround: { kind: 'boolean', label: 'Feet on slopes' },
  },
});
