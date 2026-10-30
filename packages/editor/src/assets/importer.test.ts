import { describe, expect, it } from 'vitest';
import { classifyTextureName, planImport, type IncomingFile } from './importer';

const f = (path: string, size = 10): IncomingFile => ({ path, blob: new Blob([new Uint8Array(size)]) });

describe('classifyTextureName', () => {
  it.each([
    ['rock_wall_diff_1k.jpg', 'rock_wall', 'map'],
    ['rock_wall_nor_gl_1k.png', 'rock_wall', 'normalMap'],
    ['rock_wall_rough_2k.jpg', 'rock_wall', 'roughnessMap'],
    ['Wood-BaseColor.png', 'wood', 'map'],
    ['Wood_Normal.png', 'wood', 'normalMap'],
    ['metal plate metallic.jpg', 'metal_plate', 'metalnessMap'],
    ['Bricks_AO.jpg', 'bricks', 'aoMap'],
    ['Ground_Albedo_4K.jpg', 'ground', 'map'],
  ])('%s → %s / %s', (name, stem, slot) => {
    expect(classifyTextureName(name)).toEqual({ stem, slot });
  });

  it('returns null for ordinary images', () => {
    expect(classifyTextureName('logo.png')).toBeNull();
    expect(classifyTextureName('diffuse.png')).toBeNull(); // no stem
  });
});

describe('planImport', () => {
  it('bundles a glTF with its buffers and textures, relative to the model folder', () => {
    const plan = planImport('p', [
      f('Hero/hero.gltf'),
      f('Hero/hero.bin'),
      f('Hero/textures/skin.png'),
    ]);
    expect(plan.records).toHaveLength(1);
    const m = plan.records[0];
    expect(m.type).toBe('model');
    expect(m.name).toBe('hero');
    expect(m.main).toBe('hero.gltf');
    expect(Object.keys(m.files).sort()).toEqual(['hero.bin', 'hero.gltf', 'textures/skin.png']);
    expect(m.meta.size).toBe(30);
  });

  it('keeps .glb self-contained and imports other files separately', () => {
    const plan = planImport('p', [f('Car.glb'), f('engine.mp3'), f('sky_4k.hdr'), f('readme.txt')]);
    expect(plan.records.map((r) => [r.type, r.name]).sort()).toEqual([
      ['audio', 'engine'],
      ['hdri', 'sky 4k'],
      ['model', 'Car'],
    ]);
    expect(Object.keys(plan.records.find((r) => r.type === 'model')!.files)).toEqual(['Car.glb']);
    expect(plan.skipped).toEqual(['readme.txt']);
  });

  it('turns a texture set into textures plus a material that references them', () => {
    const plan = planImport('p', [
      f('rock_diff_1k.jpg'),
      f('rock_nor_gl_1k.jpg'),
      f('rock_rough_1k.jpg'),
      f('logo.png'),
    ]);
    const textures = plan.records.filter((r) => r.type === 'texture');
    const materials = plan.records.filter((r) => r.type === 'material');
    expect(textures).toHaveLength(4);
    expect(materials).toHaveLength(1);
    const data = materials[0].data as Record<string, string>;
    const idOf = (name: string) => textures.find((t) => t.main === name)!.id;
    expect(materials[0].name).toBe('rock');
    expect(data.map).toBe(idOf('rock_diff_1k.jpg'));
    expect(data.normalMap).toBe(idOf('rock_nor_gl_1k.jpg'));
    expect(data.roughnessMap).toBe(idOf('rock_rough_1k.jpg'));
  });

  it('attaches credits to every record', () => {
    const credit = { provider: 'polyhaven' as const, author: 'Rob', license: 'CC0-1.0' };
    const plan = planImport('p', [f('a.glb')], credit);
    expect(plan.records[0].meta.credit).toEqual(credit);
  });
});
