import { describe, expect, it } from 'vitest';
import { MeshRenderer, Transform, World, serializeWorld } from '@ege/runtime';
import { History } from './History';
import {
  AddComponentCommand,
  BatchCommand,
  CreateEntityCommand,
  DeleteEntityCommand,
  RemoveComponentCommand,
  RenameCommand,
  ReparentCommand,
  SetComponentCommand,
  SetEnabledCommand,
} from './commands';

function setup() {
  const world = new World();
  const a = world.createEntity({ id: 'a', name: 'A' });
  a.add(Transform);
  const b = world.createEntity({ id: 'b', name: 'B', parent: a });
  b.add(Transform, { position: [1, 2, 3] });
  b.add(MeshRenderer, { color: '#ff0000' });
  world.createEntity({ id: 'c', name: 'C' }).add(Transform);
  return { world, history: new History(world), a, b };
}

const snapshot = (w: World) => JSON.stringify(serializeWorld(w, 's'));

describe('History', () => {
  it('undo/redo returns the world to identical states', () => {
    const { world, history, b } = setup();
    const s0 = snapshot(world);
    history.execute(new RenameCommand(b, 'Bee'));
    const s1 = snapshot(world);
    history.execute(new DeleteEntityCommand(world.getById('a')!));
    expect(world.getById('b')).toBeUndefined();
    history.undo();
    expect(snapshot(world)).toBe(s1);
    history.undo();
    expect(snapshot(world)).toBe(s0);
    expect(history.canUndo).toBe(false);
    history.redo();
    history.redo();
    expect(world.getById('a')).toBeUndefined();
    expect(history.canRedo).toBe(false);
  });

  it('a new command clears the redo stack', () => {
    const { history, b } = setup();
    history.execute(new RenameCommand(b, 'X'));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.execute(new RenameCommand(b, 'Y'));
    expect(history.canRedo).toBe(false);
  });

  it('merges rapid edits to the same component, but not after seal()', () => {
    const { world, history, b } = setup();
    const before = structuredClone(b.require(Transform));
    for (let x = 1; x <= 5; x++) {
      const prev = structuredClone(b.require(Transform));
      history.push(new SetComponentCommand(b, 'Transform', prev, { ...prev, position: [x, 2, 3] }), 100 + x);
      b.set(Transform, { position: [x, 2, 3] });
    }
    history.undo();
    expect(world.getById('b')!.require(Transform)).toEqual(before);
    expect(history.canUndo).toBe(false);

    history.redo();
    history.seal();
    const prev = structuredClone(b.require(Transform));
    history.execute(new SetComponentCommand(b, 'Transform', prev, { ...prev, position: [9, 9, 9] }));
    history.undo();
    expect(b.require(Transform).position).toEqual([5, 2, 3]);
  });

  it('notifies listeners and respects the size limit', () => {
    const world = new World();
    const e = world.createEntity({ name: 'n0' });
    const h = new History(world, 3);
    let calls = 0;
    h.onChange(() => calls++);
    for (let i = 1; i <= 5; i++) h.execute(new RenameCommand(e, `n${i}`));
    expect(calls).toBe(5);
    let undos = 0;
    while (h.undo()) undos++;
    expect(undos).toBe(3);
    expect(e.name).toBe('n2');
  });
});

describe('commands', () => {
  it('delete restores children, components and exact sibling position', () => {
    const { world, history } = setup();
    const s0 = snapshot(world);
    history.execute(new DeleteEntityCommand(world.getById('a')!));
    expect(world.roots.map((e) => e.id)).toEqual(['c']);
    history.undo();
    expect(world.roots.map((e) => e.id)).toEqual(['a', 'c']);
    expect(snapshot(world)).toBe(s0);
  });

  it('create can be undone and redone with the same id', () => {
    const { world, history } = setup();
    const cmd = new CreateEntityCommand(
      { id: 'new', name: 'New', components: { Transform: {} } },
      'a',
      0,
    );
    history.execute(cmd);
    expect(world.getById('a')!.children[0].id).toBe('new');
    history.undo();
    expect(world.getById('new')).toBeUndefined();
    history.redo();
    expect(world.getById('a')!.children[0].id).toBe('new');
  });

  it('reparent undo returns to the old parent and index', () => {
    const { world, history } = setup();
    const c = world.getById('c')!;
    history.execute(new ReparentCommand(c, world.getById('a')!, 0));
    expect(world.getById('a')!.children.map((e) => e.id)).toEqual(['c', 'b']);
    history.undo();
    expect(world.roots.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('reparenting into a descendant fails without recording', () => {
    const { world, history } = setup();
    expect(() => history.execute(new ReparentCommand(world.getById('a')!, world.getById('b')!))).toThrow();
    expect(history.canUndo).toBe(false);
  });

  it('enable / component add / remove are undoable and keep component order', () => {
    const { world, history, b } = setup();
    history.execute(new SetEnabledCommand(b, false));
    expect(b.enabled).toBe(false);
    history.undo();
    expect(b.enabled).toBe(true);

    history.execute(new AddComponentCommand(b, 'Camera'));
    expect(b.componentTypes()).toEqual(['Transform', 'MeshRenderer', 'Camera']);
    history.undo();
    expect(b.has('Camera')).toBe(false);

    history.execute(new RemoveComponentCommand(b, 'MeshRenderer'));
    expect(b.has(MeshRenderer)).toBe(false);
    history.undo();
    expect(world.getById('b')!.componentTypes()).toEqual(['Transform', 'MeshRenderer']);
    expect(b.get(MeshRenderer)?.color).toBe('#ff0000');
  });

  it('batch undoes in reverse order', () => {
    const { world, history } = setup();
    const s0 = snapshot(world);
    history.execute(
      new BatchCommand('Delete 2', [
        new DeleteEntityCommand(world.getById('b')!),
        new DeleteEntityCommand(world.getById('a')!),
      ]),
    );
    expect(world.size).toBe(1);
    history.undo();
    expect(snapshot(world)).toBe(s0);
  });
});
