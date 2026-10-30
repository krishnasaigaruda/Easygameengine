import { LOOK_PRESETS, READY_TRAITS, allComponentDefs } from '@ege/runtime';

/*
 * What the assistant may do, as data: the same things a person does in the editor (make, place,
 * move, turn, size, colour, rename, duplicate, group, delete, any component setting, traits,
 * scripts, Asset Store imports, project assets, scene settings, looks). Its answer is forced into
 * this shape (JSON schema, constrained decoding), so it is always valid and can only ask for
 * editor actions: it never touches anything outside the project.
 */

/** Things it can make (each project type maps them to its own objects). */
export const THINGS = ['cube', 'sphere', 'plane', 'cylinder', 'capsule', 'cone', 'torus', 'player', 'coin', 'finish', 'light', 'sun', 'camera', 'text', 'empty', 'sprite', 'platform', 'background', 'tilemap', 'water', 'terrain', 'plants', 'grass', 'sky', 'fog', 'effect'] as const;
export type Thing = (typeof THINGS)[number];

export const STEP_KINDS = ['create', 'row', 'scatter', 'edit', 'set', 'add', 'remove', 'traits', 'delete', 'duplicate', 'parent', 'import', 'use', 'script', 'settings', 'look'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Asset Store shelves it can import from. */
export const SOURCES = ['models', 'materials', 'skies', 'sounds', 'music', 'images'] as const;

export interface Step {
  do: StepKind;
  what?: Thing;
  name?: string;
  /** The object it's about (edit, set, add, traits, delete…), by name. */
  object?: string;
  at?: number[];
  rotate?: number[];
  size?: number[];
  color?: string;
  traits?: string[];
  count?: number;
  step?: number[];
  /** scatter: spread copies over an area this wide and deep (m) around `at`. */
  area?: number[];
  look?: string;
  /** set / add / remove: a component (MeshRenderer, RigidBody…); set: its field and the new value. */
  component?: string;
  field?: string;
  value?: string;
  /** parent: the object it goes inside ("" = top level). */
  to?: string;
  /** import: Asset Store shelf and what to search for. */
  source?: (typeof SOURCES)[number];
  query?: string;
  /** use: a project asset by name. */
  asset?: string;
  /** script: EasyScript for the object. */
  code?: string;
}

export interface Plan {
  reply: string;
  steps: Step[];
}

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };

/** The JSON schema the model's answer must follow. */
export function planSchema(): object {
  const str = { type: 'string' };
  return {
    type: 'object',
    properties: {
      reply: str,
      steps: {
        type: 'array',
        maxItems: 24,
        items: {
          type: 'object',
          properties: {
            do: { type: 'string', enum: [...STEP_KINDS] },
            what: { type: 'string', enum: [...THINGS] },
            name: str,
            object: str,
            at: vec3,
            rotate: vec3,
            size: vec3,
            color: str,
            traits: { type: 'array', items: { type: 'string', enum: [...READY_TRAITS] } },
            count: { type: 'integer' },
            area: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            step: vec3,
            look: { type: 'string', enum: Object.keys(LOOK_PRESETS) },
            component: str,
            field: str,
            value: str,
            to: str,
            source: { type: 'string', enum: [...SOURCES] },
            query: str,
            asset: str,
            code: str,
          },
          required: ['do'],
        },
      },
    },
    required: ['reply', 'steps'],
  };
}

/** What's in the scene, briefly (so it can refer to things by name). */
export interface SceneObject {
  name: string;
  kind: string;
  at: number[];
  /** Scale, when it isn't 1, 1, 1. */
  size?: number[];
  parent?: string;
}

/** Components and their settings, one short line (generated, so it's always up to date). */
function componentList(): string {
  return allComponentDefs()
    .filter((d) => d.type !== 'Transform')
    .map((d) => d.type)
    .join(', ');
}

/** The instructions. Kept short: small models follow short prompts best. */
export function systemPrompt(dimension: '3d' | '2d', objects: SceneObject[], assets: string[], docs = ''): string {
  const flat = dimension === '2d';
  const things = flat
    ? 'sprite, platform, player, coin, finish, light, background, tilemap, camera, text, empty'
    : 'cube, sphere, plane, cylinder, capsule, cone, torus, player, coin, finish, light, sun, camera, text, empty, water, terrain, plants (trees, bushes, flowers, rocks... spread over the terrain; set Scatter.shape), grass (on the terrain), sky, fog, effect (fire, smoke, rain, snow, fireflies, sparkles, mist, falling leaves, steam, magic, embers, portal, explosion: the name says which)';
  const r1 = (v: number) => Math.round(v * 10) / 10;
  // A big scene: the first few objects (camera, ground, player…) and the newest ones, which the next part builds on.
  const shown = objects.length > 40 ? [...objects.slice(0, 10), ...objects.slice(-30)] : objects;
  const line = (o: SceneObject) => `${o.name} (${o.kind}) at [${o.at.map(r1).join(', ')}]${o.size ? ` size [${o.size.map(r1).join(', ')}]` : ''}${o.parent ? ` in ${o.parent}` : ''}`;
  const lines = shown.map(line);
  if (objects.length > 40) lines.splice(10, 0, `(${objects.length - 40} more)`);
  const scene = lines.length ? lines.join('; ') : 'nothing yet';
  return [
    `You build ${flat ? '2D' : '3D'} games in Easy Game Engine, inside its editor. Answer only with JSON: {"reply": one short friendly sentence, "steps": [...]}.`,
    'Steps (in order):',
    `- create: add a thing. what: ${things}. Optional: name, at [x,y,z], rotate [x,y,z] degrees, size [x,y,z] (1 = normal), color "#rrggbb", traits.`,
    '- row: like create, count copies, each moved by step [dx,dy,dz] from at.',
    '- scatter: like create, count copies spread at random over area [width, depth] around at (they stand on the ground).',
    '- edit: object (by name): at, rotate, size, color, name (renames).',
    '- set: object, component, field, value (text: "5", "true", "1,2,3", "#ff0000", or an asset name).',
    '- add / remove: object, component.',
    '- traits: object, traits.  - delete: object.  - duplicate: object, count, step.',
    '- parent: object goes inside to ("" = top level).',
    `- import: from the Asset Store: source (${flat ? 'images, sounds, music' : SOURCES.join(', ')}), query, optional at and name.`,
    '- use: put the project asset (asset) on object (material, picture, model, sound, script).',
    '- script: object, code (EasyScript, e.g. { on: { touch: [ { if: "other.is(\'player\')" }, { say: "Hi!" } ] } }).',
    '- settings: field (background, exposure' + (flat ? ', darkness2D, pixelsPerUnit, pixelPerfect' : '') + '), value.',
    `- look: ${Object.keys(LOOK_PRESETS).join(', ')}.`,
    'Traits: solid (stand on it), collectible (+1 score, then gone), kill-zone (back to start), checkpoint, jump-pad, moving-platform, spinning, floating, bouncy, damaging, healing, enemy, patrolling, door, npc, climbable, water.',
    `Components: ${componentList()}.`,
    docs ? `How things work (from the engine's docs):\n${docs}` : '',
    flat
      ? 'World: x right, y up, z always 0; ground y = 0. A platform is about [4, 0.5, 1]; gaps 2-3 m; jumps up to 2 m.'
      : 'World: meters, y up, ground y = 0. An obby platform is a cube about [3, 0.5, 3]; gaps 2-3 m; rise about 1 m each.',
    'A player, coins and a finish work by themselves (player walks, coins add score, finish says you win).',
    `The scene: ${scene}.`,
    assets.length ? `Project assets: ${assets.slice(0, 30).join(', ')}.` : 'No project assets yet.',
    'Only use objects and assets that exist. Things are placed on the ground by themselves when no height is given. If you cannot do something, say so in reply with no steps.',
    flat
      ? 'Example: "add 3 coins" -> {"reply":"Added 3 coins.","steps":[{"do":"row","what":"coin","name":"Coin","count":3,"at":[2,2,0],"step":[2,0,0]}]}'
      : 'Example: "add 3 coins" -> {"reply":"Added 3 coins.","steps":[{"do":"row","what":"coin","name":"Coin","count":3,"at":[0,1,4],"step":[2,0,0]}]}',
  ].join('\n');
}

/** Does a step have what it needs? (Small models sometimes leave the important part out.) */
export function isComplete(s: Step): boolean {
  const has = (v: unknown) => typeof v === 'string' ? v.trim().length > 0 : v !== undefined && v !== null;
  switch (s.do) {
    case 'create':
    case 'row':
    case 'scatter':
      return has(s.what);
    case 'set':
      return has(s.object) && has(s.component) && has(s.field) && has(s.value);
    case 'add':
    case 'remove':
      return has(s.object) && has(s.component);
    case 'traits':
      return has(s.object) && !!s.traits?.length;
    case 'edit':
      return has(s.object) && (has(s.at) || has(s.rotate) || has(s.size) || has(s.color) || has(s.name));
    case 'delete':
    case 'duplicate':
    case 'parent':
      return has(s.object);
    case 'script':
      return has(s.object) && has(s.code);
    case 'import':
      return has(s.query);
    case 'use':
      return has(s.asset);
    case 'settings':
      return has(s.field) && has(s.value);
    case 'look':
      return has(s.look);
  }
}

/** Read the model's answer; anything malformed becomes a plain reply with no steps. */
export function parsePlan(text: string): Plan {
  try {
    const start = text.indexOf('{');
    const json = JSON.parse(text.slice(start)) as Partial<Plan>;
    return {
      reply: typeof json.reply === 'string' ? json.reply : '',
      steps: Array.isArray(json.steps) ? json.steps.filter((s) => s && typeof s === 'object' && STEP_KINDS.includes(s.do) && isComplete(s)) : [],
    };
  } catch {
    return { reply: text.trim().slice(0, 400), steps: [] };
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A step in words, for showing what it's about to do / did. */
export function describeStep(s: Step): string {
  const n = s.name ? ` "${s.name}"` : '';
  const o = `"${s.object ?? '?'}"`;
  switch (s.do) {
    case 'create':
      return `Add ${s.what ?? 'object'}${n}${s.at ? ` at ${s.at.map(r1).join(', ')}` : ''}`;
    case 'row':
      return `Add ${Math.max(1, Math.min(30, s.count ?? 1))} × ${s.what ?? 'object'}${n}`;
    case 'scatter':
      return `Spread ${Math.max(1, Math.min(60, s.count ?? 1))} × ${s.what ?? 'object'}${n}`;
    case 'edit':
      return `Change ${o}${s.name ? ` (rename to "${s.name}")` : ''}`;
    case 'set':
      return `Set ${o} ${s.component ?? '?'}.${s.field ?? '?'} to ${s.value ?? '?'}`;
    case 'add':
      return `Add ${s.component ?? '?'} to ${o}`;
    case 'remove':
      return `Remove ${s.component ?? '?'} from ${o}`;
    case 'traits':
      return `Give ${o} ${(s.traits ?? []).join(', ') || 'traits'}`;
    case 'delete':
      return `Delete ${o}`;
    case 'duplicate':
      return `Duplicate ${o}${s.count && s.count > 1 ? ` ${s.count} times` : ''}`;
    case 'parent':
      return s.to ? `Put ${o} inside "${s.to}"` : `Move ${o} to the top level`;
    case 'import':
      return `Import "${s.query ?? ''}" from the Asset Store (${s.source ?? 'models'})`;
    case 'use':
      return `Use "${s.asset ?? '?'}"${s.object ? ` on ${o}` : ''}`;
    case 'script':
      return `Write a script for ${o}`;
    case 'settings':
      return `Scene setting ${s.field ?? '?'} = ${s.value ?? '?'}`;
    case 'look':
      return `Make it look ${s.look ?? ''}`;
  }
}
