import { Camera, FollowCamera, LOOK_PRESETS, PARTICLE_PRESETS, PRESET_LOOK, PostProcessing, READY_TRAITS, Sprite, TERRAIN_PRESETS, Terrain, Traits, Transform, allComponentDefs, compileScript, encodeHeights, generateHeightmap, getComponentDef, type Entity, type FieldSpec, type Vec3 } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { addComponent, createObject, deleteEntity, duplicate, editComponent, removeComponent, rename, reparent, type CreatePreset } from '../editor/actions';
import { activateAsset, createWater, editSceneSettings } from '../editor/assetActions';
import { createScript, useLibrary } from '../assets/library';
import { loadAmbientCG, loadObjaverse, loadPolyHaven, loadSmithsonian, searchItems, type StoreItem } from '../store/catalog';
import { addStoreItem } from '../store/downloader';
import { searchOpenverse } from '../store/openverse';
import { searchCommons } from '../store/commons';
import { describeStep, type Plan, type SceneObject, type Step, type Thing } from './plan';
import { swapInRealModels, swapInRealPlants } from './realModels';

/*
 * Carries out the assistant's steps through the same editor actions a person uses, so everything
 * shows in the Hierarchy and the Inspector, and the whole request is one undo step. It can only
 * reach the project: no files, no pages, nothing outside the editor.
 */

const state = () => useEditor.getState();

/** At most this many new objects per request (a runaway "row" can't flood the scene). */
const MAX_NEW = 60;

/** What each thing is in a 3D / 2D project: a Create preset plus a starting look. */
interface Recipe {
  preset: CreatePreset;
  size?: Vec3;
  color?: string;
  traits?: string[];
  y?: number;
}
const THING_RECIPES_3D: Record<Thing, Recipe> = {
  cube: { preset: 'cube', traits: ['solid'] },
  sphere: { preset: 'sphere' },
  plane: { preset: 'plane' },
  cylinder: { preset: 'cylinder' },
  capsule: { preset: 'capsule' },
  cone: { preset: 'cone' },
  torus: { preset: 'torus' },
  player: { preset: 'capsule', color: '#e0703a', traits: ['player'] },
  coin: { preset: 'cylinder', size: [0.6, 0.08, 0.6], color: '#f2c23a', traits: ['collectible', 'spinning'], y: 1 },
  finish: { preset: 'cylinder', size: [1.5, 0.2, 1.5], color: '#4fd16a' },
  light: { preset: 'pointLight', y: 3 },
  sun: { preset: 'sun' },
  camera: { preset: 'camera' },
  text: { preset: 'uiText' },
  empty: { preset: 'empty' },
  sprite: { preset: 'cube' },
  platform: { preset: 'cube', size: [3, 0.5, 3], traits: ['solid'] },
  background: { preset: 'plane' },
  tilemap: { preset: 'cube' },
  water: { preset: 'cube' },
  terrain: { preset: 'terrain' },
  plants: { preset: 'scatter' },
  grass: { preset: 'empty' },
  sky: { preset: 'sky' },
  fog: { preset: 'fog' },
  effect: { preset: 'empty', y: 1 },
};
const THING_RECIPES_2D: Record<Thing, Recipe> = {
  ...THING_RECIPES_3D,
  cube: { preset: 'sprite', traits: ['solid'] },
  sphere: { preset: 'circle2d' },
  plane: { preset: 'platform2d' },
  cylinder: { preset: 'sprite' },
  capsule: { preset: 'sprite' },
  cone: { preset: 'sprite' },
  torus: { preset: 'circle2d' },
  player: { preset: 'player2d' },
  coin: { preset: 'circle2d', size: [0.6, 0.6, 1], color: '#f2c23a', traits: ['collectible'] },
  finish: { preset: 'sprite', size: [1, 2, 1], color: '#4fd16a' },
  light: { preset: 'light2d' },
  sun: { preset: 'light2d' },
  sprite: { preset: 'sprite' },
  platform: { preset: 'platform2d' },
  background: { preset: 'background2d' },
  tilemap: { preset: 'tilemap' },
  water: { preset: 'sprite', color: '#3f8fb0', traits: ['water'] },
  terrain: { preset: 'platform2d' },
  plants: { preset: 'sprite', color: '#4f8f3a' },
  grass: { preset: 'sprite', color: '#5fae3c' },
  sky: { preset: 'background2d' },
  fog: { preset: 'background2d' },
};

/** Words in a name that say which plant it is ("Pine trees" → pine tree). */
const PLANT_WORDS: [RegExp, string][] = [
  [/pine|fir|spruce|conifer/i, 'pine tree'],
  [/tree|oak|forest|wood/i, 'round tree'],
  [/bush|shrub|hedge/i, 'bush'],
  [/fern/i, 'fern'],
  [/flower|meadow|lupin|daisy|poppy/i, 'flowers'],
  [/rock|stone|boulder/i, 'rock'],
  [/pebble|gravel/i, 'pebbles'],
  [/leaves|leaf/i, 'fallen leaves'],
  [/grass|clump|reed/i, 'grass clump'],
];

/** Words in a name that say which effect it is ("Campfire smoke" → smoke). */
const EFFECT_WORDS: [RegExp, string][] = [
  [/firefl|glow ?worm/i, 'Fireflies'],
  [/smoke|chimney/i, 'Smoke'],
  [/ember/i, 'Embers'],
  [/fire|flame|torch|burn/i, 'Fire'],
  [/rain|storm|drizzle/i, 'Rain'],
  [/snow|blizzard/i, 'Snow'],
  [/leaves|leaf|autumn/i, 'Falling Leaves'],
  [/waterfall|spray|splash|mist/i, 'Waterfall Mist'],
  [/steam|geyser|vapou?r/i, 'Steam'],
  [/portal/i, 'Portal'],
  [/heal|aura/i, 'Healing Aura'],
  [/confetti|celebrat|party/i, 'Confetti'],
  [/explo|boom|blast/i, 'Explosion'],
  [/magic|spell|wizard/i, 'Magic'],
  [/dust|sand/i, 'Dust'],
  [/spark|glitter|twinkl|star/i, 'Sparkles'],
];
/** Effects that fill the air (rain, snow…) start high up, over everything. */
const SKY_EFFECTS = new Set(['Rain', 'Snow', 'Falling Leaves']);

const firstWith = (type: string) => [...(state().engine?.world.all() ?? [])].find((e) => e.has(type));

/** What's in the scene, for the prompt. */
export function sceneObjects(): SceneObject[] {
  const engine = state().engine;
  if (!engine) return [];
  const out: SceneObject[] = [];
  for (const e of engine.world.all()) {
    const t = e.get(Transform);
    if (!t) continue;
    const kind = e.componentTypes().filter((c) => c !== 'Transform')[0] ?? 'empty';
    const size = t.scale.some((v) => Math.abs(v - 1) > 1e-3) ? t.scale : undefined;
    out.push({ name: e.name, kind, at: t.position, size, parent: e.parent?.name });
  }
  return out;
}

/** Project assets by name, for the prompt. */
export function projectAssets(): string[] {
  return useLibrary
    .getState()
    .assets.filter((a) => a.type !== 'data')
    .map((a) => `${a.name} (${a.type})`);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, min: number, max: number): Vec3 | undefined =>
  Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(finite) ? (v.slice(0, 3).map((n: number) => Math.max(min, Math.min(max, n))) as Vec3) : undefined;
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : undefined);

function find(name: string | undefined): Entity | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  const all = [...(state().engine?.world.all() ?? [])];
  return all.find((e) => e.name.toLowerCase() === n) ?? all.find((e) => e.name.toLowerCase().startsWith(n));
}
function need(name: string | undefined): Entity {
  const e = find(name);
  if (!e) throw new Error(`there is no "${name ?? ''}"`);
  return e;
}
function findAsset(name: string | undefined, types?: string[]) {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  const all = useLibrary.getState().assets.filter((a) => !types || types.includes(a.type));
  return all.find((a) => a.name.toLowerCase() === n) ?? all.find((a) => a.name.toLowerCase().includes(n));
}

/** "You win!" when the player touches it (one script for every finish). */
async function finishScript(): Promise<string | null> {
  const existing = useLibrary.getState().assets.find((a) => a.type === 'script' && a.name === 'Finish');
  if (existing) return existing.id;
  return createScript('Finish', `{\n  on: {\n    touch: [\n      { if: "other.is('player')" },\n      { say: "You win!", time: 4 }\n    ]\n  }\n}\n`);
}

function place(e: Entity, step: Pick<Step, 'at' | 'rotate' | 'size' | 'color'>, flat: boolean): void {
  const at = vec(step.at, -500, 500);
  const rot = vec(step.rotate, -360, 360);
  const size = vec(step.size, 0.01, 200);
  // Stand on the ground: things put below it (or "anywhere", y = -500) are lifted onto it. The
  // ground is the terrain there (hills are taller than a guess at y), or y = 0 without one, where
  // deliberate pits (more than 2 m down) stay. Water keeps its level.
  if (at && !flat && !e.has(Terrain.type) && !e.has('Water') && (e.has('MeshRenderer') || e.has('ModelRenderer'))) {
    const t = firstWith(Terrain.type);
    const ground = (t ? state().engine?.terrain.heightAt(t, at[0], at[2]) : null) ?? 0;
    const half = e.has('MeshRenderer') ? (size ?? e.require(Transform).scale)[1] / 2 : 0;
    if (at[1] <= -499 || (at[1] - half < ground && (t || at[1] > ground - 2))) at[1] = ground + half;
  }
  if (at || rot || size) {
    editComponent(
      e,
      Transform.type,
      {
        ...(at ? { position: flat ? ([at[0], at[1], 0] as Vec3) : at } : {}),
        ...(rot ? { rotation: flat ? ([0, 0, rot[2] || rot[0]] as Vec3) : rot } : {}),
        ...(size ? { scale: flat ? ([size[0], size[1], 1] as Vec3) : size } : {}),
      },
      'AI: place',
    );
  }
  const c = color(step.color);
  if (c) {
    if (e.has(Sprite)) editComponent(e, Sprite.type, e.get(Sprite)?.image ? { tint: c } : { color: c }, 'AI: color');
    else if (e.has('MeshRenderer')) editComponent(e, 'MeshRenderer', { color: c }, 'AI: color');
    else if (e.has('Light')) editComponent(e, 'Light', { color: c }, 'AI: color');
    else if (e.has('Light2D')) editComponent(e, 'Light2D', { color: c }, 'AI: color');
  }
}

function addTraits(e: Entity, traits: string[] | undefined): void {
  const valid = (traits ?? []).filter((t) => READY_TRAITS.includes(t));
  if (!valid.length) return;
  if (!e.has(Traits)) addComponent(e, Traits.type);
  const have = e.get(Traits)?.traits ?? [];
  editComponent(e, Traits.type, { traits: [...new Set([...have, ...valid])] }, 'AI: traits');
}

/** The main camera follows the player (third person in 3D, from the side in 2D). */
function followPlayer(flat: boolean): void {
  const engine = state().engine;
  const cam = engine ? [...engine.world.query(Camera)].find((c) => (c.get(Camera) as { primary?: boolean }).primary) : undefined;
  if (!cam || cam.has(FollowCamera)) return;
  addComponent(cam, FollowCamera.type);
  editComponent(cam, FollowCamera.type, flat ? { mode: 'side-view', target: '', pitch: 0, distance: 20, height: 1, lockMouse: false, avoidWalls: false } : { mode: 'third-person', target: '' }, 'AI: camera');
}

const newest = (before: Set<string>) => [...(state().engine?.world.all() ?? [])].filter((e) => !before.has(e.id) && !e.parent);
const ids = () => new Set([...(state().engine?.world.all() ?? [])].map((e) => e.id));

async function make(what: Thing, step: Step, flat: boolean, at?: number[]): Promise<Entity | undefined> {
  const recipe = (flat ? THING_RECIPES_2D : THING_RECIPES_3D)[what];
  if (!recipe) return undefined;
  // One player: asking for another moves the one there is.
  if (what === 'player') {
    const existing = [...(state().engine?.world.all() ?? [])].find((e) => e.get(Traits)?.traits.includes('player'));
    if (existing) {
      place(existing, { at: at ?? step.at }, flat);
      return existing;
    }
  }
  let e: Entity | undefined;
  if (!flat && what === 'grass') {
    // Grass grows on the terrain (one grass for the whole landscape).
    const t = firstWith(Terrain.type);
    if (!t) throw new Error('grass needs a terrain to grow on: create a terrain first');
    if (!t.has('Grass')) addComponent(t, 'Grass');
    // All over the land: "only where painted" with nothing painted grows none at all.
    const g = t.get('Grass') as { painted?: boolean; paintMap?: string } | undefined;
    if (g?.painted && !g.paintMap) editComponent(t, 'Grass', { painted: false }, 'AI: grass');
    return t;
  }
  if (!flat && (what === 'sky' || what === 'fog')) {
    const there = firstWith(what === 'sky' ? 'Sky' : 'Fog');
    if (there) return there;
  }
  if (!flat && what === 'plants') {
    // Spread over the terrain (or the area around them without one).
    const t = firstWith(Terrain.type);
    const id = createObject('scatter', t?.id ?? null);
    e = id ? state().engine?.world.getById(id) : undefined;
    if (!e) return undefined;
    const name = `${step.name ?? ''} ${step.what}`;
    const shape = PLANT_WORDS.find(([re]) => re.test(name))?.[1];
    const count = Math.max(1, Math.min(20000, Math.round(step.count ?? 200)));
    // On a terrain: all over it. Without one: around `at`, over `area` (or 40 m).
    const spread = Array.isArray(step.area) && finite(step.area[0]) ? Math.max(2, Math.min(400, step.area[0])) : 40;
    editComponent(e, 'Scatter', { placement: 'random', area: t ? 0 : spread, count, keepClear: true, ...(shape ? { shape, solid: shape.includes('tree') || shape === 'rock' } : {}) }, 'AI: plants');
    if (step.name?.trim()) rename(e.id, step.name.trim().slice(0, 60));
    const spot = vec(at ?? step.at, -500, 500);
    if (t) editComponent(e, Transform.type, { position: [0, 0, 0] }, 'AI: place');
    else if (spot) editComponent(e, Transform.type, { position: [spot[0], 0, spot[2]] }, 'AI: place');
    return e;
  }
  if (what === 'water' && !flat) {
    const before = ids();
    await createWater();
    e = newest(before)[0];
  } else {
    const id = createObject(recipe.preset);
    e = id ? state().engine?.world.getById(id) : undefined;
  }
  if (!e) return undefined;
  if (step.name?.trim()) rename(e.id, step.name.trim().slice(0, 60));
  const spot = vec(at ?? step.at, -500, 500) ?? (e.require(Transform).position.slice() as Vec3);
  if (recipe.y !== undefined && !(at ?? step.at)) spot[1] = recipe.y;
  place(e, { at: what === 'terrain' || what === 'water' ? (at ?? step.at) : spot, rotate: step.rotate, size: step.size ?? recipe.size, color: step.color ?? recipe.color }, flat);
  addTraits(e, [...(recipe.traits ?? []), ...(step.traits ?? [])]);
  if (what === 'effect') {
    const name = `${step.name ?? ''} ${e.name}`;
    const preset = EFFECT_WORDS.find(([re]) => re.test(name))?.[1] ?? 'Sparkles';
    addComponent(e, 'ParticleSystem');
    editComponent(e, 'ParticleSystem', PARTICLE_PRESETS[preset], `AI: ${preset.toLowerCase()}`);
    if (SKY_EFFECTS.has(preset) && !(at ?? step.at))
      editComponent(e, Transform.type, { position: [0, 14, 0] }, 'AI: place');
  }
  if (what === 'player') followPlayer(flat);
  if (what === 'finish') {
    const script = await finishScript();
    if (script) {
      addComponent(e, 'Script');
      editComponent(e, 'Script', { script }, 'AI: finish');
      addTraits(e, ['trigger']);
    }
  }
  return e;
}

/** A component by its name, however it's written ("sky", "Sky", "particle system", "Mesh"). */
function componentNamed(name: string | undefined) {
  if (!name?.trim()) return undefined;
  const plainName = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = plainName(name);
  return getComponentDef(name.trim()) ?? allComponentDefs().find((d) => plainName(d.type) === n || plainName(d.label) === n);
}

/** The landscape's shape: set from the Terrain panel's buttons, not listed as fields. */
const TERRAIN_SHAPE: Record<string, FieldSpec> = {
  preset: { kind: 'enum', label: 'Landscape', options: TERRAIN_PRESETS.filter((p) => p !== 'image') },
  seed: { kind: 'number', label: 'Seed', min: 1, max: 99999, step: 1 },
  roughness: { kind: 'number', label: 'Roughness', min: 0, max: 1, step: 0.05 },
  features: { kind: 'number', label: 'Features', min: 1, max: 8, step: 1 },
};

/** A value written as text, read the way the field wants it. */
function readValue(spec: FieldSpec, text: string): unknown {
  const t = text.trim();
  switch (spec.kind) {
    case 'number': {
      const n = Number(t);
      if (!Number.isFinite(n)) throw new Error(`"${t}" is not a number`);
      return Math.max(spec.min ?? -1e6, Math.min(spec.max ?? 1e6, n));
    }
    case 'boolean':
      return /^(true|yes|on|1)$/i.test(t);
    case 'vec2':
    case 'vec3': {
      const parts = t.replace(/[[\]()]/g, '').split(/[\s,]+/).filter(Boolean).map(Number);
      const len = spec.kind === 'vec2' ? 2 : 3;
      if (parts.length < len || parts.slice(0, len).some((n) => !Number.isFinite(n))) throw new Error(`"${t}" needs ${len} numbers`);
      return parts.slice(0, len);
    }
    case 'color': {
      const c = color(t);
      if (!c) throw new Error(`"${t}" is not a colour like #ff8800`);
      return c;
    }
    case 'enum': {
      const o = spec.options.find((x) => x.toLowerCase() === t.toLowerCase());
      if (!o) throw new Error(`"${t}" is not one of ${spec.options.join(', ')}`);
      return o;
    }
    case 'asset': {
      if (!t) return '';
      const a = findAsset(t, [spec.assetType]);
      if (!a) throw new Error(`no ${spec.assetType} called "${t}" in the project`);
      return a.id;
    }
    default:
      return t;
  }
}

/** Search an Asset Store shelf; the best match. */
async function storeSearch(source: Step['source'], query: string, flat: boolean): Promise<StoreItem | undefined> {
  if (flat && (source === 'models' || source === 'materials' || source === 'skies')) throw new Error('a 2D project has no 3D models, materials or skies');
  switch (source) {
    case 'materials':
      return searchItems([...(await loadPolyHaven('material')), ...(await loadAmbientCG())], query)[0];
    case 'skies':
      return searchItems(await loadPolyHaven('hdri'), query)[0];
    case 'sounds':
      return (await searchOpenverse('sound', query)).items[0];
    case 'music':
      return (await searchOpenverse('music', query)).items[0];
    case 'images':
      return (await searchCommons(query)).items[0];
    default: {
      const [objaverse, smithsonian] = await Promise.all([loadObjaverse().then((c) => c.items), loadSmithsonian().catch(() => [] as StoreItem[])]);
      return searchItems([...objaverse, ...smithsonian], query)[0];
    }
  }
}

export interface RunReport {
  done: string[];
  skipped: string[];
}

/**
 * Run a plan, one step after another (a short pause between, so you can watch it build).
 * `stopped()` is checked between steps. All of it is one undo step. `realModels`: things it built
 * out of shapes (a "Dog", a "Cabin"), and the plants and grass it grew, then get matching Asset
 * Store models.
 */
export async function runPlan(plan: Plan, opts: { stopped?: () => boolean; onStep?: (i: number) => void; pause?: number; realModels?: boolean } = {}): Promise<RunReport> {
  const s = state();
  const report: RunReport = { done: [], skipped: [] };
  if (!s.engine || !s.history || s.playing) return report;
  const engine = s.engine;
  const flat = s.dimension === '2d';
  let made = 0;
  const existing = ids();
  s.history.beginGroup();
  try {
    for (let i = 0; i < plan.steps.length; i++) {
      if (opts.stopped?.()) break;
      const step = plan.steps[i];
      opts.onStep?.(i);
      const label = describeStep(step);
      try {
        switch (step.do) {
          case 'create': {
            if (!step.what) throw new Error('nothing to make');
            if (made >= MAX_NEW) throw new Error('too many new objects at once');
            if (!(await make(step.what, step, flat))) throw new Error(`can't make "${step.what}"`);
            made++;
            break;
          }
          case 'row': {
            if (!step.what) throw new Error('nothing to make');
            const count = Math.max(1, Math.min(30, Math.round(step.count ?? 1), MAX_NEW - made));
            const start = vec(step.at, -500, 500) ?? [0, 1, 0];
            const d = vec(step.step, -50, 50) ?? [2, 0, 0];
            for (let k = 0; k < count; k++) {
              const name = step.name ? (count > 1 ? `${step.name} ${k + 1}` : step.name) : undefined;
              await make(step.what, { ...step, name }, flat, [start[0] + d[0] * k, start[1] + d[1] * k, start[2] + d[2] * k]);
              made++;
            }
            break;
          }
          case 'scatter': {
            if (!step.what) throw new Error('nothing to spread');
            const count = Math.max(1, Math.min(60, Math.round(step.count ?? 10), MAX_NEW - made));
            const centre = vec(step.at, -500, 500) ?? [0, 0, 0];
            const area = Array.isArray(step.area) && step.area.length >= 2 && step.area.every(finite) ? step.area.map((v) => Math.max(1, Math.min(400, v))) : [20, 20];
            for (let k = 0; k < count; k++) {
              const x = centre[0] + (Math.random() - 0.5) * area[0];
              const z = flat ? 0 : centre[2] + (Math.random() - 0.5) * area[1];
              const y = flat ? centre[1] + (Math.random() - 0.5) * area[1] : -1000; // lifted onto the ground
              const name = step.name ? `${step.name} ${k + 1}` : undefined;
              await make(step.what, { ...step, name, rotate: step.rotate ?? [0, Math.random() * 360, 0] }, flat, [x, flat ? y : (step.at?.[1] ?? -1000), z]);
              made++;
            }
            break;
          }
          case 'edit': {
            const e = need(step.object);
            place(e, step, flat);
            if (step.name?.trim()) rename(e.id, step.name.trim().slice(0, 60));
            break;
          }
          case 'set': {
            const e = need(step.object);
            const def = componentNamed(step.component);
            if (!def) throw new Error(`no component "${step.component ?? ''}"`);
            const fields = def.type === Terrain.type ? { ...def.fields, ...TERRAIN_SHAPE } : def.fields;
            const key = Object.keys(fields).find((k) => k.toLowerCase() === (step.field ?? '').toLowerCase());
            const spec = key ? (fields as Record<string, FieldSpec | undefined>)[key] : undefined;
            if (!key || !spec) throw new Error(`${def.type} has no "${step.field ?? ''}"`);
            if (!e.has(def.type)) addComponent(e, def.type);
            const value = readValue(spec, step.value ?? '');
            if (def.type === Terrain.type && ['preset', 'seed', 'roughness', 'features', 'resolution'].includes(key)) {
              // A new landscape shape: build its heights the way the Terrain panel does.
              const d = { ...e.require(Terrain), [key]: value } as ReturnType<typeof Terrain.defaults>;
              const heights = d.preset === 'flat' ? '' : encodeHeights(generateHeightmap(Math.round(d.resolution), { preset: d.preset, seed: d.seed, roughness: d.roughness, scale: d.features }));
              editComponent(e, Terrain.type, { [key]: value, ...(key === 'preset' ? PRESET_LOOK[d.preset] : {}), heights }, 'AI: landscape');
            } else editComponent(e, def.type, { [key]: value }, `AI: ${def.label}`);
            break;
          }
          case 'add': {
            const e = need(step.object);
            const def = componentNamed(step.component);
            if (!def) throw new Error(`no component "${step.component ?? ''}"`);
            if (!e.has(def.type)) addComponent(e, def.type);
            break;
          }
          case 'remove': {
            const e = need(step.object);
            const def = componentNamed(step.component);
            if (!def || !e.has(def.type)) throw new Error(`"${e.name}" has no ${step.component ?? ''}`);
            removeComponent(e, def.type);
            break;
          }
          case 'traits':
            addTraits(need(step.object), step.traits);
            break;
          case 'delete':
            deleteEntity(need(step.object).id);
            break;
          case 'duplicate': {
            const e = need(step.object);
            const count = Math.max(1, Math.min(30, Math.round(step.count ?? 1), MAX_NEW - made));
            const d = vec(step.step, -50, 50);
            const from = e.require(Transform).position;
            for (let k = 1; k <= count; k++) {
              const id = duplicate(e.id);
              const copy = id ? engine.world.getById(id) : undefined;
              if (copy && d) place(copy, { at: [from[0] + d[0] * k, from[1] + d[1] * k, from[2] + d[2] * k] }, flat);
              made++;
            }
            break;
          }
          case 'parent': {
            const e = need(step.object);
            const to = step.to?.trim() ? need(step.to) : null;
            if (!reparent(e.id, to?.id ?? null)) throw new Error("can't put it there");
            break;
          }
          case 'import': {
            const query = (step.query ?? '').trim();
            if (!query) throw new Error('nothing to search for');
            const item = await storeSearch(step.source ?? 'models', query, flat);
            if (!item) throw new Error(`nothing found for "${query}"`);
            const before = ids();
            await addStoreItem(item);
            const placed = newest(before)[0];
            if (placed) {
              if (step.name?.trim()) rename(placed.id, step.name.trim().slice(0, 60));
              place(placed, step, flat);
            }
            break;
          }
          case 'use': {
            const a = findAsset(step.asset);
            if (!a) throw new Error(`no asset "${step.asset ?? ''}" in the project`);
            const target = step.object ? need(step.object) : null;
            if (a.type === 'script' && target) {
              addComponent(target, 'Script');
              editComponent(target, 'Script', { script: a.id }, 'AI: script');
              break;
            }
            state().select(target?.id ?? null);
            const before = ids();
            await activateAsset(a.id);
            const placed = newest(before)[0];
            if (placed && (step.at || step.name)) {
              if (step.name?.trim()) rename(placed.id, step.name.trim().slice(0, 60));
              place(placed, step, flat);
            }
            break;
          }
          case 'script': {
            const e = need(step.object);
            const code = (step.code ?? '').trim();
            if (!code) throw new Error('no code');
            try {
              compileScript(code, e.name);
            } catch (err) {
              throw new Error(`the script has a mistake: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
            }
            const id = await createScript(`${e.name} script`, code);
            if (!id) throw new Error("couldn't save the script");
            if (!e.has('Script')) addComponent(e, 'Script');
            editComponent(e, 'Script', { script: id }, 'AI: script');
            break;
          }
          case 'settings': {
            const field = (step.field ?? '').trim();
            const text = (step.value ?? '').trim();
            const specs: Record<string, FieldSpec> = {
              background: { kind: 'color' },
              exposure: { kind: 'number', min: 0.1, max: 4 },
              darkness2D: { kind: 'number', min: 0, max: 1 },
              pixelsPerUnit: { kind: 'number', min: 1, max: 512 },
              pixelPerfect: { kind: 'boolean' },
              touchControls: { kind: 'boolean' },
            };
            const key = Object.keys(specs).find((k) => k.toLowerCase() === field.toLowerCase());
            if (!key) throw new Error(`no scene setting "${field}"`);
            editSceneSettings({ [key]: readValue(specs[key], text) }, `AI: ${key}`);
            break;
          }
          case 'look': {
            const look = step.look && LOOK_PRESETS[step.look];
            if (!look) throw new Error('unknown look');
            let pp = [...engine.world.all()].find((e) => e.has(PostProcessing));
            if (!pp) {
              const id = createObject('postProcessing');
              pp = id ? engine.world.getById(id) : undefined;
            }
            if (!pp) throw new Error('no post processing');
            editComponent(pp, PostProcessing.type, look, `Look: ${step.look}`);
            break;
          }
        }
        report.done.push(label);
      } catch (err) {
        report.skipped.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (opts.pause) await new Promise((r) => setTimeout(r, opts.pause));
    }
    if (opts.realModels && !flat && !opts.stopped?.()) {
      const fresh = new Set([...ids()].filter((id) => !existing.has(id)));
      try {
        // The grass it grew (grass lives on the terrain, which may be older).
        const grew = plan.steps.some((st) => st.do === 'create' && st.what === 'grass');
        const terrain = grew ? firstWith(Terrain.type) : undefined;
        const swapped = [
          ...(await swapInRealModels(fresh, opts.stopped)),
          ...(await swapInRealPlants(fresh, new Set(terrain ? [terrain.id] : []), opts.stopped)),
        ];
        report.done.push(...swapped);
        for (const line of swapped) s.log('info', `AI: ${line} from the Asset Store`);
      } catch (err) {
        s.log('warn', `AI: couldn't get real models (${err instanceof Error ? err.message : String(err)}); the shapes stay.`);
      }
    }
    // Plants keep clear of what was built among them (a house in the forest).
    engine.scatter.refresh();
  } finally {
    s.history.endGroup('AI assistant');
  }
  return report;
}
