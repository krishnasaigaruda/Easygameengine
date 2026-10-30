#!/usr/bin/env node
/**
 * Builds the Asset Store's Smithsonian catalog (from Objaverse-XL): ~2,400 museum scans, all
 * CC0. Only names and links are stored; models download from the Smithsonian when added.
 *
 * Usage: node scripts/build-smithsonian-catalog.mjs
 * Output: packages/editor/public/catalog/smithsonian.json
 */
import { parquetReadObjects } from 'hyparquet';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/editor/public/catalog/smithsonian.json');
const CACHE = join(ROOT, 'node_modules/.cache/ege-smithsonian/smithsonian.parquet');
const SOURCE = 'https://huggingface.co/datasets/allenai/objaverse-xl/resolve/main/smithsonian/smithsonian.parquet';
const PREFIX = 'https://3d-api.si.edu/content/document/';

async function main() {
  await mkdir(dirname(CACHE), { recursive: true });
  if (!existsSync(CACHE)) {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(CACHE, Buffer.from(await res.arrayBuffer()));
  }
  const buf = (await readFile(CACHE)).buffer;
  const rows = await parquetReadObjects({ file: buf });
  const items = [];
  for (const r of rows) {
    if (!/zero/i.test(r.license ?? '') || r.fileType !== 'glb' || !String(r.fileIdentifier).startsWith(PREFIX)) continue;
    let title = '';
    try {
      title = JSON.parse(r.metadata ?? '{}').title ?? '';
    } catch {
      // keep empty
    }
    const file = String(r.fileIdentifier).slice(PREFIX.length);
    if (!title) title = decodeURIComponent(file.split('/').pop()).replace(/-\d+k-\d+-\w+\.glb$/, '').replace(/[-_]+/g, ' ');
    items.push([r.sha256.slice(0, 16), title.replace(/\s+/g, ' ').trim().slice(0, 80), file]);
  }
  await writeFile(OUT, JSON.stringify({ format: 'ege-catalog', version: 1, source: 'smithsonian', fileUrl: `${PREFIX}{file}`, license: 'CC0-1.0', items }));
  console.log(`wrote ${items.length} models → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
