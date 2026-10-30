import type { EditorViewport } from './EditorViewport';

/** The live viewport controller, for shortcuts like F (focus) that live outside React. */
let current: EditorViewport | null = null;

export function setViewportController(c: EditorViewport | null): void {
  current = c;
}

export function viewportController(): EditorViewport | null {
  return current;
}
