import { strFromU8, strToU8, unzip, zip, type Unzipped } from 'fflate';
import { ASSET_TYPES, parseScene, type SceneData } from '@ege/runtime';
import type { AssetRecord } from './projectStore';

/**
 * Portable project file (.egeproj): a zip with
 *   project.json                 – name + scene
 *   assets/<id>/asset.json       – asset metadata (no blobs)
 *   assets/<id>/files/<path>     – the asset's files
 *   assets/<id>/thumbnail.webp   – preview (optional)
 * Older plain-JSON project files are still accepted.
 */
export interface ProjectFile {
  format: 'ege-project';
  version: 2;
  name: string;
  scene: SceneData;
}

type AssetManifest = Omit<AssetRecord, 'files' | 'projectId' | 'meta'> & {
  files: string[];
  meta: Omit<AssetRecord['meta'], 'thumbnail'>;
};

export const PROJECT_FILE_EXTENSION = '.egeproj';

export class ProjectFileError extends Error {}

const zipAsync = (data: Parameters<typeof zip>[0]) =>
  new Promise<Uint8Array>((res, rej) => zip(data, { level: 6 }, (err, out) => (err ? rej(err) : res(out))));
const unzipAsync = (data: Uint8Array) =>
  new Promise<Unzipped>((res, rej) => unzip(data, (err, out) => (err ? rej(err) : res(out))));

export async function toProjectZip(name: string, scene: SceneData, assets: AssetRecord[]): Promise<Uint8Array> {
  const project: ProjectFile = { format: 'ege-project', version: 2, name, scene };
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'project.json': strToU8(JSON.stringify(project, null, 2)),
  };
  for (const a of assets) {
    const { thumbnail, parts, ...kept } = a.meta;
    // A pack's part previews aren't kept in the file: opening it makes them again.
    const meta = parts?.length ? { ...kept, thumbVersion: undefined } : kept;
    const manifest: AssetManifest = {
      id: a.id,
      name: a.name,
      type: a.type,
      main: a.main,
      data: a.data,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      files: Object.keys(a.files),
      meta,
    };
    entries[`assets/${a.id}/asset.json`] = strToU8(JSON.stringify(manifest));
    for (const [path, blob] of Object.entries(a.files)) {
      // Images/models are usually compressed already; store them as-is to save time.
      entries[`assets/${a.id}/files/${path}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    }
    if (thumbnail) entries[`assets/${a.id}/thumbnail.webp`] = [new Uint8Array(await thumbnail.arrayBuffer()), { level: 0 }];
  }
  return zipAsync(entries);
}

export interface ParsedProject {
  name: string;
  scene: SceneData;
  /** Assets without projectId (the caller assigns the new project's id). */
  assets: Omit<AssetRecord, 'projectId'>[];
}

export async function parseProjectFile(bytes: Uint8Array): Promise<ParsedProject> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  if (!isZip) return parseLegacyJson(strFromU8(bytes));

  let files: Unzipped;
  try {
    files = await unzipAsync(bytes);
  } catch {
    throw new ProjectFileError('This project file is damaged (it could not be unzipped).');
  }
  const projectJson = files['project.json'];
  if (!projectJson) throw new ProjectFileError('This file is not an Easy Game Engine project.');
  const { name, scene } = parseProjectJson(strFromU8(projectJson));

  const assets: ParsedProject['assets'] = [];
  for (const path of Object.keys(files)) {
    const m = /^assets\/([^/]+)\/asset\.json$/.exec(path);
    if (!m) continue;
    const id = m[1];
    let manifest: AssetManifest;
    try {
      manifest = JSON.parse(strFromU8(files[path])) as AssetManifest;
    } catch {
      continue; // skip a broken asset rather than failing the whole import
    }
    if (!(ASSET_TYPES as readonly string[]).includes(manifest.type)) continue;
    const blobs: Record<string, Blob> = {};
    for (const f of manifest.files ?? []) {
      const data = files[`assets/${id}/files/${f}`];
      if (data) blobs[f] = new Blob([data as BlobPart]);
    }
    const thumb = files[`assets/${id}/thumbnail.webp`];
    assets.push({
      id,
      name: String(manifest.name ?? 'Asset'),
      type: manifest.type,
      main: String(manifest.main ?? ''),
      files: blobs,
      data: manifest.data,
      meta: { ...manifest.meta, size: manifest.meta?.size ?? 0, thumbnail: thumb ? new Blob([thumb as BlobPart], { type: 'image/webp' }) : undefined },
      createdAt: Number(manifest.createdAt) || Date.now(),
      updatedAt: Number(manifest.updatedAt) || Date.now(),
    });
  }
  return { name, scene, assets };
}

function parseProjectJson(text: string): { name: string; scene: SceneData } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProjectFileError('This file is not a valid project (it is not JSON).');
  }
  const f = json as Partial<ProjectFile>;
  if (!f || f.format !== 'ege-project') throw new ProjectFileError('This file is not an Easy Game Engine project.');
  return { name: typeof f.name === 'string' ? f.name : 'Imported Project', scene: parseScene(f.scene) };
}

function parseLegacyJson(text: string): ParsedProject {
  return { ...parseProjectJson(text), assets: [] };
}

/** Browser download of a project file. */
export function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function projectFileName(name: string): string {
  return `${name.replace(/[^\w\- ]+/g, '').trim() || 'project'}${PROJECT_FILE_EXTENSION}`;
}
