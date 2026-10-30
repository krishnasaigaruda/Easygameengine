import { BUILTIN_MATERIALS, PARTICLE_PRESETS, Transform, defaultMaterialData, type AssetCredit, type Entity } from '@ege/runtime';
import { addComponent, createObjectWith, editComponent } from '../editor/actions';
import { unzipSync } from 'fflate';
import { useEditor } from '../state/editorStore';
import { importFiles } from '../assets/importActions';
import { createMaterial, renameAsset, updateAssetData } from '../assets/library';
import type { IncomingFile } from '../assets/importer';
import { applyMaterial, placeModel, setSky } from '../editor/assetActions';
import { loadObjaverse, type StoreItem } from './catalog';
import { markBroken } from './brokenItems';
import { viewportController } from '../viewport/viewportRef';
import { WEB_WATER } from './builtin';

/** The file no longer exists on the server. */
class GoneError extends Error {
  constructor() {
    super('This asset was removed by its author');
    this.name = 'GoneError';
  }
}
import { useStoreUi } from './storeState';

const POLYHAVEN_API = 'https://api.polyhaven.com';
const controllers = new Map<string, AbortController>();

const setProgress = (key: string, value: number | null) =>
  useStoreUi.setState((s) => {
    const downloads = { ...s.downloads };
    if (value === null) delete downloads[key];
    else downloads[key] = value;
    return { downloads };
  });

/** Fetch several URLs, reporting combined progress (bytes) as 0..1, or -1 if sizes are unknown. */
async function fetchAll(
  urls: string[],
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<Blob[]> {
  const loaded = new Array<number>(urls.length).fill(0);
  const totals = new Array<number>(urls.length).fill(0);
  const report = () => {
    const total = totals.reduce((a, b) => a + b, 0);
    onProgress(total > 0 && totals.every((t) => t > 0) ? loaded.reduce((a, b) => a + b, 0) / total : -1);
  };
  return Promise.all(
    urls.map(async (url, i) => {
      const res = await fetch(url, { signal });
      if (res.status === 404 || res.status === 410) throw new GoneError();
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      totals[i] = Number(res.headers.get('content-length')) || 0;
      if (!res.body) return res.blob();
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded[i] += value.byteLength;
        report();
      }
      return new Blob(chunks as BlobPart[]);
    }),
  );
}

const slug = (s: string) => s.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'asset';

interface PhFile {
  url: string;
  size?: number;
  include?: Record<string, { url: string; size?: number }>;
}
type PhFiles = Record<string, Record<string, Record<string, PhFile>>>;

async function polyHavenFiles(id: string, signal: AbortSignal): Promise<PhFiles> {
  const res = await fetch(`${POLYHAVEN_API}/files/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) throw new Error(`Poly Haven files unavailable (HTTP ${res.status})`);
  return (await res.json()) as PhFiles;
}

/** Pick the first resolution that exists, preferring web-friendly sizes. */
function pickRes<T>(byRes: Record<string, T> | undefined, prefs: string[]): T | undefined {
  if (!byRes) return undefined;
  for (const r of prefs) if (byRes[r]) return byRes[r];
  return Object.values(byRes)[0];
}

/** Download size of a single file, asked from the server before downloading (undefined if unknown). */
async function headSize(url: string, signal: AbortSignal): Promise<number | undefined> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal });
    const n = Number(res.headers.get('content-length'));
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** Bigger than this: ask first (it would make the game slow and use lots of memory). */
const BIG_DOWNLOAD = 40e6;

/** How big a store item's download is, when we can tell. */
async function downloadSize(files: { urls: string[]; bytes?: number }, signal: AbortSignal): Promise<number | undefined> {
  if (files.bytes) return files.bytes;
  if (files.urls.length === 1) return headSize(files.urls[0], signal);
  return undefined;
}

/** Works out which files to download for a store item, and what to call them. */
async function filesFor(item: StoreItem, signal: AbortSignal): Promise<{ urls: string[]; paths: string[]; bytes?: number }> {
  if (item.provider === 'smithsonian') {
    return { urls: [item.fileUrl!], paths: [`${slug(item.name)}.glb`] };
  }
  if (item.provider === 'objaverse') {
    const { modelUrl } = await loadObjaverse();
    const shard = `000-${String(item.shard ?? 0).padStart(3, '0')}`;
    return { urls: [modelUrl.replace('{shard}', shard).replace('{uid}', item.id)], paths: [`${slug(item.name)}.glb`] };
  }
  const files = await polyHavenFiles(item.id, signal);
  if (item.kind === 'hdri') {
    const hdr = pickRes(files.hdri, ['2k', '1k', '4k'])?.hdr;
    if (!hdr) throw new Error('No HDR file found');
    return { urls: [hdr.url], paths: [`${item.id}.hdr`] };
  }
  if (item.kind === 'model') {
    const gltf = pickRes(files.gltf, ['1k', '2k'])?.gltf;
    if (!gltf) throw new Error('No glTF version of this model');
    const includes = Object.entries(gltf.include ?? {});
    return {
      urls: [gltf.url, ...includes.map(([, f]) => f.url)],
      paths: [`${item.id}.gltf`, ...includes.map(([p]) => p)],
      bytes: (gltf.size ?? 0) + includes.reduce((n, [, f]) => n + (f.size ?? 0), 0) || undefined,
    };
  }
  // Texture set → name the files so the importer builds a material from them.
  const maps: [string, string][] = [
    ['Diffuse', 'diff'],
    ['nor_gl', 'nor_gl'],
    ['Rough', 'rough'],
    ['AO', 'ao'],
    ['Metal', 'metal'],
    ['Displacement', 'disp'],
  ];
  const urls: string[] = [];
  const paths: string[] = [];
  for (const [key, suffix] of maps) {
    const jpg = pickRes(files[key], ['1k', '2k'])?.jpg;
    if (!jpg) continue;
    urls.push(jpg.url);
    paths.push(`${item.id}_${suffix}_1k.jpg`);
  }
  if (!urls.length) throw new Error('No texture maps found');
  return { urls, paths };
}

/**
 * Downloads a store item into the project and uses it: models are placed in the scene,
 * skies are applied, materials go on the selected object.
 */
/**
 * Download an Asset Store item into the project and use it (models are placed in the scene).
 * `quiet` (the assistant): no questions, too-big models are skipped, and models aren't placed;
 * it returns the imported model's asset id.
 */
export async function addStoreItem(item: StoreItem, opts: { quiet?: boolean; maxBytes?: number } = {}): Promise<string | undefined> {
  const { log } = useEditor.getState();
  if (item.kind === 'effect') return void (await addEffect(item));
  if (item.provider === 'builtin') return void (await addBuiltin(item));
  if (item.provider === 'openverse' || item.provider === 'commons') return void (await addMedia(item));
  if (controllers.has(item.key)) return;
  const controller = new AbortController();
  controllers.set(item.key, controller);
  setProgress(item.key, 0);
  try {
    let blobs: Blob[];
    let paths: string[];
    if (item.provider === 'ambientcg') {
      ({ blobs, paths } = await ambientFiles(item, controller.signal));
    } else {
      const files = await filesFor(item, controller.signal);
      const size = await downloadSize(files, controller.signal);
      if (opts.quiet && size && size > (opts.maxBytes ?? BIG_DOWNLOAD)) return;
      if (size && size > BIG_DOWNLOAD) {
        const ok = window.confirm(
          `"${item.name}" is ${Math.round(size / 1e6)} MB. Models this big are usually film-quality scans: they make games slow and use a lot of memory (especially if you place many). Download it anyway?`,
        );
        if (!ok) {
          log('info', `Skipped "${item.name}" (${Math.round(size / 1e6)} MB). Try a lighter, game-ready model.`);
          return;
        }
      }
      paths = files.paths;
      blobs = await fetchAll(files.urls, controller.signal, (f) => setProgress(item.key, f));
    }
    const credit: AssetCredit = {
      provider: item.provider,
      sourceId: item.id,
      author: item.author,
      license: item.license,
      url: item.pageUrl,
    };
    const incoming: IncomingFile[] = blobs.map((blob, i) => ({ path: paths[i], blob }));
    // The assistant's models are small parts of a big scene (and share the graphics chip with
    // the assistant): pictures on them up to 1024 pixels, a quarter of the memory of 2048.
    const records = await importFiles(incoming, credit, opts.quiet ? { maxTextureSize: 1024 } : {});
    for (const r of records) if (r.type !== 'texture') await renameAsset(r.id, item.name);

    const model = records.find((r) => r.type === 'model');
    const sky = records.find((r) => r.type === 'hdri');
    const material = records.find((r) => r.type === 'material');
    if (opts.quiet && model) return model.id;
    if (model) await placeModel(model.id);
    else if (sky) setSky(sky.id);
    else if (material) {
      const { selection, engine, selectAsset } = useEditor.getState();
      const target = selection ? engine?.world.getById(selection) : undefined;
      if (target && applyMaterial(target.id, material.id)) {
        // Big surfaces (ground planes) would show one giant stretched image: repeat ~every 4 m.
        const s = target.get(Transform)?.scale ?? [1, 1, 1];
        const repeat = Math.max(1, Math.round(Math.max(Math.abs(s[0]), Math.abs(s[2])) / 4));
        if (repeat > 1) {
          const data = { ...defaultMaterialData(), ...(material.data as object), tiling: [repeat, repeat] };
          await updateAssetData(material.id, data);
        }
      }
      selectAsset(material.id);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') log('info', `Cancelled "${item.name}"`);
    else if (err instanceof GoneError) {
      markBroken(item.key, true);
      log('warn', `"${item.name}" was removed by its author, so it can't be downloaded. It's hidden from the store now.`);
    }
    else log('error', `Couldn't add "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    controllers.delete(item.key);
    setProgress(item.key, null);
  }
}

/** ambientCG ships a zip per material: keep the maps we use, named like a texture set. */
async function ambientFiles(item: StoreItem, signal: AbortSignal): Promise<{ blobs: Blob[]; paths: string[] }> {
  if (!item.fileUrl) throw new Error('No download for this material');
  const [zip] = await fetchAll([item.fileUrl], signal, (f) => setProgress(item.key, f));
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const KEEP: [RegExp, string][] = [
    [/_Color\.(jpe?g|png)$/i, 'diff'],
    [/_NormalGL\.(jpe?g|png)$/i, 'nor_gl'],
    [/_Roughness\.(jpe?g|png)$/i, 'rough'],
    [/_AmbientOcclusion\.(jpe?g|png)$/i, 'ao'],
    [/_Metalness\.(jpe?g|png)$/i, 'metal'],
    [/_Displacement\.(jpe?g|png)$/i, 'disp'],
  ];
  const blobs: Blob[] = [];
  const paths: string[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    const hit = KEEP.find(([re]) => re.test(name));
    if (!hit) continue;
    const ext = name.split('.').pop()!.toLowerCase();
    blobs.push(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ext === 'png' ? 'image/png' : 'image/jpeg' }));
    paths.push(`${item.id}_${hit[1]}_1k.${ext}`);
  }
  if (!blobs.length) throw new Error('No texture maps found in the download');
  return { blobs, paths };
}

/** A built-in particle effect: a new object in front of the camera. */
function addEffect(item: StoreItem): void {
  const data = PARTICLE_PRESETS[item.id];
  if (!data) return;
  const id = createObjectWith(item.name, 'sparkles', { ParticleSystem: { ...data, previewInEditor: true } });
  if (!id) return;
  setTimeout(() => viewportController()?.focusSelected(), 50); // show it right away
  useEditor.getState().log('info', `Added the "${item.name}" effect. Drag it (or its icon) to move it.`);
}

/** Sounds, music and images from Openverse: download, import, then put them to use. */
/** Something in the world a sound can come from (not music, UI or sky/fog settings). */
function isThing(e: Entity): boolean {
  return ['MeshRenderer', 'ModelRenderer', 'CharacterController', 'RigidBody', 'Collider', 'ParticleSystem', 'Light'].some((t) => e.has(t));
}

async function addMedia(item: StoreItem): Promise<void> {
  const { log } = useEditor.getState();
  if (controllers.has(item.key) || !item.fileUrl) return;
  const controller = new AbortController();
  controllers.set(item.key, controller);
  setProgress(item.key, 0);
  try {
    const [blob] = await fetchAll([item.fileUrl], controller.signal, (f) => setProgress(item.key, f));
    const ext = (item.filetype || (item.kind === 'image' ? 'jpg' : 'mp3')).toLowerCase();
    const credit: AssetCredit = { provider: item.provider === 'commons' ? 'commons' : 'openverse', sourceId: item.id, author: item.author, license: item.license, url: item.pageUrl };
    const [asset] = await importFiles([{ path: `${slug(item.name)}.${ext}`, blob }], credit);
    if (!asset) throw new Error('That file type could not be imported');
    await renameAsset(asset.id, item.name);
    const { selection, engine, selectAsset } = useEditor.getState();
    const target = selection ? engine?.world.getById(selection) : undefined;
    if (item.kind === 'music') {
      // Use the selected Music object, or make one.
      if (target?.has('Music')) editComponent(target, 'Music', { track: asset.id });
      else createObjectWith(`Music: ${item.name}`, 'music', { Music: { track: asset.id } });
      log('info', `"${item.name}" will play when the game starts.`);
    } else if (item.kind === 'sound' && !(target && isThing(target)) && (item.duration ?? 0) >= 20) {
      // Ambience (birds, wind, a crowd): its own sound object, heard everywhere, looping.
      createObjectWith(item.name, 'volume', { AudioSource: { clip: asset.id, loop: true, playOnStart: true, spatial: false, volume: 0.5 } });
      log('info', `"${item.name}" plays in the background (looping) when the game starts.`);
    } else if (item.kind === 'sound' && target && isThing(target)) {
      if (target.has('AudioSource')) editComponent(target, 'AudioSource', { clip: asset.id });
      else {
        addComponent(target, 'AudioSource');
        editComponent(target, 'AudioSource', { clip: asset.id, playOnStart: false });
      }
      log('info', `"${item.name}" is now ${target.name}'s sound. Scripts play it with { play: "self" }.`);
    } else {
      selectAsset(asset.id);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') log('info', `Cancelled "${item.name}"`);
    else log('error', `Couldn't add "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    controllers.delete(item.key);
    setProgress(item.key, null);
  }
}

/** Built-in shader material: no download, just a new editable material in the project. */
async function addBuiltin(item: StoreItem): Promise<void> {
  const preset = BUILTIN_MATERIALS.find((m) => m.id === item.id) ?? WEB_WATER.find((m) => m.id === item.id);
  if (!preset) return;
  let data = preset.data;
  if (item.fileUrl) {
    // Download the wave texture first (a plain texture, not named like a texture set).
    if (controllers.has(item.key)) return;
    const controller = new AbortController();
    controllers.set(item.key, controller);
    setProgress(item.key, 0);
    try {
      const [blob] = await fetchAll([item.fileUrl], controller.signal, (f) => setProgress(item.key, f));
      const credit: AssetCredit = { provider: 'web', sourceId: item.id, author: 'three.js authors', license: 'MIT', url: item.pageUrl };
      const [tex] = await importFiles([{ path: `${item.id}-waves.jpg`, blob }], credit);
      if (!tex) throw new Error('The wave texture could not be imported');
      await renameAsset(tex.id, `${preset.name} waves`);
      data = { ...data, normalMap: tex.id };
    } catch (err) {
      if ((err as Error).name !== 'AbortError') useEditor.getState().log('error', `Couldn't add "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      controllers.delete(item.key);
      setProgress(item.key, null);
    }
  }
  const id = await createMaterial(preset.name, data);
  if (!id) return;
  const { selection, selectAsset, log } = useEditor.getState();
  if (selection && applyMaterial(selection, id)) log('info', `Applied "${preset.name}" to the selected object`);
  else log('info', `Added "${preset.name}". Drag it onto an object, or select an object and add it again.`);
  selectAsset(id);
}

export function cancelStoreItem(key: string): void {
  controllers.get(key)?.abort();
}
