import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { Light, MeshRenderer, Transform } from '../components/builtin';
import { loadSceneInto, parseScene, serializeWorld, instantiateEntity, SceneFormatError } from './serialize';

function sampleWorld() {
  const w = new World();
  const player = w.createEntity({ id: 'p1', name: 'Player' });
  player.add(Transform, { position: [1, 2, 3] });
  player.add(MeshRenderer, { shape: 'capsule', color: '#3366ff' });
  player.tags.add('player');
  const pack = w.createEntity({ id: 'bp', name: 'Backpack', parent: player });
  pack.add(Transform, { position: [0, 0.5, -0.4] });
  pack.enabled = false;
  const sun = w.createEntity({ id: 'sun', name: 'Sun' });
  sun.add(Transform);
  sun.add(Light, { kind: 'directional', intensity: 3 });
  return w;
}

describe('scene serialization', () => {
  it('round-trips a world through JSON', () => {
    const json = JSON.parse(JSON.stringify(serializeWorld(sampleWorld(), 'Valley')));
    const scene = parseScene(json);
    const w2 = new World();
    loadSceneInto(w2, scene);

    expect(scene.name).toBe('Valley');
    expect(w2.roots.map((e) => e.name)).toEqual(['Player', 'Sun']);
    const p = w2.getById('p1')!;
    expect(p.require(Transform).position).toEqual([1, 2, 3]);
    expect(p.get(MeshRenderer)?.shape).toBe('capsule');
    expect(p.tags.has('player')).toBe(true);
    const bp = w2.getById('bp')!;
    expect(bp.parent).toBe(p);
    expect(bp.enabled).toBe(false);
    expect(w2.getById('sun')!.get(Light)?.intensity).toBe(3);
    // Same output again = stable format.
    expect(serializeWorld(w2, 'Valley')).toEqual(json);
  });

  it('fills missing component fields with defaults and adds a missing Transform', () => {
    const scene = parseScene({
      format: 'ege-scene',
      version: 1,
      name: 'Old',
      entities: [{ id: 'a', name: 'Box', components: { MeshRenderer: { color: '#00ff00' } } }],
    });
    const w = new World();
    loadSceneInto(w, scene);
    const box = w.getById('a')!;
    expect(box.has(Transform)).toBe(true);
    expect(box.get(MeshRenderer)).toMatchObject({ color: '#00ff00', shape: 'box', roughness: 0.6 });
    expect(scene.settings.fog.enabled).toBe(false); // fog is opt-in
  });

  it('gives fresh ids when instantiating copies', () => {
    const w = sampleWorld();
    const data = serializeWorld(w, 'x').entities[0];
    const copy = instantiateEntity(w, data, null, false);
    expect(copy.id).not.toBe('p1');
    expect(copy.children[0].id).not.toBe('bp');
    expect(copy.children[0].name).toBe('Backpack');
  });

  it('rejects files that are not scenes, newer versions, and duplicate ids', () => {
    expect(() => parseScene(null)).toThrow(SceneFormatError);
    expect(() => parseScene({ format: 'nope' })).toThrow(/Not an Easy Game Engine/);
    expect(() => parseScene({ format: 'ege-scene', version: 999, entities: [] })).toThrow(/newer/);
    expect(() =>
      parseScene({
        format: 'ege-scene',
        version: 1,
        entities: [
          { id: 'a', components: {} },
          { id: 'b', components: {}, children: [{ id: 'a', components: {} }] },
        ],
      }),
    ).toThrow(/reuses id "a"/);
  });

  it('loading replaces the previous world contents', () => {
    const w = sampleWorld();
    loadSceneInto(w, parseScene({ format: 'ege-scene', version: 1, entities: [{ id: 'z', components: {} }] }));
    expect([...w.all()].map((e) => e.id)).toEqual(['z']);
  });
});
