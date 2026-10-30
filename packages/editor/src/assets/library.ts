import { create } from 'zustand';
import {
  defaultMaterialData,
  optimizedGlb,
  newId,
  type AssetResolver,
  type AssetType,
  type Engine,
  type MaterialAssetData,
  type ResolvedAsset,
} from '@ege/runtime';
import {
  deleteAsset as dbDelete,
  listAssets,
  saveAsset,
  type AssetRecord,
} from '../persistence/projectStore';
import { useEditor } from '../state/editorStore';
import { makeThumbnail, MODEL_THUMB_VERSION, PICTURE_THUMB_VERSION } from './thumbnails';

/** What panels need to show an asset (no blobs). */
export interface AssetSummary {
  id: string;
  name: string;
  type: AssetType;
  size: number;
  animations: string[];
  triangles?: number;
  thumbnailUrl?: string;
  /** Models: the separate models inside the file (an asset pack). */
  parts?: { path: string; name: string; thumbnailUrl?: string }[];
  credit?: AssetRecord['meta']['credit'];
  createdAt: number;
}

interface LibraryState {
  assets: AssetSummary[];
  loading: boolean;
}

export const useLibrary = create<LibraryState>(() => ({ assets: [], loading: false }));

/** Full records for the open project, kept in memory so the resolver is instant. */
const records = new Map<string, AssetRecord>();
/** Blob URLs we've handed out, per asset, so we can revoke them on delete/close. */
const blobUrls = new Map<string, Map<string, string>>();
const thumbUrls = new Map<string, string>();
let engineRef: Engine | null = null;

/** A preview's URL, made once (`key`: the asset id, or id#part). */
function thumbUrl(key: string, blob: Blob | undefined): string | undefined {
  if (blob && !thumbUrls.has(key)) thumbUrls.set(key, URL.createObjectURL(blob));
  return thumbUrls.get(key);
}

/** Forget an asset's previews (its own and its parts'). */
function dropThumbs(id: string): void {
  for (const [key, url] of thumbUrls)
    if (key === id || key.startsWith(`${id}#`)) {
      URL.revokeObjectURL(url);
      thumbUrls.delete(key);
    }
}

function summarize(r: AssetRecord): AssetSummary {
  thumbUrl(r.id, r.meta.thumbnail);
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    size: r.meta.size,
    animations: r.meta.animations ?? [],
    triangles: r.meta.triangles,
    thumbnailUrl: thumbUrls.get(r.id),
    ...(r.meta.parts?.length ? { parts: r.meta.parts.map((p) => ({ path: p.path, name: p.name, thumbnailUrl: thumbUrl(`${r.id}#${p.path}`, p.thumbnail) })) } : {}),
    credit: r.meta.credit,
    createdAt: r.createdAt,
  };
}

function publish(): void {
  const list = [...records.values()].sort((a, b) => b.createdAt - a.createdAt).map(summarize);
  useLibrary.setState({ assets: list });
}

function revoke(id: string): void {
  for (const url of blobUrls.get(id)?.values() ?? []) URL.revokeObjectURL(url);
  blobUrls.delete(id);
  dropThumbs(id);
}

/** Serves asset files to the engine from the in-memory records. */
export const editorResolver: AssetResolver = {
  async resolve(id: string): Promise<ResolvedAsset | undefined> {
    const r = records.get(id);
    if (!r) return undefined;
    let urls = blobUrls.get(id);
    if (!urls) blobUrls.set(id, (urls = new Map()));
    const cache = urls;
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      main: r.main,
      files: Object.keys(r.files),
      data: r.data,
      url(path: string) {
        const blob = r.files[path];
        if (!blob) return undefined;
        let u = cache.get(path);
        if (!u) cache.set(path, (u = URL.createObjectURL(blob)));
        return u;
      },
    };
  },
};

/** Connect the library to an engine (sets the engine's asset resolver). */
export function attachLibrary(engine: Engine | null): void {
  engineRef = engine;
  if (engine) engine.assets.resolver = editorResolver;
}

/** Load the assets of a project (call before loading its scene so models resolve). */
export async function openLibrary(projectId: string): Promise<void> {
  for (const id of records.keys()) revoke(id);
  records.clear();
  engineRef?.assets.reset(); // the old scene is about to be replaced; no reload storm
  useLibrary.setState({ assets: [], loading: true });
  try {
    for (const r of await listAssets(projectId)) records.set(r.id, r);
  } finally {
    useLibrary.setState({ loading: false });
    publish();
  }
  // Older imports may be missing previews; make them in the background.
  const outdated = (r: AssetRecord) =>
    (r.type === 'texture' && (r.meta.thumbVersion ?? 1) < PICTURE_THUMB_VERSION) || (r.type === 'model' && (r.meta.thumbVersion ?? 1) < MODEL_THUMB_VERSION);
  for (const r of records.values()) if (!r.meta.thumbnail || outdated(r)) void refreshMeta(r.id);
}

export function getAssetRecord(id: string): AssetRecord | undefined {
  return records.get(id);
}

export function assetSummary(id: string): AssetSummary | undefined {
  return useLibrary.getState().assets.find((a) => a.id === id);
}

/** Store new assets, then build thumbnails / read animation names in the background. */
export async function addAssets(list: AssetRecord[]): Promise<void> {
  for (const r of list) {
    await saveAsset(r);
    records.set(r.id, r);
  }
  publish();
  for (const r of list) void refreshMeta(r.id);
}

/** Recompute thumbnail + model info for one asset and save it. */
export async function refreshMeta(id: string): Promise<void> {
  const r = records.get(id);
  const engine = engineRef;
  if (!r || !engine) return;
  try {
    const info = await makeThumbnail(engine, r);
    const current = records.get(id);
    if (!current) return; // deleted meanwhile
    current.meta = { ...current.meta, ...info };
    await saveAsset(current);
    dropThumbs(id);
    publish();
  } catch (err) {
    // Renamed or removed while the preview was being made (templates re-number their assets): nothing to report.
    if (records.get(id) !== r) return;
    useEditor.getState().log('warn', `Couldn't preview "${r.name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function renameAsset(id: string, name: string): Promise<void> {
  const r = records.get(id);
  if (!r || !name.trim()) return;
  r.name = name.trim();
  r.updatedAt = Date.now();
  await saveAsset(r);
  publish();
}

/** Update a data-only asset (material settings) and refresh everything using it. */
export async function updateAssetData(id: string, data: unknown): Promise<void> {
  const r = records.get(id);
  if (!r) return;
  r.data = data;
  r.updatedAt = Date.now();
  engineRef?.assets.invalidate(id);
  publish(); // re-render inspectors right away (thumbnail follows later)
  await saveAsset(r);
  void refreshMeta(id);
}

export async function removeAsset(id: string): Promise<void> {
  const r = records.get(id);
  if (!r) return;
  records.delete(id);
  revoke(id);
  engineRef?.assets.invalidate(id);
  await dbDelete(id);
  publish();
}

/** Every asset id referenced by the scene (component fields + sky) — for "in use" warnings. */
export function assetUsage(engine: Engine): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: unknown) => typeof id === 'string' && id && counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const e of engine.world.all()) {
    for (const type of e.componentTypes()) {
      for (const v of Object.values(e.get(type) ?? {})) if (records.has(v as string)) bump(v);
    }
  }
  bump(engine.settings.environment.asset);
  for (const r of records.values()) {
    if (r.type !== 'material' || !r.data) continue;
    for (const v of Object.values(r.data as Record<string, unknown>)) if (records.has(v as string)) bump(v);
  }
  return counts;
}

/** All records of the open project (for export). */
export function allAssetRecords(): AssetRecord[] {
  return [...records.values()];
}

// ── script assets ───────────────────────────────────────────────────────────

const SCRIPT_FILE = 'script.easy';

export const NEW_SCRIPT_TEMPLATE = `{
  // Values this object remembers. Read them as self.name, change them with set / add.
  props: {
    speed: 2,
  },

  // What happens, and when.
  on: {
    start: [
      { log: "Hello from {self.name}!" },
    ],
    touch: [
      { if: "other.is('player')" },
      { say: "You touched {self.name}" },
    ],
  },
}
`;

/** Create a new EasyScript asset in the open project; returns its id. */
export async function createScript(name: string, source = NEW_SCRIPT_TEMPLATE): Promise<string | null> {
  const projectId = useEditor.getState().projectId;
  if (!projectId) return null;
  const now = Date.now();
  const blob = new Blob([source], { type: 'text/plain' });
  const record: AssetRecord = {
    id: newId(),
    projectId,
    name: name.trim() || 'New Script',
    type: 'script',
    main: SCRIPT_FILE,
    files: { [SCRIPT_FILE]: blob },
    meta: { size: blob.size },
    createdAt: now,
    updatedAt: now,
  };
  await addAssets([record]);
  return record.id;
}

/** The text of a script asset (empty string if missing). */
export async function getAssetText(id: string): Promise<string> {
  const r = records.get(id);
  const blob = r?.files[r.main];
  return blob ? blob.text() : '';
}

/** Replace a script's text. Running games pick the change up immediately (hot reload). */
export async function updateAssetText(id: string, text: string): Promise<void> {
  const r = records.get(id);
  if (!r) return;
  const blob = new Blob([text], { type: 'text/plain' });
  r.files = { ...r.files, [r.main]: blob };
  r.meta = { ...r.meta, size: blob.size };
  r.updatedAt = Date.now();
  // Fresh blob URL for the new content.
  const url = blobUrls.get(id)?.get(r.main);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.get(id)!.delete(r.main);
  }
  engineRef?.assets.invalidate(id);
  publish();
  await saveAsset(r);
}

/**
 * A newly imported model, made compact before anything uses it: each repeated part kept once,
 * pictures saved compactly. Characters (with a skeleton) stay as they are, and so does a model
 * that wouldn't get much smaller. Returns the bytes saved.
 */
export async function compactNewModel(id: string, maxTextureSize?: number): Promise<number> {
  const r = records.get(id);
  if (!r || r.type !== 'model' || !engineRef) return 0;
  try {
    const { object, animations } = await engineRef.assets.instantiate(id);
    let rigged = false;
    object.traverse((o) => {
      if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) rigged = true;
    });
    if (rigged) return 0;
    const { blob } = await optimizedGlb(object, animations, maxTextureSize);
    if (blob.size > r.meta.size * 0.85) return 0;
    const saved = r.meta.size - blob.size;
    await replaceModelFile(id, blob, `${r.name.replace(/[^\w ()-]+/g, '') || 'model'}.glb`);
    return saved;
  } catch {
    return 0; // keep the original if anything about it can't be re-saved
  }
}

/** Replace a model's file with a new self-contained .glb (e.g. with an added animation). */
export async function replaceModelFile(id: string, blob: Blob, fileName: string): Promise<void> {
  const r = records.get(id);
  if (!r) return;
  for (const url of blobUrls.get(id)?.values() ?? []) URL.revokeObjectURL(url);
  blobUrls.delete(id);
  r.main = fileName;
  r.files = { [fileName]: blob };
  r.meta = { ...r.meta, size: blob.size };
  r.updatedAt = Date.now();
  engineRef?.assets.invalidate(id);
  publish();
  await saveAsset(r);
  void refreshMeta(id); // animation names, thumbnail
}

// ── material assets ─────────────────────────────────────────────────────────

/** Create a material asset (optionally from texture ids); returns its id. */
export async function createMaterial(name: string, data: Partial<MaterialAssetData> = {}): Promise<string | null> {
  const projectId = useEditor.getState().projectId;
  if (!projectId) return null;
  const now = Date.now();
  const record: AssetRecord = {
    id: newId(),
    projectId,
    name: name.trim() || 'New Material',
    type: 'material',
    main: '',
    files: {},
    data: { ...defaultMaterialData(), ...data },
    meta: { size: 0 },
    createdAt: now,
    updatedAt: now,
  };
  await addAssets([record]);
  return record.id;
}

// This module holds live state (records, blob URLs). Hot-swapping it would leave the editor
// with an empty library, so during development reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

// ── project credits (credits.json) ─────────────────────────────────────────

/** The project's own credits list: for things the Asset Store didn't credit (your imports, music by a friend…). */
export const CREDITS_FILE = 'credits.json';

export interface ProjectCredit {
  /** What it is: "Castle model", "Theme music". */
  name: string;
  author: string;
  license: string;
  url: string;
}

const CREDITS_TEMPLATE = `{
  "credits": []
}
`;

export function creditsAsset(): AssetRecord | undefined {
  return [...records.values()].find((r) => r.type === 'data' && r.name === CREDITS_FILE);
}

/** Every project has a credits.json (made the first time it opens). */
export async function ensureCreditsFile(): Promise<void> {
  const projectId = useEditor.getState().projectId;
  if (!projectId || creditsAsset()) return;
  const now = Date.now();
  const blob = new Blob([CREDITS_TEMPLATE], { type: 'application/json' });
  await addAssets([
    { id: newId(), projectId, name: CREDITS_FILE, type: 'data', main: CREDITS_FILE, files: { [CREDITS_FILE]: blob }, meta: { size: blob.size }, createdAt: now, updatedAt: now },
  ]);
}

/** The entries of a credits.json (forgiving: a hand-edited file with mistakes gives what it can). */
export function parseCredits(text: string): ProjectCredit[] {
  try {
    const data = JSON.parse(text) as { credits?: unknown } | unknown[];
    const list = Array.isArray(data) ? data : Array.isArray((data as { credits?: unknown }).credits) ? ((data as { credits: unknown[] }).credits) : [];
    return list
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({ name: String(c.name ?? ''), author: String(c.author ?? ''), license: String(c.license ?? ''), url: String(c.url ?? '') }))
      .filter((c) => c.name || c.author);
  } catch {
    return [];
  }
}

export async function readProjectCredits(): Promise<ProjectCredit[]> {
  const r = creditsAsset();
  const blob = r?.files[r.main];
  return blob ? parseCredits(await blob.text()) : [];
}

export async function writeProjectCredits(list: ProjectCredit[]): Promise<void> {
  await ensureCreditsFile();
  const r = creditsAsset();
  if (!r) return;
  await updateAssetText(r.id, `${JSON.stringify({ credits: list }, null, 2)}\n`);
}

/** Who made one of your own imports (it then appears in the game's Credits). */
export async function setAssetCredit(id: string, credit: { author: string; license: string; url: string }): Promise<void> {
  const r = records.get(id);
  if (!r) return;
  const empty = !credit.author.trim() && !credit.url.trim() && !credit.license.trim();
  const keep = r.meta.credit && r.meta.credit.provider !== 'user' ? r.meta.credit : undefined;
  r.meta = { ...r.meta, credit: keep ?? (empty ? undefined : { provider: 'user', author: credit.author.trim(), license: credit.license.trim(), url: credit.url.trim() }) };
  r.updatedAt = Date.now();
  publish();
  await saveAsset(r);
}
