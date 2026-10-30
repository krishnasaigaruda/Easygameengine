import { describe, expect, it } from 'vitest';
import { formatKeys } from './keymap';

describe('shortcut labels', () => {
  it('uses symbols on a Mac and Ctrl names elsewhere', () => {
    expect(formatKeys('Mod+D', true)).toBe('⌘D');
    expect(formatKeys('Mod+D', false)).toBe('Ctrl+D');
    expect(formatKeys('Shift+Mod+Z', true)).toBe('⇧⌘Z');
    expect(formatKeys('Shift+Mod+Z', false)).toBe('Ctrl+Shift+Z');
    expect(formatKeys('Alt+Mod+P', false)).toBe('Ctrl+Alt+P');
    expect(formatKeys('Delete', false)).toBe('Del');
    expect(formatKeys('Mod+Click', true)).toBe('⌘ Click');
    expect(formatKeys('Mod+Click', false)).toBe('Ctrl+Click');
  });
});
