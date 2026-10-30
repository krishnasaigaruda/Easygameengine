/**
 * Every editor shortcut, for the Keyboard Shortcuts list and for labels in menus and tooltips.
 * "Mod" is Cmd on a Mac and Ctrl on Windows / Linux; both always work.
 */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface Shortcut {
  id: string;
  /** e.g. "Mod+D", "Shift+Mod+Z", "Delete", "F". */
  keys: string;
  label: string;
  group: 'General' | 'Edit' | 'Selection' | 'Tools' | 'View' | 'Play';
  /** Shown as an alternative ("or Ctrl+Y"). */
  alt?: string;
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'save', keys: 'Mod+S', label: 'Save now', group: 'General' },
  { id: 'shortcuts', keys: '?', label: 'Show keyboard shortcuts', group: 'General' },

  { id: 'undo', keys: 'Mod+Z', label: 'Undo', group: 'Edit' },
  { id: 'redo', keys: 'Shift+Mod+Z', label: 'Redo', group: 'Edit', alt: 'Mod+Y' },
  { id: 'duplicate', keys: 'Mod+D', label: 'Duplicate', group: 'Edit' },
  { id: 'copy', keys: 'Mod+C', label: 'Copy', group: 'Edit' },
  { id: 'cut', keys: 'Mod+X', label: 'Cut', group: 'Edit' },
  { id: 'paste', keys: 'Mod+V', label: 'Paste', group: 'Edit' },
  { id: 'delete', keys: 'Delete', label: 'Delete', group: 'Edit', alt: 'Backspace' },
  { id: 'rename', keys: 'F2', label: 'Rename', group: 'Edit' },

  { id: 'selectAll', keys: 'Mod+A', label: 'Select everything', group: 'Selection' },
  { id: 'deselect', keys: 'Escape', label: 'Select nothing', group: 'Selection' },
  { id: 'addSelect', keys: 'Mod+Click', label: 'Add to / remove from selection', group: 'Selection' },
  { id: 'rangeSelect', keys: 'Shift+Click', label: 'Select a range (Hierarchy)', group: 'Selection' },

  { id: 'hand', keys: 'Q', label: 'Hand tool (look around only: drag to pan, nothing gets selected)', group: 'Tools' },
  { id: 'move', keys: 'W', label: 'Move tool (drag the arrows, or drag the selected object itself)', group: 'Tools' },
  { id: 'rotate', keys: 'E', label: 'Rotate tool', group: 'Tools' },
  { id: 'scale', keys: 'R', label: 'Scale tool', group: 'Tools' },
  { id: 'snap', keys: 'G', label: 'Snap to grid on / off', group: 'Tools' },

  { id: 'focus', keys: 'F', label: 'Focus on selection', group: 'View', alt: 'Double-click' },
  { id: 'orbit', keys: 'Left drag', label: 'Orbit around (on empty space)', group: 'View' },
  { id: 'look', keys: 'Right drag', label: 'Look around', group: 'View' },
  { id: 'fly', keys: 'Right drag + WASD', label: 'Fly (Q / E down / up, Shift faster, scroll = speed)', group: 'View' },
  { id: 'pan', keys: 'Middle drag', label: 'Pan', group: 'View' },
  { id: 'zoom', keys: 'Scroll', label: 'Zoom', group: 'View' },

  { id: 'play', keys: 'Mod+P', label: 'Play / Stop', group: 'Play' },
  { id: 'pause', keys: 'Shift+Mod+P', label: 'Pause / Resume', group: 'Play' },
  { id: 'step', keys: 'Alt+Mod+P', label: 'Step one frame', group: 'Play' },
  { id: 'stop', keys: 'Escape', label: 'Stop (while playing)', group: 'Play' },
];

const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Delete: '⌫', Backspace: '⌫', Escape: 'Esc' };
const PC_NAMES: Record<string, string> = { Mod: 'Ctrl', Delete: 'Del', Escape: 'Esc' };

/** "Shift+Mod+Z" → "⇧⌘Z" on a Mac, "Ctrl+Shift+Z" elsewhere. */
export function formatKeys(keys: string, mac = IS_MAC): string {
  const parts = keys.split('+');
  if (mac) {
    // Mac order: ⌃ ⌥ ⇧ ⌘ then the key, no separators between symbols.
    const order = ['Alt', 'Shift', 'Mod'];
    const mods = order.filter((m) => parts.includes(m)).map((m) => MAC_SYMBOLS[m]);
    const rest = parts.filter((p) => !order.includes(p)).map((p) => MAC_SYMBOLS[p] ?? p);
    return mods.join('') + (mods.length && rest.join('').length === 1 ? '' : mods.length ? ' ' : '') + rest.join(' + ');
  }
  // Windows order: Ctrl + Alt + Shift + key.
  const order = ['Mod', 'Alt', 'Shift'];
  const mods = order.filter((m) => parts.includes(m)).map((m) => PC_NAMES[m] ?? m);
  const rest = parts.filter((p) => !order.includes(p)).map((p) => PC_NAMES[p] ?? p);
  return [...mods, ...rest].join('+');
}

/** Formatted keys for a shortcut id ("" if unknown), for menus and tooltips. */
export function keyLabel(id: string): string {
  const s = SHORTCUTS.find((x) => x.id === id);
  return s ? formatKeys(s.keys) : '';
}
