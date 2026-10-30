import type { Engine } from '../core/Engine';
import type { AssetResolver, AssetType, ResolvedAsset } from '../assets/types';
import { showLoading, type GameCredit } from './Branding';
import { startGame } from './startGame';

/*
 * Exported games: a folder with index.html, ege-player.js, game.json and assets/<id>/<file>.
 * Any static host can serve it. game.json lists every file and its size, so the loading screen
 * shows real progress.
 */

export const GAME_FILE = 'game.json';

export interface ExportedAsset {
  id: string;
  type: AssetType;
  name: string;
  main: string;
  /** File paths inside the asset, with their sizes in bytes. */
  files: { path: string; size: number }[];
  data?: unknown;
}

export interface ExportedGame {
  format: 'ege-game';
  version: 1;
  title: string;
  scene: unknown;
  assets: ExportedAsset[];
  credits: GameCredit[];
}

/** Where an asset's file lives in the exported folder. */
export function exportedFilePath(assetId: string, path: string): string {
  return `assets/${assetId}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Download a file, reporting bytes as they arrive. */
async function fetchWithProgress(url: string, onBytes: (n: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  if (!res.body) {
    const blob = await res.blob();
    onBytes(blob.size);
    return blob;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.byteLength);
  }
  return new Blob(parts as BlobPart[], { type: res.headers.get('content-type') ?? '' });
}

/** In a single-file export, game.json and each file are script tags of the page itself. */
export const EMBEDDED_GAME_ID = 'ege-game';
export const EMBEDDED_FILE_TYPE = 'application/x-ege-file';

function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Run the exported game in `container`; files are read relative to `base` (or from the page itself). */
export async function playExportedGame(container: HTMLElement, base = './'): Promise<Engine> {
  const inPage = document.getElementById(EMBEDDED_GAME_ID);
  if (inPage) return playEmbedded(container, JSON.parse(inPage.textContent ?? '{}') as ExportedGame);
  const res = await fetch(new URL(GAME_FILE, new URL(base, location.href)));
  if (!res.ok) throw new Error(`Couldn't load ${GAME_FILE} (${res.status})`);
  const game = (await res.json()) as ExportedGame;
  if (game.format !== 'ege-game') throw new Error(`${GAME_FILE} isn't an Easy Game Engine game`);
  document.title = game.title;
  const loading = showLoading(container, game.title);

  const total = game.assets.reduce((n, a) => n + a.files.reduce((m, f) => m + f.size, 0), 0);
  let done = 0;
  loading.progress(0, total);
  const urls = new Map<string, string>();
  const jobs = game.assets.flatMap((a) => a.files.map((f) => ({ asset: a, file: f })));
  // A few downloads at a time.
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { asset, file } = jobs[next++];
      const blob = await fetchWithProgress(new URL(exportedFilePath(asset.id, file.path), new URL(base, location.href)).href, (n) => {
        done += n;
        loading.progress(done, total);
      });
      urls.set(`${asset.id}/${file.path}`, URL.createObjectURL(blob));
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));

  loading.remove();
  return run(container, game, urls);
}

/** A single-file export (double-click the .html): every file is already in the page. */
async function playEmbedded(container: HTMLElement, game: ExportedGame): Promise<Engine> {
  if (game.format !== 'ege-game') throw new Error("This page doesn't contain an Easy Game Engine game");
  document.title = game.title;
  const loading = showLoading(container, game.title);
  const tags = new Map<string, HTMLScriptElement>();
  for (const el of document.querySelectorAll<HTMLScriptElement>(`script[type="${EMBEDDED_FILE_TYPE}"]`)) tags.set(el.dataset.file ?? '', el);
  const total = game.assets.reduce((n, a) => n + a.files.reduce((m, f) => m + f.size, 0), 0);
  let done = 0;
  const urls = new Map<string, string>();
  for (const a of game.assets) {
    for (const f of a.files) {
      const key = `${a.id}/${f.path}`;
      const tag = tags.get(key);
      if (!tag) continue;
      urls.set(key, URL.createObjectURL(new Blob([base64ToBytes(tag.textContent ?? '') as BlobPart])));
      tag.remove(); // free the text copy
      done += f.size;
      loading.progress(done, total);
      await new Promise((r) => setTimeout(r, 0)); // let the progress bar draw
    }
  }
  loading.remove();
  return run(container, game, urls);
}

function run(container: HTMLElement, game: ExportedGame, urls: Map<string, string>): Promise<Engine> {
  const byId = new Map(game.assets.map((a) => [a.id, a]));
  const resolver: AssetResolver = {
    async resolve(id: string): Promise<ResolvedAsset | undefined> {
      const a = byId.get(id);
      if (!a) return undefined;
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        main: a.main,
        files: a.files.map((f) => f.path),
        data: a.data,
        url: (path) => urls.get(`${a.id}/${path}`),
      };
    },
  };
  return startGame({ container, scene: game.scene, assets: resolver, credits: game.credits, title: game.title });
}
