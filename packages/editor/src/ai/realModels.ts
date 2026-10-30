import { THREE, Traits, type Entity } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { addComponent, createObject, deleteEntity, editComponent, removeComponent, rename } from '../editor/actions';
import { loadObjaverse, scoreQuery, type StoreItem } from '../store/catalog';
import { addStoreItem } from '../store/downloader';
import { deleteAssetSafely } from '../editor/assetActions';
import { useLibrary } from '../assets/library';

/*
 * Real models for things the assistant built out of shapes: a "Dog" capsule, a "Cabin" box with
 * a "Cabin Roof" cone. Each such thing gets a matching Asset Store model, fitted to the space its
 * shapes took. The object itself stays (its scripts, traits and name), only its look changes; the
 * extra shapes it was made of go. Game pieces (platforms, coins, walls, lava…) keep their shapes.
 */

const state = () => useEditor.getState();

/** Words that name parts of a thing ("Cabin Roof" is part of the Cabin). */
const PIECES = new Set(
  'roof door window windows chimney trunk leaves leaf top crown canopy legs leg head body tail ear ears eye eyes nose snout paw paws wheel wheels seat back arm arms handle frame porch pole blade blades sail mast hull deck cab base walls'.split(
    ' ',
  ),
);

/** Game pieces and building blocks: never swapped for a model. */
const KEEP = new Set(
  'ground floor platform platforms wall block ramp path road finish start goal coin coins checkpoint lava water pad spawn pillar column beam cube sphere cylinder capsule cone plane torus ball target button plate trigger zone border edge marker obstacle spinner bar tile step steps stair stairs ledge level arena maze part piece kill brick jump lift elevator track lane line barrier player hero box shape island sky sun light camera text sign floor ceiling room corridor hall tunnel slope hill hills mountain mountains terrain meadow field fields lawn grass yard park land landscape scenery valley lake river pond sea ocean beach sand dirt mud snow ice desert area'.split(
    ' ',
  ),
);

/** Traits of game pieces (a model would hide what they do). */
const GAME_TRAITS = new Set([
  'collectible',
  'deadly',
  'kill-zone',
  'jump-pad',
  'checkpoint',
  'moving-platform',
  'disappearing',
  'trigger',
  'water',
  'swimmable',
  'climbable',
  'bouncy',
  'slippery',
  'damaging',
  'healing',
]);

/** Biggest model it downloads for this (bigger ones are usually film-quality scans). */
const MAX_BYTES = 25e6;
/** More copies of one thing than this keep their shapes (a real model each would be heavy). */
const MAX_COPIES = 12;
/** At most this many different models per part (each is a download). */
const MAX_MODELS = 6;

/**
 * Built-in plants (a Scatter's shape) → a real model of that plant: one picked by hand (it looks
 * right), else what to search for; how tall each copy stands (m); and the most triangles one may
 * have (there are hundreds of copies).
 */
interface Plant {
  pick?: string;
  query: string;
  height: number;
  triangles: number;
  not?: RegExp;
}
const PLANTS: Record<string, Plant> = {
  'pine tree': { pick: 'e52769d653cd4e52a4acff3041961e65', query: 'pine tree', height: 8, triangles: 8000 },
  'round tree': { pick: '3dc59560f2d24345bdbe65c44636453b', query: 'tree', height: 7, triangles: 8000, not: /pine|fir|spruce|palm|christmas|dead|stump|house|proto/i },
  bush: { pick: 'a83fd7049a784ca6bc0095e7323451d0', query: 'bush', height: 1.2, triangles: 3000 },
  fern: { pick: '34fffcb1f90d4bb2a3bd362f38abbe80', query: 'fern', height: 0.8, triangles: 2000 },
  flowers: { pick: '857802babfd542e094e8ef2c396be360', query: 'flower', height: 0.45, triangles: 1500 },
  rock: { pick: '94d7312ca455402ab370fc7f35372324', query: 'rock', height: 1.2, triangles: 3000 },
  'grass clump': { pick: 'c7b3cadd101245d899ca49fa587b2745', query: 'grass', height: 0.5, triangles: 600 },
};
/** Palms are round trees by shape: their name says which. */
const PALM: Plant = { pick: '557ea8d4527f47e8bbc657e2764b7cab', query: 'palm tree', height: 8, triangles: 8000 };
/** A grass model grows thousands of clumps: it has to be very light. */
const GRASS: Plant = { pick: 'c7b3cadd101245d899ca49fa587b2745', query: 'grass', height: 0.5, triangles: 300 };
/** Not one plant: packs, whole scenes, flat textures. */
const NOT_ONE_PLANT =
  /\b(pack|packs|set|collection|kit|texture|textures|material|pbr|scene|diorama|island|terrain|landscape|forest|garden|scan|scanned|photogrammetry|bonsai|pot|potted|proto|vase|leaf|leaves|branch|test|linen|fabric|cloth|pattern|painting|card|logo|ring|necklace|jewel)\b/i;
/** Triangles one group of real plants may draw in all (the forest, the flowers…). */
const PLANT_TRIANGLES = 400_000;

async function trianglesOf(modelId: string): Promise<number> {
  try {
    const { scene } = await state().engine!.assets.loadModel(modelId);
    let n = 0;
    scene.traverse((o) => {
      const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
      if (g) n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    return n;
  } catch {
    return 0;
  }
}

/** Plant models are small downloads (big ones are scans, too heavy for hundreds of copies). */
const MAX_PLANT_BYTES = 8e6;

/** "Cabin Roof 2" → "cabin roof" (lower case, letters only). */
const plain = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

/** Words that say where or how it is, not what ("Fence North", "Red Barn", "Big Rock"). */
const DESCRIBING = new Set(
  'north south east west northern southern eastern western left right front back rear middle center centre top bottom side inner outer near far upper lower big small large little tiny huge tall short long wide old new main first second third red orange yellow green blue purple pink white black brown grey gray golden dark light bright wooden wood metal stone'.split(
    ' ',
  ),
);

/** "Fence North" → "fence", "Crop A" → "crop": the words that say what it is. */
const whatWords = (name: string) =>
  plain(name)
    .split(' ')
    // Single letters are labels ("Crop A 3").
    .filter((w) => w.length > 1 && !DESCRIBING.has(w));

/** "Cabin Roof 2" → "cabin" (the thing it's part of); null for game pieces. */
export function thingOf(name: string): string | null {
  const words = whatWords(name);
  while (words.length > 1 && PIECES.has(words[words.length - 1])) words.pop();
  if (!words.length || words.some((w) => KEEP.has(w))) return null;
  return words.join(' ');
}

const isShape = (e: Entity) =>
  e.has('MeshRenderer') &&
  !e.has('ModelRenderer') &&
  !e.has('Sprite') &&
  !e.has('Terrain') &&
  !e.has('UIText');
const traitsOf = (e: Entity) => (e.get(Traits)?.traits ?? []) as string[];

/** Things the catalog knows by another name ("crops" are wheat; a "crop" there is a crop top). */
const ALSO_CALLED: Record<string, string> = { crop: 'wheat clump', crops: 'wheat clump', farmland: 'wheat clump', hay: 'hay bale' };
/** Clothes are only for clothes (a "dress" yes; "Crop A" no). */
const CLOTHES = /\b(shirt|dress|skirt|jacket|coat|hat|cap|shoe|shoes|boot|boots|clothes|outfit|scarf|glove|gloves|trousers|pants|hoodie)\b/;

/** Its name says it ("Cow", "Wooden Cow"), not only its tags ("Halloween!!" tagged dog). */
const named = (item: StoreItem, query: string) =>
  query.split(' ').every((w) => item.nameWords.some((n) => n === w || n === `${w}s` || n === `${w}es`));

/** The best game-ready model for a thing: its name must say it, and not too heavy. */
/** Not the thing itself: its bones, a statue or toy of it, armor for it… */
const NOT_THE_THING =
  /\b(pack|collection|kit|test|skeleton|skull|skulls|bone|bones|fossil|statue|sculpture|figurine|toy|plush|keychain|logo|icon|armor|armour|costume|helmet|mask|robot|robo|sketch|lowres|broken|destroyed|ruin|ruins|ruined|interior|miniature|cake|cookie)\b/i;

/** The best game-ready models for a thing, best first (the next is tried when one won't load). */
async function findModels(thing: string): Promise<StoreItem[]> {
  // "farm dog" → "dog" when there's no farm dog: the last word says what it is.
  const words = thing.split(' ');
  for (let k = 0; k < words.length; k++) {
    const found = await findNamed(words.slice(k).join(' '));
    if (found.length) return found;
  }
  return [];
}

async function findNamed(thing: string): Promise<StoreItem[]> {
  const query = ALSO_CALLED[thing] ?? thing;
  const asked = new Set(query.split(' '));
  const { items } = await loadObjaverse();
  return (
    items
      .map((item, i) => ({ item, score: scoreQuery(item, query), i }))
      .filter(
        (x) =>
          x.score >= 1000 &&
          named(x.item, query) &&
          !(NOT_THE_THING.test(x.item.name) && !NOT_THE_THING.test(query)) &&
          (CLOTHES.test(query) || !x.item.categories.includes('fashion-style')) &&
          (x.item.bytes === undefined || x.item.bytes <= MAX_BYTES) &&
          (x.item.triangles ?? 0) <= 150_000,
      )
      // Plainly named first ("Horse" before "Horse Walk Cycle Demo"), then the best match.
      .map((x) => ({ ...x, extra: x.item.nameWords.filter((w) => !asked.has(w) && !asked.has(w.replace(/e?s$/, ''))).length }))
      .sort((a, b) => Math.min(a.extra, 3) - Math.min(b.extra, 3) || b.score - a.score || a.i - b.i)
      .slice(0, 4)
      .map((x) => x.item)
  );
}

/** A light, game-ready model of one plant: its name says what it is (a "tree", not "street"). */
async function findPlant({ pick, query, triangles, not }: Plant): Promise<StoreItem | undefined> {
  const { items } = await loadObjaverse();
  const picked = pick && items.find((item) => item.id === pick);
  if (picked) return picked;
  const words = query.split(' ');
  return items
    .map((item, i) => ({ item, score: scoreQuery(item, query), i }))
    .filter(
      ({ item, score }) =>
        score >= 1000 &&
        words.every((w) => item.nameWords.some((n) => n === w || n === `${w}s` || n === `${w}es`)) &&
        !NOT_ONE_PLANT.test(item.name) &&
        !not?.test(item.name) &&
        (item.triangles ?? 0) >= 40 &&
        (item.triangles ?? Infinity) <= triangles &&
        (item.bytes === undefined || item.bytes <= MAX_PLANT_BYTES),
    )
    // Plants first (a "rock" among art pieces is often a sculpture), then the best match.
    .sort(
      (a, b) =>
        Number(b.item.categories.includes('nature-plants')) - Number(a.item.categories.includes('nature-plants')) ||
        b.score - a.score ||
        a.i - b.i,
    )[0]?.item;
}

async function plantModel(plant: Plant, cache: Map<string, string | null>): Promise<string | null> {
  const key = `${plant.query}:${plant.triangles}`;
  if (!cache.has(key)) {
    const item = await findPlant(plant).catch(() => undefined);
    cache.set(key, item ? ((await addStoreItem(item, { quiet: true, maxBytes: MAX_PLANT_BYTES })) ?? null) : null);
  }
  return cache.get(key) ?? null;
}

/**
 * Real plants: the trees, flowers, bushes and rocks this request spread with built-in shapes
 * (Scatter) become copies of a matching model, and its grass grows model clumps. Where nothing
 * light enough is found, the built-in ones stay.
 */
export async function swapInRealPlants(made: Set<string>, grassOn: Set<string>, stopped?: () => boolean): Promise<string[]> {
  const engine = state().engine;
  if (!engine || state().dimension === '2d') return [];
  const done: string[] = [];
  const cache = new Map<string, string | null>();
  for (const id of made) {
    if (stopped?.()) break;
    const e = engine.world.getById(id);
    const d = e?.get('Scatter') as { shape?: string; model?: string; color?: string } | undefined;
    // Flowers in a color it chose (purple lupins) keep it: a flower model has its own.
    if (d?.shape === 'flowers' && d.color && d.color.toLowerCase() !== '#3c6b2c') continue;
    const plant = d?.shape === 'round tree' && /palm/i.test(e?.name ?? '') ? PALM : d?.shape ? PLANTS[d.shape] : undefined;
    if (!e || !plant || d?.model) continue;
    const model = await plantModel(plant, cache);
    if (!model) continue;
    // Light enough to share the graphics chip with the assistant: fewer copies of a detailed one.
    const each = await trianglesOf(model);
    const count = each ? Math.max(10, Math.min((d as { count?: number }).count ?? 120, Math.floor(PLANT_TRIANGLES / each))) : undefined;
    editComponent(e, 'Scatter', { shape: 'model', model, fitHeight: plant.height, ...(count ? { count } : {}) }, 'AI: real plants');
    done.push(`${e.name}: real ${plant.query} models`);
  }
  for (const id of grassOn) {
    if (stopped?.()) break;
    const e = engine.world.getById(id);
    const g = e?.get('Grass') as { model?: string } | undefined;
    if (!e || !g || g.model) continue;
    const model = await plantModel(GRASS, cache);
    if (!model) continue;
    editComponent(e, 'Grass', { model, clumps: 5, clumpHeight: GRASS.height }, 'AI: real grass');
    done.push(`${e.name}: real grass models`);
  }
  return done;
}

/**
 * Swap in models for the shape-built things among `made` (ids of objects this request made).
 * Returns what it did, for the log.
 */
export async function swapInRealModels(made: Set<string>, stopped?: () => boolean): Promise<string[]> {
  const engine = state().engine;
  if (!engine || state().dimension === '2d') return [];
  // Group the new shapes by the thing they make up.
  const groups = new Map<string, Entity[]>();
  for (const id of made) {
    const e = engine.world.getById(id);
    if (!e || !isShape(e) || traitsOf(e).some((t) => GAME_TRAITS.has(t))) continue;
    const thing = thingOf(e.name);
    if (thing) groups.set(thing, [...(groups.get(thing) ?? []), e]);
  }
  const done: string[] = [];
  const models = new Map<string, string | null>();
  for (const [thing, shapes] of groups) {
    if (stopped?.()) break;
    // Dozens of copies (rows of crops, fence posts) stay light as shapes.
    if (shapes.length > MAX_COPIES) continue;
    if (!models.has(thing)) {
      if (models.size >= MAX_MODELS) break;
      // Too big, or it won't download: the next best.
      let id: string | null = null;
      for (const item of await findModels(thing).catch(() => [])) {
        const had = new Set(useLibrary.getState().assets.map((a) => a.id));
        id = (await addStoreItem(item, { quiet: true, maxBytes: MAX_BYTES }).catch(() => undefined)) ?? null;
        // A model on its own slab of ground (a black square around the house) won't fit in:
        // the next one, and this one leaves the project again (unless it was yours already).
        if (id && (await onSlab(id))) {
          if (!had.has(id)) await deleteAssetSafely(id);
          id = null;
        }
        if (id || stopped?.()) break;
      }
      models.set(thing, id);
    }
    const modelId = models.get(thing);
    if (!modelId) continue;
    // The object named just that owns it ("Tree 1", "Tree 2" are each their own); "Cabin Roof" is a piece.
    const mains = shapes.filter((e) => whatWords(e.name).join(' ') === thing);
    const owners = mains.length
      ? mains
      : [shapes.reduce((a, b) => (volume(a) >= volume(b) ? a : b))];
    for (const owner of owners) {
      const pieces =
        owners.length === 1
          ? shapes.filter((e) => e !== owner && !traitsOf(e).length && !e.has('Script'))
          : [];
      if (await fitModel(owner, pieces, modelId)) {
        for (const p of pieces) deleteEntity(p.id);
        done.push(`${owner.name}: a real model`);
      }
    }
  }
  return done;
}

function worldBox(e: Entity): THREE.Box3 {
  const node = state().engine?.render.nodeOf(e);
  return node ? new THREE.Box3().setFromObject(node) : new THREE.Box3();
}

const volume = (e: Entity) => {
  const s = worldBox(e).getSize(new THREE.Vector3());
  return s.x * s.y * s.z;
};

/** The model stands on a flat base of its own, as wide as all of it (a display plinth, a ground tile). */
async function onSlab(modelId: string): Promise<boolean> {
  const engine = state().engine;
  if (!engine) return false;
  try {
    const { scene, bounds } = await engine.assets.loadModel(modelId);
    const all = bounds.getSize(new THREE.Vector3());
    if (all.y < 1e-6) return false;
    scene.updateMatrixWorld(true);
    let slab = false;
    scene.traverse((o) => {
      if (slab || !(o as THREE.Mesh).isMesh) return;
      const b = new THREE.Box3().setFromObject(o);
      const s = b.getSize(new THREE.Vector3());
      slab =
        s.y < all.y * 0.04 &&
        s.x > all.x * 0.85 &&
        s.z > all.z * 0.85 &&
        b.min.y <= bounds.min.y + all.y * 0.15;
    });
    return slab;
  } catch {
    return false;
  }
}

/** Copies of a model along one long thing, at most. */
const MAX_ALONG = 16;

/**
 * Long and low (a fence, a hedge): much longer than it is tall or deep, and longer than one
 * copy of the model `model` (its size) at that height.
 */
function long(size: THREE.Vector3, model: THREE.Vector3): boolean {
  const length = Math.max(size.x, size.z);
  if (length < 3 || length < 3 * Math.max(size.y, Math.min(size.x, size.z)) || model.y < 1e-6) return false;
  return Math.max(model.x, model.z) * (Math.max(0.1, size.y) / model.y) < length * 0.6;
}

/** Put the model on `owner`, filling the space it and its pieces took (bottom on the ground). */
async function fitModel(owner: Entity, pieces: Entity[], modelId: string): Promise<boolean> {
  const engine = state().engine;
  if (!engine) return false;
  const box = worldBox(owner);
  for (const p of pieces) box.union(worldBox(p));
  if (box.isEmpty()) return false;
  const size = box.getSize(new THREE.Vector3());
  let fitHeight = Math.max(0.1, size.y);
  const s = new THREE.Vector3();
  // A model much wider than the space (a long house for a tall box) is fitted by its width instead.
  try {
    (await engine.assets.loadModel(modelId)).bounds.getSize(s);
    if (s.y > 1e-6 && !long(size, s)) {
      const wide = Math.max(s.x, s.z) * (fitHeight / s.y);
      const room = Math.max(size.x, size.z) * 1.5;
      if (wide > room) fitHeight *= room / wide;
    }
  } catch {
    return false;
  }
  const bottom = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    box.min.y,
    (box.min.z + box.max.z) / 2,
  );
  // Sunk into the floor (shapes are often placed half in it): stand on top of it instead.
  const hit = engine.physics?.raycast(new THREE.Vector3(bottom.x, box.min.y + size.y * 0.5, bottom.z), new THREE.Vector3(0, -1, 0), size.y, owner);
  if (hit && hit.entity && !pieces.includes(hit.entity)) bottom.y = Math.max(bottom.y, box.min.y + size.y * 0.5 - hit.distance);
  const node = engine.render.nodeOf(owner);
  const local = node?.parent ? node.parent.worldToLocal(bottom.clone()) : bottom;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const t = owner.get('Transform') as { rotation: [number, number, number] } | undefined;
  removeComponent(owner, 'MeshRenderer');
  if (long(size, s)) {
    // A long thing (a fence, a hedge, a row of crops): the model again and again along it.
    const alongX = size.x >= size.z;
    const length = alongX ? size.x : size.z;
    const each = Math.max(s.x, s.z) * (fitHeight / s.y);
    const n = Math.max(2, Math.min(MAX_ALONG, Math.round(length / each)));
    // Turn each copy so its long side runs along the thing.
    const yaw = alongX === s.x >= s.z ? 0 : 90;
    editComponent(owner, 'Transform', { position: [round(local.x), round(local.y), round(local.z)], rotation: [0, 0, 0], scale: [1, 1, 1] }, 'AI: real model');
    for (let k = 0; k < n; k++) {
      const id = createObject('empty', owner.id);
      const part = id ? engine.world.getById(id) : undefined;
      if (!part) continue;
      rename(part.id, `${owner.name} ${k + 1}`);
      const at = round((k - (n - 1) / 2) * (length / n));
      editComponent(part, 'Transform', { position: alongX ? [at, 0, 0] : [0, 0, at], rotation: [0, yaw, 0] }, 'AI: real model');
      addComponent(part, 'ModelRenderer');
      editComponent(part, 'ModelRenderer', { model: modelId, fitHeight: round(fitHeight), standOnGround: true }, 'AI: real model');
    }
    return true;
  }
  editComponent(
    owner,
    'Transform',
    {
      position: [round(local.x), round(local.y), round(local.z)],
      rotation: [0, t?.rotation[1] ?? 0, 0],
      scale: [1, 1, 1],
    },
    'AI: real model',
  );
  addComponent(owner, 'ModelRenderer');
  editComponent(
    owner,
    'ModelRenderer',
    { model: modelId, fitHeight: round(fitHeight), standOnGround: true },
    'AI: real model',
  );
  return true;
}
