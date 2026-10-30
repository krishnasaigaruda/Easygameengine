import { describe, expect, it } from 'vitest';
import type { SceneData } from '@ege/runtime';
import type { AssetRecord } from '../persistence/projectStore';
import { creditsOf, usedAssets } from './exportGame';

const record = (id: string, extra: Partial<AssetRecord> = {}): AssetRecord => ({
  id,
  projectId: 'p',
  name: id,
  type: 'model',
  main: 'a.glb',
  files: { 'a.glb': new Blob(['x']) },
  meta: { size: 1 },
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe('export', () => {
  const scene = { format: 'ege-scene', version: 1, name: 'S', entities: [{ id: 'e', name: 'Box', components: { ModelRenderer: { model: 'modelAAAAAAAA' }, MeshRenderer: { material: 'matBBBBBBBBBB' } } }] } as unknown as SceneData;
  const records = [
    record('modelAAAAAAAA'),
    record('matBBBBBBBBBB', { type: 'material', main: '', files: {}, data: { albedoMap: 'texCCCCCCCCCC' } }),
    record('texCCCCCCCCCC', { type: 'texture', meta: { size: 1, credit: { provider: 'polyhaven', author: 'Rob', license: 'CC0' } } }),
    record('unusedDDDDDDD', { meta: { size: 1, credit: { provider: 'objaverse', author: 'Ann', license: 'CC-BY 4.0', url: 'https://x' } } }),
  ];

  it('keeps what the scene uses, and what those use in turn (a material\'s textures)', () => {
    expect(usedAssets(scene, records).map((r) => r.id)).toEqual(['modelAAAAAAAA', 'matBBBBBBBBBB', 'texCCCCCCCCCC']);
  });

  it('lists credits for store assets', () => {
    expect(creditsOf(records).map((c) => `${c.name} by ${c.author} (${c.license}, ${c.source})`)).toEqual([
      'texCCCCCCCCCC by Rob (CC0, Poly Haven)',
      'unusedDDDDDDD by Ann (CC-BY 4.0, Sketchfab (Objaverse))',
    ]);
  });
});

describe('credits', () => {
  it('lists a texture set once, under its own name', () => {
    const credit = { provider: 'polyhaven' as const, author: 'Rob', license: 'CC0', url: 'https://polyhaven.com/a/forest_leaves_02' };
    const maps = ['Forest Leaves 02', 'forest leaves 02 diff 1k', 'forest leaves 02 nor gl 1k'].map((name, i) => record(`id${i}AAAAAAAAAA`, { name, meta: { size: 1, credit } }));
    expect(creditsOf(maps).map((c) => c.name)).toEqual(['Forest Leaves 02']);
  });
});

describe('project credits', () => {
  it('adds credits.json entries and own imports with a maker to the game credits', async () => {
    const { gameCredits } = await import('./exportGame');
    const file = record('credsAAAAAAAA', {
      type: 'data',
      name: 'credits.json',
      main: 'credits.json',
      files: { 'credits.json': new Blob([JSON.stringify({ credits: [{ name: 'Theme music', author: 'Sam', license: 'Used with permission', url: '' }, { name: '', author: '' }] })]) },
    });
    const own = record('ownBBBBBBBBBB', { name: 'Castle', meta: { size: 1, credit: { provider: 'user', author: 'Me', license: 'My own work' } } });
    const uncredited = record('ownCCCCCCCCCC', { name: 'Rock', meta: { size: 1, credit: { provider: 'user' } } });
    const credits = await gameCredits([own, uncredited], [own, uncredited, file]);
    expect(credits.map((c) => `${c.name} by ${c.author}`)).toEqual(['Castle by Me', 'Theme music by Sam']);
  });
});
