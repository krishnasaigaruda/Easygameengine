import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { World, serializeWorld } from '@ege/runtime';
import { _resetDbForTests, deleteAsset, listAssets, loadProject, saveAsset, saveProject, type AssetRecord } from './projectStore';
import { ASSET_JSON, chooseProjectFolder, flushFolder, forgetProjectFolder, importFolder, safeName, useFolder, attachProjectFolder } from './projectFolder';

/** In-memory stand-in for a folder on disk (just enough of the File System Access API). */
class FakeFile {
  readonly kind = 'file' as const;
  data: Blob = new Blob([]);
  constructor(readonly name: string) {}
  async getFile() {
    return new File([this.data], this.name);
  }
  async createWritable() {
    const parts: (Blob | string)[] = [];
    return { write: async (d: Blob | string) => void parts.push(d), close: async () => void (this.data = new Blob(parts)) };
  }
}
class FakeDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, FakeDir | FakeFile>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    let c = this.children.get(name);
    if (!c && o?.create) this.children.set(name, (c = new FakeDir(name)));
    if (!(c instanceof FakeDir)) throw new DOMException('not found', 'NotFoundError');
    return c;
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    let c = this.children.get(name);
    if (!c && o?.create) this.children.set(name, (c = new FakeFile(name)));
    if (!(c instanceof FakeFile)) throw new DOMException('not found', 'NotFoundError');
    return c;
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new DOMException('not found', 'NotFoundError');
  }
  async *entries() {
    yield* this.children.entries();
  }
  async queryPermission() {
    return 'granted';
  }
  async requestPermission() {
    return 'granted';
  }
  /** Paths of every file below, for assertions. */
  tree(prefix = ''): string[] {
    return [...this.children.values()].flatMap((c) => (c instanceof FakeDir ? c.tree(`${prefix}${c.name}/`) : [`${prefix}${c.name}`])).sort();
  }
  text(path: string) {
    return textAt(this, path.split('/'));
  }
}

async function textAt(d: FakeDir, parts: string[]): Promise<string> {
  if (parts.length > 1) return textAt(await d.getDirectoryHandle(parts[0]), parts.slice(1));
  return (await (await d.getFileHandle(parts[0])).getFile()).text();
}

let picked: FakeDir;
const g = globalThis as unknown as { window: { showDirectoryPicker: () => Promise<FakeDir> } };
g.window = { showDirectoryPicker: async () => picked };

const project = (id: string, name: string) => {
  const w = new World();
  w.createEntity({ name: 'Thing' });
  return { id, name, createdAt: 1, updatedAt: 2, scene: serializeWorld(w, 'Main') };
};
const asset = (id: string, name: string, files: Record<string, string>): AssetRecord => ({
  id,
  projectId: 'p1',
  name,
  type: 'model',
  main: Object.keys(files)[0],
  files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Blob([v])])),
  meta: { size: 1, credit: { provider: 'objaverse', sourceId: 'abc', author: 'Someone', license: 'CC-BY-4.0', url: 'https://example.com' } as never },
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
  await forgetProjectFolder();
});

describe('project folders', () => {
  it('copies the project and its assets into the chosen folder and keeps it up to date', async () => {
    await saveProject(project('p1', 'My Game'));
    await saveAsset(asset('a1', 'Old Car', { 'scene.gltf': 'gltf', 'textures/paint.png': 'png' }));
    await attachProjectFolder('p1');
    const games = new FakeDir('Games');
    await games.getFileHandle('notes.txt', { create: true }); // not empty → a project folder is made inside
    picked = games;
    expect(await chooseProjectFolder('My Game')).toBe('My Game');
    await flushFolder();
    expect(useFolder.getState().status).toBe('connected');
    const root = (await games.getDirectoryHandle('My Game')) as FakeDir;
    expect(root.tree()).toEqual([
      'Assets/Models/Old Car/.ege-asset.json',
      'Assets/Models/Old Car/scene.gltf',
      'Assets/Models/Old Car/textures/paint.png',
      'project.json',
    ]);
    expect(JSON.parse(await root.text('project.json')).name).toBe('My Game');

    // New download, rename, delete — all mirrored.
    await saveAsset(asset('a2', 'Tree', { 'tree.glb': 'glb' }));
    await saveAsset(asset('a1', 'Red Car', { 'scene.gltf': 'gltf2' }));
    await flushFolder();
    expect(root.tree()).toEqual([
      'Assets/Models/Red Car/.ege-asset.json',
      'Assets/Models/Red Car/scene.gltf',
      'Assets/Models/Tree/.ege-asset.json',
      'Assets/Models/Tree/tree.glb',
      'project.json',
    ]);
    await deleteAsset('a2');
    await saveProject(project('p1', 'Renamed Game'));
    await flushFolder();
    expect(root.tree()).not.toContain('Assets/Models/Tree/tree.glb');
    expect(JSON.parse(await root.text('project.json')).name).toBe('Renamed Game');
  });

  it('opens a project folder back into the editor, files and all', async () => {
    await saveProject(project('p1', 'My Game'));
    await saveAsset(asset('a1', 'Old Car', { 'scene.gltf': 'gltf', 'textures/paint.png': 'png' }));
    await attachProjectFolder('p1');
    picked = new FakeDir('Empty'); // empty → used as the project folder itself
    await chooseProjectFolder('My Game');
    await flushFolder();
    const folder = picked;
    expect(JSON.parse(await folder.text(`Assets/Models/Old Car/${ASSET_JSON}`)).id).toBe('a1');

    // Another computer: nothing in browser storage.
    await forgetProjectFolder();
    globalThis.indexedDB = new IDBFactory();
    _resetDbForTests();
    const opened = await importFolder(folder as never);
    expect(opened).toEqual({ id: 'p1', name: 'My Game', assets: 1 });
    expect((await loadProject('p1'))?.scene.entities[0].name).toBe('Thing');
    const [a] = await listAssets('p1');
    expect(a.name).toBe('Old Car');
    expect(Object.keys(a.files).sort()).toEqual(['scene.gltf', 'textures/paint.png']);
    expect(await a.files['textures/paint.png'].text()).toBe('png');
    expect(a.meta.credit?.author).toBe('Someone');
  });

  it('rejects folders that are not projects, and makes safe names', async () => {
    await expect(importFolder(new FakeDir('Random') as never)).rejects.toThrow(/isn't an Easy Game Engine project folder/);
    expect(safeName('a/b:c*?. ')).toBe('a b c');
    expect(safeName('')).toBe('Untitled');
  });
});
