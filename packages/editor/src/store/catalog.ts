/**
 * Asset Store catalogs. Objaverse comes from a prebuilt index (scripts/build-objaverse-catalog.mjs);
 * Poly Haven is queried live from its public API. Only metadata is fetched here — asset files are
 * downloaded when the user clicks Add (see downloader.ts).
 */

export type StoreKind = 'model' | 'material' | 'hdri' | 'sound' | 'music' | 'image' | 'effect';
export type StoreProvider = 'builtin' | 'polyhaven' | 'ambientcg' | 'smithsonian' | 'objaverse' | 'openverse' | 'commons';

export interface StoreItem {
  /** Unique across providers: "ov:<uid>" / "ph:<id>". */
  key: string;
  provider: StoreProvider;
  kind: StoreKind;
  id: string;
  name: string;
  author: string;
  /** SPDX-style id: CC0-1.0, CC-BY-4.0, CC-BY-3.0, MIT, Public Domain Mark… */
  license: string;
  /** Thumbnail URLs to try in order (some CDN sizes are missing). */
  thumbs: string[];
  animations: number;
  triangles?: number;
  categories: string[];
  /** Lower-cased words of the name, and of the tags + categories (for ranked search). */
  nameWords: string[];
  tagWords: string[];
  /** Lower-cased author, for search. */
  authorText: string;
  pageUrl: string;
  /** Objaverse shard number (needed to build the download URL). */
  shard?: number;
  /** Direct file to download (ambientCG zip). */
  fileUrl?: string;
  /** Download size in bytes, when known. */
  bytes?: number;
  /** Sounds: length in seconds, and a preview you can play. */
  duration?: number;
  previewUrl?: string;
  /** File type (mp3, ogg, png…). */
  filetype?: string;
}

const POLYHAVEN_API = 'https://api.polyhaven.com';

interface ObjaverseCatalog {
  format: 'ege-catalog';
  modelUrl: string;
  thumbUrl: string;
  pageUrl: string;
  licenses: string[];
  categories: string[];
  /** [uid, shard, name, author, license, faces, animations, category, tags, thumb256, thumb720] */
  items: [string, number, string, string, number, number, number, number, string, string, string][];
}

let objaverse: Promise<{ items: StoreItem[]; modelUrl: string }> | null = null;

export function loadObjaverse(): Promise<{ items: StoreItem[]; modelUrl: string }> {
  objaverse ??= (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}catalog/objaverse.json`);
    if (!res.ok) throw new Error(`Catalog missing (HTTP ${res.status})`);
    const c = (await res.json()) as ObjaverseCatalog;
    const items = c.items.map(([uid, shard, name, author, lic, faces, anims, cat, tags, t256, t720]): StoreItem => {
      const category = c.categories[cat] ?? '';
      const thumb = (t: string) => c.thumbUrl.replace('{uid}', uid).replace('{thumb}', t);
      return {
        key: `ov:${uid}`,
        provider: 'objaverse',
        kind: 'model',
        id: uid,
        name,
        author,
        license: lic === 0 ? 'CC0-1.0' : 'CC-BY-4.0',
        thumbs: [t256, t720].filter(Boolean).map(thumb),
        animations: anims,
        triangles: faces,
        categories: category ? [category] : [],
        nameWords: words(name),
        tagWords: words(`${tags} ${category}`),
        authorText: author.toLowerCase(),
        pageUrl: c.pageUrl.replace('{uid}', uid),
        shard,
      };
    });
    return { items, modelUrl: c.modelUrl };
  })();
  objaverse.catch(() => (objaverse = null)); // allow retry
  return objaverse;
}

interface PolyHavenAsset {
  name: string;
  type: number;
  categories?: string[];
  tags?: string[];
  authors?: Record<string, string>;
  download_count?: number;
  thumbnail_url?: string;
}

const PH_TYPES: Partial<Record<StoreKind, string>> = { hdri: 'hdris', material: 'textures', model: 'models' };
const polyhaven = new Map<StoreKind, Promise<StoreItem[]>>();

export function loadPolyHaven(kind: StoreKind): Promise<StoreItem[]> {
  let p = polyhaven.get(kind);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${POLYHAVEN_API}/assets?type=${PH_TYPES[kind]}`);
      if (!res.ok) throw new Error(`Poly Haven unavailable (HTTP ${res.status})`);
      const data = (await res.json()) as Record<string, PolyHavenAsset>;
      return Object.entries(data)
        .sort(([, a], [, b]) => (b.download_count ?? 0) - (a.download_count ?? 0))
        .map(([id, a]): StoreItem => {
          const author = Object.keys(a.authors ?? {}).join(', ') || 'Poly Haven';
          return {
            key: `ph:${id}`,
            provider: 'polyhaven',
            kind,
            id,
            name: a.name,
            author,
            license: 'CC0-1.0',
            thumbs: [
              a.thumbnail_url ?? `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`,
            ],
            animations: 0,
            categories: a.categories ?? [],
            nameWords: words(a.name),
            tagWords: words(`${(a.tags ?? []).join(' ')} ${(a.categories ?? []).join(' ')}`),
            authorText: author.toLowerCase(),
            pageUrl: `https://polyhaven.com/a/${id}`,
          };
        });
    })();
    polyhaven.set(kind, p);
    p.catch(() => polyhaven.delete(kind));
  }
  return p;
}

// ── Smithsonian (CC0 museum scans, from Objaverse-XL: scripts/build-smithsonian-catalog.mjs) ──

let smithsonian: Promise<StoreItem[]> | null = null;

export function loadSmithsonian(): Promise<StoreItem[]> {
  smithsonian ??= (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}catalog/smithsonian.json`);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
      throw new Error('The Smithsonian list is not built yet (run: node scripts/build-smithsonian-catalog.mjs)');
    }
    const c = (await res.json()) as { fileUrl: string; items: [string, string, string][] };
    return c.items.map(([id, name, file]): StoreItem => ({
      key: `si:${id}`,
      provider: 'smithsonian',
      kind: 'model',
      id,
      name,
      author: 'Smithsonian Institution',
      license: 'CC0-1.0',
      thumbs: [], // no public previews; a thumbnail is made once it's added
      animations: 0,
      categories: ['museum scans'],
      nameWords: words(name),
      tagWords: words('museum scan smithsonian realistic history science'),
      authorText: 'smithsonian',
      pageUrl: 'https://3d.si.edu',
      fileUrl: c.fileUrl.replace('{file}', file),
    }));
  })();
  smithsonian.catch(() => (smithsonian = null));
  return smithsonian;
}

// ── ambientCG (CC0 materials, prebuilt index: scripts/build-ambientcg-catalog.mjs) ──

interface AmbientCatalog {
  fileUrl: string;
  thumbUrl: string;
  pageUrl: string;
  /** [id, name, category, tags, downloads, file, bytes] */
  items: [string, string, string, string, number, string, number][];
}

let ambient: Promise<StoreItem[]> | null = null;

export function loadAmbientCG(): Promise<StoreItem[]> {
  ambient ??= (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}catalog/ambientcg.json`);
    // A missing file comes back as the app's HTML page in development.
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
      throw new Error('The ambientCG list is not built yet (run: node scripts/build-ambientcg-catalog.mjs)');
    }
    const c = (await res.json()) as AmbientCatalog;
    return c.items.map(([id, name, category, tags, , file, bytes]): StoreItem => ({
      key: `acg:${id}`,
      provider: 'ambientcg',
      kind: 'material',
      id,
      name,
      author: 'ambientCG',
      license: 'CC0-1.0',
      thumbs: [c.thumbUrl.replace('{id}', id)],
      animations: 0,
      categories: category ? [category.toLowerCase()] : [],
      nameWords: words(name),
      tagWords: words(`${tags} ${category}`),
      authorText: 'ambientcg',
      pageUrl: c.pageUrl.replace('{id}', id),
      fileUrl: c.fileUrl.replace('{file}', file),
      bytes,
    }));
  })();
  ambient.catch(() => (ambient = null));
  return ambient;
}

/** Lower-cased words; "cars-vehicles", "low_poly" and "SportsCar2" split into their parts. */
export function words(text: string): string[] {
  const parts = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return [...new Set(parts)];
}

/**
 * Words people search for that models are often tagged differently. A synonym hit counts for
 * less than the word itself, so "car" lists cars first, then other vehicles.
 */
const SYNONYMS: Record<string, string[]> = {
  car: ['cars', 'vehicle', 'vehicles', 'sedan', 'sportscar', 'automobile', 'auto', 'coupe', 'hatchback', 'suv', 'taxi', 'racecar', 'jeep', 'van', 'truck', 'pickup', 'automotive'],
  vehicle: ['vehicles', 'car', 'cars', 'truck', 'van', 'bus', 'motorcycle', 'bike', 'tank', 'tractor', 'boat', 'plane'],
  truck: ['lorry', 'pickup', 'trucks'],
  plane: ['airplane', 'aircraft', 'jet', 'aeroplane'],
  boat: ['ship', 'yacht', 'vessel'],
  gun: ['weapon', 'pistol', 'rifle', 'firearm'],
  weapon: ['weapons', 'gun', 'sword', 'axe', 'bow'],
  person: ['people', 'human', 'character', 'man', 'woman'],
  character: ['characters', 'creature', 'person', 'human', 'hero'],
  house: ['building', 'home', 'cottage', 'cabin', 'architecture'],
  tree: ['trees', 'plant', 'pine', 'oak', 'palm'],
  rock: ['rocks', 'stone', 'boulder', 'cliff'],
  animal: ['animals', 'pet', 'pets', 'creature'],
  monster: ['creature', 'zombie', 'demon', 'beast'],
  food: ['drink', 'fruit', 'meal'],
  chair: ['seat', 'stool', 'armchair'],
  sofa: ['couch'],
};

/** Plural/singular forms to also accept ("cars" for "car", "trees" for "tree"). */
function forms(w: string): string[] {
  const out = [w];
  if (w.endsWith('ies') && w.length > 4) out.push(w.slice(0, -3) + 'y');
  else if (w.endsWith('es') && w.length > 4) out.push(w.slice(0, -2), w.slice(0, -1));
  else if (w.endsWith('s') && w.length > 3) out.push(w.slice(0, -1));
  else out.push(w + 's', w + 'es');
  return out;
}

/** How well one search word matches an item (0 = not at all). */
function wordScore(item: StoreItem, q: string): number {
  const exact = forms(q);
  const inName = (ws: string[]) => ws.some((w) => exact.includes(w));
  if (inName(item.nameWords)) return 10;
  if (inName(item.tagWords)) return 6;
  const syn = SYNONYMS[exact.find((f) => SYNONYMS[f]) ?? ''];
  if (syn) {
    if (item.nameWords.some((w) => syn.includes(w))) return 3;
    if (item.tagWords.some((w) => syn.includes(w))) return 2;
  }
  // Word starts with it ("sport" → "sportscar"); only for 3+ letters so "ca" isn't everything.
  // Ranked below synonyms: "car" should list vans before carrots.
  if (q.length >= 3) {
    if (item.nameWords.some((w) => w.startsWith(q))) return 1.5;
    if (item.tagWords.some((w) => w.startsWith(q))) return 1.2;
  }
  // Inside a longer word ("pine" in "pineapple") or the author — only for longer searches.
  if (q.length >= 4 && (item.nameWords.some((w) => w.includes(q)) || item.tagWords.some((w) => w.includes(q)))) return 1;
  if (q.length >= 3 && item.authorText.includes(q)) return 1;
  return 0;
}

/**
 * Higher = better match; 0 = not shown. Items with every word come first; after them, items
 * that have most of the words ("thatched house medieval" still finds medieval houses).
 */
export function scoreQuery(item: StoreItem, query: string): number {
  const qs = words(query);
  let total = 0;
  let matched = 0;
  for (const q of qs) {
    const s = wordScore(item, q);
    if (s > 0) matched++;
    total += s;
  }
  if (matched === qs.length) return total + 1000;
  return qs.length > 1 && matched >= Math.ceil(qs.length / 2) ? total : 0;
}

/**
 * Ranked search: best matches first; equal matches keep their popularity order. Without a query
 * the items come back unchanged.
 */
export function searchItems(items: StoreItem[], query: string): StoreItem[] {
  if (!words(query).length) return items;
  const scored: { item: StoreItem; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const score = scoreQuery(item, query);
    if (score > 0) scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.item);
}
