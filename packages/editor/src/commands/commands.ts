import {
  instantiateEntity,
  serializeEntity,
  type Engine,
  type Entity,
  type EntityData,
  type SceneSettings,
  type World,
} from '@ege/runtime';
import type { Command } from './History';

function mustGet(world: World, id: string): Entity {
  const e = world.getById(id);
  if (!e) throw new Error(`Entity ${id} no longer exists`);
  return e;
}

function parentOf(world: World, parentId: string | null): Entity | null {
  return parentId ? mustGet(world, parentId) : null;
}

function indexIn(entity: Entity): number {
  const list = entity.parent ? entity.parent.children : entity.world.roots;
  return list.indexOf(entity);
}

/** Creates an entity tree from data (ids are kept, so undo/redo keep pointing at it). */
export class CreateEntityCommand implements Command {
  readonly label: string;
  private readonly data: EntityData;
  private readonly parentId: string | null;
  private readonly index: number | undefined;

  constructor(data: EntityData, parentId: string | null = null, index?: number, label?: string) {
    this.data = structuredClone(data);
    this.parentId = parentId;
    this.index = index;
    this.label = label ?? `Create ${data.name}`;
  }

  get entityId(): string {
    return this.data.id;
  }

  do(world: World): void {
    instantiateEntity(world, this.data, parentOf(world, this.parentId), true, this.index);
  }

  undo(world: World): void {
    world.destroyEntity(mustGet(world, this.data.id));
  }
}

/** Deletes an entity (and children); undo restores it at the same place in the hierarchy. */
export class DeleteEntityCommand implements Command {
  readonly label: string;
  private readonly id: string;
  private snapshot: EntityData | null = null;
  private parentId: string | null = null;
  private index = 0;

  constructor(entity: Entity) {
    this.id = entity.id;
    this.label = `Delete ${entity.name}`;
  }

  do(world: World): void {
    const e = mustGet(world, this.id);
    this.snapshot = serializeEntity(e);
    this.parentId = e.parent?.id ?? null;
    this.index = indexIn(e);
    world.destroyEntity(e);
  }

  undo(world: World): void {
    if (!this.snapshot) return;
    instantiateEntity(world, this.snapshot, parentOf(world, this.parentId), true, this.index);
  }
}

export class ReparentCommand implements Command {
  readonly label: string;
  private readonly id: string;
  private readonly oldParentId: string | null;
  private readonly oldIndex: number;
  private readonly newParentId: string | null;
  private readonly newIndex: number | undefined;

  constructor(entity: Entity, newParent: Entity | null, newIndex?: number) {
    this.id = entity.id;
    this.label = `Move ${entity.name}`;
    this.oldParentId = entity.parent?.id ?? null;
    this.oldIndex = indexIn(entity);
    this.newParentId = newParent?.id ?? null;
    this.newIndex = newIndex;
  }

  do(world: World): void {
    const e = mustGet(world, this.id);
    if (!world.setParent(e, parentOf(world, this.newParentId), this.newIndex)) {
      throw new Error('Cannot move an object inside itself');
    }
  }

  undo(world: World): void {
    world.setParent(mustGet(world, this.id), parentOf(world, this.oldParentId), this.oldIndex);
  }
}

export class RenameCommand implements Command {
  readonly label = 'Rename';
  private readonly id: string;
  private readonly before: string;
  private readonly after: string;

  constructor(entity: Entity, name: string) {
    this.id = entity.id;
    this.before = entity.name;
    this.after = name;
  }

  do(world: World): void {
    mustGet(world, this.id).name = this.after;
  }

  undo(world: World): void {
    mustGet(world, this.id).name = this.before;
  }
}

/** Replace an object's tags (scripts find objects by tag: count('enemy'), closest('coin')). */
export class SetTagsCommand implements Command {
  readonly label = 'Edit tags';
  private readonly id: string;
  private readonly before: string[];
  private readonly after: string[];

  constructor(entity: Entity, tags: string[]) {
    this.id = entity.id;
    this.before = [...entity.tags];
    this.after = tags;
  }

  private apply(world: World, tags: string[]): void {
    const e = mustGet(world, this.id);
    e.tags.clear();
    for (const t of tags) e.tags.add(t);
  }

  do(world: World): void {
    this.apply(world, this.after);
  }

  undo(world: World): void {
    this.apply(world, this.before);
  }
}

export class SetEnabledCommand implements Command {
  readonly label: string;
  private readonly id: string;
  private readonly value: boolean;

  constructor(entity: Entity, value: boolean) {
    this.id = entity.id;
    this.value = value;
    this.label = value ? `Show ${entity.name}` : `Hide ${entity.name}`;
  }

  do(world: World): void {
    mustGet(world, this.id).enabled = this.value;
  }

  undo(world: World): void {
    mustGet(world, this.id).enabled = !this.value;
  }
}

/**
 * Replaces a component's data. Edits to the same component in quick succession merge, so
 * dragging a slider or a gizmo is one undo step.
 */
export class SetComponentCommand implements Command {
  readonly label: string;
  readonly entityId: string;
  readonly type: string;
  private readonly before: object;
  private after: object;

  constructor(entity: Entity, type: string, before: object, after: object, label?: string) {
    this.entityId = entity.id;
    this.type = type;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
    this.label = label ?? `Edit ${type}`;
  }

  do(world: World): void {
    mustGet(world, this.entityId).set(this.type, structuredClone(this.after));
  }

  undo(world: World): void {
    mustGet(world, this.entityId).set(this.type, structuredClone(this.before));
  }

  merge(next: Command): boolean {
    if (!(next instanceof SetComponentCommand)) return false;
    if (next.entityId !== this.entityId || next.type !== this.type) return false;
    this.after = next.after;
    return true;
  }
}

export class AddComponentCommand implements Command {
  readonly label: string;
  private readonly id: string;
  private readonly type: string;
  private readonly data: object | undefined;

  constructor(entity: Entity, type: string, data?: object) {
    this.id = entity.id;
    this.type = type;
    this.data = data && structuredClone(data);
    this.label = `Add ${type}`;
  }

  do(world: World): void {
    mustGet(world, this.id).add(this.type, this.data && structuredClone(this.data));
  }

  undo(world: World): void {
    mustGet(world, this.id).remove(this.type);
  }
}

export class RemoveComponentCommand implements Command {
  readonly label: string;
  private readonly id: string;
  private readonly type: string;
  private snapshot: object | null = null;
  private position = 0;

  constructor(entity: Entity, type: string) {
    this.id = entity.id;
    this.type = type;
    this.label = `Remove ${type}`;
  }

  do(world: World): void {
    const e = mustGet(world, this.id);
    this.snapshot = structuredClone(e.get(this.type) ?? {});
    this.position = e.componentTypes().indexOf(this.type);
    e.remove(this.type);
  }

  undo(world: World): void {
    if (!this.snapshot) return;
    const e = mustGet(world, this.id);
    e.add(this.type, structuredClone(this.snapshot));
    e.moveComponent(this.type, this.position);
  }
}

/** Several commands as one undo step (e.g. deleting a multi-selection). */
export class BatchCommand implements Command {
  readonly label: string;
  private readonly commands: Command[];

  constructor(label: string, commands: Command[]) {
    this.label = label;
    this.commands = commands;
  }

  do(world: World): void {
    for (const c of this.commands) c.do(world);
  }

  undo(world: World): void {
    for (const c of [...this.commands].reverse()) c.undo(world);
  }

  /** A multi-object edit merges with the next one if it edits the same things (dragging a value). */
  merge(next: Command): boolean {
    if (!(next instanceof BatchCommand) || next.commands.length !== this.commands.length) return false;
    const pairs = this.commands.map((c, i) => [c, next.commands[i]] as const);
    const same = pairs.every(
      ([a, b]) => a instanceof SetComponentCommand && b instanceof SetComponentCommand && a.entityId === b.entityId && a.type === b.type,
    );
    if (!same) return false;
    for (const [a, b] of pairs) (a as SetComponentCommand).merge(b);
    return true;
  }
}

/** Scene-wide settings (sky, fog, exposure). Lives on the engine, not in the world. */
export class SetSceneSettingsCommand implements Command {
  readonly label: string;
  private readonly engine: Engine;
  private readonly before: SceneSettings;
  private after: SceneSettings;
  private readonly onApply: () => void;

  constructor(engine: Engine, after: SceneSettings, onApply: () => void, label = 'Edit scene settings') {
    this.engine = engine;
    this.before = structuredClone(engine.settings);
    this.after = structuredClone(after);
    this.onApply = onApply;
    this.label = label;
  }

  do(): void {
    this.engine.settings = structuredClone(this.after);
    this.onApply();
  }

  undo(): void {
    this.engine.settings = structuredClone(this.before);
    this.onApply();
  }

  merge(next: Command): boolean {
    if (!(next instanceof SetSceneSettingsCommand) || next.label !== this.label) return false;
    this.after = next.after;
    return true;
  }
}
