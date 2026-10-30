import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Camera, Light, MeshRenderer, ModelRenderer, getComponentDef, UI_TYPES, type Entity } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import {
  copySelected,
  deleteEntity,
  deleteSelected,
  duplicate,
  duplicateSelected,
  groupSelected,
  hasClipboard,
  topSelected,
  paste,
  rename,
  reparent,
  setEnabled,
} from '../editor/actions';
import { createMenuItems } from '../editor/menus';
import { useMenu, type MenuEntry } from '../ui/Menu';
import { viewportController } from '../viewport/viewportRef';
import { Icon } from '../ui/Icon';
import { keyLabel } from '../editor/keymap';
import { startsFolded } from './hierarchyFold';

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
type DropZone = 'before' | 'inside' | 'after';

function iconFor(e: Entity): string {
  const light = e.get(Light);
  if (light) return light.kind === 'directional' ? 'sun' : light.kind === 'spot' ? 'flashlight' : 'lightbulb';
  if (e.has(Camera)) return 'video';
  const ui = UI_TYPES.find((t) => e.has(t));
  if (ui) return getComponentDef(ui)?.icon ?? 'monitor';
  if (e.has(ModelRenderer)) return 'shapes';
  if (e.has(MeshRenderer)) return 'box';
  return e.children.length ? 'folder' : 'square-dashed';
}

/** Ids of entities matching the search, plus all their ancestors (so the tree stays readable). */
function searchMatches(roots: readonly Entity[], q: string): Set<string> {
  const keep = new Set<string>();
  const visit = (e: Entity): boolean => {
    let any = e.name.toLowerCase().includes(q) || [...e.tags].some((t) => t.toLowerCase().includes(q));
    for (const c of e.children) if (visit(c)) any = true;
    if (any) keep.add(e.id);
    return any;
  };
  roots.forEach(visit);
  return keep;
}

export function Hierarchy() {
  const engine = useEditor((s) => s.engine);
  const selection = useEditor((s) => s.selection);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const selectMany = useEditor((s) => s.selectMany);
  const selectedSet = new Set(selected);
  const multi = selected.length > 1;
  useEditor((s) => s.revision);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [drop, setDrop] = useState<{ id: string | null; zone: DropZone } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const menu = useMenu();
  const listRef = useRef<HTMLUListElement>(null);
  /** Set right after a drag so the click that follows pointerup doesn't change selection. */
  const suppressClick = useRef(false);

  // F2 renames the selection (from anywhere except text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === 'F2' && selection && !t.closest('input, textarea, select')) setRenaming(selection);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  // Keep the selected row visible (e.g. after clicking it in the viewport).
  useEffect(() => {
    if (!selection) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(selection)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  if (!engine) return <p className="empty">Loading…</p>;
  const world = engine.world;
  const q = query.trim().toLowerCase();
  const matches = q ? searchMatches(world.roots, q) : null;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Rows in the order they're shown (for Shift-click ranges). */
  const visibleOrder = (): string[] =>
    [...(listRef.current?.querySelectorAll<HTMLElement>('.tree-item[data-id]') ?? [])].map((el) => el.dataset.id!);

  const clickRow = (ev: MouseEvent, id: string) => {
    if (ev.metaKey || ev.ctrlKey) toggleSelect(id);
    else if (ev.shiftKey && selection) {
      const order = visibleOrder();
      const a = order.indexOf(selection);
      const b = order.indexOf(id);
      if (a < 0 || b < 0) return select(id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      selectMany([...new Set([...selected, ...range])], id);
    } else select(id);
  };

  const multiMenu = (): MenuEntry[] => [
    { label: `${selected.length} objects selected`, icon: 'layers', disabled: true, onSelect: () => {} },
    'separator',
    { label: 'Duplicate all', icon: 'copy', shortcut: keyLabel('duplicate'), onSelect: duplicateSelected },
    { label: 'Copy all', icon: 'clipboard', shortcut: keyLabel('copy'), onSelect: copySelected },
    { label: 'Group under new parent', icon: 'folder', onSelect: groupSelected },
    'separator',
    { label: 'Delete all', icon: 'trash', shortcut: keyLabel('delete'), danger: true, onSelect: deleteSelected },
  ];

  const entityMenu = (e: Entity): MenuEntry[] => [
    { label: 'Create child', icon: 'plus', children: createMenuItems(e.id) },
    'separator',
    { label: 'Rename', icon: 'pencil', shortcut: 'F2', onSelect: () => setRenaming(e.id) },
    { label: 'Duplicate', icon: 'copy', shortcut: keyLabel('duplicate'), onSelect: () => duplicate(e.id) },
    { label: 'Copy', icon: 'clipboard', shortcut: keyLabel('copy'), onSelect: () => { select(e.id); copySelected(); } },
    { label: 'Paste', icon: 'paste', shortcut: keyLabel('paste'), disabled: !hasClipboard(), onSelect: () => { select(e.id); paste(); } },
    { label: 'Focus in view', icon: 'crosshair', shortcut: 'F', onSelect: () => { select(e.id); setTimeout(() => viewportController()?.focusSelected()); } },
    {
      label: e.enabled ? 'Hide' : 'Show',
      icon: e.enabled ? 'eye-off' : 'eye',
      onSelect: () => setEnabled(e.id, !e.enabled),
    },
    { label: 'Move to top level', icon: 'upload-from', disabled: !e.parent, onSelect: () => reparent(e.id, null) },
    'separator',
    { label: 'Delete', icon: 'trash', shortcut: keyLabel('delete'), danger: true, onSelect: () => deleteEntity(e.id) },
  ];

  /** Works out where a drop at (x, y) would go: before/inside/after a row, or the top level. */
  const dropTargetAt = (x: number, y: number): { id: string | null; zone: DropZone } | null => {
    const el = document.elementFromPoint(x, y);
    const list = listRef.current;
    if (!el || !list || !list.contains(el)) return null;
    const row = el.closest<HTMLElement>('.tree-item[data-id]');
    if (!row) return { id: null, zone: 'inside' };
    const r = row.getBoundingClientRect();
    const t = (y - r.top) / r.height;
    return { id: row.dataset.id!, zone: t < 0.25 ? 'before' : t > 0.75 ? 'after' : 'inside' };
  };

  const performDrop = (id: string, target: { id: string | null; zone: DropZone }) => {
    // Dragging one of several selected rows moves them all (in Hierarchy order).
    if (multi && selectedSet.has(id)) {
      const list = topSelected().filter((e) => e.id !== target.id);
      if (target.zone === 'after') list.reverse(); // each "after" insert pushes the earlier ones down
      for (const e of list) dropOne(e.id, target);
      return;
    }
    dropOne(id, target);
  };

  const dropOne = (id: string, target: { id: string | null; zone: DropZone }) => {
    if (target.id === id) return;
    const targetEntity = target.id ? world.getById(target.id) : null;
    if (!targetEntity) {
      reparent(id, null);
      return;
    }
    if (target.zone === 'inside') {
      reparent(id, targetEntity.id);
      setCollapsed((p) => {
        const n = new Set(p);
        n.delete(targetEntity.id);
        return n;
      });
      return;
    }
    const parent = targetEntity.parent;
    const siblings = parent ? parent.children : world.roots;
    const index = siblings.indexOf(targetEntity) + (target.zone === 'after' ? 1 : 0);
    reparent(id, parent?.id ?? null, index);
  };

  /**
   * Pointer-based drag & drop (instead of HTML5 drag events) so it also works with touch.
   * A press only becomes a drag after moving a few pixels; otherwise it's a normal click.
   */
  const onRowPointerDown = (ev: ReactPointerEvent<HTMLElement>, entity: Entity) => {
    if (ev.button !== 0 || renaming === entity.id) return;
    if ((ev.target as HTMLElement).closest('button, input')) return;
    const startX = ev.clientX;
    const startY = ev.clientY;
    let active = false;
    let target: { id: string | null; zone: DropZone } | null = null;

    const move = (e: PointerEvent) => {
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        active = true;
        setDraggingId(entity.id);
      }
      target = dropTargetAt(e.clientX, e.clientY);
      setDrop(target);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!active) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false));
      setDraggingId(null);
      setDrop(null);
      if (target) performDrop(entity.id, target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // A render function (not a nested component) so rows aren't remounted on every world change.
  const renderRow = (entity: Entity, depth: number): ReactNode => {
    if (matches && !matches.has(entity.id)) return null;
    const isCollapsed = !q && collapsed.has(entity.id) !== startsFolded.has(entity.id);
    const hasKids = entity.children.length > 0;
    const isDrop = drop?.id === entity.id ? drop.zone : null;
    return (
      <Fragment key={entity.id}>
        <li
          data-id={entity.id}
          className={[
            'tree-item',
            selectedSet.has(entity.id) ? 'selected' : '',
            multi && selection === entity.id ? 'active' : '',
            entity.activeInHierarchy ? '' : 'disabled',
            isDrop ? `drop-${isDrop}` : '',
            draggingId === entity.id ? 'dragging' : '',
          ].join(' ')}
          style={{ paddingLeft: 6 + depth * 14 }}
          onPointerDown={(ev) => onRowPointerDown(ev, entity)}
          onClick={(ev) => {
            if (!suppressClick.current) clickRow(ev, entity.id);
          }}
          // Double-click: fly the camera to it (like Unity). Rename with F2 or the right-click menu.
          onDoubleClick={() => {
            select(entity.id);
            setTimeout(() => viewportController()?.focusSelected());
          }}
          onContextMenu={(ev: MouseEvent) => {
            ev.preventDefault();
            // Right-clicking inside a multi-selection acts on all of it.
            if (multi && selectedSet.has(entity.id)) return menu.open(ev.clientX, ev.clientY, multiMenu());
            select(entity.id);
            menu.open(ev.clientX, ev.clientY, entityMenu(entity));
          }}
        >
          <span
            className="tree-caret"
            onClick={(ev) => {
              ev.stopPropagation();
              if (hasKids) toggle(entity.id);
            }}
          >
            {hasKids && <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={12} />}
          </span>
          <span className="tree-icon">
            <Icon name={iconFor(entity)} />
          </span>
          {renaming === entity.id ? (
            <RenameInput
              initial={entity.name}
              onDone={(name) => {
                setRenaming(null);
                if (name !== null) rename(entity.id, name);
              }}
            />
          ) : (
            <span className="tree-name">{entity.name}</span>
          )}
          <button
            className="tree-eye"
            title={entity.enabled ? 'Hide' : 'Show'}
            onClick={(ev) => {
              ev.stopPropagation();
              setEnabled(entity.id, !entity.enabled);
            }}
          >
            <Icon name={entity.enabled ? 'eye' : 'eye-off'} size={12} />
          </button>
        </li>
        {!isCollapsed && entity.children.map((c) => renderRow(c, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div className="hierarchy">
      <div className="hierarchy-toolbar">
        <button
          className="primary small"
          onClick={(ev) => {
            const r = ev.currentTarget.getBoundingClientRect();
            menu.open(r.left, r.bottom + 2, createMenuItems(null));
          }}
        >
          <Icon name="plus" size={12} />
          Create
        </button>
        <input
          className="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ul
        ref={listRef}
        className={`tree ${drop?.id === null ? 'drop-root' : ''} ${draggingId ? 'is-dragging' : ''}`}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget && !suppressClick.current) select(null);
        }}
        onContextMenu={(ev) => {
          if (ev.target !== ev.currentTarget) return;
          ev.preventDefault();
          menu.open(ev.clientX, ev.clientY, [
            { label: 'Create', icon: 'plus', children: createMenuItems(null) },
            { label: 'Paste', icon: 'paste', disabled: !hasClipboard(), onSelect: () => { select(null); paste(); } },
          ]);
        }}
      >
        {world.roots.map((e) => renderRow(e, 0))}
        {matches && matches.size === 0 && <li className="empty">No objects match “{query}”</li>}
      </ul>
      {menu.element}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      className="tree-rename"
      autoFocus
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}
