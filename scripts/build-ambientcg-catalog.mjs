#!/usr/bin/env node
/**
 * Builds the Asset Store's ambientCG catalog: a compact index of every CC0 material on
 * ambientcg.com (names, tags, thumbnails, the 1K texture zip). No texture files are downloaded —
 * the editor fetches a zip only when the user clicks "Add".
 *
 * ambientCG's search API can't be called from a web page (no CORS), but its file and image
 * servers can, so the index stores direct file links (resolved once here).
 *
 * Usage: node scripts/build-ambientcg-catalog.mjs
 * Output: packages/editor/public/catalog/ambientcg.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/editor/public/catalog/ambientcg.json');
const API = 'https://ambientcg.com/api/v2/full_json';
const PAGE = 250;
const FILE_PREFIX = 'https://acg-download.struffelproductions.com/file/ambientCG-Web/download/';

async function json(url, attempt = 1) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 4) throw err;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return json(url, attempt + 1);
  }
}

/** ambientcg.com/get?file=… redirects to the real file; keep the part after FILE_PREFIX. */
async function resolveFile(link, attempt = 1) {
  try {
    const res = await fetch(link, { method: 'HEAD', redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    return loc.startsWith(FILE_PREFIX) ? loc.slice(FILE_PREFIX.length) : '';
  } catch {
    if (attempt >= 3) return '';
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return resolveFile(link, attempt + 1);
  }
}

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  const assets = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await json(`${API}?type=Material&include=downloadData,tagData,displayData&sort=Popular&limit=${PAGE}&offset=${offset}`);
    assets.push(...(page.foundAssets ?? []));
    process.stdout.write(`\rlisted ${assets.length}/${page.numberOfResults}   `);
    if (!page.foundAssets?.length || assets.length >= page.numberOfResults) break;
  }
  process.stdout.write('\n');

  const rows = [];
  let i = 0;
  const worker = async () => {
    while (i < assets.length) {
      const a = assets[i++];
      const zips = a.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? [];
      const zip = zips.find((z) => z.attribute === '1K-JPG') ?? zips.find((z) => z.attribute === '2K-JPG');
      if (!zip) continue;
      const file = await resolveFile(zip.downloadLink);
      if (!file) continue;
      rows.push([
        a.assetId,
        String(a.displayName ?? a.assetId).slice(0, 60),
        String(a.displayCategory ?? a.category ?? '').slice(0, 40),
        (a.tags ?? []).filter((t) => !/^\d+$/.test(t)).slice(0, 10).join(','),
        a.downloadCount ?? 0,
        file,
        zip.size ?? 0,
      ]);
      if (rows.length % 50 === 0) process.stdout.write(`\rresolved ${rows.length}/${assets.length}   `);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  process.stdout.write('\n');
  rows.sort((x, y) => y[4] - x[4]);

  const catalog = {
    format: 'ege-catalog',
    version: 1,
    source: 'ambientcg',
    generatedAt: new Date().toISOString(),
    fileUrl: `${FILE_PREFIX}{file}`,
    thumbUrl: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/{id}.png',
    pageUrl: 'https://ambientcg.com/view?id={id}',
    license: 'CC0-1.0',
    // [id, name, category, tags, downloads, file, bytes]
    items: rows,
  };
  await writeFile(OUT, JSON.stringify(catalog));
  console.log(`wrote ${rows.length} materials → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
