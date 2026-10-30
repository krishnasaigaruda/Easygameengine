import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  /** Icon name from the icon registry. */
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
  /** Nested items render as a labelled group. */
  children?: MenuEntry[];
}
export type MenuEntry = MenuItem | 'separator';

/**
 * A floating menu at screen coordinates. Closes on outside click, Escape or selection. When it
 * would be taller than the window, its groups fold into side menus (hover or click to open).
 */
export function Menu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [folded, setFolded] = useState(false);
  const [side, setSide] = useState<{ index: number; x: number; y: number } | null>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const [sidePos, setSidePos] = useState<{ x: number; y: number } | null>(null);

  // Keep the menu on screen; fold the groups away if it doesn't fit.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // (scrollHeight: the full height, even while the CSS limit makes it scroll.)
    if (!folded && el.scrollHeight > window.innerHeight - 8 && items.some((i) => i !== 'separator' && i.children)) {
      setFolded(true);
      return;
    }
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, folded, items]);

  // A side menu opens beside its row, on screen (left of the menu if there's no room on the right).
  useLayoutEffect(() => {
    const el = sideRef.current;
    if (!el || !side) return setSidePos(null);
    const r = el.getBoundingClientRect();
    const menu = ref.current!.getBoundingClientRect();
    const right = side.x + r.width <= window.innerWidth - 4;
    setSidePos({ x: right ? side.x : Math.max(4, menu.left - r.width + 2), y: Math.max(4, Math.min(side.y - 4, window.innerHeight - r.height - 4)) });
  }, [side]);

  // Keyboard: the first item gets focus, arrows move, Enter picks; focus goes back after.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !ref.current) return;
      const items = [...(sideRef.current ?? ref.current).querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)')];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next].focus();
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const openSide = (index: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setSide({ index, x: r.right - 2, y: r.top });
  };

  const render = (entries: MenuEntry[], top = false): ReactNode =>
    entries.map((item, i) =>
      item === 'separator' ? (
        <div key={i} className="menu-sep" />
      ) : item.children && folded && top ? (
        <button
          key={i}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={side?.index === i}
          className={`menu-item ${side?.index === i ? 'open' : ''}`}
          onMouseEnter={(e) => openSide(i, e.currentTarget)}
          onClick={(e) => openSide(i, e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') openSide(i, e.currentTarget);
          }}
        >
          <span className="menu-icon">{item.icon && <Icon name={item.icon} />}</span>
          <span className="menu-label">{item.label}</span>
          <span className="menu-shortcut">
            <Icon name="chevron-right" size={12} />
          </span>
        </button>
      ) : item.children ? (
        <div key={i} className="menu-group" role="group" aria-label={item.label}>
          <div className="menu-group-label">{item.label}</div>
          {render(item.children)}
        </div>
      ) : (
        <button
          key={i}
          role="menuitem"
          onMouseEnter={top && folded ? () => setSide(null) : undefined}
          className={`menu-item ${item.danger ? 'danger' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect?.();
          }}
        >
          <span className="menu-icon">{item.icon && <Icon name={item.icon} />}</span>
          <span className="menu-label">{item.label}</span>
          {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
        </button>
      ),
    );

  return createPortal(
    <div ref={ref} role="menu" className="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {render(items, true)}
      {side && (() => {
        const group = items[side.index];
        if (group === 'separator' || !group?.children) return null;
        return (
          <div
            ref={sideRef}
            role="menu"
            aria-label={group.label}
            className="menu menu-side"
            style={{ left: sidePos?.x ?? side.x, top: sidePos?.y ?? side.y, visibility: sidePos ? 'visible' : 'hidden' }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setSide(null);
            }}
          >
            {render(group.children)}
          </div>
        );
      })()}
    </div>,
    document.body,
  );
}

/** Small helper: state for "a menu is open at (x, y) with these items". */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const element = menu ? <Menu {...menu} onClose={() => setMenu(null)} /> : null;
  return { open: (x: number, y: number, items: MenuEntry[]) => setMenu({ x, y, items }), element };
}
