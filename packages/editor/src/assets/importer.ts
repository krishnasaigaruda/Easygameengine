import {
  assetTypeForFile,
  defaultMaterialData,
  extensionOf,
  newId,
  type AssetCredit,
  type AssetType,
  type MaterialAssetData,
} from '@ege/runtime';
import type { AssetRecord } from '../persistence/projectStore';

/** A dropped/picked file with its path relative to the drop (folders keep their structure). */
export interface IncomingFile {
  path: string;
  blob: Blob;
}

const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'fbx', 'obj']);

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const baseName = (p: string) => p.split('/').pop() ?? p;
const stripExt = (p: string) => baseName(p).replace(/\.[^.]+$/, '');
/** "Hero_Final-v2" → "Hero Final v2" */
const prettyName = (p: string) => stripExt(p).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Asset';

// ── PBR texture set detection ───────────────────────────────────────────────

type MapSlot = 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'heightMap';

/** Suffix tokens (lowercase) that identify each texture map. Order = priority. */
const SLOT_TOKENS: [MapSlot, string[]][] = [
  ['normalMap', ['nor_gl', 'normal_gl', 'normalgl', 'normal', 'nor', 'nrm', 'norm', 'nor_dx', 'normal_dx']],
  ['roughnessMap', ['roughness', 'rough', 'rgh']],
  ['metalnessMap', ['metalness', 'metallic', 'metal', 'mtl']],
  ['aoMap', ['ambientocclusion', 'ambient_occlusion', 'occlusion', 'ao']],
  ['heightMap', ['displacement', 'disp', 'height', 'heightmap', 'bump']],
  ['map', ['basecolor', 'base_color', 'albedo', 'diffuse', 'diff', 'color', 'col']],
];
const RESOLUTION = /^(\d+k|\d{3,4}(px)?)$/i;

/**
 * Splits "rock_wall_nor_gl_1k" into { stem: "rock_wall", slot: "normalMap" }.
 * Returns null if the name doesn't end in a known map suffix.
 */
export function classifyTextureName(fileName: string): { stem: string; slot: MapSlot } | null {
  const tokens = stripExt(fileName).toLowerCase().split(/[\s._-]+/).filter(Boolean);
  while (tokens.length > 1 && RESOLUTION.test(tokens[tokens.length - 1])) tokens.pop();
  for (const [slot, names] of SLOT_TOKENS) {
    for (const name of names) {
      const parts = name.split('_');
      const tail = tokens.slice(-parts.length).join('_');
      if (tail === name && tokens.length > parts.length) {
        return { stem: tokens.slice(0, -parts.length).join('_'), slot };
      }
    }
  }
  return null;
}

// ── grouping files into assets ──────────────────────────────────────────────

export interface ImportPlan {
  records: AssetRecord[];
  /** Files we couldn't use (unknown types not belonging to a model). */
  skipped: string[];
}

function record(
  projectId: string,
  type: AssetType,
  name: string,
  main: string,
  files: Record<string, Blob>,
  extra: Partial<AssetRecord> = {},
): AssetRecord {
  const now = Date.now();
  const size = Object.values(files).reduce((n, b) => n + b.size, 0);
  return { id: newId(), projectId, name, type, main, files, meta: { size }, createdAt: now, updatedAt: now, ...extra };
}

/**
 * Decides which assets a set of files becomes:
 * - each .glb/.gltf/.fbx/.obj → a model, carrying the other files from its folder
 *   (buffers, textures, .mtl) with paths relative to the model
 * - leftover images → textures; HDR/EXR → skies; audio → sounds
 * - texture sets named like "rock_diff / rock_nor / rock_rough" → also a ready-made material
 */
export function planImport(projectId: string, incoming: IncomingFile[], credit?: AssetCredit): ImportPlan {
  const files = incoming.map((f) => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\/+/, '') }));
  const models = files.filter((f) => MODEL_EXTENSIONS.has(extensionOf(f.path)));
  const used = new Set<string>(models.map((m) => m.path));
  const records: AssetRecord[] = [];

  for (const m of models) {
    const dir = dirOf(m.path);
    const bundle: Record<string, Blob> = {};
    const main = m.path.slice(dir.length);
    bundle[main] = m.blob;
    // A .glb is self-contained; text formats reference sibling files.
    if (extensionOf(m.path) !== 'glb') {
      for (const f of files) {
        if (f === m || MODEL_EXTENSIONS.has(extensionOf(f.path))) continue;
        const rel = f.path.startsWith(dir) ? f.path.slice(dir.length) : baseName(f.path);
        if (!(rel in bundle)) bundle[rel] = f.blob;
        used.add(f.path);
      }
    }
    records.push(record(projectId, 'model', prettyName(m.path), main, bundle, { meta: { size: 0, credit } }));
  }

  const skipped: string[] = [];
  const textureIds = new Map<string, string>(); // path → asset id
  for (const f of files) {
    if (used.has(f.path)) continue;
    const type = assetTypeForFile(f.path);
    if (!type || type === 'model') {
      skipped.push(f.path);
      continue;
    }
    const main = baseName(f.path);
    const r = record(projectId, type, prettyName(f.path), main, { [main]: f.blob }, { meta: { size: 0, credit } });
    if (type === 'texture') textureIds.set(f.path, r.id);
    records.push(r);
  }

  records.push(...detectMaterials(projectId, textureIds, credit));
  for (const r of records) r.meta.size = Object.values(r.files).reduce((n, b) => n + b.size, 0);
  return { records, skipped };
}

/** Builds material assets from texture sets that share a stem and include a color map. */
export function detectMaterials(
  projectId: string,
  textures: Map<string, string>,
  credit?: AssetCredit,
): AssetRecord[] {
  const sets = new Map<string, Partial<Record<MapSlot, string>>>();
  for (const [path, id] of textures) {
    const c = classifyTextureName(baseName(path));
    if (!c) continue;
    const key = dirOf(path) + c.stem;
    const set = sets.get(key) ?? {};
    set[c.slot] ??= id;
    sets.set(key, set);
  }
  const out: AssetRecord[] = [];
  for (const [key, slots] of sets) {
    if (!slots.map || Object.keys(slots).length < 2) continue;
    const data: MaterialAssetData = { ...defaultMaterialData(), ...slots };
    if (slots.metalnessMap) data.metalness = 1; // the map decides where it's metal
    out.push(record(projectId, 'material', prettyName(baseName(key)), '', {}, { data, meta: { size: 0, credit } }));
  }
  return out;
}

/** Reads a folder drop (DataTransferItem entries) recursively into IncomingFiles. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<IncomingFile[]> {
  const entries = [...dt.items]
    .map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files].map((f) => ({ path: f.name, blob: f }));
  const out: IncomingFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + file.name, blob: file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in batches; keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

/** Files from an <input type="file" multiple webkitdirectory> keep their folder paths. */
export function filesFromInput(list: FileList): IncomingFile[] {
  return [...list].map((f) => ({ path: f.webkitRelativePath || f.name, blob: f }));
}
