import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { World, serializeWorld } from '@ege/runtime';
import {
  _resetDbForTests,
  deleteAsset,
  listAssets,
  saveAsset,
  type AssetRecord,
  deleteProject,
  lastProjectId,
  listProjects,
  loadProject,
  saveProject,
  type ProjectRecord,
} from './projectStore';
import { parseProjectFile, toProjectZip, ProjectFileError } from './projectFile';
import { strToU8 } from 'fflate';

function record(id: string, updatedAt: number): ProjectRecord {
  const w = new World();
  w.createEntity({ id: `${id}-e`, name: 'Thing' });
  return { id, name: `Project ${id}`, createdAt: 1, updatedAt, scene: serializeWorld(w, 'Main') };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
});

describe('projectStore', () => {
  it('saves, loads, lists newest first, and remembers the last project', async () => {
    await saveProject(record('a', 10));
    await saveProject(record('b', 20));
    expect((await listProjects()).map((p) => p.id)).toEqual(['b', 'a']);
    expect(await lastProjectId()).toBe('b');
    const a = await loadProject('a');
    expect(a?.scene.entities[0].name).toBe('Thing');
  });

  it('deletes and clears lastProjectId when needed', async () => {
    await saveProject(record('a', 10));
    await deleteProject('a');
    expect(await loadProject('a')).toBeUndefined();
    expect(await lastProjectId()).toBeUndefined();
  });
});

function asset(id: string, projectId: string): AssetRecord {
  return {
    id,
    projectId,
    name: `Asset ${id}`,
    type: 'model',
    main: 'scene.gltf',
    files: { 'scene.gltf': new Blob(['{"asset":{}}']), 'tex/a.png': new Blob([new Uint8Array([1, 2, 3])]) },
    meta: { size: 15, animations: ['Walk'], credit: { provider: 'polyhaven', author: 'X', license: 'CC0-1.0' } },
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('asset storage', () => {
  it('stores assets per project and deletes them with the project', async () => {
    await saveProject(record('p1', 1));
    await saveAsset(asset('a1', 'p1'));
    await saveAsset(asset('a2', 'p1'));
    await saveAsset(asset('b1', 'p2'));
    expect((await listAssets('p1')).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    await deleteAsset('a2');
    expect((await listAssets('p1')).map((a) => a.id)).toEqual(['a1']);
    await deleteProject('p1');
    expect(await listAssets('p1')).toEqual([]);
    expect((await listAssets('p2')).map((a) => a.id)).toEqual(['b1']);
  });
});

describe('projectFile', () => {
  it('round-trips scene and assets (with all their files) through a zip', async () => {
    const r = record('x', 1);
    const bytes = await toProjectZip('My Game', r.scene, [asset('a1', 'x')]);
    const parsed = await parseProjectFile(bytes);
    expect(parsed.name).toBe('My Game');
    expect(parsed.scene.entities[0].id).toBe('x-e');
    expect(parsed.assets).toHaveLength(1);
    const a = parsed.assets[0];
    expect(a.id).toBe('a1');
    expect(a.meta.animations).toEqual(['Walk']);
    expect(a.meta.credit?.author).toBe('X');
    expect(Object.keys(a.files).sort()).toEqual(['scene.gltf', 'tex/a.png']);
    expect([...new Uint8Array(await a.files['tex/a.png'].arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('still opens old plain-JSON project files', async () => {
    const r = record('old', 1);
    const json = JSON.stringify({ format: 'ege-project', version: 1, name: 'Old', scene: r.scene });
    const parsed = await parseProjectFile(strToU8(json));
    expect(parsed.name).toBe('Old');
    expect(parsed.assets).toEqual([]);
  });

  it('gives friendly errors for wrong files', async () => {
    await expect(parseProjectFile(strToU8('not json'))).rejects.toThrow(ProjectFileError);
    await expect(parseProjectFile(strToU8('{"hello":1}'))).rejects.toThrow(/not an Easy Game Engine project/);
    await expect(parseProjectFile(new Uint8Array([0x50, 0x4b, 1, 2]))).rejects.toThrow(/damaged/);
  });
});
