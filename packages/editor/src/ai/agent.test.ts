import { describe, expect, it, vi } from 'vitest';

vi.mock('../state/editorStore', () => ({ useEditor: { getState: () => ({ engine: null }) } }));
vi.mock('./model', () => ({ chat: vi.fn() }));

const { isSmallChange, partPrompt, pictureOf, understandPrompt } = await import('./agent');

const ask = 'make this\nThe attached picture shows: A dog on a path in a meadow with purple flowers. A wooden cabin. Mountains behind.\nBuild it to look like the picture.';

describe('a picture to rebuild', () => {
  it('plans the scene the picture shows, not a game', () => {
    expect(understandPrompt('3d', false, ask)).toContain('not a game');
    expect(understandPrompt('3d', false, 'make a game like this' + ask.slice(9))).toContain('designer of a 3D game');
    expect(understandPrompt('3d', false, 'a farm game')).toContain('designer of a 3D game');
  });

  it('tells every part what the picture shows', () => {
    expect(pictureOf(ask)).toBe('The attached picture shows: A dog on a path in a meadow with purple flowers. A wooden cabin. Mountains behind.');
    const p = partPrompt('A meadow with a cabin', [{ text: 'A wooden cabin on the right', status: 'waiting', steps: [] }], 0, pictureOf(ask));
    expect(p).toContain('purple flowers');
    expect(p).toContain('The scene: A meadow with a cabin');
  });
});

describe('small changes', () => {
  it('are built as asked, without designing a game around them', () => {
    for (const r of ['add a tiger', 'make the sky red', 'Put 3 rocks by the house', 'remove the fog']) expect(isSmallChange(r)).toBe(true);
    for (const r of ['a tiger hunting game in a jungle', 'make a game where you collect coins', 'add a whole forest level with enemies and a boss at the end']) expect(isSmallChange(r)).toBe(false);
  });
});

describe('changing a game that is already made', () => {
  it('plans only the change, knowing what was asked before', () => {
    const p = understandPrompt('3d', false, 'add a shop and a field of crops', { earlier: ['a farm: find the farmer’s eggs'] });
    expect(p).toContain('already made');
    expect(p).toContain('never the whole game again');
    expect(p).toContain('"a farm: find the farmer’s eggs"');
    expect(p).not.toContain('designer of a 3D game');
  });
});
