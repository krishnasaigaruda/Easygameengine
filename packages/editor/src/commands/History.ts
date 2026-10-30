import type { World } from '@ege/runtime';

/**
 * One undoable edit. Commands refer to entities by id (not reference) because undoing a
 * delete re-creates the entity as a new object with the same id.
 */
export interface Command {
  readonly label: string;
  do(world: World): void;
  undo(world: World): void;
  /**
   * Try to absorb a newer command into this one (e.g. many slider ticks → one undo step).
   * Return true if merged.
   */
  merge?(next: Command): boolean;
}

/** Consecutive mergeable edits closer together than this become one undo step. */
const MERGE_WINDOW_MS = 1000;

export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private lastPushTime = -Infinity;
  private readonly listeners = new Set<() => void>();
  private readonly world: World;
  private readonly limit: number;

  constructor(world: World, limit = 300) {
    this.world = world;
    this.limit = limit;
  }

  /** Apply a command and record it. */
  execute(cmd: Command): void {
    cmd.do(this.world);
    this.push(cmd);
  }

  /** While set, edits are collected here and become one undo step (endGroup). */
  private grouping: Command[] | null = null;
  /** Groups inside groups (an AI request made of parts) all end up in the outermost one. */
  private groupDepth = 0;

  /** From now until endGroup(), every edit is part of one undo step (an AI request). */
  beginGroup(): void {
    if (this.groupDepth++ === 0) this.grouping = [];
  }

  /** Close the group: everything since beginGroup() undoes and redoes together. */
  endGroup(label: string): void {
    if (this.groupDepth === 0 || --this.groupDepth > 0) return;
    const cmds = this.grouping;
    this.grouping = null;
    if (!cmds?.length) return;
    this.push(cmds.length === 1 ? cmds[0] : new GroupCommand(label, cmds));
    this.seal();
  }

  /** Record a command whose effect has already been applied (e.g. after a gizmo drag). */
  push(cmd: Command, now = performance.now()): void {
    if (this.grouping) {
      const last = this.grouping[this.grouping.length - 1];
      if (!(last?.merge && last.merge(cmd))) this.grouping.push(cmd);
      this.redoStack.length = 0;
      this.notify();
      return;
    }
    const top = this.undoStack[this.undoStack.length - 1];
    const canMerge = top?.merge && now - this.lastPushTime < MERGE_WINDOW_MS;
    if (!(canMerge && top.merge!(cmd))) {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.lastPushTime = now;
    this.redoStack.length = 0;
    this.notify();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo(this.world);
    this.redoStack.push(cmd);
    this.lastPushTime = -Infinity; // never merge into something that was undone/redone
    this.notify();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do(this.world);
    this.undoStack.push(cmd);
    this.lastPushTime = -Infinity;
    this.notify();
    return true;
  }

  /** Stop the next command merging into the previous one (e.g. on pointer up). */
  seal(): void {
    this.lastPushTime = -Infinity;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Commands already applied, undone and redone together. */
class GroupCommand implements Command {
  constructor(
    readonly label: string,
    private readonly commands: Command[],
  ) {}

  do(world: World): void {
    for (const c of this.commands) c.do(world);
  }

  undo(world: World): void {
    for (const c of [...this.commands].reverse()) c.undo(world);
  }
}
