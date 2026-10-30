import { describe, expect, it } from 'vitest';
import { World } from '@ege/runtime';
import { uniqueName, withFreshIds } from './actions';

describe('uniqueName', () => {
  it('keeps free names and numbers taken ones like Unity', () => {
    const w = new World();
    const siblings = [w.createEntity({ name: 'Cube' }), w.createEntity({ name: 'Cube (1)' })];
    expect(uniqueName('Sphere', siblings)).toBe('Sphere');
    expect(uniqueName('Cube', siblings)).toBe('Cube (2)');
    expect(uniqueName('Cube (1)', siblings)).toBe('Cube (2)');
  });
});

describe('withFreshIds', () => {
  it('re-ids the whole tree without touching the original', () => {
    const original = {
      id: 'a',
      name: 'A',
      components: { Transform: { position: [1, 2, 3] } },
      children: [{ id: 'b', name: 'B', components: {} }],
    };
    const copy = withFreshIds(original);
    expect(copy.id).not.toBe('a');
    expect(copy.children![0].id).not.toBe('b');
    expect(copy.children![0].name).toBe('B');
    (copy.components.Transform as { position: number[] }).position[0] = 99;
    expect(original.components.Transform.position[0]).toBe(1);
  });
});

describe('multi-selection', () => {
  async function setup() {
    const { useEditor } = await import('../state/editorStore');
    const { History } = await import('../commands/History');
    const { RenderSystem, Transform, THREE } = await import('@ege/runtime');
    const world = new World();
    const render = new RenderSystem(new THREE.Scene());
    world.addSystem(render);
    const history = new History(world);
    useEditor.setState({ engine: { world, render } as never, history, playing: false, selection: null, selected: [] });
    const make = (name: string, x: number, parent?: string) => {
      const e = world.createEntity({ name });
      e.add(Transform, { position: [x, 0, 0] });
      if (parent) world.setParent(e, world.getById(parent)!);
      return e;
    };
    return { useEditor, world, history, make, Transform };
  }

  it('Ctrl/Cmd-click toggles, the last picked is active', async () => {
    const { useEditor, make } = await setup();
    const a = make('A', 0);
    const b = make('B', 1);
    const s = useEditor.getState();
    s.select(a.id);
    s.toggleSelect(b.id);
    expect(useEditor.getState().selected).toEqual([a.id, b.id]);
    expect(useEditor.getState().selection).toBe(b.id);
    useEditor.getState().toggleSelect(b.id);
    expect(useEditor.getState().selected).toEqual([a.id]);
    expect(useEditor.getState().selection).toBe(a.id);
  });

  it('delete, duplicate and group act on every selected object, each as one undo step', async () => {
    const { deleteSelected, duplicateSelected, groupSelected, selectAll } = await import('./actions');
    const { useEditor, world, history, make, Transform } = await setup();
    const a = make('A', 0);
    const b = make('B', 4);
    const child = make('Child', 1, a.id);
    selectAll();
    expect(useEditor.getState().selected).toHaveLength(3);

    duplicateSelected(); // A (with its child) and B — the child isn't copied twice
    expect([...world.all()].map((e) => e.name).sort()).toEqual(['A', 'A (1)', 'B', 'B (1)', 'Child', 'Child'].sort());
    expect(useEditor.getState().selected).toHaveLength(2);
    history.undo();
    expect([...world.all()]).toHaveLength(3);

    useEditor.getState().selectMany([a.id, b.id]);
    groupSelected();
    const group = world.roots.find((e) => e.name === 'Group')!;
    expect(group.children.map((e) => e.name)).toEqual(['A', 'B']);
    expect(group.require(Transform).position).toEqual([2, 0, 0]); // the middle
    expect(b.require(Transform).position).toEqual([2, 0, 0]); // still at x = 4 in the world
    history.undo();
    expect(b.parent).toBeNull();
    expect(b.require(Transform).position).toEqual([4, 0, 0]);
    expect(world.getById(group.id)).toBeUndefined();

    useEditor.getState().selectMany([a.id, b.id, child.id]);
    deleteSelected();
    expect([...world.all()]).toHaveLength(0);
    history.undo();
    expect([...world.all()].map((e) => e.name).sort()).toEqual(['A', 'B', 'Child']);
    expect(world.getById(child.id)?.parent?.id).toBe(a.id);
  });

  it('editing a field changes it on all selected objects that have it', async () => {
    const { editComponent } = await import('./actions');
    const { useEditor, history, make, Transform } = await setup();
    const a = make('A', 0);
    const b = make('B', 4);
    useEditor.getState().selectMany([a.id, b.id], b.id);
    editComponent(b, Transform.type, { scale: [2, 2, 2] });
    expect(a.require(Transform).scale).toEqual([2, 2, 2]);
    expect(b.require(Transform).scale).toEqual([2, 2, 2]);
    history.undo();
    expect(a.require(Transform).scale).toEqual([1, 1, 1]);
  });
});
