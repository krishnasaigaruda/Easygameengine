/*
 * Saved games: a slot holds the game's values (game.*), and for every object where it is, how it's
 * turned and sized, whether it's shown, and its own script values, plus which objects are gone
 * (collected coins, defeated enemies). Slots live in the player's browser, per game.
 */

export interface SavedObject {
  position: number[];
  rotation: number[];
  scale: number[];
  enabled: boolean;
  vars?: Record<string, unknown>;
}

export interface SaveData {
  format: 'ege-save';
  version: 1;
  savedAt: number;
  game: Record<string, unknown>;
  objects: Record<string, SavedObject>;
  /** Objects that were in the scene at the start but aren't any more. */
  gone: string[];
}

/** Where slots are kept (localStorage in browsers; anything with the same shape in tests). */
export interface SaveStore {
  read(slot: string): string | null;
  write(slot: string, text: string): void;
  remove(slot: string): void;
}

const clean = (slot: string) => slot.trim().replace(/[^\w -]/g, '').slice(0, 60) || 'game';

/** Slots for one game in this browser's storage. `game` tells games apart. */
export function browserSaves(game: () => string): SaveStore {
  const key = (slot: string) => `ege.save.${game()}.${clean(slot)}`;
  return {
    read: (slot) => {
      try {
        return localStorage.getItem(key(slot));
      } catch {
        return null; // storage blocked
      }
    },
    write: (slot, text) => {
      try {
        localStorage.setItem(key(slot), text);
      } catch {
        // storage blocked or full: the save is skipped
      }
    },
    remove: (slot) => {
      try {
        localStorage.removeItem(key(slot));
      } catch {
        // nothing to remove
      }
    },
  };
}

/** Slots kept in memory (tests, or when there's no storage). */
export function memorySaves(): SaveStore & { slots: Map<string, string> } {
  const slots = new Map<string, string>();
  return { slots, read: (s) => slots.get(clean(s)) ?? null, write: (s, t) => void slots.set(clean(s), t), remove: (s) => void slots.delete(clean(s)) };
}
