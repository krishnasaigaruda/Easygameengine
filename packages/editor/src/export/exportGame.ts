import { strToU8, zip } from 'fflate';
import { EMBEDDED_FILE_TYPE, EMBEDDED_GAME_ID, GAME_FILE, exportedFilePath, type ExportedAsset, type ExportedGame, type GameCredit, type SceneData } from '@ege/runtime';
import type { AssetRecord } from '../persistence/projectStore';
import { CREDITS_FILE, parseCredits } from '../assets/library';

/*
 * Export: the game as a folder any website host can serve (Netlify, GitHub Pages, itch.io…):
 * index.html + ege-player.js (the engine only) + game.json + assets/. Built entirely in
 * the browser.
 */

export interface ExportOptions {
  title: string;
  /** Leave out assets nothing in the game uses. */
  onlyUsed: boolean;
  /** Installable app that also works offline (manifest + service worker). */
  installable: boolean;
  /** Licences of the open-source software inside the player (THIRD-PARTY-NOTICES.txt). */
  notices?: string;
}

export const PROVIDERS: Record<string, string> = {
  objaverse: 'Sketchfab (Objaverse)',
  polyhaven: 'Poly Haven',
  ambientcg: 'ambientCG',
  smithsonian: 'Smithsonian Open Access',
  openverse: 'Openverse',
  commons: 'Wikimedia Commons',
  web: 'Web',
};

/**
 * The assets the game needs: those the scene names, then whatever those name in turn (a material's
 * textures…). Asset ids are long random strings, so finding one in the JSON means it's used.
 */
export function usedAssets(scene: SceneData, records: AssetRecord[]): AssetRecord[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const used = new Set<string>();
  const scan = (text: string) => {
    for (const id of byId.keys()) if (!used.has(id) && text.includes(id)) {
      used.add(id);
      const r = byId.get(id)!;
      if (r.data !== undefined) scan(JSON.stringify(r.data));
    }
  };
  scan(JSON.stringify(scene));
  return records.filter((r) => used.has(r.id));
}

/** One credit per work: a texture set's maps (diffuse, normal, rough…) share their source. */
export function creditsOf(records: AssetRecord[]): GameCredit[] {
  const byWork = new Map<string, GameCredit>();
  for (const r of records) {
    const c = r.meta.credit;
    // Your own imports count once you've said who made them.
    if (!c || (c.provider === 'user' && !c.author)) continue;
    const key = c.url || `${c.provider}:${c.sourceId ?? r.name}:${c.author ?? ''}`;
    const prev = byWork.get(key);
    // The shortest name is usually the work's own ("Forest Ground 05", not "forest ground 05 ao 1k").
    if (!prev || r.name.length < prev.name.length) byWork.set(key, { name: r.name, author: c.author, license: c.license, url: c.url, source: PROVIDERS[c.provider] ?? c.provider });
  }
  return [...byWork.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything to credit: the assets' own credits plus the project's credits.json. */
export async function gameCredits(included: AssetRecord[], allRecords: AssetRecord[]): Promise<GameCredit[]> {
  const file = allRecords.find((r) => r.type === 'data' && r.name === CREDITS_FILE);
  const blob = file?.files[file.main];
  const extra = blob ? parseCredits(await blob.text()) : [];
  const list = [...creditsOf(included), ...extra.map((c) => ({ name: c.name || c.author, author: c.author || undefined, license: c.license || undefined, url: c.url || undefined }))];
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.name}|${c.author ?? ''}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function indexHtml(title: string, installable: boolean): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="generator" content="Easy Game Engine" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="icon.png" />${installable ? `
    <link rel="manifest" href="manifest.webmanifest" />
    <meta name="theme-color" content="#121417" />` : ''}
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #121417; }
      #game { position: fixed; inset: 0; }
    </style>
  </head>
  <body>
    <div id="game"></div>
    <script type="module" src="ege-player.js"></script>${installable ? `
    <script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');</script>` : ''}
  </body>
</html>
`;
}

function manifest(title: string): string {
  return JSON.stringify(
    {
      name: title,
      short_name: title.slice(0, 12),
      start_url: './',
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: '#121417',
      theme_color: '#121417',
      icons: [{ src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    },
    null,
    2,
  );
}

/** Keeps every file of the game, so it starts without a connection after the first visit (and still updates). */
function serviceWorker(files: string[], version: string): string {
  return `// Made with Easy Game Engine: keeps the game's files so it runs offline.
const CACHE = 'ege-${version}';
const FILES = ${JSON.stringify(['./', ...files])};
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
// Online: the newest version (and keep it). Offline: what was kept.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || Response.error())),
  );
});
`;
}

/** The logo as a 512 px app icon. */
async function iconPng(): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#121417';
  g.fillRect(0, 0, 512, 512);
  g.setTransform(512 / 24 * 0.7, 0, 0, 512 / 24 * 0.7, 512 * 0.15, 512 * 0.15);
  g.strokeStyle = '#e0b23a';
  g.lineWidth = 1.6;
  g.lineJoin = 'round';
  g.stroke(new Path2D('M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5L12 2.5Z'));
  g.stroke(new Path2D('M3.5 7.25 12 12l8.5-4.75M12 12v9.5'));
  g.globalAlpha = 0.35;
  g.fillStyle = '#e0b23a';
  g.fill(new Path2D('M12 12 16.25 9.6v4.8L12 16.8Z'));
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

const README = (title: string) => `${title}
Made with Easy Game Engine.

PLAY IT ON YOUR COMPUTER
Browsers won't run a game by double-clicking index.html, so serve this folder:
  1. Open a terminal in this folder (Mac: type "cd ", drag the folder in, press Enter).
  2. Run:  python3 -m http.server 8000      (or, with Node installed:  npx serve)
  3. Open http://localhost:8000 in your browser. Ctrl+C in the terminal stops it.

PUT IT ONLINE
Upload this whole folder to any website host, for example Netlify Drop (app.netlify.com/drop),
GitHub Pages, or itch.io (as an HTML game: upload the zip).
`;

const STORED = /\.(glb|gltf|bin|png|jpe?g|webp|avif|ktx2|mp3|ogg|wav|m4a|hdr|exr|fbx|zip)$/i;

/** Build game.zip. `player` is ege-player.js; `onProgress` gets 0–1. */
export async function buildGameZip(
  scene: SceneData,
  allRecords: AssetRecord[],
  player: Uint8Array,
  options: ExportOptions,
  onProgress: (f: number) => void = () => {},
): Promise<Uint8Array> {
  const records = options.onlyUsed ? usedAssets(scene, allRecords) : allRecords;
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const assets: ExportedAsset[] = [];
  const paths: string[] = [];
  let i = 0;
  for (const r of records) {
    const files: ExportedAsset['files'] = [];
    for (const [path, blob] of Object.entries(r.files)) {
      const at = exportedFilePath(r.id, path);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      entries[decodeURIComponent(at)] = STORED.test(path) ? [bytes, { level: 0 }] : bytes;
      files.push({ path, size: blob.size });
      paths.push(at);
    }
    assets.push({ id: r.id, type: r.type, name: r.name, main: r.main, files, data: r.data });
    onProgress((++i / Math.max(1, records.length)) * 0.8);
  }
  const game: ExportedGame = { format: 'ege-game', version: 1, title: options.title, scene, assets, credits: await gameCredits(records, allRecords) };
  entries[GAME_FILE] = strToU8(JSON.stringify(game));
  entries['ege-player.js'] = player;
  entries['index.html'] = strToU8(indexHtml(options.title, options.installable));
  entries['icon.png'] = [await iconPng(), { level: 0 }];
  entries['README.txt'] = strToU8(README(options.title));
  if (options.notices) entries['THIRD-PARTY-NOTICES.txt'] = strToU8(options.notices);
  if (options.installable) {
    entries['manifest.webmanifest'] = strToU8(manifest(options.title));
    entries['sw.js'] = strToU8(serviceWorker(['index.html', 'ege-player.js', GAME_FILE, 'icon.png', 'manifest.webmanifest', ...paths], Date.now().toString(36)));
  }
  const out = await new Promise<Uint8Array>((res, rej) => zip(entries, { level: 6 }, (err, data) => (err ? rej(err) : res(data))));
  onProgress(1);
  return out;
}


/** A file's bytes as base64 text (fast, in the background). */
function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * The whole game as one .html file you can double-click: the engine, game.json and every file
 * are inside it (files as base64 text, about a third bigger than the files themselves).
 */
export async function buildSingleHtml(
  scene: SceneData,
  allRecords: AssetRecord[],
  player: string,
  options: Pick<ExportOptions, 'title' | 'onlyUsed' | 'notices'>,
  onProgress: (f: number) => void = () => {},
): Promise<Blob> {
  const records = options.onlyUsed ? usedAssets(scene, allRecords) : allRecords;
  const assets: ExportedAsset[] = records.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    main: r.main,
    files: Object.entries(r.files).map(([path, b]) => ({ path, size: b.size })),
    data: r.data,
  }));
  const game: ExportedGame = { format: 'ege-game', version: 1, title: options.title, scene, assets, credits: await gameCredits(records, allRecords) };
  // Nothing inside may end a <script> early.
  const safe = (text: string) => text.replace(/<\/(script)/gi, '<\\/$1');
  const icon = await base64Of(new Blob([(await iconPng()) as BlobPart], { type: 'image/png' }));
  const parts: BlobPart[] = [
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="generator" content="Easy Game Engine" />
    <title>${escapeHtml(options.title)}</title>
    <link rel="icon" href="data:image/png;base64,${icon}" />
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #121417; }
      #game { position: fixed; inset: 0; }
    </style>
  </head>
  <body>
    <div id="game"></div>
    <script type="application/json" id="${EMBEDDED_GAME_ID}">${safe(JSON.stringify(game))}</script>
`,
  ];
  let i = 0;
  for (const r of records) {
    for (const [path, blob] of Object.entries(r.files)) {
      parts.push(`    <script type="${EMBEDDED_FILE_TYPE}" data-file="${escapeHtml(`${r.id}/${path}`)}">`, await base64Of(blob), '</script>\n');
    }
    onProgress((++i / Math.max(1, records.length)) * 0.95);
  }
  parts.push(`    <script type="module">${safe(player)}</script>\n`);
  // The open-source licences, kept with the game (MIT / Apache ask for that).
  if (options.notices) parts.push(`    <script type="text/plain" id="third-party-notices">${safe(options.notices)}</script>\n`);
  parts.push('  </body>\n</html>\n');
  onProgress(1);
  return new Blob(parts, { type: 'text/html' });
}
