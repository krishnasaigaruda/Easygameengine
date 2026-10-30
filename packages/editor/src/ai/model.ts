import type { AppConfig, ModelRecord, WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { beginWork, endWork, pace, releasePause } from './pacer';
import { useEditor } from '../state/editorStore';

/*
 * The assistant's model: a small language model running on this computer's graphics chip
 * (WebGPU, through WebLLM): the one trained on this engine (ai-training). Nothing is downloaded
 * until the person asks. It comes from the site itself (scripts/pack-ai-model.mjs, split into
 * files any static host takes), is kept in the browser afterwards (works offline), and can also be
 * saved to / loaded from a folder.
 */

export interface ModelChoice {
  key: string;
  label: string;
  note: string;
  /** For graphics chips with 16-bit floats (most), and without. */
  f16: string;
  f32: string;
  /** Rough download size, until the real one is known. */
  approxMB: number;
}

/** Models trained from Qwen3 think for themselves: turned on for planning, off for steps. */
const THINKS = (id: string, lib = '') => /^Qwen3/.test(id) || /^Qwen3/.test(lib);

/** A model this site ships (see scripts/pack-ai-model.mjs). */
interface Packed {
  id: string;
  lib: string;
  bytes: number;
  /** A model trained on this engine (ai-training), with its name. */
  label?: string;
  custom?: boolean;
  /** Files stored in parts (too big for the host in one piece), joined on download. */
  joined: { file: string; parts: string[]; bytes: number }[];
}

const siteUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, location.href).href;

let packedList: Promise<Packed[]> | null = null;
function packedModels(): Promise<Packed[]> {
  packedList ??= fetch(siteUrl('ai/models.json'))
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<Packed[]>) : []))
    .catch(() => []);
  return packedList;
}

/** WebLLM's own settings for the model. */
const OVERRIDES = { context_window_size: 4096 };

/** The models trained on this engine that this site ships: the only ones the assistant uses. */
export async function trainedModels(): Promise<ModelChoice[]> {
  return (await packedModels())
    .filter((p) => p.custom)
    .map((p) => ({ key: p.id, label: p.label ?? p.id, note: 'Trained on this engine', f16: p.id, f32: p.id, approxMB: Math.round(p.bytes / 1048576) }));
}

/** Where a model's files come from: this site. */
async function recordFor(id: string): Promise<{ record: ModelRecord; packed: Packed }> {
  const packed = (await packedModels()).find((p) => p.id === id);
  if (!packed) throw new Error("This site doesn't have the assistant's model.");
  const record: ModelRecord = { model: siteUrl(`ai/${id}/resolve/main/`), model_id: id, model_lib: siteUrl(`ai/${packed.lib}`), overrides: OVERRIDES };
  return { record, packed };
}

async function appConfigFor(id: string): Promise<{ appConfig: AppConfig; record: ModelRecord; packed?: Packed }> {
  const { record, packed } = await recordFor(id);
  return { appConfig: { model_list: [record] }, record, packed };
}

export interface GpuInfo {
  ok: boolean;
  f16: boolean;
  reason?: string;
}

/** Can this browser run the model? (WebGPU, and whether it has 16-bit floats.) */
export async function checkGpu(): Promise<GpuInfo> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) return { ok: false, f16: false, reason: 'This browser has no WebGPU. Use a recent Chrome or Edge on a computer.' };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, f16: false, reason: 'No graphics chip was offered to the page (WebGPU is turned off or not supported here).' };
    return { ok: true, f16: adapter.features.has('shader-f16') };
  } catch (err) {
    return { ok: false, f16: false, reason: `WebGPU failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The exact model for this computer. */
export const modelIdFor = (choice: ModelChoice, gpu: GpuInfo) => (gpu.f16 ? choice.f16 : choice.f32);

/** Download size in bytes (from the model's own file list). */
export async function downloadBytes(id: string): Promise<number | null> {
  const { record, packed } = await recordFor(id);
  if (packed) return packed.bytes;
  try {
    const res = await fetch(new URL('tensor-cache.json', record.model).href);
    const cache = (await res.json()) as { records: { nbytes: number }[] };
    return cache.records.reduce((n, r) => n + r.nbytes, 0) + 5e6;
  } catch {
    return null;
  }
}

/** Is it already on this computer (in this browser)? */
export async function isDownloaded(id: string): Promise<boolean> {
  const { hasModelInCache } = await import('@mlc-ai/web-llm');
  const { appConfig } = await appConfigFor(id);
  try {
    return await hasModelInCache(id, appConfig);
  } catch {
    return false;
  }
}

export interface Progress {
  /** 0–1. */
  fraction: number;
  text: string;
}

/** Share of the progress bar for downloading a model the site ships (the rest is starting it). */
const DOWNLOAD_SHARE = 0.9;

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  return res;
}

/** The files one after another, as one download (streamed: nothing large is held in memory). */
function joinedStream(urls: string[]): ReadableStream<Uint8Array> {
  let next = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (next >= urls.length) return controller.close();
          reader = (await fetchOk(urls[next++])).body!.getReader();
        }
        const { done, value } = await reader.read();
        if (!done) return controller.enqueue(value);
        reader = null;
      }
    },
  });
}

/** Download a file (or its parts) straight into the cache, tried a few times: a dropped connection shouldn't stop a 2 GB download. */
async function cacheFile(cache: Cache, key: string, urls: string[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = urls.length === 1 ? await fetchOk(urls[0]) : new Response(joinedStream(urls), { headers: { 'content-type': 'application/octet-stream' } });
      return await cache.put(new Request(key), res);
    } catch (err) {
      if (attempt >= 4) throw new Error(`Couldn't download ${key.split('/').pop()} (${err instanceof Error ? err.message : String(err)})`, { cause: err });
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * A model the site ships: download its weights here (a few at a time, retrying) and keep them where
 * WebLLM looks, joining files stored in parts. WebLLM then only reads them from the browser.
 */
async function downloadSiteModel(record: ModelRecord, packed: Packed, onProgress: (p: Progress) => void): Promise<void> {
  const cache = await caches.open('webllm/model');
  const base = new URL(record.model).href;
  const list = (await (await fetch(new URL('tensor-cache.json', base).href)).json()) as { records: { dataPath: string; nbytes: number }[] };
  const joined = new Map(packed.joined.map((j) => [j.file, j.parts]));
  const files = list.records.map((s) => ({ key: new URL(s.dataPath, base).href, parts: joined.get(s.dataPath) ?? [s.dataPath], bytes: s.nbytes }));
  const total = files.reduce((n, f) => n + f.bytes, 0);
  let got = 0;
  const report = () => onProgress({ fraction: Math.min(1, got / total) * DOWNLOAD_SHARE, text: `Downloading the model… ${Math.round(got / 1048576)} MB` });
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      if (!(await cache.match(new Request(f.key)))) await cacheFile(cache, f.key, f.parts.map((part) => new URL(part, base).href));
      got += f.bytes;
      report();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

let engine: { id: string; engine: WebWorkerMLCEngine; worker: Worker; thinks: boolean; trained: boolean } | null = null;

/** Unused for this long, the model leaves the graphics chip and memory (it starts again by itself, from the browser's copy). */
const IDLE_MS = 5 * 60_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
function restartIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void unloadModel(), IDLE_MS);
}

/** Is this model running right now? */
export const isRunning = (id: string) => engine?.id === id;

/** Download (first time) and start the model. */
export async function loadModel(id: string, onProgress: (p: Progress) => void): Promise<WebWorkerMLCEngine> {
  if (engine?.id === id) return engine.engine;
  await unloadModel();
  const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
  const { appConfig, record, packed } = await appConfigFor(id);
  if (packed) await downloadSiteModel(record, packed, onProgress);
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const offset = packed ? DOWNLOAD_SHARE : 0;
  const e = await CreateWebWorkerMLCEngine(worker, id, {
    appConfig,
    initProgressCallback: (r) => onProgress({ fraction: offset + r.progress * (1 - offset), text: plainProgress(r.text) }),
  });
  engine = { id, engine: e, worker, thinks: THINKS(id, packed?.lib.split('/').pop()), trained: !!packed?.custom };
  restartIdle();
  return e;
}

/** WebLLM's progress lines, in plain words. */
function plainProgress(text: string): string {
  const fetchMatch = /Fetching param cache\[(\d+)\/(\d+)\]: (\d+)MB fetched/.exec(text);
  if (fetchMatch) return `Downloading the model… ${fetchMatch[3]} MB`;
  if (/Loading model from cache\[(\d+)\/(\d+)\]/.test(text)) return 'Starting the model…';
  if (/shader|compil/i.test(text)) return 'Preparing the graphics chip…';
  if (/Finish loading/i.test(text)) return 'Ready';
  return 'Starting the model…';
}

export async function unloadModel(): Promise<void> {
  clearTimeout(idleTimer);
  if (!engine) return;
  const e = engine;
  engine = null;
  try {
    await e.engine.unload();
  } catch {
    // already gone
  }
  e.worker.terminate();
}

/** Remove the downloaded model from this browser. */
export async function deleteModel(id: string): Promise<void> {
  if (engine?.id === id) await unloadModel();
  const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
  const { appConfig } = await appConfigFor(id);
  await deleteModelAllInfoInCache(id, appConfig);
}

// ── keeping the model in a folder ───────────────────────────────────────────

const CACHE_SCOPES = ['webllm/model', 'webllm/config', 'webllm/wasm'] as const;
const scopeOf = (name: string) => (name.endsWith('.wasm') ? 'webllm/wasm' : name === 'mlc-chat-config.json' ? 'webllm/config' : 'webllm/model');

/** Every file of the model WebLLM keeps, with the name it has in a folder. */
async function cachedFiles(id: string): Promise<{ name: string; scope: string; request: Request }[]> {
  const { record } = await recordFor(id);
  const base = new URL(record.model).href;
  const lib = new URL(record.model_lib).href;
  const out: { name: string; scope: string; request: Request }[] = [];
  for (const scope of CACHE_SCOPES) {
    const cache = await caches.open(scope);
    for (const request of await cache.keys()) {
      if (request.url === lib) out.push({ name: lib.split('/').pop()!, scope, request });
      else if (request.url.startsWith(base)) out.push({ name: request.url.slice(base.length), scope, request });
    }
  }
  return out;
}

/** Save the (downloaded) model into a folder the person picked. */
export async function saveToFolder(id: string, dir: FileSystemDirectoryHandle, onProgress: (p: Progress) => void): Promise<number> {
  const files = await cachedFiles(id);
  if (!files.length) throw new Error('The model is not downloaded yet.');
  let n = 0;
  for (const f of files) {
    const res = await (await caches.open(f.scope)).match(f.request);
    if (!res) continue;
    const handle = await dir.getFileHandle(f.name, { create: true });
    const w = await handle.createWritable();
    await w.write(await res.blob());
    await w.close();
    onProgress({ fraction: ++n / files.length, text: `Saving ${f.name}` });
  }
  const info = await dir.getFileHandle('easy-game-engine-model.json', { create: true });
  const w = await info.createWritable();
  await w.write(JSON.stringify({ id, files: files.map((f) => f.name) }, null, 2));
  await w.close();
  return n;
}

/** Load a model saved with saveToFolder (no download). Returns its id. */
export async function loadFromFolder(dir: FileSystemDirectoryHandle, onProgress: (p: Progress) => void): Promise<string> {
  let info: { id: string; files: string[] };
  try {
    info = JSON.parse(await (await (await dir.getFileHandle('easy-game-engine-model.json')).getFile()).text());
  } catch {
    throw new Error('That folder has no saved model (easy-game-engine-model.json is missing).');
  }
  const { record } = await recordFor(info.id);
  const base = new URL(record.model).href;
  let n = 0;
  for (const name of info.files) {
    const file = await (await dir.getFileHandle(name)).getFile();
    const url = name.endsWith('.wasm') ? new URL(record.model_lib).href : new URL(name, base).href;
    await (await caches.open(scopeOf(name))).put(new Request(url), new Response(file));
    onProgress({ fraction: ++n / info.files.length, text: `Loading ${name}` });
  }
  return info.id;
}

// ── asking ──────────────────────────────────────────────────────────────────

export interface ChatRequest {
  system: string;
  user: string;
  schema?: object;
  think?: boolean;
  maxTokens?: number;
  temperature?: number;
  onText?: (soFar: string, thinking: boolean) => void;
}

/** Tests (dev build only): answer requests without a real model. */
let fake: ((o: ChatRequest) => string | Promise<string>) | null = null;
export function setFakeModel(fn: typeof fake): void {
  if (import.meta.env.DEV) fake = fn;
}
export const hasFakeModel = () => !!fake;

export interface ChatResult {
  /** The answer (for a schema: JSON text). */
  text: string;
  /** What the model thought first (Qwen3 thinking), if it did. */
  thought?: string;
}

/**
 * One request to the model. With a `schema` the answer is forced into that JSON shape. `think`
 * lets models that can (Qwen3) think before answering; it's always off for JSON answers (the
 * shape can't hold thoughts), so think in a separate free-text request when needed.
 */
export async function chat(o: ChatRequest): Promise<ChatResult> {
  if (fake) {
    const text = await fake(o);
    o.onText?.(text, false);
    return { text };
  }
  if (!engine) throw new Error('The model is not started.');
  const id = engine.id;
  try {
    return await chatOnce(o);
  } catch (err) {
    // The browser lost the graphics chip (it was reset, or ran out of memory): start the model
    // again from the browser's copy and ask once more.
    if (!GPU_LOST.test(err instanceof Error ? `${err.name} ${err.message}` : String(err))) throw err;
    await unloadModel();
    try {
      await loadModel(id, () => {});
    } catch (again) {
      throw new Error(plainError(again), { cause: again });
    }
    return chatOnce(o);
  }
}

const GPU_LOST = /mapAsync|Instance reference|device (was |is )?lost|GPUBuffer|DXGI|context lost/i;
/** The browser has no graphics chip to give (it reset it, and holds it back for a while). */
const NO_GPU = /compatible GPU|requestAdapter|no (gpu )?adapter|WebGPU is not (supported|available)/i;

/** An error from the model in plain words (the graphics chip ones say what to do). */
export function plainError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (NO_GPU.test(text))
    return 'The graphics chip was reset (it had too much to do at once), and the browser hasn\'t given it back yet. Reload the page; if this shows again, quit and reopen Chrome. A lower "Use up to" and Quality help it not happen.';
  if (GPU_LOST.test(text))
    return 'The graphics chip was reset while the AI worked (it had too much to do at once). Reload the page and ask again; a lower "Use up to" and Quality help.';
  return text;
}

/** Frames a second the 3D view draws while the model writes (the graphics chip is the model's). */
const WRITING_FPS = 2;

async function chatOnce(o: ChatRequest): Promise<ChatResult> {
  // The view and the model on the graphics chip at once can make the browser reset it: while the
  // model writes, the view barely draws (it's back to normal for the steps, so you see them).
  const view = useEditor.getState().engine;
  const was = view?.maxFps ?? 0;
  if (view) view.maxFps = WRITING_FPS;
  try {
    return await writeAnswer(o);
  } finally {
    if (view) view.maxFps = was;
  }
}

async function writeAnswer(o: ChatRequest): Promise<ChatResult> {
  if (!engine) throw new Error('The model is not started.');
  clearTimeout(idleTimer);
  const stream = await engine.engine.chat.completions.create({
    messages: [
      { role: 'system', content: o.system },
      { role: 'user', content: o.user },
    ],
    stream: true,
    temperature: o.temperature ?? (o.schema ? 0.2 : 0.5),
    max_tokens: o.maxTokens ?? (o.schema ? 900 : 400),
    ...(o.schema ? { response_format: { type: 'json_object' as const, schema: JSON.stringify(o.schema) } } : {}),
    // A model trained on this engine learned to answer (and write its notes) with thinking off.
    ...(engine.thinks ? { extra_body: { enable_thinking: !engine.trained && !!o.think && !o.schema } } : {}),
  });
  let raw = '';
  // One piece at a time, resting in between so the computer stays usable (see pacer.ts).
  const pieces = stream[Symbol.asyncIterator]();
  beginWork();
  try {
    for (;;) {
      const t = performance.now();
      const { value: chunk, done } = await pieces.next();
      if (done) break;
      raw += chunk.choices[0]?.delta?.content ?? '';
      const open = raw.includes('<think>') && !raw.includes('</think>');
      o.onText?.(raw.replace(/<think>[\s\S]*?(<\/think>|$)/, '').trim(), open);
      await pace(performance.now() - t);
    }
  } finally {
    endWork();
  }
  restartIdle();
  const m = /<think>([\s\S]*?)<\/think>/.exec(raw);
  return { text: raw.replace(/<think>[\s\S]*?<\/think>/, '').trim(), thought: m?.[1].trim() || undefined };
}

/** Stop writing the answer. */
export function stopModel(): void {
  releasePause();
  engine?.engine.interruptGenerate();
}
