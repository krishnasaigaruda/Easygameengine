import { create } from 'zustand';
import { openDB } from 'idb';
import type { AssetType } from '@ege/runtime';
import { listAssets, loadProject, saveAsset, saveProject, storeHooks, type AssetRecord, type ProjectRecord } from './projectStore';

/*
 * Project folders: keep a project as real files in a folder the user picks
 * (File System Access API — Chrome, Edge, Opera). Browser storage stays the working copy;
 * every save, download, import, rename and delete is copied to the folder.
 *
 *   My Game/
 *     project.json               scene + project info
 *     Assets/Models/Old Car/     the asset's own files (scene.gltf, textures/…)
 *       .ege-asset.json          id, type and settings so the folder can be opened again
 */

// Parts of the File System Access API that TypeScript's DOM types don't include yet.
type Permission = 'granted' | 'denied' | 'prompt';
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(o: { mode: 'readwrite' }): Promise<Permission>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

export const PROJECT_JSON = 'project.json';
export const ASSET_JSON = '.ege-asset.json';
export const TYPE_DIRS: Record<AssetType, string> = {
  model: 'Models',
  texture: 'Textures',
  hdri: 'Skies',
  audio: 'Audio',
  material: 'Materials',
  script: 'Scripts',
  data: 'Data',
};

export type FolderStatus = 'none' | 'connected' | 'locked' | 'error';

/** What the toolbar shows about the open project's folder. */
export const useFolder = create<{ status: FolderStatus; name: string; error?: string }>(() => ({ status: 'none', name: '' }));

export function folderSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// Folder handles are remembered per project in their own small database.
export const FOLDER_DB_NAME = 'easy-game-engine-folders';
let handlesDb: ReturnType<typeof openDB> | null = null;
const handles = () => (handlesDb ??= openDB(FOLDER_DB_NAME, 1, { upgrade: (d) => d.createObjectStore('handles') }));

/** Close the folder-handle database (before deleting everything). */
export async function closeFolderDb(): Promise<void> {
  const p = handlesDb;
  handlesDb = null;
  mirror = null;
  if (p) (await p.catch(() => null))?.close();
}
const getHandle = async (projectId: string) => (await (await handles()).get('handles', projectId)) as DirHandle | undefined;
const putHandle = async (projectId: string, h: FileSystemDirectoryHandle) => void (await (await handles()).put('handles', h, projectId));
const dropHandle = async (projectId: string) => void (await (await handles()).delete('handles', projectId));

/** The folder of the open project, while writable. */
let mirror: { projectId: string; root: DirHandle; paths: Map<string, string[]> } | null = null;
let currentProject = '';
/** Writes run one at a time, in order. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (job: () => Promise<void>) => {
  queue = queue.then(job).catch((err) => {
    useFolder.setState({ status: 'error', error: String(err instanceof Error ? err.message : err) });
    onError?.(err);
  });
  return queue;
};
let onError: ((err: unknown) => void) | undefined;

/** Lets the editor log folder problems. */
export function setFolderErrorHandler(fn: (err: unknown) => void): void {
  onError = fn;
}

/** A file or folder name that works on every OS. */
export function safeName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (s || 'Untitled').slice(0, 80);
}

async function dirAt(root: FileSystemDirectoryHandle, parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let d = root;
  for (const p of parts) {
    try {
      d = await d.getDirectoryHandle(p, { create });
    } catch {
      return null;
    }
  }
  return d;
}

async function writeFile(root: FileSystemDirectoryHandle, path: string[], data: Blob | string): Promise<void> {
  const dir = await dirAt(root, path.slice(0, -1), true);
  const file = await dir!.getFileHandle(path[path.length - 1], { create: true });
  const w = await file.createWritable();
  await w.write(data);
  await w.close();
}

async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch {
    return null;
  }
}

async function removeDir(root: FileSystemDirectoryHandle, parts: string[]): Promise<void> {
  const parent = await dirAt(root, parts.slice(0, -1), false);
  await parent?.removeEntry(parts[parts.length - 1], { recursive: true }).catch(() => {});
}

async function* subdirs(dir: FileSystemDirectoryHandle): AsyncGenerator<[string, FileSystemDirectoryHandle]> {
  for await (const [name, h] of dir.entries()) if (h.kind === 'directory') yield [name, h];
}

/** Where each asset already lives in the folder (asset id → path parts). */
async function scanAssets(root: FileSystemDirectoryHandle): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const assets = await dirAt(root, ['Assets'], false);
  if (!assets) return out;
  for await (const [typeName, typeDir] of subdirs(assets)) {
    for await (const [name, dir] of subdirs(typeDir)) {
      const meta = await readText(dir, ASSET_JSON);
      if (!meta) continue;
      try {
        const id = (JSON.parse(meta) as { id?: string }).id;
        if (id) out.set(id, ['Assets', typeName, name]);
      } catch {
        // not ours
      }
    }
  }
  return out;
}

function projectJson(r: ProjectRecord): string {
  return JSON.stringify({ format: 'ege-project-folder', version: 1, id: r.id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt, scene: r.scene }, null, 2);
}

async function writeAsset(m: NonNullable<typeof mirror>, r: AssetRecord): Promise<void> {
  const typeDir = TYPE_DIRS[r.type] ?? 'Other';
  const taken = new Set([...m.paths].filter(([id]) => id !== r.id).map(([, p]) => p.join('/')));
  let name = safeName(r.name);
  for (let n = 2; taken.has(['Assets', typeDir, name].join('/')); n++) name = `${safeName(r.name)} ${n}`;
  const path = ['Assets', typeDir, name];
  // Replace the old copy (also handles renames and changed files).
  const old = m.paths.get(r.id);
  if (old) await removeDir(m.root, old);
  else await removeDir(m.root, path);
  for (const [file, blob] of Object.entries(r.files)) await writeFile(m.root, [...path, ...file.split('/').filter(Boolean).map(safeName)], blob);
  const meta = { format: 'ege-asset', version: 1, id: r.id, name: r.name, type: r.type, main: r.main, data: r.data, credit: r.meta.credit, createdAt: r.createdAt, updatedAt: r.updatedAt };
  await writeFile(m.root, [...path, ASSET_JSON], JSON.stringify(meta, null, 2));
  m.paths.set(r.id, path);
}

/** Write the whole project (after linking, or after the folder was reconnected). */
async function writeAll(m: NonNullable<typeof mirror>): Promise<void> {
  const record = await loadProject(m.projectId);
  if (record) await writeFile(m.root, [PROJECT_JSON], projectJson(record));
  const assets = await listAssets(m.projectId);
  const keep = new Set(assets.map((a) => a.id));
  for (const [id, path] of m.paths) {
    if (!keep.has(id)) {
      await removeDir(m.root, path);
      m.paths.delete(id);
    }
  }
  for (const a of assets) await writeAsset(m, a);
}

async function connect(projectId: string, root: DirHandle, fullWrite: boolean): Promise<void> {
  const paths = await scanAssets(root);
  mirror = { projectId, root, paths };
  useFolder.setState({ status: 'connected', name: root.name, error: undefined });
  if (fullWrite) await enqueue(() => writeAll(mirror!));
}

storeHooks.projectSaved = (r) => {
  const m = mirror;
  if (m && m.projectId === r.id) void enqueue(() => writeFile(m.root, [PROJECT_JSON], projectJson(r)));
};
storeHooks.assetSaved = (r) => {
  const m = mirror;
  if (m && m.projectId === r.projectId) void enqueue(() => writeAsset(m, r));
};
storeHooks.assetDeleted = (id) => {
  const m = mirror;
  const path = m?.paths.get(id);
  if (m && path) {
    void enqueue(async () => {
      await removeDir(m.root, path);
      m.paths.delete(id);
    });
  }
};

/** Call when a project opens: reconnects its folder if the browser still allows it. */
export async function attachProjectFolder(projectId: string): Promise<void> {
  currentProject = projectId;
  mirror = null;
  useFolder.setState({ status: 'none', name: '', error: undefined });
  if (!folderSupported()) return;
  const h = await getHandle(projectId).catch(() => undefined);
  if (!h || currentProject !== projectId) return;
  const perm = await h.queryPermission({ mode: 'readwrite' }).catch(() => 'denied' as const);
  if (perm === 'granted') await connect(projectId, h, true);
  else useFolder.setState({ status: 'locked', name: h.name });
}

/** After a restart the browser asks once more before writing (must run from a click). */
export async function reconnectFolder(): Promise<boolean> {
  const h = await getHandle(currentProject);
  if (!h) return false;
  if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  await connect(currentProject, h, true);
  return true;
}

/**
 * Let the user pick where the open project is saved. An empty folder (or this project's own
 * folder) is used as is; otherwise a folder named after the project is made inside it.
 */
export async function chooseProjectFolder(projectName: string): Promise<string | null> {
  if (!folderSupported() || !currentProject) return null;
  let picked: FileSystemDirectoryHandle;
  try {
    picked = await window.showDirectoryPicker!({ id: 'ege-projects', mode: 'readwrite', startIn: 'documents' });
  } catch {
    return null; // cancelled
  }
  let root = picked as DirHandle;
  const own = await readText(root, PROJECT_JSON);
  const ownId = own ? (JSON.parse(own) as { id?: string }).id : undefined;
  let empty = true;
  for await (const [name] of root.entries()) {
    if (!name.startsWith('.')) {
      empty = false;
      break;
    }
  }
  if (ownId !== currentProject && !empty) {
    let name = safeName(projectName);
    for (let n = 2; await dirAt(root, [name], false); n++) name = `${safeName(projectName)} ${n}`;
    root = (await root.getDirectoryHandle(name, { create: true })) as DirHandle;
  }
  await putHandle(currentProject, root);
  await connect(currentProject, root, true);
  return root.name;
}

/** Stop copying to the folder (the files already there stay). */
export async function forgetProjectFolder(): Promise<void> {
  await queue;
  mirror = null;
  if (currentProject) await dropHandle(currentProject).catch(() => {});
  useFolder.setState({ status: 'none', name: '', error: undefined });
}

/** Wait for pending folder writes (tests, before switching projects). */
export function flushFolder(): Promise<unknown> {
  return queue;
}

/**
 * Open a project folder (made here, or copied from another computer). Its files become the
 * project's working copy and the folder stays linked. Returns the project id.
 */
export async function openProjectFolder(): Promise<{ id: string; name: string; assets: number } | null> {
  if (!folderSupported()) return null;
  let root: DirHandle;
  try {
    root = (await window.showDirectoryPicker!({ id: 'ege-projects', mode: 'readwrite', startIn: 'documents' })) as DirHandle;
  } catch {
    return null;
  }
  return importFolder(root);
}

/** Read a project folder into browser storage and link it. Exported for tests. */
export async function importFolder(root: DirHandle): Promise<{ id: string; name: string; assets: number }> {
  const text = await readText(root, PROJECT_JSON);
  if (!text) throw new Error(`"${root.name}" isn't an Easy Game Engine project folder (no ${PROJECT_JSON}).`);
  const p = JSON.parse(text) as { format?: string; id?: string; name?: string; createdAt?: number; scene?: ProjectRecord['scene'] };
  if (p.format !== 'ege-project-folder' || !p.id || !p.scene) throw new Error(`${PROJECT_JSON} in "${root.name}" isn't a valid project.`);
  const id = p.id;
  mirror = null; // don't echo what we read back into the folder
  const paths = await scanAssets(root);
  const existing = new Set((await listAssets(id)).map((a) => a.id));
  let count = 0;
  for (const [assetId, path] of paths) {
    const dir = (await dirAt(root, path, false))!;
    const meta = JSON.parse((await readText(dir, ASSET_JSON))!) as Omit<AssetRecord, 'files' | 'meta' | 'projectId'> & { credit?: AssetRecord['meta']['credit'] };
    const files: Record<string, Blob> = {};
    let size = 0;
    const walk = async (d: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, h] of d.entries()) {
        if (name.startsWith('.')) continue;
        if (h.kind === 'directory') await walk(h, `${prefix}${name}/`);
        else {
          const f = await h.getFile();
          files[`${prefix}${name}`] = f;
          size += f.size;
        }
      }
    };
    await walk(dir, '');
    await saveAsset({
      id: assetId,
      projectId: id,
      name: meta.name,
      type: meta.type,
      main: meta.main,
      files,
      data: meta.data,
      meta: { size, credit: meta.credit },
      createdAt: meta.createdAt ?? Date.now(),
      updatedAt: meta.updatedAt ?? Date.now(),
    });
    existing.delete(assetId);
    count++;
  }
  await saveProject({ id, name: p.name ?? root.name, createdAt: p.createdAt ?? Date.now(), updatedAt: Date.now(), scene: p.scene });
  await putHandle(id, root);
  return { id, name: p.name ?? root.name, assets: count };
}
