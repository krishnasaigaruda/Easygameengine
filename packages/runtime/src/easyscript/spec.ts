/**
 * The single description of EasyScript: every event, action and function, with beginner-friendly
 * text. The validator, interpreter, editor autocomplete, the visual rule builder and the docs all
 * read from here, so they can never disagree.
 */

export type ParamKind =
  /** A value or formula: 10, "self.health - 5", [0, 1, 0]. */
  | 'expr'
  /** Something you can change: "self.health", "game.score". */
  | 'path'
  /** Which object: "self", "other", "player", or an object's name like "Door". */
  | 'target'
  /** Words to show, with {formulas} inside: "Score: {game.score}". */
  | 'text'
  /** A list of actions to run. */
  | 'actions'
  /** A name you make up (function / message name). */
  | 'name'
  /** Values to pass to a function: { amount: 10 }. */
  | 'args';

export interface ParamSpec {
  name: string;
  kind: ParamKind;
  label: string;
  required?: boolean;
  default?: unknown;
  help?: string;
}

export interface ActionSpec {
  key: string;
  label: string;
  /** Icon name (see the editor's icon registry). */
  icon: string;
  category: 'Variables' | 'Logic' | 'Objects' | 'Movement' | 'Physics' | 'Look' | 'Messages' | 'Sound & UI' | 'Game';
  description: string;
  /** The first param is the action's own key ({ add: "game.score" }). */
  params: ParamSpec[];
  example: Record<string, unknown>;
  /** Not implemented yet: accepted, but does nothing and warns once. */
  comingIn?: string;
}

const p = (name: string, kind: ParamKind, label: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({
  name,
  kind,
  label,
  ...extra,
});

export const ACTIONS: ActionSpec[] = [
  // Variables
  {
    key: 'set',
    label: 'Set',
    icon: 'pencil',
    category: 'Variables',
    description: 'Change a value to something new.',
    params: [p('set', 'path', 'What', { required: true }), p('to', 'expr', 'New value', { required: true, default: 0 })],
    example: { set: 'self.health', to: 100 },
  },
  {
    key: 'add',
    label: 'Add',
    icon: 'plus',
    category: 'Variables',
    description: 'Add to a number (or move a position by a vector).',
    params: [p('add', 'path', 'To', { required: true }), p('value', 'expr', 'Amount', { default: 1 })],
    example: { add: 'game.score', value: 1 },
  },
  {
    key: 'subtract',
    label: 'Subtract',
    icon: 'minus',
    category: 'Variables',
    description: 'Take away from a number.',
    params: [p('subtract', 'path', 'From', { required: true }), p('value', 'expr', 'Amount', { default: 1 })],
    example: { subtract: 'self.health', value: 10 },
  },
  {
    key: 'multiply',
    label: 'Multiply',
    icon: 'x',
    category: 'Variables',
    description: 'Multiply a number.',
    params: [p('multiply', 'path', 'What', { required: true }), p('by', 'expr', 'By', { default: 2 })],
    example: { multiply: 'self.speed', by: 2 },
  },
  {
    key: 'toggle',
    label: 'Toggle',
    icon: 'refresh',
    category: 'Variables',
    description: 'Flip true ↔ false.',
    params: [p('toggle', 'path', 'What', { required: true })],
    example: { toggle: 'self.open' },
  },
  // Logic
  {
    key: 'if',
    label: 'If',
    icon: 'help',
    category: 'Logic',
    description: 'Only continue if something is true. With "then"/"else", choose what to do.',
    params: [
      p('if', 'expr', 'Condition', { required: true, default: "other.is('player')" }),
      p('then', 'actions', 'Then'),
      p('else', 'actions', 'Otherwise'),
    ],
    example: { if: "other.is('player')" },
  },
  {
    key: 'repeat',
    label: 'Repeat',
    icon: 'repeat',
    category: 'Logic',
    description: 'Do something several times. "index" counts 0, 1, 2…',
    params: [p('repeat', 'expr', 'Times', { required: true, default: 3 }), p('do', 'actions', 'Do', { required: true })],
    example: { repeat: 3, do: [{ log: 'Hello {index}' }] },
  },
  {
    key: 'wait',
    label: 'Wait',
    icon: 'hourglass',
    category: 'Logic',
    description: 'Pause for some seconds before the next action.',
    params: [p('wait', 'expr', 'Seconds', { required: true, default: 1 })],
    example: { wait: 2 },
  },
  {
    key: 'call',
    label: 'Call function',
    icon: 'phone',
    category: 'Logic',
    description: 'Run a function — your own, or one on another object (like takeDamage).',
    params: [
      p('call', 'name', 'Function', { required: true }),
      p('on', 'target', 'On object', { default: 'self' }),
      p('args', 'args', 'Values'),
    ],
    example: { call: 'takeDamage', on: 'other', args: { amount: 10 } },
  },
  {
    key: 'stop',
    label: 'Stop',
    icon: 'ban',
    category: 'Logic',
    description: 'Stop running the rest of these actions.',
    params: [p('stop', 'expr', 'Stop', { default: true })],
    example: { stop: true },
  },
  // Objects
  {
    key: 'destroy',
    label: 'Destroy',
    icon: 'bomb',
    category: 'Objects',
    description: 'Remove an object from the game.',
    params: [p('destroy', 'target', 'Object', { required: true, default: 'self' })],
    example: { destroy: 'self' },
  },
  {
    key: 'spawn',
    label: 'Spawn',
    icon: 'egg',
    category: 'Objects',
    description: 'Make a copy of an object (it can be hidden, as a template).',
    params: [
      p('spawn', 'target', 'Copy of', { required: true }),
      p('at', 'expr', 'At', { default: 'self.position', help: 'A position, or an object' }),
      p('offset', 'expr', 'Offset'),
    ],
    example: { spawn: 'Sparkle', at: 'self.position' },
  },
  {
    key: 'show',
    label: 'Show',
    icon: 'eye',
    category: 'Objects',
    description: 'Make a hidden object visible and active.',
    params: [p('show', 'target', 'Object', { required: true, default: 'self' })],
    example: { show: 'Secret Door' },
  },
  {
    key: 'hide',
    label: 'Hide',
    icon: 'eye-off',
    category: 'Objects',
    description: 'Hide and deactivate an object.',
    params: [p('hide', 'target', 'Object', { required: true, default: 'self' })],
    example: { hide: 'self' },
  },
  // Movement
  {
    key: 'move',
    label: 'Move by',
    icon: 'move-right',
    category: 'Movement',
    description: 'Move by an amount [x, y, z], instantly or over some seconds.',
    params: [
      p('move', 'expr', 'By', { required: true, default: [0, 1, 0] }),
      p('time', 'expr', 'Over seconds', { default: 0 }),
      p('on', 'target', 'Object', { default: 'self' }),
    ],
    example: { move: [0, 2, 0], time: 1 },
  },
  {
    key: 'moveTo',
    label: 'Move to',
    icon: 'target',
    category: 'Movement',
    description: 'Go to a position or to another object, instantly or over some seconds.',
    params: [
      p('moveTo', 'expr', 'To', { required: true, default: [0, 0, 0] }),
      p('time', 'expr', 'Over seconds', { default: 0 }),
      p('on', 'target', 'Object', { default: 'self' }),
    ],
    example: { moveTo: 'game.checkpoint', time: 0 },
  },
  {
    key: 'rotate',
    label: 'Rotate',
    icon: 'rotate',
    category: 'Movement',
    description: 'Turn by some degrees [x, y, z], instantly or over some seconds.',
    params: [
      p('rotate', 'expr', 'Degrees', { required: true, default: [0, 90, 0] }),
      p('time', 'expr', 'Over seconds', { default: 0 }),
      p('on', 'target', 'Object', { default: 'self' }),
    ],
    example: { rotate: [0, 90, 0], time: 0.5 },
  },
  {
    key: 'playMusic',
    label: 'Play music',
    icon: 'music',
    category: 'Sound & UI',
    description: 'Switch the background music to an object\'s Music (cross-fades).',
    params: [p('playMusic', 'target', 'Object with Music', { required: true, default: 'self' })],
    example: { playMusic: 'Battle Music' },
  },
  {
    key: 'stopMusic',
    label: 'Stop music',
    icon: 'volume',
    category: 'Sound & UI',
    description: 'Fade the music out over a few seconds.',
    params: [p('stopMusic', 'expr', 'Fade (s)', { required: true, default: 1.5 })],
    example: { stopMusic: 2 },
  },
  {
    key: 'fire',
    label: 'Fire weapon',
    icon: 'crosshair',
    category: 'Physics',
    description: 'Attack with an object\'s Weapon (enemies, turrets). The player fires with the mouse.',
    params: [p('fire', 'target', 'Object with a Weapon', { required: true, default: 'self' })],
    example: { fire: 'self' },
  },
  {
    key: 'reload',
    label: 'Reload weapon',
    icon: 'refresh',
    category: 'Physics',
    description: 'Reload an object\'s Weapon.',
    params: [p('reload', 'target', 'Object with a Weapon', { required: true, default: 'self' })],
    example: { reload: 'self' },
  },
  {
    key: 'useCamera',
    label: 'Use camera',
    icon: 'video',
    category: 'Movement',
    description: 'Show the game through another camera (security cameras, cutscenes, menus).',
    params: [p('useCamera', 'target', 'Camera object', { required: true })],
    example: { useCamera: 'Cam 2' },
  },
  {
    key: 'lookAt',
    label: 'Look at',
    icon: 'crosshair',
    category: 'Movement',
    description: 'Turn to face another object or a position.',
    params: [p('lookAt', 'expr', 'Target', { required: true, default: 'player' }), p('on', 'target', 'Object', { default: 'self' })],
    example: { lookAt: 'player' },
  },
  {
    key: 'chase',
    label: 'Chase',
    icon: 'footprints',
    category: 'Movement',
    description: 'Walk toward an object (use in on.update). Characters walk with physics; others glide.',
    params: [
      p('chase', 'target', 'Object to chase', { required: true, default: 'player' }),
      p('speed', 'expr', 'Speed (m/s)'),
      p('stopAt', 'expr', 'Stop this close', { default: 1.2 }),
      p('run', 'expr', 'Run', { default: false }),
    ],
    example: { chase: 'player', stopAt: 1.2 },
  },
  // Physics
  {
    key: 'push',
    label: 'Push',
    icon: 'hand',
    category: 'Physics',
    description: 'Give a physics object a shove [x, y, z].',
    params: [p('push', 'expr', 'Force', { required: true, default: [0, 5, 0] }), p('on', 'target', 'Object', { default: 'self' })],
    example: { push: [0, 8, 0], on: 'other' },
  },
  {
    key: 'velocity',
    label: 'Set speed',
    icon: 'wind',
    category: 'Physics',
    description: 'Set a physics object\'s velocity [x, y, z] in meters per second.',
    params: [p('velocity', 'expr', 'Velocity', { required: true, default: [0, 0, 5] }), p('on', 'target', 'Object', { default: 'self' })],
    example: { velocity: [0, 0, 10] },
  },
  {
    key: 'pickUp',
    label: 'Pick up',
    icon: 'hand',
    category: 'Physics',
    description: 'Carry an object in front of someone (it stops falling until dropped).',
    params: [p('pickUp', 'target', 'Object', { required: true, default: 'self' }), p('by', 'target', 'Carried by', { default: 'player' })],
    example: { pickUp: 'self', by: 'player' },
  },
  {
    key: 'drop',
    label: 'Drop',
    icon: 'download',
    category: 'Physics',
    description: 'Put down an object that is being carried.',
    params: [p('drop', 'target', 'Object', { required: true, default: 'self' })],
    example: { drop: 'self' },
  },
  {
    key: 'burst',
    label: 'Burst particles',
    icon: 'sparkles',
    category: 'Look',
    description: 'Make an object\'s Particle System shoot out a burst (explosions, impacts).',
    params: [p('burst', 'target', 'Object', { required: true, default: 'self' })],
    example: { burst: 'self' },
  },
  // Look
  {
    key: 'color',
    label: 'Color',
    icon: 'palette',
    category: 'Look',
    description: 'Change the color of a shape.',
    params: [p('color', 'expr', 'Color', { required: true, default: "'#ff0000'" }), p('on', 'target', 'Object', { default: 'self' })],
    example: { color: "'#ffcc00'" },
  },
  {
    key: 'animate',
    label: 'Animate',
    icon: 'activity',
    category: 'Look',
    description: 'Play an animation: "attack", "hurt" or "die" on characters with an Animator (once, then back to moving), or any clip name.',
    params: [p('animate', 'expr', 'Clip name', { required: true, default: "'Walk'" }), p('on', 'target', 'Object', { default: 'self' })],
    example: { animate: "'attack'" },
  },
  {
    key: 'keyframes',
    label: 'Keyframes',
    icon: 'activity',
    category: 'Look',
    description: 'Play, stop, restart or reverse an object\'s Keyframes animation (doors, lifts, drawbridges).',
    params: [p('keyframes', 'expr', 'Do', { required: true, default: "'play'" }), p('on', 'target', 'Object', { default: 'self' })],
    example: { keyframes: "'play'", on: 'Gate' },
  },
  // Messages
  {
    key: 'send',
    label: 'Send message',
    icon: 'send',
    category: 'Messages',
    description: 'Tell another object (or everyone) that something happened. They react in on.message.',
    params: [p('send', 'name', 'Message', { required: true }), p('to', 'target', 'To', { default: 'all' })],
    example: { send: 'opened', to: 'all' },
  },
  // Sound & UI
  {
    key: 'log',
    label: 'Log',
    icon: 'file',
    category: 'Sound & UI',
    description: 'Write a message in the editor Console (great for testing).',
    params: [p('log', 'text', 'Message', { required: true, default: 'Hello!' })],
    example: { log: 'Score is {game.score}' },
  },
  {
    key: 'say',
    label: 'Show message',
    icon: 'message',
    category: 'Sound & UI',
    description: 'Show a message on screen for a few seconds.',
    params: [p('say', 'text', 'Message', { required: true, default: 'You found a coin!' }), p('time', 'expr', 'Seconds', { default: 2 })],
    example: { say: 'Checkpoint!', time: 2 },
  },
  {
    key: 'dialog',
    label: 'Dialog',
    icon: 'message',
    category: 'Sound & UI',
    description: 'Show a dialog box with who is speaking (for characters that talk).',
    params: [
      p('dialog', 'text', 'What they say', { required: true, default: 'Hello, traveler.' }),
      p('speaker', 'expr', 'Speaker', { default: 'self.name' }),
      p('time', 'expr', 'Seconds', { default: 4 }),
    ],
    example: { dialog: 'The bridge is out. Try the mountain path.', speaker: 'self.name' },
  },
  {
    key: 'bar',
    label: 'Screen bar',
    icon: 'gauge',
    category: 'Sound & UI',
    description: 'Show a bar on screen, full at 1 and empty at 0 (health, stamina).',
    params: [
      p('bar', 'expr', 'Amount (0 to 1)', { required: true, default: 'self.health / self.maxHealth' }),
      p('label', 'text', 'Label', { default: 'Health' }),
      p('slot', 'expr', 'Corner', { default: "'top-right'" }),
      p('color', 'expr', 'Color', { default: "'#e0645a'" }),
    ],
    example: { bar: 'self.health / self.maxHealth', label: 'Health' },
  },
  {
    key: 'hud',
    label: 'Screen text',
    icon: 'monitor',
    category: 'Sound & UI',
    description: 'Keep some text in a corner of the screen (score, health…).',
    params: [
      p('hud', 'text', 'Text', { required: true, default: 'Score: {game.score}' }),
      p('slot', 'expr', 'Corner', { default: "'top-left'", help: 'top-left, top-right, bottom-left, bottom-right' }),
    ],
    example: { hud: 'Score: {game.score}' },
  },
  {
    key: 'play',
    label: 'Play sound',
    icon: 'volume',
    category: 'Sound & UI',
    description: 'Play the sound of an object\'s Audio Source (from the start).',
    params: [p('play', 'target', 'Object with the sound', { required: true, default: 'self' })],
    example: { play: 'self' },
  },
  {
    key: 'stopSound',
    label: 'Stop sound',
    icon: 'volume',
    category: 'Sound & UI',
    description: 'Stop an object\'s sound.',
    params: [p('stopSound', 'target', 'Object with the sound', { required: true, default: 'self' })],
    example: { stopSound: 'self' },
  },
  // Game
  {
    key: 'pause',
    label: 'Pause game',
    icon: 'pause',
    category: 'Game',
    description: 'Freeze the game (menus, pause screens). Buttons, keys and messages still work; the mouse is freed. Use { pause: false } or resume to carry on.',
    params: [p('pause', 'expr', 'Paused', { default: 'true', help: 'true to pause, false to carry on' })],
    example: { pause: true },
  },
  {
    key: 'resume',
    label: 'Resume game',
    icon: 'play',
    category: 'Game',
    description: 'Carry on after pause.',
    params: [p('resume', 'expr', 'Resume', { default: 'true' })],
    example: { resume: true },
  },
  {
    key: 'restart',
    label: 'Restart game',
    icon: 'refresh',
    category: 'Game',
    description: 'Start again from the beginning: everything goes back to how it was when the game started.',
    params: [p('restart', 'expr', 'Restart', { default: 'true' })],
    example: { restart: true },
  },
  {
    key: 'save',
    label: 'Save game',
    icon: 'save',
    category: 'Game',
    description: 'Save the game in a slot: game values, where every object is, its own values, and what has gone (collected, defeated). Kept in the player\'s browser.',
    params: [p('save', 'expr', 'Slot', { default: "'game'", help: "A name: 'game', 'slot1'…" })],
    example: { save: "'game'" },
  },
  {
    key: 'load',
    label: 'Load game',
    icon: 'folder-open',
    category: 'Game',
    description: 'Put the game back the way a slot was saved. Check first with hasSave(\'game\').',
    params: [p('load', 'expr', 'Slot', { default: "'game'" })],
    example: { load: "'game'" },
  },
  {
    key: 'deleteSave',
    label: 'Delete save',
    icon: 'trash',
    category: 'Game',
    description: 'Forget a saved slot (a "New game" button).',
    params: [p('deleteSave', 'expr', 'Slot', { default: "'game'" })],
    example: { deleteSave: "'game'" },
  },
  {
    key: 'loadScene',
    label: 'Load scene',
    icon: 'layers',
    category: 'Sound & UI',
    description: 'Switch to another scene.',
    params: [p('loadScene', 'expr', 'Scene', { required: true })],
    example: { loadScene: "'Level 2'" },
    comingIn: 'Phase 12 (multiple scenes)',
  },
];

export const ACTION_BY_KEY = new Map(ACTIONS.map((a) => [a.key, a]));

// ── events ──────────────────────────────────────────────────────────────────

export type EventShape =
  /** on.start: [ actions ] */
  | 'actions'
  /** on.key: { space: [ actions ], e: [ actions ] } */
  | 'keyed'
  /** on.timer: [ { every: 2, do: [ actions ] } ] */
  | 'timers'
  /** on.near: [ { distance: 3, do: [ actions ], leave: [ actions ] } ] */
  | 'near';

export interface EventSpec {
  key: string;
  label: string;
  icon: string;
  description: string;
  shape: EventShape;
  /** Does "other" mean something here? */
  hasOther?: boolean;
  aliasOf?: string;
}

export const EVENTS: EventSpec[] = [
  { key: 'start', label: 'Game starts', icon: 'flag', description: 'Once, when Play starts (or when the object is spawned).', shape: 'actions' },
  { key: 'update', label: 'Every frame', icon: 'refresh', description: 'Many times per second. Use time.delta for smooth changes. No waiting here.', shape: 'actions' },
  { key: 'touch', label: 'Touched', icon: 'hand', description: 'Something bumps into this or enters it. "other" is that thing.', shape: 'actions', hasOther: true },
  { key: 'untouch', label: 'Stops touching', icon: 'arrow-right', description: 'Something stops touching / leaves this. "other" is that thing.', shape: 'actions', hasOther: true },
  { key: 'enter', label: 'Entered', icon: 'door', description: 'Same as touch (handy for trigger zones).', shape: 'actions', hasOther: true, aliasOf: 'touch' },
  { key: 'exit', label: 'Exited', icon: 'footprints', description: 'Same as untouch.', shape: 'actions', hasOther: true, aliasOf: 'untouch' },
  { key: 'click', label: 'Clicked', icon: 'mouse', description: 'The player clicks/taps this object.', shape: 'actions' },
  { key: 'key', label: 'Key pressed', icon: 'keyboard', description: 'A key is pressed: { space: [...], e: [...] }. Also: jump, interact, fire.', shape: 'keyed' },
  { key: 'timer', label: 'Timer', icon: 'timer', description: 'Repeat every N seconds, or once after N seconds: [ { every: 2, do: [...] } ].', shape: 'timers' },
  { key: 'near', label: 'Player is near', icon: 'radar', description: 'The player comes within a distance: [ { distance: 3, do: [...], leave: [...] } ].', shape: 'near', hasOther: true },
  { key: 'message', label: 'Message received', icon: 'mail', description: 'Another object used send: { opened: [...] }.', shape: 'keyed' },
];

export const EVENT_BY_KEY = new Map(EVENTS.map((e) => [e.key, e]));

/** Keys you can react to in on.key (besides any single letter or digit). */
export const KEY_NAMES: Record<string, string> = {
  space: 'Key:Space',
  enter: 'Key:Enter',
  shift: 'Key:ShiftLeft',
  tab: 'Key:Tab',
  escape: 'Key:Escape',
  up: 'Key:ArrowUp',
  down: 'Key:ArrowDown',
  left: 'Key:ArrowLeft',
  right: 'Key:ArrowRight',
  click: 'Mouse:0',
  rightclick: 'Mouse:2',
};
/** Named input actions also usable in on.key (they include gamepad buttons). */
export const INPUT_ACTIONS = ['jump', 'run', 'crouch', 'interact', 'fire', 'aim', 'pause'];

export function keyBinding(name: string): string | null {
  const k = name.toLowerCase();
  if (KEY_NAMES[k]) return KEY_NAMES[k];
  if (/^[a-z]$/.test(k)) return `Key:Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Key:Digit${k}`;
  return null;
}

// ── expression functions & names ────────────────────────────────────────────

export interface FunctionSpec {
  name: string;
  signature: string;
  description: string;
}

export const FUNCTIONS: FunctionSpec[] = [
  { name: 'random', signature: 'random(min, max)', description: 'A random number between min and max.' },
  { name: 'randomInt', signature: 'randomInt(min, max)', description: 'A random whole number, min and max included.' },
  { name: 'pick', signature: "pick('a', 'b', 'c')", description: 'One of the values, at random.' },
  { name: 'abs', signature: 'abs(x)', description: 'The number without its minus sign.' },
  { name: 'min', signature: 'min(a, b)', description: 'The smaller value.' },
  { name: 'max', signature: 'max(a, b)', description: 'The bigger value.' },
  { name: 'clamp', signature: 'clamp(x, low, high)', description: 'Keep x between low and high.' },
  { name: 'round', signature: 'round(x)', description: 'Round to the nearest whole number.' },
  { name: 'floor', signature: 'floor(x)', description: 'Round down.' },
  { name: 'ceil', signature: 'ceil(x)', description: 'Round up.' },
  { name: 'sqrt', signature: 'sqrt(x)', description: 'Square root.' },
  { name: 'sin', signature: 'sin(degrees)', description: 'Wave between -1 and 1 (degrees).' },
  { name: 'cos', signature: 'cos(degrees)', description: 'Wave between -1 and 1 (degrees).' },
  { name: 'lerp', signature: 'lerp(a, b, t)', description: 'Blend from a to b (t from 0 to 1).' },
  { name: 'distance', signature: 'distance(a, b)', description: 'Meters between two objects or positions.' },
  { name: 'angleTo', signature: 'angleTo(a, b)', description: 'Direction from a to b in degrees, measured like camera.yaw (compasses, turrets).' },
  { name: 'wrapAngle', signature: 'wrapAngle(degrees)', description: 'The same angle between -180 and 180.' },
  { name: 'atan2', signature: 'atan2(y, x)', description: 'Angle of a direction, in degrees.' },
  { name: 'vec3', signature: 'vec3(x, y, z)', description: 'A position / direction.' },
  { name: 'vec2', signature: 'vec2(x, y)', description: 'Two numbers, for UI offsets and sizes.' },
  { name: 'find', signature: "find('Door')", description: 'The object with that name.' },
  { name: 'closest', signature: "closest('enemy')", description: 'The nearest object with that tag.' },
  { name: 'count', signature: "count('coin')", description: 'How many objects have that tag.' },
  { name: 'lookTarget', signature: 'lookTarget(10)', description: 'The object in the middle of the screen (within 10 m), or nothing.' },
  { name: 'lookPoint', signature: 'lookPoint(50)', description: 'The spot the camera looks at (or 50 m ahead).' },
  { name: 'raycast', signature: 'raycast(from, direction, 20)', description: 'The first object along a line, or nothing.' },
  { name: 'exists', signature: 'exists(x)', description: 'True if x is not nothing.' },
  { name: 'hasSave', signature: "hasSave('game')", description: 'True if that saved-game slot exists.' },
  { name: 'text', signature: 'text(x)', description: 'Turn a value into text.' },
  { name: 'number', signature: 'number(x)', description: 'Turn text into a number.' },
];

export const FUNCTION_NAMES = new Set(FUNCTIONS.map((f) => f.name));

/** Names an expression can start with. */
export const ROOT_NAMES: Record<string, string> = {
  self: 'This object',
  other: 'The other object in touch/untouch/near events',
  player: 'The object tagged "player"',
  game: 'Values shared by the whole game (game.score…)',
  time: 'time.delta (seconds since last frame), time.elapsed',
  input: 'input.moveX, input.moveY (-1…1), input.jump, input.run (true/false)',
  args: 'Values passed to this function (also $name)',
  index: 'The repeat counter',
};

/** Properties every object has (besides its own variables). */
export const ENTITY_PROPS: Record<string, string> = {
  name: 'Its name',
  position: '[x, y, z] in meters',
  rotation: '[x, y, z] in degrees',
  scale: '[x, y, z]',
  x: 'Position x',
  y: 'Position y (up)',
  z: 'Position z',
  visible: 'Shown and active (true/false)',
  tags: 'Its tags',
  grounded: 'Standing on something (characters)',
  climbing: 'Climbing something right now (characters)',
  swimming: 'Swimming right now (characters)',
  held: 'Being carried right now',
  solid: 'Blocks things (false = things pass through, but it keeps running)',
  opacity: 'How see-through it looks, 0 = invisible, 1 = solid',
};

export const ENTITY_METHODS: Record<string, string> = {
  is: "is('player') — has this tag or name",
  has: "has('health') — has this variable or component",
  distanceTo: 'distanceTo(other) — meters to another object',
};

// ── helpers ─────────────────────────────────────────────────────────────────

/** "pley" → "play". Returns undefined if nothing is close. */
export function didYouMean(word: string, options: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  const w = word.toLowerCase();
  for (const o of options) {
    const d = levenshtein(w, o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  const limit = word.length <= 3 ? 1 : word.length <= 6 ? 2 : 3;
  return bestD <= limit ? best : undefined;
}

/** Edit distance where swapping two neighbouring letters ("lgo" → "log") counts as one typo. */
function levenshtein(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
