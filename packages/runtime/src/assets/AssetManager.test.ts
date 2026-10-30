import { describe, expect, it } from 'vitest';

// Three's FileLoader reports progress with the browser-only ProgressEvent; Node lacks it.
globalThis.ProgressEvent ??= class extends Event {
  lengthComputable: boolean;
  loaded: number;
  total: number;
  constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
} as unknown as typeof ProgressEvent;
import * as THREE from 'three';
import { AssetManager, findFileUrl } from './AssetManager';
import { assetTypeForFile, type ResolvedAsset } from './types';
import { MemoryResolver, makeTestGltfFiles } from './testModel';
import { World } from '../core/World';
import { RenderSystem } from '../render/RenderSystem';
import { ModelSystem } from '../render/ModelSystem';
import { ModelRenderer, Transform } from '../components/builtin';

function setupAssets() {
  const resolver = new MemoryResolver();
  resolver.assets.set('tri', { id: 'tri', type: 'model', name: 'Tri', main: 'Tri.gltf', files: makeTestGltfFiles() });
  const assets = new AssetManager();
  assets.resolver = resolver;
  return { assets, resolver };
}

const visualsLoaded = (world: World) =>
  new Promise<void>((resolve) => {
    const off = world.events.on('entityVisualsChanged', () => {
      off();
      resolve();
    });
  });

describe('asset helpers', () => {
  it('classifies files by extension', () => {
    expect(assetTypeForFile('Hero.GLB')).toBe('model');
    expect(assetTypeForFile('rock_diff_1k.jpg')).toBe('texture');
    expect(assetTypeForFile('sky.hdr')).toBe('hdri');
    expect(assetTypeForFile('step.ogg')).toBe('audio');
    expect(assetTypeForFile('scene.bin')).toBeUndefined();
  });

  it('finds files by exact, case-insensitive, then bare-name match', () => {
    const asset: ResolvedAsset = {
      id: 'a',
      type: 'model',
      name: 'a',
      main: 'm.fbx',
      files: ['m.fbx', 'Textures/Wood.PNG'],
      url: (p) => (p === 'm.fbx' || p === 'Textures/Wood.PNG' ? `url:${p}` : undefined),
    };
    expect(findFileUrl(asset, './m.fbx')).toBe('url:m.fbx');
    expect(findFileUrl(asset, 'textures/wood.png')).toBe('url:Textures/Wood.PNG');
    // FBX files often store absolute paths from the artist's machine.
    expect(findFileUrl(asset, 'C:\\Users\\art\\Wood.png')).toBe('url:Textures/Wood.PNG');
    expect(findFileUrl(asset, 'missing.png')).toBeUndefined();
  });
});

describe('AssetManager', () => {
  it('loads a glTF whose buffer is a separate file, with its animation clips', async () => {
    const { assets } = setupAssets();
    const model = await assets.loadModel('tri');
    expect(model.animations.map((a) => a.name)).toEqual(['Bounce']);
    expect(model.bounds.max.x).toBeCloseTo(1);
    let meshes = 0;
    model.scene.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
    expect(meshes).toBe(1);
  });

  it('reads old specular-glossiness materials instead of showing them white', async () => {
    const { assets, resolver } = setupAssets();
    const files = makeTestGltfFiles();
    const gltf = JSON.parse(new TextDecoder().decode(files['Tri.gltf']));
    gltf.extensionsUsed = ['KHR_materials_pbrSpecularGlossiness'];
    gltf.extensionsRequired = ['KHR_materials_pbrSpecularGlossiness'];
    gltf.materials = [{ name: 'leaves', extensions: { KHR_materials_pbrSpecularGlossiness: { diffuseFactor: [0.2, 0.5, 0.1, 1], glossinessFactor: 0.3 } } }];
    gltf.meshes[0].primitives[0].material = 0;
    files['Tri.gltf'] = new TextEncoder().encode(JSON.stringify(gltf));
    resolver.assets.set('old', { id: 'old', type: 'model', name: 'Old', main: 'Tri.gltf', files });
    const model = await assets.loadModel('old');
    let mat: THREE.MeshStandardMaterial | undefined;
    model.scene.traverse((o) => (mat ??= (o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).material as THREE.MeshStandardMaterial) : undefined));
    expect(mat!.type).toBe('MeshStandardMaterial');
    expect(mat!.color.g).toBeGreaterThan(mat!.color.r);
    expect(mat!.roughness).toBeCloseTo(0.7);
  });

  it('caches loads and gives every instance its own object', async () => {
    const { assets } = setupAssets();
    expect(assets.loadModel('tri')).toBe(assets.loadModel('tri'));
    const a = await assets.instantiate('tri');
    const b = await assets.instantiate('tri');
    expect(a.object).not.toBe(b.object);
  });

  it('invalidate() forces a reload and notifies listeners; failures are not cached', async () => {
    const { assets } = setupAssets();
    const first = assets.loadModel('tri');
    const changed: string[] = [];
    assets.events.on('changed', ({ id }) => changed.push(id));
    assets.invalidate('tri');
    expect(assets.loadModel('tri')).not.toBe(first);
    expect(changed).toEqual(['tri']);
    const failed = assets.loadModel('nope');
    await expect(failed).rejects.toThrow(/not found/);
    const retry = assets.loadModel('nope'); // a fresh attempt, not the cached failure
    expect(retry).not.toBe(failed);
    await expect(retry).rejects.toThrow();
  });

  it('rejects non-models with a clear message', async () => {
    const { assets, resolver } = setupAssets();
    resolver.assets.set('snd', { id: 'snd', type: 'audio', name: 'Step', main: 'step.ogg', files: {} });
    await expect(assets.loadModel('snd')).rejects.toThrow(/not a model/);
  });
});

describe('ModelSystem', () => {
  function setupWorld() {
    const { assets, resolver } = setupAssets();
    const world = new World();
    const render = new RenderSystem(new THREE.Scene(), assets);
    world.addSystem(render);
    const models = new ModelSystem(render, assets);
    world.addSystem(models);
    return { world, render, models, assets, resolver };
  }

  it('puts the model under the entity and auto-plays the first clip', async () => {
    const { world, render, models } = setupWorld();
    const e = world.createEntity({ name: 'Hero' });
    e.add(Transform);
    const loaded = visualsLoaded(world);
    e.add(ModelRenderer, { model: 'tri' });
    await loaded;
    const obj = models.objectOf(e)!;
    expect(obj.parent).toBe(render.nodeOf(e));
    expect(models.clipsOf(e)).toEqual(['Bounce']);
    world.update(0.5); // animation moves the triangle node up
    expect(obj.getObjectByName('Tri')!.position.y).toBeCloseTo(1);
  });

  it('a slow stale load never overwrites a newer model choice', async () => {
    const { world, models, resolver } = setupWorld();
    resolver.assets.set('tri2', { id: 'tri2', type: 'model', name: 'Tri2', main: 'Tri.gltf', files: makeTestGltfFiles() });
    const e = world.createEntity();
    resolver.delayMs = 30;
    e.add(ModelRenderer, { model: 'tri' });
    resolver.delayMs = 0;
    const loaded = visualsLoaded(world);
    e.set(ModelRenderer, { model: 'tri2' });
    await loaded;
    await new Promise((r) => setTimeout(r, 60)); // let the stale load finish
    expect(models.objectOf(e)!.name).toBe('Tri2');
  });

  it('reloads models once when their asset changes (no infinite loop)', async () => {
    const { world, models, assets } = setupWorld();
    const entities = [world.createEntity(), world.createEntity()];
    let loaded = visualsLoaded(world);
    for (const e of entities) e.add(ModelRenderer, { model: 'tri' });
    await loaded;
    await new Promise((r) => setTimeout(r, 20));
    const before = entities.map((e) => models.objectOf(e));
    loaded = visualsLoaded(world);
    assets.invalidate('tri'); // used to spin forever
    await loaded;
    await new Promise((r) => setTimeout(r, 20));
    for (const [i, e] of entities.entries()) {
      expect(models.objectOf(e)).toBeDefined();
      expect(models.objectOf(e)).not.toBe(before[i]);
    }
  });

  it('removes the model when the component goes away', async () => {
    const { world, render, models } = setupWorld();
    const e = world.createEntity();
    const loaded = visualsLoaded(world);
    e.add(ModelRenderer, { model: 'tri' });
    await loaded;
    e.remove(ModelRenderer);
    expect(models.objectOf(e)).toBeUndefined();
    expect(render.nodeOf(e)!.children).toHaveLength(0);
  });
});
