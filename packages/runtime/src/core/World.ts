import { EventBus } from './EventBus';
import { Entity } from './Entity';
import { newId } from './ids';
import type { ComponentDef } from './Component';

export interface WorldEvents {
  entityCreated: { entity: Entity };
  /** Fired for each entity (children first) just before it's removed from the world. */
  entityDestroyed: { entity: Entity };
  entityRenamed: { entity: Entity };
  entityEnabledChanged: { entity: Entity };
  hierarchyChanged: { entity: Entity; oldParent: Entity | null; newParent: Entity | null };
  componentAdded: { entity: Entity; type: string };
  componentChanged: { entity: Entity; type: string };
  componentRemoved: { entity: Entity; type: string };
  /** Something only visual finished (e.g. a model loaded). Not a data change — don't save. */
  entityVisualsChanged: { entity: Entity };
}

/**
 * A system is engine logic that runs over entities every frame: rendering, physics,
 * scripts, animation... Systems should react to world events rather than poll for
 * structural changes.
 */
export interface System {
  readonly name: string;
  /** Lower runs first. Default 0. */
  readonly order?: number;
  attach?(world: World): void;
  detach?(world: World): void;
  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  /** Runs after every system's update; good for syncing to the renderer. */
  lateUpdate?(dt: number): void;
}

export interface CreateEntityOptions {
  name?: string;
  parent?: Entity | null;
  /** Keep an existing id (loading a scene). Must be unique in this world. */
  id?: string;
  /** Position among the parent's children. Defaults to last. */
  index?: number;
}

export class World {
  readonly events = new EventBus<WorldEvents>();
  private readonly entities = new Map<string, Entity>();
  private readonly _roots: Entity[] = [];
  private systems: System[] = [];

  /** Top-level entities in hierarchy order. */
  get roots(): readonly Entity[] {
    return this._roots;
  }

  get size(): number {
    return this.entities.size;
  }

  createEntity(options: CreateEntityOptions = {}): Entity {
    const id = options.id ?? newId();
    if (this.entities.has(id)) throw new Error(`Entity id "${id}" already exists`);
    const entity = new Entity(this, id, options.name ?? 'Entity');
    this.entities.set(id, entity);
    this.insertChild(options.parent ?? null, entity, options.index);
    this.events.emit('entityCreated', { entity });
    return entity;
  }

  /** Removes the entity and all its descendants. */
  destroyEntity(entity: Entity): void {
    if (this.entities.get(entity.id) !== entity) return;
    for (const child of [...entity._children]) this.destroyEntity(child);
    this.events.emit('entityDestroyed', { entity });
    this.detachChild(entity);
    this.entities.delete(entity.id);
  }

  /**
   * Moves `entity` under `parent` (null = top level). Returns false if that would create a
   * cycle (parenting something to its own descendant).
   */
  setParent(entity: Entity, parent: Entity | null, index?: number): boolean {
    if (parent === entity || (parent && parent.isDescendantOf(entity))) return false;
    const oldParent = entity._parent;
    this.detachChild(entity);
    this.insertChild(parent, entity, index);
    this.events.emit('hierarchyChanged', { entity, oldParent, newParent: parent });
    return true;
  }

  getById(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  findByName(name: string): Entity | undefined {
    for (const e of this.all()) if (e.name === name) return e;
    return undefined;
  }

  findByTag(tag: string): Entity[] {
    return [...this.all()].filter((e) => e.tags.has(tag));
  }

  /** Every entity, depth-first in hierarchy order. */
  *all(): Generator<Entity> {
    for (const r of this._roots) yield* r.descendants(true);
  }

  /** Entities that have every listed component. */
  *query(...defs: (ComponentDef | string)[]): Generator<Entity> {
    for (const e of this.all()) if (defs.every((d) => e.has(d))) yield e;
  }

  addSystem(system: System): void {
    this.systems.push(system);
    this.systems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    system.attach?.(this);
  }

  removeSystem(system: System): void {
    const i = this.systems.indexOf(system);
    if (i < 0) return;
    this.systems.splice(i, 1);
    system.detach?.(this);
  }

  getSystem<S extends System>(name: string): S | undefined {
    return this.systems.find((s) => s.name === name) as S | undefined;
  }

  /** Profiler: when on, how long each system takes per frame (milliseconds, smoothed). */
  profiling = false;
  readonly timings = new Map<string, number>();

  private timed(s: System, fn: () => void): void {
    if (!this.profiling) return fn();
    const t0 = performance.now();
    fn();
    const ms = performance.now() - t0;
    this.frameTimes.set(s.name, (this.frameTimes.get(s.name) ?? 0) + ms);
  }
  private readonly frameTimes = new Map<string, number>();

  fixedUpdate(dt: number): void {
    for (const s of this.systems) if (s.fixedUpdate) this.timed(s, () => s.fixedUpdate!(dt));
  }

  update(dt: number): void {
    for (const s of this.systems) if (s.update) this.timed(s, () => s.update!(dt));
    for (const s of this.systems) if (s.lateUpdate) this.timed(s, () => s.lateUpdate!(dt));
    if (!this.profiling) return;
    // One frame done: fold its times into the smoothed ones.
    for (const s of this.systems) {
      const ms = this.frameTimes.get(s.name) ?? 0;
      this.timings.set(s.name, (this.timings.get(s.name) ?? ms) * 0.9 + ms * 0.1);
    }
    this.frameTimes.clear();
  }

  /** Destroys every entity (systems stay attached). */
  clear(): void {
    for (const r of [...this._roots]) this.destroyEntity(r);
  }

  private siblingsOf(parent: Entity | null): Entity[] {
    return parent ? parent._children : this._roots;
  }

  private insertChild(parent: Entity | null, entity: Entity, index?: number): void {
    const list = this.siblingsOf(parent);
    const i = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
    list.splice(i, 0, entity);
    entity._parent = parent;
  }

  private detachChild(entity: Entity): void {
    const list = this.siblingsOf(entity._parent);
    const i = list.indexOf(entity);
    if (i >= 0) list.splice(i, 1);
    entity._parent = null;
  }
}
