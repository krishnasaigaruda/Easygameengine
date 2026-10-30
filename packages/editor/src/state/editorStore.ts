import { create } from 'zustand';
import type { Engine, Entity, WorldEvents } from '@ege/runtime';
import { History } from '../commands/History';

/** This tab's memory (survives a reload, not a new tab). Private windows may refuse it: fine. */
export const tabMemory = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(`ege-${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) sessionStorage.removeItem(`ege-${key}`);
      else sessionStorage.setItem(`ege-${key}`, value);
    } catch {
      // not remembered
    }
  },
};

/** 'view' is the hand tool: navigate only, never select or move things. */
export type GizmoTool = 'view' | 'translate' | 'rotate' | 'scale';
export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export interface LogEntry {
  id: number;
  time: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  /** Entity the message is about (click to select). */
  entityId?: string;
}

interface EditorState {
  engine: Engine | null;
  history: History | null;
  /** Bumped on any world change (incl. visual-only ones) so panels re-render. */
  revision: number;
  /** Bumped only when saved data changes (scene, settings) — drives autosave. */
  dataRevision: number;
  /** Bumped when undo/redo availability changes. */
  historyRevision: number;
  /** The active selected entity (gizmo + Inspector). Always also in `selected`. */
  selection: string | null;
  /** Every selected entity, in the order they were picked (the active one is last). */
  selected: string[];
  /** Selected asset in the Project panel (mutually exclusive with `selection`). */
  assetSelection: string | null;
  tool: GizmoTool;
  snap: boolean;
  projectId: string | null;
  projectName: string;
  saveStatus: SaveStatus;
  logs: LogEntry[];
  /** The game is running (Play). Edits are temporary and autosave is paused. */
  playing: boolean;
  /** Playing, but game time is frozen. */
  paused: boolean;
  /** The viewport looks through the scene's camera instead of the editor camera. */
  gameView: boolean;
  /** This project was opened in another tab: this tab stopped saving so it can't overwrite it. */
  suspended: boolean;
  /** The Project Hub (all projects, new 3D / 2D, templates) is showing. */
  hubOpen: boolean;
  /** The open project is 3D or 2D. */
  dimension: '3d' | '2d';
  setHubOpen: (open: boolean) => void;

  setEngine: (engine: Engine | null) => void;
  /** Select just this entity (or nothing). */
  select: (id: string | null) => void;
  /** Ctrl/Cmd-click: add to the selection, or remove if already selected. */
  toggleSelect: (id: string) => void;
  /** Select several at once; `active` (default: the last) gets the gizmo and Inspector. */
  selectMany: (ids: string[], active?: string | null) => void;
  selectAsset: (id: string | null) => void;
  /** Mark saved data as changed (for edits outside the world, e.g. scene settings). */
  touchData: () => void;
  setTool: (tool: GizmoTool) => void;
  toggleSnap: () => void;
  setProject: (id: string, name: string) => void;
  setSaveStatus: (s: SaveStatus) => void;
  log: (level: LogEntry['level'], message: string, entityId?: string) => void;
  clearLogs: () => void;
  setPlaying: (on: boolean) => void;
  setPaused: (on: boolean) => void;
  setGameView: (on: boolean) => void;
}

const WATCHED: (keyof WorldEvents)[] = [
  'entityCreated',
  'entityDestroyed',
  'entityRenamed',
  'entityEnabledChanged',
  'hierarchyChanged',
  'componentAdded',
  'componentChanged',
  'componentRemoved',
];

const MAX_LOGS = 500;
let unwatch: (() => void)[] = [];
let logId = 0;

export const useEditor = create<EditorState>((set, get) => ({
  engine: null,
  history: null,
  revision: 0,
  dataRevision: 0,
  historyRevision: 0,
  selection: null,
  selected: [],
  suspended: false,
  // A reload keeps you where you were: in the editor if you were (this tab only).
  hubOpen: tabMemory.get('in-editor') !== '1',
  dimension: '3d',
  setHubOpen: (hubOpen) => {
    tabMemory.set('in-editor', hubOpen ? null : '1');
    set({ hubOpen });
  },
  assetSelection: null,
  tool: 'translate',
  snap: false,
  projectId: null,
  projectName: 'My Game',
  saveStatus: 'saved',
  logs: [],
  playing: false,
  paused: false,
  gameView: false,

  setEngine: (engine) => {
    // Handy for debugging in the browser console (development builds only).
    if (import.meta.env.DEV) (globalThis as { __ege?: Engine | null }).__ege = engine;
    for (const off of unwatch) off();
    unwatch = [];
    let history: History | null = null;
    if (engine) {
      history = new History(engine.world);
      const bump = () => set((s) => ({ revision: s.revision + 1, dataRevision: s.dataRevision + 1 }));
      unwatch = WATCHED.map((ev) => engine.world.events.on(ev, bump));
      unwatch.push(engine.world.events.on('entityVisualsChanged', () => set((s) => ({ revision: s.revision + 1 }))));
      // Drop the selection if the selected entity disappears (delete, undo of create…).
      unwatch.push(
        engine.world.events.on('entityDestroyed', ({ entity }) => {
          const { selected, selection } = get();
          if (!selected.includes(entity.id)) return;
          const rest = selected.filter((id) => id !== entity.id);
          set({ selected: rest, selection: selection === entity.id ? (rest[rest.length - 1] ?? null) : selection });
        }),
      );
      unwatch.push(history.onChange(() => set((s) => ({ historyRevision: s.historyRevision + 1 }))));
      // The viewport hands the engine over after init(), so scripts exist by now.
      if (engine.scripts) {
        unwatch.push(engine.scripts.events.on('log', (l) => get().log(l.level, l.message, l.entityId)));
      }
    }
    set((s) => ({ engine, history, selection: null, selected: [], revision: s.revision + 1 }));
  },
  select: (id) => set((s) => ({ selection: id, selected: id ? [id] : [], assetSelection: id ? null : s.assetSelection })),
  toggleSelect: (id) =>
    set((s) => {
      if (s.selected.includes(id)) {
        const selected = s.selected.filter((x) => x !== id);
        return { selected, selection: s.selection === id ? (selected[selected.length - 1] ?? null) : s.selection };
      }
      return { selected: [...s.selected, id], selection: id, assetSelection: null };
    }),
  selectMany: (ids, active) =>
    set((s) => {
      const selected = [...new Set(ids)];
      const a = active !== undefined && active !== null && selected.includes(active) ? active : (selected[selected.length - 1] ?? null);
      // Keep the active one last so "the active one is last" holds.
      const ordered = a ? [...selected.filter((x) => x !== a), a] : selected;
      return { selected: ordered, selection: a, assetSelection: a ? null : s.assetSelection };
    }),
  selectAsset: (id) => set((s) => ({ assetSelection: id, selection: id ? null : s.selection, selected: id ? [] : s.selected })),
  touchData: () => set((s) => ({ revision: s.revision + 1, dataRevision: s.dataRevision + 1 })),
  setTool: (tool) => set({ tool }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  setProject: (projectId, projectName) => set({ projectId, projectName }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  log: (level, message, entityId) =>
    set((s) => ({
      logs: [...s.logs.slice(-(MAX_LOGS - 1)), { id: ++logId, time: Date.now(), level, message, entityId }],
    })),
  clearLogs: () => set({ logs: [] }),
  setPlaying: (playing) => set({ playing, paused: false }),
  setPaused: (paused) => set({ paused }),
  setGameView: (gameView) => set({ gameView }),
}));

/** All selected entities that still exist, active one last. */
export function selectedEntities(): Entity[] {
  const { engine, selected } = useEditor.getState();
  if (!engine) return [];
  return selected.map((id) => engine.world.getById(id)).filter((e): e is Entity => !!e);
}

/** The selected entity object (re-evaluated on every world revision). */
export function useSelectedEntity() {
  const engine = useEditor((s) => s.engine);
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.revision);
  return selection ? engine?.world.getById(selection) : undefined;
}
