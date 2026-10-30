#!/usr/bin/env node
/**
 * Builds the Asset Store's Objaverse catalog: a compact index (names, authors, licenses, tags,
 * thumbnail links) of the best freely-licensed models. No model files are downloaded — the editor
 * fetches a model from Hugging Face only when the user clicks "Add".
 *
 * Usage: node scripts/build-objaverse-catalog.mjs [--shards 160] [--max 40000]
 * Output: packages/editor/public/catalog/objaverse.json
 */
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/editor/public/catalog/objaverse.json');
const CACHE = join(ROOT, 'node_modules/.cache/ege-objaverse');
const BASE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main';
const THUMB_PREFIX = 'https://media.sketchfab.com/models/';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const SHARDS = arg('shards', 160); // all of Objaverse: 160 shards of ~5000 objects
const MAX_ITEMS = arg('max', 40000);
const MAX_ANIMATED = Math.round(MAX_ITEMS * 0.2);
const MAX_FACES = 300_000;
/** Only licenses that allow commercial use and modification without share-alike. */
const LICENSES = { cc0: 0, by: 1 };

/**
 * A CC license from the uploader doesn't cover characters/brands they don't own (fan art).
 * Drop the obvious ones; the store still tells users to check before publishing.
 */
const BLOCKED = new RegExp(
  '\\b(' +
    [
      'marvel', 'dc comics', 'batman', 'superman', 'spider-?man', 'iron ?man', 'avengers', 'joker',
      'catwoman', 'harley quinn', 'wonder woman', 'deadpool', 'hulk', 'thanos',
      'disney', 'pixar', 'mickey', 'star wars', 'stormtrooper', 'darth', 'mandalorian',
      'yoda', 'pokemon', 'pok[eé]mon', 'pikachu', 'nintendo', 'mario', 'zelda', 'kirby',
      'sonic', 'overwatch', 'junkrat', 'league of legends', 'valorant', 'fortnite',
      'minecraft', 'roblox', 'genshin', 'naruto', 'one piece', 'dragon ball', 'goku', 'gundam',
      'transformers', 'optimus', 'harry potter', 'hogwarts', 'lord of the rings', 'gandalf',
      'warhammer', 'master chief', 'call of duty', 'gta', 'cyberpunk', 'witcher',
      'resident evil', 'final fantasy', 'kingdom hearts', 'dark souls', 'elden ring', 'zelda',
      'hello kitty', 'shrek', 'simpsons', 'spongebob', 'peppa', 'barbie', 'lego', 'ferrari',
      'lamborghini', 'porsche', 'bmw', 'mercedes', 'audi', 'tesla', 'nike', 'adidas', 'coca-?cola',
      'mcdonald', 'iphone', 'playstation', 'xbox', 'vtuber', 'hololive', 'miku', 'genshin',
      'honkai', 'blue archive', 'arknights', 'azur lane', 'kancolle', 'evangelion',
      'attack on titan', 'demon slayer', 'jujutsu', 'chainsaw man', 'my hero academia', 'sailor moon',
      'jojo', 'bleach', 'hunter x hunter', 'death note', 'tokyo ghoul', 'fnaf', 'five nights',
      'among us', 'apex legends', 'diablo', 'warcraft', 'starcraft', 'world of tanks',
      'tf2', 'team fortress', 'adventure time', 'jake the dog', 'cartoon network', 'rick and morty', 'gravity falls', 'steven universe', 'looney tunes', 'bugs bunny', 'scooby', 'garfield', 'snoopy', 'sesame street', 'muppet', 'teletubbies', 'paw patrol', 'bluey', 'dreamworks', 'kung fu panda', 'minions?', 'despicable me', 'toy story', 'buzz lightyear', 'lightning mcqueen', 'monsters inc', 'finding nemo', 'lilo', 'moana', 'encanto', 'how to train your dragon', 'toothless', 'ghibli', 'totoro', 'pac-?man', 'tetris', 'angry birds', 'jurassic', 'indominus', 'nier', 'automata', 'volkswagen', 'fusca', 'mixamo', 'half-?life', 'counter-?strike', 'csgo', 'dota',
    ].join('|') +
    ')\\b',
  'i',
);

const shardName = (i) => `000-${String(i).padStart(3, '0')}`;

async function fetchShard(i, attempt = 1) {
  const name = shardName(i);
  const cached = join(CACHE, `${name}.json.gz`);
  if (existsSync(cached)) return JSON.parse(gunzipSync(await readFile(cached)).toString('utf8'));
  try {
    const res = await fetch(`${BASE}/metadata/${name}.json.gz`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(cached, buf);
    return JSON.parse(gunzipSync(buf).toString('utf8'));
  } catch (err) {
    if (attempt >= 4) throw new Error(`shard ${name}: ${err.message}`, { cause: err });
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return fetchShard(i, attempt + 1);
  }
}

function thumbSuffix(a, uid, width) {
  const img = a.thumbnails?.images?.find((t) => t.width === width);
  const prefix = `${THUMB_PREFIX}${uid}/thumbnails/`;
  return img?.url?.startsWith(prefix) ? img.url.slice(prefix.length) : '';
}

const clean = (s, max) =>
  String(s ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function score(a) {
  const likes = a.likeCount ?? 0;
  const views = a.viewCount ?? 0;
  return likes * 3 + views / 50 + (a.staffpickedAt ? 400 : 0);
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(dirname(OUT), { recursive: true });

  const pool = [];
  let seen = 0;
  let blocked = 0;
  const queue = [...Array(SHARDS).keys()];
  const worker = async () => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
      const shard = await fetchShard(i);
      for (const [uid, a] of Object.entries(shard)) {
        seen++;
        const lic = LICENSES[a.license];
        if (lic === undefined || a.isAgeRestricted || a.isDownloadable === false) continue;
        if (!a.faceCount || a.faceCount > MAX_FACES) continue;
        const name = clean(a.name, 80);
        if (!name) continue;
        const text = `${name} ${(a.tags ?? []).map((t) => t.name).join(' ')} ${a.description ?? ''}`;
        if (BLOCKED.test(text)) {
          blocked++;
          continue;
        }
        pool.push({ uid, shard: i, a, lic, name, score: score(a) });
      }
      process.stdout.write(`\rshards ${SHARDS - queue.length}/${SHARDS} · objects ${seen} · usable ${pool.length}   `);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  process.stdout.write('\n');

  pool.sort((x, y) => y.score - x.score);
  const animated = pool.filter((p) => (p.a.animationCount ?? 0) > 0).slice(0, MAX_ANIMATED);
  const chosen = new Map(animated.map((p) => [p.uid, p]));
  for (const p of pool) {
    if (chosen.size >= MAX_ITEMS) break;
    chosen.set(p.uid, p);
  }

  const categories = [];
  const catIndex = new Map();
  const cat = (name) => {
    if (!name) return -1;
    if (!catIndex.has(name)) {
      catIndex.set(name, categories.length);
      categories.push(name);
    }
    return catIndex.get(name);
  };

  // Compact rows: [uid, shard, name, author, license(0=cc0,1=by), faces, animations,
  //                categoryIndex, tags, thumb256, thumb720]
  const items = [...chosen.values()]
    .sort((x, y) => y.score - x.score)
    .map(({ uid, shard, a, lic, name }) => [
      uid,
      shard,
      name,
      clean(a.user?.displayName || a.user?.username || 'Unknown', 40),
      lic,
      a.faceCount,
      a.animationCount ?? 0,
      cat(a.categories?.[0]?.name),
      (a.tags ?? [])
        .map((t) => clean(t.name, 24).toLowerCase())
        .filter(Boolean)
        .slice(0, 6)
        .join(','),
      thumbSuffix(a, uid, 256),
      thumbSuffix(a, uid, 720),
    ]);

  const catalog = {
    format: 'ege-catalog',
    version: 1,
    source: 'objaverse',
    generatedAt: new Date().toISOString(),
    modelUrl: `${BASE}/glbs/{shard}/{uid}.glb`,
    thumbUrl: `${THUMB_PREFIX}{uid}/thumbnails/{thumb}`,
    pageUrl: 'https://sketchfab.com/3d-models/{uid}',
    licenses: ['CC0-1.0', 'CC-BY-4.0'],
    categories,
    items,
  };
  await writeFile(OUT, JSON.stringify(catalog));
  const anim = items.filter((r) => r[6] > 0).length;
  const cc0 = items.filter((r) => r[4] === 0).length;
  console.log(`blocked ${blocked} likely fan-art/brand models`);
  console.log(`wrote ${items.length} models (${anim} animated, ${cc0} CC0) → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
