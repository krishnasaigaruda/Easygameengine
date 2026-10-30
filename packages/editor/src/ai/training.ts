import { ACTIONS, LOOK_PRESETS, TRAITS, Transform, compileScript, getComponentDef, type Entity, type FieldSpec, type SceneSettings } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { viewportController } from '../viewport/viewportRef';
import { removeAsset, useLibrary } from '../assets/library';
import { editSceneSettings } from '../editor/assetActions';
import { partPrompt, partSystem, understandSchema, understandSystem, type PartState } from './agent';
import { runPlan } from './execute';
import { SAMPLE_SCRIPTS, designGame, type Rng } from './games';
import { planSchema, type Step } from './plan';

/*
 * Training examples for the assistant's model, made from the engine itself (no API needed).
 * Each example is a real request with an answer built by code, in exactly the prompts the
 * assistant uses. Every answer is run in this editor first: only ones that work are kept.
 * Used by ai-training/generate (headless); never shipped in games.
 */

export interface Example {
  kind: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
}

// ── randomness (seeded: the same seed makes the same examples) ──
let seed = 1;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const r1 = (v: number) => Math.round(v * 10) / 10;
const chance = (p: number) => rand() < p;
const rng: Rng = { rand, pick, int, chance };

const NAMES = ['Crate', 'Tower', 'Pillar', 'Rock', 'Box', 'Block', 'Barrel', 'Statue', 'Lamp', 'Wall', 'Bridge', 'Gate', 'Chest', 'Platform', 'Ramp', 'Pole', 'Stone', 'Table', 'Fountain', 'Bench', 'Sign', 'Pipe', 'Arch', 'Cart'];
const NEW_NAMES = ['Goal', 'Treasure', 'Beacon', 'Marker', 'Base', 'Spawn', 'Tower Top', 'Guard Post', 'Altar', 'Totem', 'Well', 'Bell'];
const COLORS: Record<string, string> = { red: '#e04a3a', blue: '#3a6ee0', green: '#4fae3c', yellow: '#f2c23a', orange: '#f28c28', purple: '#8a4fd0', pink: '#f07ab0', white: '#f2f2f2', black: '#1a1a1a', grey: '#8a8a8a', brown: '#8a5a34', gold: '#d4a017', teal: '#2fa3a0' };
const SHAPES_3D = ['cube', 'sphere', 'cylinder', 'cone', 'capsule', 'torus'] as const;
const SHAPES_2D = ['sprite', 'platform'] as const;

/** Ways people ask for traits. */
const TRAIT_PHRASES: Record<string, string[]> = {
  bouncy: ['bouncy', 'bounce things off it', 'like a trampoline'],
  spinning: ['spin', 'spin around', 'keep turning'],
  floating: ['float', 'float up and down', 'hover'],
  collectible: ['a pickup the player can collect', 'collectible', 'something you collect for points'],
  'kill-zone': ['deadly', 'kill the player when touched', 'a kill zone'],
  'jump-pad': ['a jump pad', 'launch the player up', 'a trampoline that launches you'],
  'moving-platform': ['move back and forth', 'a moving platform'],
  checkpoint: ['a checkpoint', 'save the player\'s progress when touched'],
  solid: ['solid', 'something you can stand on'],
  slippery: ['slippery', 'like ice'],
  damaging: ['hurt the player', 'damage the player on touch'],
  healing: ['heal the player', 'a health pickup'],
  disappearing: ['disappear when stood on', 'vanish after you step on it'],
  climbable: ['climbable', 'something you can climb like a ladder'],
  door: ['a door that opens with E', 'open and close like a door'],
  npc: ['a character you can talk to', 'an NPC'],
  enemy: ['an enemy', 'attack the player'],
  pushable: ['pushable', 'something the player can push'],
};

const LOOK_PHRASES: Record<string, string[]> = {
  Realistic: ['realistic', 'like real life', 'more realistic'],
  Cartoon: ['like a cartoon', 'cartoony', 'like a cartoon with outlines'],
  Retro: ['retro', 'pixelated like an old game', 'like a retro game'],
  Horror: ['scary', 'like a horror game', 'creepy'],
  Noir: ['black and white', 'like an old film', 'noir'],
};

/** Vague requests and good questions to ask about them. */
const VAGUE: { ask: string; questions: { q: string; options: string[] }[] }[] = [
  { ask: 'make a game', questions: [{ q: 'What kind of game?', options: ['Obby / parkour', 'Exploring a world', 'Collect coins', 'Shooter'] }, { q: 'How do you win?', options: ['Reach the finish', 'Collect everything', 'Beat a timer'] }] },
  { ask: 'make something cool', questions: [{ q: 'What should it be?', options: ['A level to play', 'A pretty scene', 'A small game'] }, { q: 'What mood?', options: ['Bright and fun', 'Calm', 'Spooky'] }] },
  { ask: 'build a world', questions: [{ q: 'What kind of place?', options: ['Forest', 'Mountains', 'Island', 'City'] }, { q: 'Should you be able to walk around in it?', options: ['Yes, add a player', 'No, just the scene'] }] },
  { ask: 'make a level', questions: [{ q: 'What kind of level?', options: ['Platforms to jump on', 'A maze', 'An arena'] }, { q: 'How hard?', options: ['Easy', 'Medium', 'Hard'] }] },
  { ask: 'make it better', questions: [{ q: 'What should get better?', options: ['How it looks', 'More to do', 'Harder to win'] }] },
  { ask: 'add some stuff', questions: [{ q: 'What should I add?', options: ['Decorations', 'Coins to collect', 'Obstacles', 'Enemies'] }] },
  { ask: 'make a scene', questions: [{ q: 'What kind of scene?', options: ['Nature', 'A town', 'Indoors', 'Space'] }, { q: 'Time of day?', options: ['Day', 'Sunset', 'Night'] }] },
  { ask: 'make a horror game', questions: [{ q: 'Where does it happen?', options: ['A haunted house', 'A dark forest', 'An abandoned school'] }, { q: 'What is the goal?', options: ['Escape', 'Find items', 'Survive a time'] }] },
  { ask: 'make a racing game', questions: [{ q: 'What do you race?', options: ['Cars', 'On foot', 'Boats'] }, { q: 'What kind of track?', options: ['A loop', 'Point to point', 'An obstacle course'] }] },
  { ask: 'i want a fun game for my friends', questions: [{ q: 'What should you do in it?', options: ['Race to a finish', 'Collect the most coins', 'Explore and find secrets'] }] },
];

/** Bigger requests and how to split them into parts (the plan; parts are built one by one). */
const PLANS: { ask: string; summary: string; parts: string[] }[] = [
  { ask: 'make an obby with 5 platforms and a finish', summary: 'An obby: rising platforms to a finish', parts: ['A player at the start', '5 platforms rising step by step with gaps to jump', 'A finish on the last platform'] },
  { ask: 'make a coin hunt', summary: 'Find all the coins around the area', parts: ['A player in the middle', 'Coins hidden around the area', 'A score on screen'] },
  { ask: 'a mountain meadow with a cabin', summary: 'A meadow in a mountain valley with a cabin', parts: ['Shape the ground into a mountain valley', 'Grass and wildflowers on the meadow', 'Pine trees on the slopes', 'A cabin by the meadow', 'A sunny sky with a little haze', 'A player to walk around'] },
  { ask: 'a spooky forest at night', summary: 'A dark, spooky forest', parts: ['Hilly ground', 'Lots of trees close together', 'A night sky and fog', 'A lantern that lights the path', 'A scary look'] },
  { ask: 'a small island', summary: 'An island in the sea', parts: ['Shape the ground into an island', 'Water all around', 'Trees and rocks on the island', 'A player on the beach'] },
  { ask: 'a lava parkour level', summary: 'Jump across platforms over lava', parts: ['A player at the start', 'A big red lava floor that kills the player', 'Platforms to jump across with gaps', 'Checkpoints along the way', 'A finish at the end'] },
  { ask: 'a village with houses and a well', summary: 'A small village', parts: ['Flat grassy ground', 'Houses around a square', 'A well in the middle of the square', 'Paths between the houses', 'A player to walk around'] },
  { ask: 'an arena with enemies', summary: 'Fight enemies in an arena', parts: ['A round floor with walls around it', 'A player in the middle', 'Enemies around the edges that attack the player', 'Health pickups'] },
  { ask: 'a maze to escape', summary: 'Find your way out of a maze', parts: ['A floor for the maze', 'Walls making a maze', 'A player at the start', 'A finish at the exit'] },
  { ask: 'a 2D platformer level', summary: 'Jump across platforms to the finish', parts: ['Ground along the bottom', 'Platforms at different heights', 'Coins above the platforms', 'A finish at the end', 'A player at the start'] },
  { ask: 'a cave with torches', summary: 'A dark cave lit by torches', parts: ['Make it dark', 'A cave floor and ceiling', 'Ledges to jump on', 'Flickering torches along the way', 'A player at the start'] },
  { ask: 'add a shop where coins buy a hat', summary: 'A shop that sells a hat for coins', parts: ['A shop counter with a shopkeeper', 'A script: talking to the shopkeeper with enough coins buys the hat', 'A hat that appears on the player when bought'] },
  { ask: 'a timer that ends the game after 60 seconds', summary: 'A 60 second time limit', parts: ['A timer on screen counting down from 60', 'When it reaches 0 the game ends'] },
  { ask: 'a dog that follows me', summary: 'A dog that follows the player', parts: ['A dog near the player', 'The dog follows the player around'] },
];

// ── the scene ───────────────────────────────────────────────────────────────

const state = () => useEditor.getState();
const world = () => state().engine!.world;
const things = () => [...world().all()].filter((e) => !e.parent && (e.has('MeshRenderer') || e.has('Sprite')) && e.name !== 'Ground');
const posOf = (e: Entity) => e.require(Transform).position;

/** A fresh random scene to work in (kept for a batch of examples). */
async function setUpScene(flat: boolean): Promise<void> {
  const used = new Set<string>();
  const steps: Step[] = [];
  const n = int(4, 8);
  for (let i = 0; i < n; i++) {
    let name = pick(NAMES);
    if (used.has(name)) name = `${name} ${i + 1}`;
    used.add(name);
    const what = flat ? pick(SHAPES_2D) : pick(SHAPES_3D);
    steps.push({ do: 'create', what, name, at: flat ? [int(-10, 10), int(0, 6), 0] : [int(-12, 12), 0.5 + int(0, 3), int(-12, 12)], color: chance(0.5) ? pick(Object.values(COLORS)) : undefined });
  }
  if (chance(0.5)) steps.push({ do: 'create', what: 'player', at: flat ? [0, 2, 0] : [0, 1, 0] });
  await runPlan({ reply: '', steps });
  state().history?.clear();
}

// ── requests with answers ───────────────────────────────────────────────────

interface Task {
  kind: string;
  ask: string;
  reply: string;
  steps: Step[];
}

type Maker = (flat: boolean) => Task | null;

const DIRS: [string, number, number, number][] = [
  ['up', 0, 1, 0],
  ['down', 0, -1, 0],
  ['left', -1, 0, 0],
  ['right', 1, 0, 0],
  ['forward', 0, 0, -1],
  ['back', 0, 0, 1],
];

const makers: Record<string, Maker> = {
  moveBy: (flat) => {
    const o = pick(things());
    if (!o) return null;
    const [dir, dx, dy, dz] = pick(flat ? DIRS.slice(0, 4) : DIRS);
    const n = int(1, 5);
    const p = posOf(o);
    const at = [r1(p[0] + dx * n), r1(p[1] + dy * n), flat ? 0 : r1(p[2] + dz * n)];
    const ask = pick([`Move ${o.name} ${dir} by ${n}`, `move the ${o.name.toLowerCase()} ${n} meters ${dir}`, `Shift ${o.name} ${n} ${dir}`]);
    return { kind: 'move', ask, reply: `Moved ${o.name} ${dir}.`, steps: [{ do: 'edit', object: o.name, at }] };
  },
  moveTo: (flat) => {
    const o = pick(things());
    if (!o) return null;
    const at = flat ? [int(-10, 10), int(0, 6), 0] : [int(-10, 10), int(1, 4), int(-10, 10)];
    return { kind: 'move', ask: pick([`Put ${o.name} at ${at.join(', ')}`, `move ${o.name} to ${at.join(' ')}`]), reply: `Moved ${o.name}.`, steps: [{ do: 'edit', object: o.name, at }] };
  },
  moveNext: (flat) => {
    const list = things();
    if (list.length < 2) return null;
    const a = pick(list);
    const b = pick(list.filter((x) => x !== a));
    const p = posOf(b);
    const at = [r1(p[0] + 2), r1(p[1]), flat ? 0 : r1(p[2])];
    return { kind: 'move', ask: pick([`Move ${a.name} next to ${b.name}`, `put the ${a.name.toLowerCase()} beside ${b.name}`]), reply: `${a.name} is next to ${b.name} now.`, steps: [{ do: 'edit', object: a.name, at }] };
  },
  color: () => {
    const o = pick(things());
    if (!o) return null;
    const [name, hex] = pick(Object.entries(COLORS));
    return { kind: 'color', ask: pick([`Make ${o.name} ${name}`, `paint the ${o.name.toLowerCase()} ${name}`, `Change ${o.name}'s colour to ${name}`, `color ${o.name} ${name}`]), reply: `${o.name} is ${name} now.`, steps: [{ do: 'edit', object: o.name, color: hex }] };
  },
  scale: (flat) => {
    const o = pick(things());
    if (!o) return null;
    const s = o.require(Transform).scale;
    const [words, k] = pick<[string, number[]]>([
      ['twice as big', [2, 2, 2]],
      ['bigger', [1.5, 1.5, 1.5]],
      ['smaller', [0.5, 0.5, 0.5]],
      ['taller', [1, 2, 1]],
      ['wider', [2, 1, flat ? 1 : 2]],
      ['3 times bigger', [3, 3, 3]],
      ['half the size', [0.5, 0.5, 0.5]],
    ]);
    const size = [r1(s[0] * k[0]), r1(s[1] * k[1]), flat ? 1 : r1(s[2] * k[2])];
    return { kind: 'size', ask: pick([`Make ${o.name} ${words}`, `make the ${o.name.toLowerCase()} ${words}`]), reply: `${o.name} is ${words} now.`, steps: [{ do: 'edit', object: o.name, size }] };
  },
  rotate: (flat) => {
    const o = pick(things());
    if (!o) return null;
    const deg = pick([45, 90, 180, 30, 270]);
    const r = o.require(Transform).rotation;
    const rotate = flat ? [0, 0, (r[2] + deg) % 360] : [r[0], (r[1] + deg) % 360, r[2]];
    return { kind: 'rotate', ask: pick([`Turn ${o.name} ${deg} degrees`, `rotate the ${o.name.toLowerCase()} by ${deg}°`]), reply: `Turned ${o.name}.`, steps: [{ do: 'edit', object: o.name, rotate }] };
  },
  rename: () => {
    const o = pick(things());
    if (!o) return null;
    const name = pick(NEW_NAMES);
    return { kind: 'rename', ask: pick([`Rename ${o.name} to ${name}`, `call the ${o.name.toLowerCase()} "${name}"`]), reply: `Renamed it ${name}.`, steps: [{ do: 'edit', object: o.name, name }] };
  },
  delete: () => {
    const o = pick(things());
    if (!o) return null;
    return { kind: 'delete', ask: pick([`Delete ${o.name}`, `remove the ${o.name.toLowerCase()}`, `get rid of ${o.name}`]), reply: `Deleted ${o.name}.`, steps: [{ do: 'delete', object: o.name }] };
  },
  duplicate: (flat) => {
    const o = pick(things());
    if (!o) return null;
    const n = int(2, 5);
    const stack = chance(0.3);
    const h = o.require(Transform).scale[1];
    const step = stack ? [0, r1(h), 0] : flat ? [2, 0, 0] : pick([[2, 0, 0], [0, 0, 2]]);
    return { kind: 'duplicate', ask: stack ? `Stack ${n} copies of ${o.name} on top of each other` : pick([`Make ${n} copies of ${o.name} in a row`, `duplicate the ${o.name.toLowerCase()} ${n} times`]), reply: `Made ${n} copies of ${o.name}.`, steps: [{ do: 'duplicate', object: o.name, count: n, step }] };
  },
  parent: () => {
    const list = things();
    if (list.length < 2) return null;
    const a = pick(list);
    const b = pick(list.filter((x) => x !== a));
    return { kind: 'parent', ask: pick([`Put ${a.name} inside ${b.name}`, `make ${a.name} a child of ${b.name}`, `group ${a.name} under ${b.name}`]), reply: `${a.name} is inside ${b.name} now.`, steps: [{ do: 'parent', object: a.name, to: b.name }] };
  },
  traits: () => {
    const o = pick(things());
    if (!o) return null;
    const trait = pick(Object.keys(TRAIT_PHRASES).filter((t) => TRAITS.some((x) => x.name === t && !x.comingIn)));
    const phrase = pick(TRAIT_PHRASES[trait]);
    return { kind: 'traits', ask: pick([`Make ${o.name} ${phrase}`, `make the ${o.name.toLowerCase()} ${phrase}`]), reply: `${o.name} is ${trait} now.`, steps: [{ do: 'traits', object: o.name, traits: [trait] }] };
  },
  create: (flat) => {
    const what = flat ? pick(['sprite', 'platform', 'coin', 'light']) : pick(['cube', 'sphere', 'cylinder', 'cone', 'coin', 'light', 'torus']);
    const [cname, hex] = pick(Object.entries(COLORS));
    const name = pick(NEW_NAMES);
    const on = chance(0.4) ? pick(things()) : undefined;
    if (on) {
      const p = posOf(on);
      const h = on.require(Transform).scale[1];
      const at = [r1(p[0]), r1(p[1] + h / 2 + 0.5), flat ? 0 : r1(p[2])];
      return { kind: 'create', ask: `Add a ${cname} ${what} on top of ${on.name}`, reply: `Added a ${cname} ${what} on ${on.name}.`, steps: [{ do: 'create', what: what as Step['what'], name, at, color: what === 'light' ? undefined : hex }] };
    }
    const at = flat ? [int(-10, 10), int(1, 6), 0] : [int(-10, 10), 1, int(-10, 10)];
    return { kind: 'create', ask: pick([`Add a ${cname} ${what} called ${name} at ${at.join(', ')}`, `create a ${what} named ${name} at ${at.join(' ')}, ${cname}`]), reply: `Added ${name}.`, steps: [{ do: 'create', what: what as Step['what'], name, at, color: what === 'light' ? undefined : hex }] };
  },
  row: (flat) => {
    const what = flat ? pick(['coin', 'platform', 'sprite']) : pick(['coin', 'cube', 'cylinder', 'light']);
    const n = int(3, 8);
    const at = flat ? [int(-8, 4), int(1, 5), 0] : [int(-8, 4), 1, int(-8, 4)];
    const gap = int(2, 4);
    const name = what === 'coin' ? 'Coin' : what === 'light' ? 'Lamp' : pick(['Post', 'Step', 'Block', 'Pillar']);
    return { kind: 'row', ask: pick([`Add ${n} ${what}s in a row starting at ${at.join(', ')}`, `make a line of ${n} ${what}s, ${gap} meters apart`]), reply: `Added ${n} ${what}s.`, steps: [{ do: 'row', what: what as Step['what'], name, count: n, at, step: flat ? [gap, 0, 0] : [gap, 0, 0] }] };
  },
  scatter: (flat) => {
    const what = flat ? pick(['coin', 'sprite']) : pick(['coin', 'sphere', 'cube', 'cone']);
    const n = int(5, 20);
    const around = chance(0.5) ? pick(things()) : undefined;
    const at = around ? posOf(around).map(r1) : [0, 0, 0];
    const size = int(10, 30);
    return { kind: 'scatter', ask: around ? `Spread ${n} ${what}s around ${around.name}` : `scatter ${n} ${what}s over a ${size} by ${size} area`, reply: `Spread ${n} ${what}s around.`, steps: [{ do: 'scatter', what: what as Step['what'], count: n, at: flat ? [at[0], at[1], 0] : at, area: [size, flat ? int(2, 6) : size] }] };
  },
  set: () => {
    const o = pick(things());
    if (!o) return null;
    const comps = o.componentTypes().filter((t) => t !== 'Transform' && t !== 'Traits');
    const type = pick(comps);
    const def = type ? getComponentDef(type) : undefined;
    if (!def) return null;
    const fields = Object.entries(def.fields as Record<string, FieldSpec | undefined>).filter((e): e is [string, FieldSpec] => !!e[1] && ['number', 'boolean', 'enum'].includes(e[1].kind));
    if (!fields.length) return null;
    const [key, spec] = pick(fields);
    const label = (spec.label ?? key).replace(/\s*\(.*\)$/, '').toLowerCase();
    let value: string;
    if (spec.kind === 'number') value = String(r1((spec.min ?? 0) + rand() * Math.min(10, (spec.max ?? 10) - (spec.min ?? 0))));
    else if (spec.kind === 'boolean') value = String(!(o.get(def.type) as Record<string, unknown>)[key]);
    else value = pick((spec as { options: readonly string[] }).options);
    const ask = spec.kind === 'boolean' ? `${value === 'true' ? 'Turn on' : 'Turn off'} ${label} for ${o.name}` : pick([`Set ${o.name}'s ${label} to ${value}`, `change the ${label} of ${o.name} to ${value}`]);
    return { kind: 'set', ask, reply: `Set ${o.name}'s ${label} to ${value}.`, steps: [{ do: 'set', object: o.name, component: def.type, field: key, value }] };
  },
  addComponent: () => {
    const o = pick(things());
    if (!o) return null;
    const options: [string, string][] = [
      ['RigidBody', 'physics so it falls and can be pushed'],
      ['AudioSource', 'a sound'],
      ['Collider', 'a collider'],
      ['Light', 'a light'],
    ];
    const [type, words] = pick(options.filter(([t]) => !o.has(t) && getComponentDef(t)));
    if (!type) return null;
    return { kind: 'add', ask: pick([`Give ${o.name} ${words}`, `add ${words} to the ${o.name.toLowerCase()}`]), reply: `${o.name} has ${words} now.`, steps: [{ do: 'add', object: o.name, component: type }] };
  },
  script: () => {
    const o = pick(things());
    if (!o) return null;
    const actions = ACTIONS.filter((a) => !a.comingIn && ['Sound & UI', 'Variables', 'Look', 'Objects', 'Game'].includes(a.category));
    const a = pick(actions);
    const when = pick<[string, (body: string) => string]>([
      ['When the player touches', (b) => `{ on: { touch: [ { if: "other.is('player')" }, ${b} ] } }`],
      ['When the game starts,', (b) => `{ on: { start: [ ${b} ] } }`],
      ['When I press E near', (b) => `{ on: { key: { e: [ ${b} ] } } }`],
    ]);
    const body = JSON.stringify(a.example).replace(/"([a-zA-Z_]+)":/g, '$1: ');
    const code = when[1](body);
    try {
      compileScript(code, o.name);
    } catch {
      return null;
    }
    const what = a.description.replace(/\.$/, '');
    const ask = when[0].endsWith(',') ? `${when[0]} ${o.name} should ${what.charAt(0).toLowerCase()}${what.slice(1)}` : `${when[0]} ${o.name}, ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
    return { kind: 'script', ask, reply: `Gave ${o.name} a script.`, steps: [{ do: 'script', object: o.name, code }] };
  },
  look: (flat) => {
    if (flat) return null;
    const look = pick(Object.keys(LOOK_PRESETS));
    const phrase = pick(LOOK_PHRASES[look] ?? [look.toLowerCase()]);
    return { kind: 'look', ask: pick([`Make it look ${phrase}`, `make the game look ${phrase}`, `give it a ${look.toLowerCase()} look`]), reply: `It looks ${look.toLowerCase()} now.`, steps: [{ do: 'look', look }] };
  },
  settings: () => {
    if (chance(0.5)) {
      const [name, hex] = pick(Object.entries(COLORS));
      return { kind: 'settings', ask: `Make the background ${name}`, reply: `The background is ${name}.`, steps: [{ do: 'settings', field: 'background', value: hex }] };
    }
    const brighter = chance(0.5);
    return { kind: 'settings', ask: brighter ? 'Make everything brighter' : 'make it a bit darker', reply: brighter ? 'Brighter now.' : 'A bit darker now.', steps: [{ do: 'settings', field: 'exposure', value: brighter ? '1.4' : '0.7' }] };
  },
};

/** Two requests in one sentence ("make Crate red and move it up"). */
function combo(flat: boolean): Task | null {
  const a = makers[pick(['color', 'scale', 'traits', 'rotate'])](flat);
  const b = makers[pick(['moveBy', 'create', 'row', 'duplicate'])](flat);
  if (!a || !b) return null;
  return { kind: 'combo', ask: `${a.ask} and ${b.ask.charAt(0).toLowerCase()}${b.ask.slice(1)}`, reply: `${a.reply} ${b.reply}`, steps: [...a.steps, ...b.steps] };
}

// ── answers in the exact shape the model writes ─────────────────────────────

/** Keys in schema order (constrained decoding writes them in this order). */
function ordered(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
const stepKeys = () => Object.keys(((planSchema() as { properties: { steps: { items: { properties: object } } } }).properties.steps.items.properties));
const planJson = (reply: string, steps: Step[]) => JSON.stringify({ reply, steps: steps.map((s) => ordered(s as unknown as Record<string, unknown>, stepKeys())) });
const understandJson = (questions: { q: string; options: string[] }[], summary: string, parts: string[]) =>
  JSON.stringify(ordered({ questions, summary, parts }, Object.keys((understandSchema as { properties: object }).properties)));

// ── making examples ─────────────────────────────────────────────────────────

/**
 * Make up to `count` working examples in the open project (a fresh, empty one). Each task is
 * run for real, kept only if every step works, then undone.
 */
export async function generateExamples(count: number, opts: { seed?: number; onProgress?: (made: number, tried: number) => void } = {}): Promise<{ examples: Example[]; tried: number }> {
  seed = opts.seed ?? 1;
  const s = state();
  if (!s.engine || !s.history) throw new Error('Open a project first.');
  const flat = s.dimension === '2d';
  const examples: Example[] = [];
  let tried = 0;
  const names = Object.keys(makers);

  // Questions for vague requests, and plans for big ones (no running needed).
  for (const v of VAGUE) {
    examples.push({ kind: 'questions', messages: [{ role: 'system', content: understandSystem(s.dimension, false, v.ask) }, { role: 'user', content: v.ask }, { role: 'assistant', content: understandJson(v.questions, '', []) }] });
  }
  for (const p of PLANS) {
    if (flat !== /2d|cave/i.test(p.ask)) continue;
    examples.push({ kind: 'plan', messages: [{ role: 'system', content: understandSystem(s.dimension, false, p.ask) }, { role: 'user', content: p.ask }, { role: 'assistant', content: understandJson([], p.summary, p.parts) }] });
  }
  // Questions about the engine: answered in words, no steps.
  for (const t of TRAITS.filter((x) => !x.comingIn)) {
    const ask = pick([`What does the ${t.name} trait do?`, `what is ${t.label}?`]);
    examples.push({ kind: 'answer', messages: [{ role: 'system', content: partSystem(s.dimension, ask, ask) }, { role: 'user', content: partPrompt(ask, [{ text: ask, status: 'waiting', steps: [] }], 0) }, { role: 'assistant', content: planJson(t.description, []) }] });
  }

  let batch = 0;
  const keep = new Set(useLibrary.getState().assets.map((a) => a.id));
  resetScene(keep);
  await setUpScene(flat);
  while (examples.length < count && tried < count * 3) {
    if (++batch % 25 === 0) {
      // A new scene now and then, so names and positions vary (and no scripts left over).
      resetScene(keep);
      await setUpScene(flat);
    }
    tried++;
    const task = chance(0.15) ? combo(flat) : makers[pick(names)](flat);
    if (!task || !task.steps.length) continue;
    // What the model sees: the scene as it is before the change.
    const system = partSystem(s.dimension, task.ask, task.ask);
    const user = partPrompt(task.ask, [{ text: task.ask, status: 'waiting', steps: [] }], 0);
    const report = await runPlan({ reply: task.reply, steps: task.steps });
    if (report.done.length) state().history?.undo();
    if (report.skipped.length || report.done.length !== task.steps.length) continue;
    examples.push({ kind: task.kind, messages: [{ role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: planJson(task.reply, task.steps) }] });
    // Small requests are one part: the understand answer is just that.
    if (chance(0.15)) {
      examples.push({ kind: 'plan-small', messages: [{ role: 'system', content: understandSystem(s.dimension, false, task.ask) }, { role: 'user', content: task.ask }, { role: 'assistant', content: understandJson([], task.ask, [task.ask]) }] });
    }
    opts.onProgress?.(examples.length, tried);
  }
  return { examples, tried };
}

// ── whole games ─────────────────────────────────────────────────────────────

/** The Think step's request, word for word (see runAgent). */
const THINK_ASK = '\n\nThink about how to make this well in this engine: in a few short lines, what it needs and in what order. Plain words.';

/** Back to the starting scene: only what a new project has, no scripts made since. */
/** How the open project's scene settings were before any example changed them. */
let start: { engine: object; settings: SceneSettings } | null = null;
function resetScene(keepAssets: Set<string>): void {
  for (const e of [...world().all()]) if (!e.parent && !['Main Camera', 'Sun', 'Sky Light', 'Ground'].includes(e.name)) world().destroyEntity(e);
  for (const a of useLibrary.getState().assets) if (!keepAssets.has(a.id)) void removeAsset(a.id);
  // Background, exposure, darkness… back to how the project started.
  const engine = state().engine!;
  if (start?.engine !== engine) start = { engine, settings: structuredClone(engine.settings) };
  if (JSON.stringify(engine.settings) !== JSON.stringify(start.settings)) {
    // Settings added since (like darkness2D) go back to unset.
    const added = Object.fromEntries(Object.keys(engine.settings).filter((k) => !(k in start!.settings)).map((k) => [k, undefined]));
    editSceneSettings({ ...added, ...structuredClone(start.settings) }, 'Reset');
  }
  state().history?.clear();
}

/**
 * Whole games, `count` of them, in the open project (a fresh, empty one): the request (or a
 * vague one, the questions and the answers), the plan, the Think notes, and every part built in
 * order, each seeing the scene the parts before it made. A game is kept only if every step of
 * every part works; `failed` says which steps didn't, to fix the designer.
 */
export async function generateGames(count: number, opts: { seed?: number; onProgress?: (made: number, tried: number) => void } = {}): Promise<{ examples: Example[]; tried: number; failed: Record<string, number> }> {
  seed = opts.seed ?? 1;
  const s = state();
  if (!s.engine || !s.history) throw new Error('Open a project first.');
  start = { engine: s.engine, settings: structuredClone(s.engine.settings) };
  for (const code of SAMPLE_SCRIPTS) compileScript(code, 'check');
  const dim = s.dimension;
  const flat = dim === '2d';
  const keep = new Set(useLibrary.getState().assets.map((a) => a.id));
  const examples: Example[] = [];
  const failed: Record<string, number> = {};
  let tried = 0;
  for (let n = 0; n < count; n++) {
    tried++;
    resetScene(keep);
    const g = designGame(rng, flat);
    const ask = g.vague ? `${g.vague.ask}\nAnswers: ${g.vague.answers}` : g.ask;
    const plan = understandJson([], g.summary, g.parts.map((p) => p.text));
    const made: Example[] = [];
    if (g.vague) made.push({ kind: 'questions', messages: [{ role: 'system', content: understandSystem(dim, false, g.vague.ask) }, { role: 'user', content: g.vague.ask }, { role: 'assistant', content: understandJson(g.vague.questions, '', []) }] });
    made.push({ kind: 'plan-game', messages: [{ role: 'system', content: understandSystem(dim, !!g.vague, ask) }, { role: 'user', content: ask }, { role: 'assistant', content: plan }] });
    if (chance(0.4)) {
      made.push({ kind: 'notes', messages: [{ role: 'system', content: understandSystem(dim, true, ask) }, { role: 'user', content: ask + THINK_ASK }, { role: 'assistant', content: g.notes }] });
      made.push({ kind: 'plan-game', messages: [{ role: 'system', content: understandSystem(dim, !!g.vague, ask) }, { role: 'user', content: `${ask}\n\nYour notes:\n${g.notes}` }, { role: 'assistant', content: plan }] });
    }
    const parts: PartState[] = g.parts.map((p) => ({ text: p.text, status: 'waiting', steps: [] }));
    let ok = true;
    for (let i = 0; i < g.parts.length && ok; i++) {
      const part = g.parts[i];
      const system = partSystem(dim, part.text, g.summary);
      const user = partPrompt(g.summary, parts, i);
      const report = await runPlan({ reply: part.reply, steps: part.steps });
      if (report.skipped.length || report.done.length !== part.steps.length) {
        ok = false;
        for (const why of report.skipped) failed[`${g.kind}: ${why.replace(/\d+/g, '#')}`] = (failed[`${g.kind}: ${why.replace(/\d+/g, '#')}`] ?? 0) + 1;
        break;
      }
      made.push({ kind: g.kind, messages: [{ role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: planJson(part.reply, part.steps) }] });
      parts[i] = { ...parts[i], status: 'done', steps: part.steps };
    }
    if (ok) examples.push(...made);
    opts.onProgress?.(examples.length, tried);
  }
  resetScene(keep);
  return { examples, tried, failed };
}

/** Dev: build one whole game (of a kind, e.g. "maze") in the open project and leave it there, to look at. */
export async function previewGame(kind: string, opts: { seed?: number } = {}): Promise<{ ask: string; summary: string; parts: string[]; skipped: string[] }> {
  seed = opts.seed ?? 1;
  const flat = state().dimension === '2d';
  resetScene(new Set(useLibrary.getState().assets.map((a) => a.id)));
  let g = designGame(rng, flat);
  for (let i = 0; i < 500 && g.kind !== kind; i++) g = designGame(rng, flat);
  const skipped: string[] = [];
  for (const part of g.parts) skipped.push(...(await runPlan({ reply: part.reply, steps: part.steps })).skipped);
  // Frame it all from above at an angle.
  const built = [...world().all()].filter((e) => !e.parent && !['Main Camera', 'Sun', 'Sky Light', 'Ground'].includes(e.name) && (e.has('MeshRenderer') || e.has('Sprite') || e.has('Terrain')));
  state().selectMany(built.map((e) => e.id), built[0]?.id ?? null);
  state().engine?.camera.position.set(...((flat ? [0, 0, 60] : [30, 38, 42]) as [number, number, number]));
  await new Promise((r) => setTimeout(r, 50));
  viewportController()?.focusSelected();
  state().selectMany([], null);
  return { ask: g.ask, summary: g.summary, parts: g.parts.map((p) => p.text), skipped };
}

/** Dev: is the open project 2D or 3D (it settles just after a project opens). */
export const openDimension = () => state().dimension;
