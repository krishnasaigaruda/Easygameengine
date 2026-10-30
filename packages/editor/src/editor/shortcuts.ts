import { useEffect } from 'react';
import { useEditor } from '../state/editorStore';
import {
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  paste,
  redo,
  undo,
} from './actions';
import { saveNow } from './project';
import { viewportController } from '../viewport/viewportRef';
import { gameUsesEscape, stepFrame, stop, togglePause, togglePlay } from './play';
import { selectAll } from './actions';
import { openShortcuts } from '../panels/ShortcutsDialog';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
}

/** Global editor shortcuts (Unity-style). Ignored while typing in a field. */
export function useEditorShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'p') {
        e.preventDefault(); // not "print"
        if (e.altKey) stepFrame();
        else if (e.shiftKey) togglePause();
        else togglePlay();
        return;
      }
      // Save works even inside text fields.
      if (mod && key === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (isTyping(e.target)) return;
      const s = useEditor.getState();
      // While playing, the keyboard belongs to the game (WASD, Space…); only Esc stops it
      // (Shift+Esc when the game uses Esc itself, e.g. for a pause menu).
      if (s.playing) {
        if (key === 'escape' && (e.shiftKey || !gameUsesEscape())) stop();
        return;
      }

      if (mod) {
        const handlers: Record<string, () => void> = {
          z: () => (e.shiftKey ? redo() : undo()),
          y: redo,
          d: duplicateSelected,
          c: copySelected,
          x: cutSelected,
          v: paste,
          a: selectAll,
        };
        const h = handlers[key];
        if (h) {
          e.preventDefault();
          h();
        }
        return;
      }
      if (e.altKey) return;

      if (e.key === '?') {
        openShortcuts();
        return;
      }
      switch (key) {
        case 'q':
          s.setTool('view');
          break;
        case 'w':
          s.setTool('translate');
          break;
        case 'e':
          s.setTool('rotate');
          break;
        case 'r':
          s.setTool('scale');
          break;
        case 'g':
          s.toggleSnap();
          break;
        case 'f':
          viewportController()?.focusSelected();
          break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          deleteSelected();
          break;
        case 'escape':
          s.select(null);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Mirror engine errors ("[EGE] …" console.error calls) into the editor Console panel. */
export function useEngineErrorCapture(): void {
  useEffect(() => {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      original(...args);
      if (typeof args[0] === 'string' && args[0].startsWith('[EGE]')) {
        useEditor.getState().log('error', args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
      }
    };
    return () => {
      console.error = original;
    };
  }, []);
}
