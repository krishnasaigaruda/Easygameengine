// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { World } from '../core/World';
import { UIButton, UIPanel, UIProgressBar, UIText } from '../components/ui';
import { UISystem } from './UISystem';

function setup(width = 1280, height = 720) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const world = new World();
  const ui = new UISystem(container, {
    format: (t) => t.replace('{game.score}', '7'),
    evaluate: () => 0.25,
  });
  Object.defineProperty(ui.root, 'clientWidth', { value: width });
  Object.defineProperty(ui.root, 'clientHeight', { value: height });
  world.addSystem(ui);
  const el = (e: { id: string }) => ui.root.querySelector<HTMLElement>(`[data-entity-id="${e.id}"]`)!;
  return { world, ui, el, container };
}

describe('UISystem', () => {
  it('anchors elements and scales with the screen', () => {
    const { world, ui, el } = setup(640, 360); // half the design size → scale 0.5
    const t = world.createEntity({ name: 'Score' });
    t.add(UIText, { anchor: 'bottom-right', offset: [-20, -10], text: 'Hi', fontSize: 40 });
    ui.lateUpdate();
    const s = el(t).style;
    expect(s.left).toBe('calc(100% - 10px)');
    expect(s.top).toBe('calc(100% - 5px)');
    expect(s.transform).toBe('translate(-100%, -100%)');
    expect(el(t).querySelector('div')!.style.fontSize).toBe('20px');
  });

  it('previews formulas in the editor and shows live values while playing', () => {
    const { world, ui, el } = setup();
    const t = world.createEntity();
    t.add(UIText, { text: 'Score: {game.score}' });
    ui.lateUpdate();
    expect(el(t).textContent).toBe('Score: 7'); // the same formatter previews it (real games show "…" before Play)
    ui.playing = true;
    ui.lateUpdate();
    expect(el(t).textContent).toBe('Score: 7');
  });

  it('nests UI inside its UI parent and follows hierarchy changes', () => {
    const { world, ui, el } = setup();
    const panel = world.createEntity({ name: 'Menu' });
    panel.add(UIPanel);
    const button = world.createEntity({ name: 'Play', parent: panel });
    button.add(UIButton, { label: 'Play' });
    ui.lateUpdate();
    expect(el(button).parentElement).toBe(el(panel));
    world.setParent(button, null);
    expect(el(button).parentElement).toBe(ui.root);
    world.setParent(button, panel);
    world.destroyEntity(panel);
    expect(ui.root.querySelectorAll('[data-entity-id]')).toHaveLength(0);
  });

  it('buttons are clickable; plain text is not (except in the editor)', () => {
    const { world, ui, el } = setup();
    const onClick = vi.fn();
    ui.onClick = onClick;
    const b = world.createEntity({ name: 'B' });
    b.add(UIButton);
    const t = world.createEntity({ name: 'T' });
    t.add(UIText);
    ui.lateUpdate();
    el(b).click();
    el(t).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(el(t).style.pointerEvents).toBe('none');
    ui.editMode = true;
    ui.lateUpdate();
    el(t).click();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('progress bars fill from their formula while playing', () => {
    const { world, ui, el } = setup();
    const bar = world.createEntity();
    bar.add(UIProgressBar, { label: 'HP' });
    ui.playing = true;
    ui.lateUpdate();
    const fill = el(bar).querySelector<HTMLElement>('.ege-ui-track > div')!;
    expect(fill.style.width).toBe('25%');
  });

  it('hidden objects hide their UI; removing the component removes the element', () => {
    const { world, ui, el } = setup();
    const t = world.createEntity();
    t.add(UIText);
    t.enabled = false;
    ui.lateUpdate();
    expect(el(t).style.display).toBe('none');
    t.remove(UIText);
    expect(ui.root.querySelector(`[data-entity-id="${t.id}"]`)).toBeNull();
  });
});
