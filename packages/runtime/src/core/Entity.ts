import { createComponentData, getComponentDef, type ComponentDef } from './Component';
import type { World } from './World';

type DefOrType<T extends object> = ComponentDef<T> | string;

const typeOf = (d: DefOrType<object>) => (typeof d === 'string' ? d : d.type);

/**
 * An object in the game world ("Player", "Rock", "Sun"). It's just a name, a place in the
 * hierarchy and a bag of components — all behaviour lives in systems.
 */
export class Entity {
  readonly id: string;
  readonly world: World;
  /** @internal managed by World */
  _parent: Entity | null = null;
  /** @internal managed by World */
  readonly _children: Entity[] = [];
  private _name: string;
  private _enabled = true;
  readonly tags = new Set<string>();
  private readonly components = new Map<string, object>();

  /** @internal use world.createEntity() */
  constructor(world: World, id: string, name: string) {
    this.world = world;
    this.id = id;
    this._name = name;
  }

  get name(): string {
    return this._name;
  }
  set name(value: string) {
    if (value === this._name) return;
    this._name = value;
    this.world.events.emit('entityRenamed', { entity: this });
  }

  /** Disabled entities (or children of disabled entities) are hidden and don't run. */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    if (value === this._enabled) return;
    this._enabled = value;
    this.world.events.emit('entityEnabledChanged', { entity: this });
  }

  /** True if this and every ancestor is enabled. */
  get activeInHierarchy(): boolean {
    if (!this._enabled) return false;
    for (let e = this._parent; e; e = e._parent) if (!e._enabled) return false;
    return true;
  }

  get parent(): Entity | null {
    return this._parent;
  }

  get children(): readonly Entity[] {
    return this._children;
  }

  has(def: DefOrType<object>): boolean {
    return this.components.has(typeOf(def));
  }

  get<T extends object>(def: ComponentDef<T>): T | undefined;
  get(type: string): object | undefined;
  get(def: DefOrType<object>): object | undefined {
    return this.components.get(typeOf(def));
  }

  /** Like `get`, but throws if missing. Handy for components every entity has (Transform). */
  require<T extends object>(def: ComponentDef<T>): T {
    const c = this.components.get(def.type) as T | undefined;
    if (!c) throw new Error(`Entity "${this._name}" has no ${def.type} component`);
    return c;
  }

  /**
   * Adds a component (filled with defaults, overlaid with `data`). If the entity already has
   * one, its data is replaced. Unknown component types are stored as raw data so scene files
   * from newer engine versions don't lose information.
   */
  add<T extends object>(def: ComponentDef<T>, data?: Partial<T>): T;
  add(type: string, data?: object): object;
  add(def: DefOrType<object>, data?: object): object {
    const type = typeOf(def);
    const resolved = typeof def === 'string' ? getComponentDef(def) : def;
    const value = resolved ? createComponentData(resolved, data) : structuredClone(data ?? {});
    const existed = this.components.has(type);
    this.components.set(type, value);
    this.world.events.emit(existed ? 'componentChanged' : 'componentAdded', { entity: this, type });
    return value;
  }

  /** Merges `patch` into an existing component and notifies systems/editor. */
  set<T extends object>(def: ComponentDef<T>, patch: Partial<T>): T;
  set(type: string, patch: object): object;
  set(def: DefOrType<object>, patch: object): object {
    const type = typeOf(def);
    const current = this.components.get(type);
    if (!current) return this.add(type, patch);
    Object.assign(current, patch);
    this.world.events.emit('componentChanged', { entity: this, type });
    return current;
  }

  remove(def: DefOrType<object>): boolean {
    const type = typeOf(def);
    if (getComponentDef(type)?.required) return false;
    if (!this.components.delete(type)) return false;
    this.world.events.emit('componentRemoved', { entity: this, type });
    return true;
  }

  /** Reorders a component (affects Inspector order and serialization only). */
  moveComponent(def: DefOrType<object>, index: number): void {
    const type = typeOf(def);
    const value = this.components.get(type);
    if (!value) return;
    const entries = [...this.components].filter(([t]) => t !== type);
    entries.splice(Math.max(0, Math.min(index, entries.length)), 0, [type, value]);
    this.components.clear();
    for (const [t, v] of entries) this.components.set(t, v);
  }

  /** Component types on this entity, in insertion order. */
  componentTypes(): string[] {
    return [...this.components.keys()];
  }

  /** Walks this entity and all descendants depth-first. */
  *descendants(includeSelf = true): Generator<Entity> {
    if (includeSelf) yield this;
    for (const c of this._children) yield* c.descendants(true);
  }

  isDescendantOf(other: Entity): boolean {
    for (let e = this._parent; e; e = e._parent) if (e === other) return true;
    return false;
  }
}
