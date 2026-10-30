import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AssetCredit, AssetType, SceneData } from '@ege/runtime';

/** A saved project (its assets live in the `assets` store, keyed by projectId). */
export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  scene: SceneData;
}

export type ProjectSummary = Pick<ProjectRecord, 'id' | 'name' | 'createdAt' | 'updatedAt'> & {
  dimension: '3d' | '2d';
  objects: number;
};

export interface AssetMeta {
  /** Total bytes of all files. */
  size: number;
  /** Animation clip names (models). */
  animations?: string[];
  /** Triangle count (models). */
  triangles?: number;
  /** Models: the separate models inside the file (an asset pack), each with its own preview. */
  parts?: { path: string; name: string; thumbnail?: Blob }[];
  /** Small preview image. */
  thumbnail?: Blob;
  /** How the preview was made (older ones are redone when this changes). */
  thumbVersion?: number;
  /** Where it came from (Asset Store credits). */
  credit?: AssetCredit;
}

/** One imported asset: its files as blobs, plus metadata. */
export interface AssetRecord {
  id: string;
  projectId: string;
  name: string;
  type: AssetType;
  /** Main file path inside `files` ('' for data-only assets like materials). */
  main: string;
  files: Record<string, Blob>;
  /** JSON payload (material settings). */
  data?: unknown;
  meta: AssetMeta;
  createdAt: number;
  updatedAt: number;
}

interface EgeDB extends DBSchema {
  projects: { key: string; value: ProjectRecord; indexes: { updatedAt: number } };
  meta: { key: string; value: string };
  assets: { key: string; value: AssetRecord; indexes: { projectId: string } };
}

/**
 * Called after each successful write, so a linked project folder can mirror it (projectFolder.ts).
 * Browser storage stays the working copy; the folder is a plain-file copy next to it.
 */
export const storeHooks: {
  projectSaved?: (record: ProjectRecord) => void;
  assetSaved?: (record: AssetRecord) => void;
  assetDeleted?: (id: string) => void;
} = {};

const DB_NAME = 'easy-game-engine';
const DB_VERSION = 2;
let dbPromise: Promise<IDBPDatabase<EgeDB>> | null = null;

function db(): Promise<IDBPDatabase<EgeDB>> {
  dbPromise ??= openDB<EgeDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const projects = database.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
        database.createObjectStore('meta');
      }
      if (oldVersion < 2) {
        const assets = database.createObjectStore('assets', { keyPath: 'id' });
        assets.createIndex('projectId', 'projectId');
      }
    },
  });
  return dbPromise;
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('projects').put(record),
    tx.objectStore('meta').put(record.id, 'lastProjectId'),
    tx.done,
  ]);
  storeHooks.projectSaved?.(record);
}

export async function loadProject(id: string): Promise<ProjectRecord | undefined> {
  return (await db()).get('projects', id);
}

/** Most recently edited first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await (await db()).getAllFromIndex('projects', 'updatedAt');
  const count = (list: { children?: unknown[] }[] = []): number => list.reduce((n, e) => n + 1 + count((e.children ?? []) as { children?: unknown[] }[]), 0);
  return all.reverse().map(({ id, name, createdAt, updatedAt, scene }) => ({
    id,
    name,
    createdAt,
    updatedAt,
    dimension: scene?.settings?.dimension ?? '3d',
    objects: count(scene?.entities ?? []),
  }));
}

/** Deletes a project and all of its assets. */
export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'meta', 'assets'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  if ((await tx.objectStore('meta').get('lastProjectId')) === id) await tx.objectStore('meta').delete('lastProjectId');
  const index = tx.objectStore('assets').index('projectId');
  for (let cursor = await index.openCursor(id); cursor; cursor = await cursor.continue()) await cursor.delete();
  await tx.done;
}

/** Remember the project that's open, so a reload comes back to it. */
export async function setLastProjectId(id: string): Promise<void> {
  await (await db()).put('meta', id, 'lastProjectId');
}

export async function lastProjectId(): Promise<string | undefined> {
  return (await db()).get('meta', 'lastProjectId');
}

export async function saveAsset(record: AssetRecord): Promise<void> {
  await (await db()).put('assets', record);
  storeHooks.assetSaved?.(record);
}

export async function loadAsset(id: string): Promise<AssetRecord | undefined> {
  return (await db()).get('assets', id);
}

export async function listAssets(projectId: string): Promise<AssetRecord[]> {
  return (await db()).getAllFromIndex('assets', 'projectId', projectId);
}

export async function deleteAsset(id: string): Promise<void> {
  await (await db()).delete('assets', id);
  storeHooks.assetDeleted?.(id);
}

export const DB_NAMES = [DB_NAME];

/** Close the connection (needed before the database can be deleted). */
export async function closeDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
}

/** Test helper: forget the cached connection (fake-indexeddb is reset between tests). */
export function _resetDbForTests(): void {
  dbPromise = null;
}
