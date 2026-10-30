import { create } from 'zustand';

/*
 * Store items that turned out to be gone: their author removed them (every preview image fails)
 * or the file is missing. They are hidden from the store and remembered in this browser.
 */

const KEY = 'ege.store.removed';

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export const useBrokenItems = create<{ keys: Set<string> }>(() => ({ keys: load() }));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Previews that loaded fine this session — if none did, the user is probably offline. */
let thumbsLoaded = 0;

export function thumbLoaded(): void {
  thumbsLoaded++;
}

/** Hide an item. `certain` = we know it's gone (file missing), not just a failed preview. */
export function markBroken(key: string, certain = false): void {
  if (!certain && (thumbsLoaded === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false))) return;
  const keys = useBrokenItems.getState().keys;
  if (keys.has(key)) return;
  const next = new Set(keys).add(key);
  useBrokenItems.setState({ keys: next });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...next].slice(-20000)));
    } catch {
      // storage full or blocked: hiding still works for this session
    }
  }, 500);
}
