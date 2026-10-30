import { defaultSceneSettings, newId, type Engine, type SceneData } from '@ege/runtime';
import { useEditor, tabMemory } from '../state/editorStore';
import { startGuide, type Guide } from '../guide/guide';
import {
  closeDb,
  DB_NAMES,
  deleteProject,
  lastProjectId,
  setLastProjectId,
  listProjects,
  loadProject,
  saveProject,
  type ProjectRecord,
  type ProjectSummary,
} from '../persistence/projectStore';
import { downloadBytes, parseProjectFile, projectFileName, toProjectZip } from '../persistence/projectFile';
import { saveAsset } from '../persistence/projectStore';
import { allAssetRecords, ensureCreditsFile, openLibrary } from '../assets/library';
import {
  attachProjectFolder,
  chooseProjectFolder,
  closeFolderDb,
  FOLDER_DB_NAME,
  flushFolder,
  forgetProjectFolder,
  openProjectFolder,
  reconnectFolder,
  setFolderErrorHandler,
  useFolder,
} from '../persistence/projectFolder';

setFolderErrorHandler((err) => state().log('error', `Couldn't write to the project folder: ${err instanceof Error ? err.message : String(err)}`));

const AUTOSAVE_DELAY_MS = 800;
const state = () => useEditor.getState();

let createdAt = Date.now();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Set while all saved data is being deleted: nothing may write any more. */
let wiping = false;

/*
 * One project, one tab: when a project opens here, other tabs showing it stop saving (the
 * newest tab wins) so two autosaves never overwrite each other.
 */
const TAB_ID = Math.random().toString(36).slice(2);
const lockChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ege-project-tabs') : null;
type LockMessage = { type: string; projectId: string; tab: string; visible?: boolean };
/** A tab you can see beats one in the background. */
const tabVisible = () => typeof document === 'undefined' || !document.hidden;
lockChannel?.addEventListener('message', (e: MessageEvent<LockMessage>) => {
  const s = state();
  if (!e.data || e.data.tab === TAB_ID || e.data.projectId !== s.projectId || s.suspended) return;
  // Another tab is loading this project and asks whether someone is already working on it.
  if (e.data.type === 'who') {
    lockChannel?.postMessage({ type: 'here', projectId: s.projectId, tab: TAB_ID, visible: tabVisible() });
    return;
  }
  if (e.data.type !== 'opened') return;
  // Both tabs reloaded at once (an update): a background tab doesn't take the project from the one you see.
  if (e.data.visible === false && tabVisible()) {
    announceOpen(s.projectId);
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = undefined;
  useEditor.setState({ suspended: true });
  s.log('warn', `"${s.projectName}" was opened in another tab. This tab stopped saving so it can't overwrite that one. Click "Use here" to work in this tab instead.`);
});
const announceOpen = (projectId: string) => lockChannel?.postMessage({ type: 'opened', projectId, tab: TAB_ID, visible: tabVisible() });

/**
 * "Use here" on a tab that stopped saving: this tab takes the project over and saves what it
 * shows right now (changes made here meanwhile are kept; the other tab stops saving).
 */
export function takeOverProject(): void {
  const s = state();
  if (!s.projectId) return;
  useEditor.setState({ suspended: false });
  announceOpen(s.projectId);
  void setLastProjectId(s.projectId).catch(() => {});
  void saveNow();
  s.log('info', `Working on "${s.projectName}" in this tab.`);
}

/**
 * Who edits a project when it's open in several tabs: a tab that loads takes over only if no
 * other tab is working on it, if it's the tab you're using (it has focus), or after "Use here".
 * Otherwise background tabs that reload by themselves would quietly steal the project.
 */
async function claimProject(projectId: string): Promise<boolean> {
  if (!lockChannel || document.hasFocus()) return true;
  const someoneElse = await new Promise<boolean>((resolve) => {
    const onMessage = (e: MessageEvent<LockMessage>) => {
      if (e.data?.type === 'here' && e.data.projectId === projectId && e.data.tab !== TAB_ID) {
        // Someone in the background doesn't keep the tab you're looking at from working.
        if (e.data.visible === false && tabVisible()) return;
        lockChannel.removeEventListener('message', onMessage);
        resolve(true);
      }
    };
    lockChannel.addEventListener('message', onMessage);
    lockChannel.postMessage({ type: 'who', projectId, tab: TAB_ID });
    setTimeout(() => {
      lockChannel.removeEventListener('message', onMessage);
      resolve(false);
    }, 300);
  });
  return !someoneElse;
}
/** Set while we load a scene so the resulting world events don't trigger a save. */
let loading = false;

async function applyScene(engine: Engine, id: string, name: string, scene: unknown, created: number): Promise<void> {
  loading = true;
  try {
    await flushFolder(); // finish copying the previous project
    await attachProjectFolder(id).catch(() => {});
    await openLibrary(id); // assets first, so models in the scene can resolve
    engine.loadScene(scene);
  } finally {
    loading = false;
  }
  createdAt = created;
  const s = state();
  const mine = await claimProject(id);
  tabMemory.set('project', id); // a reload of this tab comes back here
  useEditor.setState({ suspended: !mine, dimension: engine.settings.dimension === '2d' ? '2d' : '3d' });
  s.setProject(id, name);
  if (mine) {
    announceOpen(id);
    void setLastProjectId(id).catch(() => {});
    void ensureCreditsFile().catch(() => {});
  }
  else s.log('warn', `"${name}" is open in another tab, so this tab won't save. Click "Use here" to work in this tab instead.`);
  s.history?.clear();
  s.select(null);
  s.setSaveStatus('saved');
}

/** Opens the last project, or creates an empty one on first run. */
export async function bootProject(engine: Engine): Promise<void> {
  const tryOpen = async (id: string): Promise<boolean> => {
    const record = await loadProject(id);
    if (!record) return false;
    await applyScene(engine, record.id, record.name, record.scene, record.createdAt);
    state().log('info', `Opened "${record.name}"`);
    return true;
  };
  // This tab's own project first (a reload), else the last one used anywhere.
  const last = tabMemory.get('project') ?? (await lastProjectId().catch(() => undefined));
  let failure: unknown = null;
  // Twice: a reload in the middle of an update can fail once and work right after.
  for (let attempt = 0; last && attempt < 2; attempt++) {
    try {
      if (await tryOpen(last)) return;
      break; // gone (deleted): fall through
    } catch (err) {
      failure = err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (failure) state().log('error', `Couldn't open your last project (${failure instanceof Error ? failure.message : String(failure)}). It is still saved: open it again from the Project menu.`);
  // Never hide someone's work behind a new empty project: open the most recent other one first.
  const others = (await getProjects().catch(() => [] as ProjectSummary[])).filter((p) => p.id !== last).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const p of others) {
    try {
      if (await tryOpen(p.id)) return;
    } catch {
      // try the next one
    }
  }
  await newProject(engine, 'My Game');
}

export async function newProject(engine: Engine, name: string, scene: unknown = emptyScene()): Promise<void> {
  await saveNow();
  await applyScene(engine, newId(), name, scene, Date.now());
  await saveNow();
  state().log('info', `Created project "${name}"`);
}

export async function openProject(engine: Engine, id: string): Promise<void> {
  await saveNow();
  const record = await loadProject(id);
  if (!record) {
    state().log('error', 'That project no longer exists.');
    return;
  }
  await applyScene(engine, record.id, record.name, record.scene, record.createdAt);
  state().log('info', `Opened "${record.name}"`);
}

export function getProjects(): Promise<ProjectSummary[]> {
  return listProjects();
}

export async function renameProject(name: string): Promise<void> {
  const s = state();
  if (!s.projectId || !name.trim()) return;
  s.setProject(s.projectId, name.trim());
  await saveNow();
}

/** Saves immediately (Ctrl+S, before switching projects, on page hide). */
export async function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const s = state();
  // Never save a scene mid-game (also if the editor lost track of play mode, e.g. after a reload).
  if (wiping || s.suspended || !s.engine || !s.projectId || s.playing || s.engine.physics.simulating) return;
  const record: ProjectRecord = {
    id: s.projectId,
    name: s.projectName,
    createdAt,
    updatedAt: Date.now(),
    scene: s.engine.saveScene(),
  };
  s.setSaveStatus('saving');
  try {
    await saveProject(record);
    // Only mark saved if nothing changed while we were writing.
    if (state().saveStatus === 'saving') state().setSaveStatus('saved');
  } catch (err) {
    state().setSaveStatus('error');
    state().log('error', `Save failed: ${String(err)}`);
  }
}

/** Watches world changes and saves shortly after the user stops editing. */
export function startAutosave(): () => void {
  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.dataRevision === prev.dataRevision || loading || !s.projectId || s.playing || prev.playing) return;
    if (s.saveStatus !== 'unsaved') s.setSaveStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
  });
  const flush = () => {
    if (saveTimer) void saveNow();
  };
  const onVisibility = () => document.visibilityState === 'hidden' && flush();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** Pick a folder on disk where this project (and everything added to it) is kept as files. */
export async function chooseFolder(): Promise<void> {
  const s = state();
  await saveNow();
  try {
    const name = await chooseProjectFolder(s.projectName);
    if (name) s.log('info', `Saving "${s.projectName}" to the folder "${name}". Downloads and imports go in its Assets folder.`);
  } catch (err) {
    s.log('error', `Couldn't use that folder: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** After a browser restart: allow writing to the project folder again. */
export async function reconnectProjectFolder(): Promise<void> {
  const ok = await reconnectFolder().catch(() => false);
  if (ok) state().log('info', `Reconnected the folder "${useFolder.getState().name}"`);
  else state().log('warn', 'The browser did not allow access to the project folder. Changes are still saved in the browser.');
}

export async function stopUsingFolder(): Promise<void> {
  const name = useFolder.getState().name;
  await forgetProjectFolder();
  state().log('info', `No longer saving to "${name}" (its files stay where they are)`);
}

/** Open a project folder (made earlier, or copied from another computer). */
export async function openFolder(engine: Engine): Promise<void> {
  await saveNow();
  try {
    const opened = await openProjectFolder();
    if (!opened) return;
    const record = await loadProject(opened.id);
    if (!record) return;
    await applyScene(engine, record.id, record.name, record.scene, record.createdAt);
    state().log('info', `Opened "${record.name}" from its folder (${opened.assets} asset${opened.assets === 1 ? '' : 's'})`);
  } catch (err) {
    state().log('error', err instanceof Error ? err.message : String(err));
  }
}

/** Delete the open project and its assets from the browser, then open another one. */
export async function deleteCurrentProject(engine: Engine): Promise<void> {
  const s = state();
  const id = s.projectId;
  if (!id) return;
  const folder = useFolder.getState();
  const note = folder.status === 'none' ? '' : `\n\nThe files in the folder "${folder.name}" stay on your computer.`;
  if (!window.confirm(`Delete "${s.projectName}" and all of its assets from this browser? This can't be undone.${note}`)) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  await forgetProjectFolder();
  await deleteProject(id);
  s.log('info', `Deleted "${s.projectName}"`);
  const next = (await listProjects())[0];
  const record = next ? await loadProject(next.id) : undefined;
  if (record) await applyScene(engine, record.id, record.name, record.scene, record.createdAt);
  else await newProject(engine, 'My Game');
}

/**
 * Delete everything Easy Game Engine saved in this browser (all projects, assets, store
 * downloads, settings) and start over. Project folders on disk are not touched.
 */
export async function deleteAllData(): Promise<void> {
  const count = (await listProjects()).length;
  const ok = window.confirm(
    `Delete ALL saved data in this browser? This removes ${count} project${count === 1 ? '' : 's'}, every imported or downloaded asset, and your settings. ` +
      `It can't be undone.\n\nProject folders on your computer are not touched. Export anything you want to keep first.`,
  );
  if (!ok) return;
  wiping = true;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  await flushFolder();
  await Promise.all([closeDb(), closeFolderDb()]);
  const remove = (name: string) =>
    new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  await Promise.all([...DB_NAMES, FOLDER_DB_NAME].map(remove));
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('ege.')) localStorage.removeItem(key);
  } catch {
    // storage blocked: nothing to clear
  }
  location.reload();
}

export async function exportProject(): Promise<void> {
  const s = state();
  if (!s.engine) return;
  try {
    const bytes = await toProjectZip(s.projectName, s.engine.saveScene(), allAssetRecords());
    downloadBytes(projectFileName(s.projectName), bytes);
    s.log('info', `Exported "${s.projectName}" (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    s.log('error', `Export failed: ${String(err)}`);
  }
}

/** Imports a .egeproj as a new project (assets keep their ids so the scene still matches). */
export async function importProject(engine: Engine, file: File): Promise<boolean> {
  return importProjectBytes(engine, new Uint8Array(await file.arrayBuffer()));
}

/** Rename any project (the open one too). */
export async function renameProjectById(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  if (state().projectId === id) return renameProject(clean);
  const record = await loadProject(id);
  if (record) await saveProject({ ...record, name: clean, updatedAt: record.updatedAt });
}

/**
 * Delete a project and its assets (the Hub asks first, in its own window). If it was the open one,
 * the next project opens behind the Hub (or a new empty one).
 */
export async function deleteProjectById(engine: Engine, id: string): Promise<void> {
  const s = state();
  const name = (await loadProject(id))?.name ?? 'project';
  if (s.projectId === id) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    await forgetProjectFolder();
  }
  await deleteProject(id);
  s.log('info', `Deleted "${name}"`);
  if (s.projectId !== id) return;
  const next = (await listProjects())[0];
  const record = next ? await loadProject(next.id) : undefined;
  if (record) await applyScene(engine, record.id, record.name, record.scene, record.createdAt);
  else await newProject(engine, 'My Game');
}

/** A project file's contents (a .egeproj or a template) as a new project. */
export async function importProjectBytes(engine: Engine, bytes: Uint8Array, name?: string): Promise<boolean> {
  try {
    const parsed = await parseProjectFile(bytes);
    await saveNow();
    const id = newId();
    // Fresh asset ids per project, so the same template can be used many times.
    const rename = new Map(parsed.assets.map((a) => [a.id, newId()]));
    let sceneJson = JSON.stringify(parsed.scene);
    for (const [from, to] of rename) sceneJson = sceneJson.split(from).join(to);
    for (const a of parsed.assets) {
      let data = a.data;
      if (data !== undefined) {
        let text = JSON.stringify(data);
        for (const [from, to] of rename) text = text.split(from).join(to);
        data = JSON.parse(text);
      }
      await saveAsset({ ...a, id: rename.get(a.id)!, data, projectId: id });
    }
    await applyScene(engine, id, name?.trim() || parsed.name, JSON.parse(sceneJson), Date.now());
    await saveNow();
    state().log('info', `Created "${name?.trim() || parsed.name}" with ${parsed.assets.length} asset(s)`);
    return true;
  } catch (err) {
    state().log('error', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** A ready-made starting project, shipped with the editor (public/templates). */
export interface ProjectTemplate {
  id: string;
  name: string;
  dimension: '3d' | '2d';
  description: string;
  file: string;
  /** Tutorials: the step-by-step guide that opens with it. */
  guide?: Guide;
}

export async function listTemplates(): Promise<ProjectTemplate[]> {
  try {
    const res = await fetch(new URL('templates/templates.json', document.baseURI));
    if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) return [];
    return ((await res.json()) as { templates: ProjectTemplate[] }).templates ?? [];
  } catch {
    return [];
  }
}

export async function newFromTemplate(engine: Engine, template: ProjectTemplate, name: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(`templates/${template.file}`, document.baseURI));
    if (!res.ok) throw new Error(`${res.status}`);
    const ok = await importProjectBytes(engine, new Uint8Array(await res.arrayBuffer()), name);
    const id = state().projectId;
    if (ok && id && template.guide) startGuide(id, template.guide);
    return ok;
  } catch (err) {
    state().log('error', `Couldn't load the template "${template.name}" (${err instanceof Error ? err.message : String(err)})`);
    return false;
  }
}

/** A new, empty 2D game: seen from the side, everything on one flat plane. */
export function emptyScene2D(): SceneData {
  return {
    format: 'ege-scene',
    version: 1,
    name: 'Main',
    settings: { ...defaultSceneSettings(), background: '#9fc5e8', dimension: '2d' },
    entities: [
      {
        id: newId(),
        name: 'Main Camera',
        components: {
          Transform: { position: [0, 2, 20], rotation: [0, 0, 0], scale: [1, 1, 1] },
          Camera: { fov: 60, near: 0.1, far: 200, primary: true, orthographic: true, viewHeight: 12 },
        },
      },
    ],
  };
}

export function emptyScene(): SceneData {
  return {
    format: 'ege-scene',
    version: 1,
    name: 'Main',
    settings: {
      ...defaultSceneSettings(),
      background: '#b7cde0',
      fog: { enabled: false, color: '#b7cde0', near: 30, far: 150 },
    },
    entities: [
      {
        id: newId(),
        name: 'Sun',
        components: {
          Transform: { position: [20, 30, 12], rotation: [-55, 35, 0], scale: [1, 1, 1] },
          Light: { kind: 'directional', color: '#fff3e0', intensity: 2.8, castShadow: true },
        },
      },
      {
        id: newId(),
        name: 'Sky Light',
        components: {
          Transform: {},
          Light: { kind: 'hemisphere', color: '#dbe9ff', groundColor: '#6b5a45', intensity: 1.1 },
        },
      },
      {
        id: newId(),
        name: 'Ground',
        components: {
          Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [50, 1, 50] },
          MeshRenderer: { shape: 'plane', color: '#8a9a5b', roughness: 1, castShadow: false },
          Collider: {},
        },
      },
      {
        id: newId(),
        name: 'Main Camera',
        components: {
          Transform: { position: [0, 2, 6], rotation: [-10, 0, 0], scale: [1, 1, 1] },
          Camera: { primary: true },
        },
      },
    ],
  };
}
