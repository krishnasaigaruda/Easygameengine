import { startGame, type AssetResolver, type ResolvedAsset } from '@ege/runtime';
import { listAssets, loadProject, type AssetRecord } from '../persistence/projectStore';
import { gameCredits } from '../export/exportGame';

/** Serve asset files straight from IndexedDB records (same origin as the editor). */
function resolverFromRecords(records: AssetRecord[]): AssetResolver {
  const byId = new Map(records.map((r) => [r.id, r]));
  const urls = new Map<string, string>();
  return {
    async resolve(id: string): Promise<ResolvedAsset | undefined> {
      const r = byId.get(id);
      if (!r) return undefined;
      return {
        id: r.id,
        type: r.type,
        name: r.name,
        main: r.main,
        files: Object.keys(r.files),
        data: r.data,
        url(path) {
          const blob = r.files[path];
          if (!blob) return undefined;
          const key = `${id}/${path}`;
          let u = urls.get(key);
          if (!u) urls.set(key, (u = URL.createObjectURL(blob)));
          return u;
        },
      };
    },
  };
}

function showError(message: string): void {
  const el = document.createElement('div');
  el.className = 'ege-error';
  el.textContent = message;
  document.body.appendChild(el);
}

async function main(): Promise<void> {
  const id = new URLSearchParams(location.search).get('project');
  if (!id) return showError('No project selected. Open this page from the editor with "Play in new tab".');
  const project = await loadProject(id);
  if (!project) return showError('This project could not be found in this browser.');
  document.title = `${project.name} · Easy Game Engine`;
  const records = await listAssets(id);
  await startGame({
    container: document.getElementById('game')!,
    scene: project.scene,
    assets: resolverFromRecords(records),
    title: project.name,
    credits: await gameCredits(records, records),
  });
}

main().catch((err: unknown) => showError(`The game could not start: ${err instanceof Error ? err.message : String(err)}`));
