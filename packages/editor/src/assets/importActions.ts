import type { AssetCredit } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { planImport, type IncomingFile } from './importer';
import { addAssets, compactNewModel } from './library';
import type { AssetRecord } from '../persistence/projectStore';

const MB = 1024 * 1024;

/** Imports files into the open project; returns the created records. */
export async function importFiles(files: IncomingFile[], credit?: AssetCredit, options: { compact?: boolean; maxTextureSize?: number } = {}): Promise<AssetRecord[]> {
  const { projectId, log } = useEditor.getState();
  if (!projectId || !files.length) return [];
  const plan = planImport(projectId, files, credit);
  // A 2D game has no use for 3D models or skies: leave them out (pictures become sprites).
  if (useEditor.getState().dimension === '2d') {
    const left = plan.records.filter((r) => r.type === 'model' || r.type === 'hdri');
    if (left.length) {
      plan.records = plan.records.filter((r) => !left.includes(r));
      log('warn', `This is a 2D project, so ${left.length === 1 ? `"${left[0].name}" (a 3D ${left[0].type === 'model' ? 'model' : 'sky'}) was` : `${left.length} 3D models / skies were`} left out. Pictures (PNG, JPG) become sprites.`);
      if (!plan.records.length) return [];
    }
  }
  if (plan.skipped.length) log('warn', `Skipped ${plan.skipped.length} unsupported file(s): ${plan.skipped.slice(0, 5).join(', ')}`);
  if (!plan.records.length) {
    log('warn', 'Nothing to import. Supported: .glb .gltf .fbx .obj, images, .hdr .exr, .mp3 .ogg .wav');
    return [];
  }
  try {
    await addAssets(plan.records);
  } catch (err) {
    const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
    log('error', quota ? 'Browser storage is full. Delete unused assets or projects.' : `Import failed: ${String(err)}`);
    return [];
  }
  const total = plan.records.reduce((n, r) => n + r.meta.size, 0);
  // Models: repeated parts kept once, pictures compact (skipped for files the editor just made).
  let saved = 0;
  if (options.compact !== false) for (const r of plan.records) if (r.type === 'model') saved += await compactNewModel(r.id, options.maxTextureSize);
  const counts = new Map<string, number>();
  for (const r of plan.records) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  const what = [...counts].map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ');
  log('info', `Imported ${what} (${((total - saved) / MB).toFixed(1)} MB${saved > MB / 2 ? `, made ${(saved / MB).toFixed(1)} MB smaller` : ''})`);
  return plan.records;
}
