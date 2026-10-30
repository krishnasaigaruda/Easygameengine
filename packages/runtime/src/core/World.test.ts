import { describe, expect, it, vi } from 'vitest';
import { World } from './World';
import { MeshRenderer, Transform } from '../components/builtin';

describe('World hierarchy', () => {
  it('creates roots and children in order', () => {
    const w = new World();
    const a = w.createEntity({ name: 'A' });
    w.createEntity({ name: 'B' });
    const c = w.createEntity({ name: 'C', parent: a });
    const first = w.createEntity({ name: 'First', index: 0 });
    expect(w.roots.map((e) => e.name)).toEqual(['First', 'A', 'B']);
    expect(a.children).toEqual([c]);
    expect(c.parent).toBe(a);
    expect([...w.all()].map((e) => e.name)).toEqual(['First', 'A', 'C', 'B']);
    expect(first.parent).toBeNull();
  });

  it('reparents and refuses cycles', () => {
    const w = new World();
    const a = w.createEntity({ name: 'A' });
    const b = w.createEntity({ name: 'B', parent: a });
    const c = w.createEntity({ name: 'C', parent: b });
    expect(w.setParent(a, c)).toBe(false); // A under its own grandchild
    expect(w.setParent(a, a)).toBe(false);
    expect(w.setParent(c, null)).toBe(true);
    expect(w.roots.map((e) => e.name)).toEqual(['A', 'C']);
    expect(b.children).toHaveLength(0);
    expect(w.setParent(c, a, 0)).toBe(true);
    expect(a.children.map((e) => e.name)).toEqual(['C', 'B']);
  });

  it('destroys descendants, children first', () => {
    const w = new World();
    const a = w.createEntity({ name: 'A' });
    const b = w.createEntity({ name: 'B', parent: a });
    w.createEntity({ name: 'C', parent: b });
    const order: string[] = [];
    w.events.on('entityDestroyed', ({ entity }) => order.push(entity.name));
    w.destroyEntity(a);
    expect(order).toEqual(['C', 'B', 'A']);
    expect(w.size).toBe(0);
    expect(w.roots).toHaveLength(0);
  });

  it('rejects duplicate ids', () => {
    const w = new World();
    w.createEntity({ id: 'x' });
    expect(() => w.createEntity({ id: 'x' })).toThrow();
  });

  it('activeInHierarchy follows disabled ancestors', () => {
    const w = new World();
    const a = w.createEntity();
    const b = w.createEntity({ parent: a });
    a.enabled = false;
    expect(b.enabled).toBe(true);
    expect(b.activeInHierarchy).toBe(false);
  });
});

describe('Entity components', () => {
  it('adds with defaults, merges partial data, and emits events', () => {
    const w = new World();
    const e = w.createEntity();
    const events: string[] = [];
    w.events.on('componentAdded', ({ type }) => events.push(`+${type}`));
    w.events.on('componentChanged', ({ type }) => events.push(`~${type}`));
    w.events.on('componentRemoved', ({ type }) => events.push(`-${type}`));

    const m = e.add(MeshRenderer, { color: '#ff0000' });
    expect(m.shape).toBe('box');
    expect(m.color).toBe('#ff0000');
    e.set(MeshRenderer, { shape: 'sphere' });
    expect(e.get(MeshRenderer)?.shape).toBe('sphere');
    expect(e.remove(MeshRenderer)).toBe(true);
    expect(events).toEqual(['+MeshRenderer', '~MeshRenderer', '-MeshRenderer']);
  });

  it('cannot remove required components', () => {
    const w = new World();
    const e = w.createEntity();
    e.add(Transform);
    expect(e.remove(Transform)).toBe(false);
    expect(e.has(Transform)).toBe(true);
  });

  it('defaults are fresh objects per entity', () => {
    const w = new World();
    const a = w.createEntity().add(Transform);
    const b = w.createEntity().add(Transform);
    a.position[0] = 5;
    expect(b.position[0]).toBe(0);
  });

  it('keeps unknown component types as raw data', () => {
    const w = new World();
    const e = w.createEntity();
    e.add('FutureThing', { power: 9 });
    expect(e.get('FutureThing')).toEqual({ power: 9 });
  });

  it('query finds entities with all listed components', () => {
    const w = new World();
    const a = w.createEntity({ name: 'a' });
    a.add(Transform);
    a.add(MeshRenderer);
    w.createEntity({ name: 'b' }).add(Transform);
    expect([...w.query(Transform, MeshRenderer)].map((e) => e.name)).toEqual(['a']);
  });
});

describe('systems', () => {
  it('runs in order with update then lateUpdate', () => {
    const w = new World();
    const calls: string[] = [];
    w.addSystem({ name: 'late', order: 10, update: () => calls.push('late.update') });
    w.addSystem({
      name: 'early',
      order: -1,
      update: () => calls.push('early.update'),
      lateUpdate: () => calls.push('early.late'),
    });
    w.update(0.016);
    expect(calls).toEqual(['early.update', 'late.update', 'early.late']);
  });

  it('attach/detach hooks fire', () => {
    const w = new World();
    const attach = vi.fn();
    const detach = vi.fn();
    const s = { name: 's', attach, detach };
    w.addSystem(s);
    w.removeSystem(s);
    expect(attach).toHaveBeenCalledWith(w);
    expect(detach).toHaveBeenCalledWith(w);
  });
});
