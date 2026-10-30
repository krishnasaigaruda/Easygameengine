import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import type { AssetManager } from '../assets/AssetManager';
import * as THREE from 'three';
import {
  UIButton,
  UIImage,
  UIPanel,
  UIProgressBar,
  UIText,
  UI_TYPES,
  type UIAnchor,
  type UILayout,
} from '../components/ui';
import { paintRing } from './widgets';

/** UI is designed for this screen size and scaled to fit the real one. */
export const UI_DESIGN_SIZE = { width: 1280, height: 720 };

const ANCHOR_POINT: Record<UIAnchor, [number, number]> = {
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  'bottom-left': [0, 1],
  bottom: [0.5, 1],
  'bottom-right': [1, 1],
};

export interface UISystemOptions {
  assets?: AssetManager;
  /** Turns "Score: {game.score}" into "Score: 3" (only while playing). */
  format?: (template: string, entity: Entity) => string;
  /** Evaluates a formula to a number (progress bars). */
  evaluate?: (formula: string, entity: Entity) => number;
  /** Evaluates a formula to an object (compass "guide to"). */
  lookup?: (formula: string, entity: Entity) => Entity | null;
  /** The camera the player sees through (compass heading). */
  camera?: () => THREE.Camera;
}

interface Node {
  el: HTMLDivElement;
  text?: HTMLDivElement;
  fill?: HTMLDivElement;
  ring?: HTMLDivElement;
  imageId?: string;
  lastText?: string;
  /** Editor resize handle. */
  handle?: HTMLDivElement;
}

/**
 * Screen-space UI: draws UIText / UIImage / UIButton / UIPanel / UIProgressBar as DOM over the
 * canvas. Anchored layout, nesting through the Hierarchy (UI inside a UI parent is placed inside
 * it), live {formula} text, and clicks.
 */
export class UISystem implements System {
  readonly name = 'ui';
  readonly order = 1100;
  readonly root: HTMLDivElement;
  /** Called when a UI element is clicked (play: scripts' on.click; editor: select it). */
  onClick: ((entity: Entity) => void) | null = null;
  private onDrag: ((entity: Entity, kind: 'move' | 'resize', delta: [number, number], phase: 'start' | 'move' | 'end') => void) | null = null;
  private suppressClick = false;
  /** Editor-only: which element is selected (outlined). */
  highlight: string | null = null;
  /** Editor-only: every element is clickable (to select it), not just buttons. */
  editMode = false;
  playing = false;
  private readonly nodes = new Map<string, Node>();
  private readonly options: UISystemOptions;
  private world: World | null = null;
  private unsubscribers: (() => void)[] = [];
  private scale = 1;

  constructor(container: HTMLElement, options: UISystemOptions = {}) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.className = 'ege-ui';
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '4',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Inter, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.root);
  }

  /** Editor: are we editing (every element selectable), and which element is selected. */
  setEditorState(editMode: boolean, highlight: string | null): void {
    this.editMode = editMode;
    this.highlight = highlight;
  }

  /** Show or hide the whole screen UI layer (the editor hides it in its own camera view). */
  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  setClickHandler(fn: ((entity: Entity) => void) | null): void {
    this.onClick = fn;
  }

  /**
   * Editor: called while an element is dragged (moved, or resized from its corner handle).
   * `delta` is in design pixels (1280×720 screen). Phase "end" is when to record an undo step.
   */
  setDragHandler(fn: ((entity: Entity, kind: 'move' | 'resize', delta: [number, number], phase: 'start' | 'move' | 'end') => void) | null): void {
    this.onDrag = fn;
  }

  /** On-screen size of an element in design pixels (for resizing "fit content" elements). */
  measured(entityId: string): [number, number] | null {
    const el = this.nodes.get(entityId)?.el;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Math.round(r.width / this.scale), Math.round(r.height / this.scale)];
  }

  private beginDrag(ev: PointerEvent, e: Entity, kind: 'move' | 'resize'): void {
    if (!this.editMode || ev.button !== 0 || !this.onDrag) return;
    ev.stopPropagation();
    ev.preventDefault();
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let started = false;
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - x0) / this.scale;
      const dy = (m.clientY - y0) / this.scale;
      if (!started) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 3) return; // a click, not a drag
        started = true;
        this.onDrag?.(e, kind, [0, 0], 'start');
      }
      this.onDrag?.(e, kind, [Math.round(dx), Math.round(dy)], 'move');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (started) {
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false));
        this.onDrag?.(e, kind, [0, 0], 'end');
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  attach(world: World): void {
    this.world = world;
    const rebuild = ({ entity }: { entity: Entity }) => this.rebuild(entity);
    const ev = world.events;
    this.unsubscribers = [
      ev.on('componentAdded', ({ entity, type }) => UI_TYPES.includes(type) && this.rebuild(entity)),
      ev.on('componentRemoved', ({ entity, type }) => UI_TYPES.includes(type) && this.rebuild(entity)),
      ev.on('entityDestroyed', ({ entity }) => this.remove(entity.id)),
      ev.on('hierarchyChanged', ({ entity }) => {
        for (const d of entity.descendants(true)) this.reparent(d);
      }),
      ev.on('entityCreated', rebuild),
    ];
    for (const e of world.all()) this.rebuild(e);
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    for (const id of [...this.nodes.keys()]) this.remove(id);
    this.world = null;
  }

  dispose(): void {
    this.detach();
    this.root.remove();
  }

  /** Every frame: layout, live text, bars. Cheap: only touches the DOM when something changed. */
  lateUpdate(): void {
    const w = this.world;
    if (!w) return;
    const rw = this.root.clientWidth || UI_DESIGN_SIZE.width;
    const rh = this.root.clientHeight || UI_DESIGN_SIZE.height;
    this.scale = Math.min(rw / UI_DESIGN_SIZE.width, rh / UI_DESIGN_SIZE.height);
    for (const [id, node] of this.nodes) {
      const e = w.getById(id);
      if (e) this.paint(e, node);
    }
  }

  private kind(e: Entity): string | undefined {
    return UI_TYPES.find((t) => e.has(t));
  }

  private rebuild(e: Entity): void {
    this.remove(e.id);
    const kind = this.kind(e);
    if (!kind) return;
    const el = document.createElement('div');
    el.dataset.entityId = e.id;
    Object.assign(el.style, { position: 'absolute', boxSizing: 'border-box' } satisfies Partial<CSSStyleDeclaration>);
    const node: Node = { el };
    // Text gets its own layer so it never wipes out child elements (a panel with a title).
    if (kind === UIButton.type || kind === UIProgressBar.type || e.has(UIText)) {
      node.text = document.createElement('div');
      el.appendChild(node.text);
    }
    if (kind === UIProgressBar.type) {
      const track = document.createElement('div');
      Object.assign(track.style, { position: 'relative', overflow: 'hidden', width: '100%' });
      track.className = 'ege-ui-track';
      node.fill = document.createElement('div');
      Object.assign(node.fill.style, { position: 'absolute', left: '0', top: '0', bottom: '0', transition: 'width 0.2s ease' });
      track.appendChild(node.fill);
      el.appendChild(track);
      node.ring = document.createElement('div');
      node.ring.style.position = 'relative';
      el.appendChild(node.ring);
    }
    el.addEventListener('click', (ev) => {
      if (!this.editMode && !e.has(UIButton)) return;
      ev.stopPropagation();
      if (this.suppressClick) return;
      this.onClick?.(e);
    });
    el.addEventListener('pointerdown', (ev) => {
      if (this.editMode) this.onClick?.(e); // select on press so the drag moves this one
      this.beginDrag(ev, e, 'move');
    });
    // Corner handle for resizing (shown on the selected element while editing).
    node.handle = document.createElement('div');
    Object.assign(node.handle.style, {
      position: 'absolute',
      right: '-6px',
      bottom: '-6px',
      width: '10px',
      height: '10px',
      background: '#e0b23a',
      border: '1px solid #1b1d22',
      borderRadius: '2px',
      cursor: 'nwse-resize',
      display: 'none',
      zIndex: '2',
    } satisfies Partial<CSSStyleDeclaration>);
    node.handle.addEventListener('pointerdown', (ev) => this.beginDrag(ev, e, 'resize'));
    el.appendChild(node.handle);
    this.nodes.set(e.id, node);
    this.reparent(e);
    this.paint(e, node);
  }

  private reparent(e: Entity): void {
    const node = this.nodes.get(e.id);
    if (!node) return;
    let parentEl: HTMLElement = this.root;
    for (let p = e.parent; p; p = p.parent) {
      const pn = this.nodes.get(p.id);
      if (pn) {
        parentEl = pn.el;
        break;
      }
    }
    if (node.el.parentElement !== parentEl) parentEl.appendChild(node.el);
  }

  private remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    // Keep UI children alive: hand them back to the root before removing this element.
    for (const child of [...node.el.querySelectorAll<HTMLElement>(':scope > [data-entity-id]')]) this.root.appendChild(child);
    node.el.remove();
    this.nodes.delete(id);
  }

  private layout(el: HTMLElement, l: UILayout): void {
    if (l.fill) {
      Object.assign(el.style, { left: '0', top: '0', transform: 'none', width: '100%', height: '100%', whiteSpace: 'normal' });
      return;
    }
    const s = this.scale;
    const [ax, ay] = ANCHOR_POINT[l.anchor] ?? ANCHOR_POINT.center;
    el.style.left = `calc(${ax * 100}% + ${l.offset[0] * s}px)`;
    el.style.top = `calc(${ay * 100}% + ${l.offset[1] * s}px)`;
    el.style.transform = `translate(${-ax * 100}%, ${-ay * 100}%)`;
    el.style.width = l.size[0] > 0 ? `${l.size[0] * s}px` : '';
    el.style.height = l.size[1] > 0 ? `${l.size[1] * s}px` : '';
    // "Fit content" text keeps to one line (otherwise right-anchored text gets squeezed).
    el.style.whiteSpace = l.size[0] > 0 ? 'normal' : 'nowrap';
  }

  private text(template: string, e: Entity): string {
    // Editing too: show what the formulas say now ("Power 0%", not "{round(game.power)}").
    if (!template.includes('{')) return template;
    try {
      return this.options.format?.(template, e) ?? template;
    } catch {
      return template;
    }
  }

  private paint(e: Entity, node: Node): void {
    const el = node.el;
    const s = this.scale;
    el.style.display = e.activeInHierarchy ? '' : 'none';
    el.style.outline = this.highlight === e.id ? `${Math.max(1, 2 * s)}px solid #e0b23a` : '';
    el.style.outlineOffset = '2px';
    el.style.pointerEvents = this.editMode || e.has(UIButton) ? 'auto' : 'none';
    el.style.cursor = this.editMode ? 'move' : e.has(UIButton) ? 'pointer' : '';
    if (node.handle) node.handle.style.display = this.editMode && this.highlight === e.id ? '' : 'none';

    const panel = e.get(UIPanel);
    const image = e.get(UIImage);
    const button = e.get(UIButton);
    const label = e.get(UIText);
    const bar = e.get(UIProgressBar);
    const l = panel ?? image ?? button ?? bar ?? label;
    if (!l) return;
    this.layout(el, l);

    if (panel) {
      el.style.background = withAlpha(panel.color, panel.opacity);
      el.style.borderRadius = `${panel.cornerRadius * s}px`;
      el.style.backdropFilter = panel.blur ? 'blur(10px)' : '';
      el.style.border = '1px solid rgba(255,255,255,0.08)';
    } else if (image) {
      if (node.imageId !== image.image) {
        node.imageId = image.image;
        el.style.backgroundImage = '';
        if (image.image && this.options.assets) {
          void this.options.assets.resolve(image.image).then((a) => {
            if (node.imageId !== image.image) return;
            const url = a.url(a.main);
            if (url) el.style.backgroundImage = `url("${url}")`;
          }, () => {});
        }
      }
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundColor = image.image ? '' : 'rgba(255,255,255,0.12)';
      el.style.opacity = String(image.opacity);
      el.style.borderRadius = `${image.cornerRadius * s}px`;
      // Tint by multiplying the picture with a color.
      const tinted = image.image && image.tint.toLowerCase() !== '#ffffff';
      el.style.backgroundBlendMode = tinted ? 'multiply' : '';
      if (tinted) el.style.backgroundColor = image.tint;
    } else if (button) {
      Object.assign(el.style, {
        display: e.activeInHierarchy ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
        background: button.color,
        color: button.textColor,
        borderRadius: `${button.cornerRadius * s}px`,
        fontSize: `${button.fontSize * s}px`,
        fontWeight: '600',
        boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
        userSelect: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      this.setText(node, this.text(button.label, e));
    } else if (bar) {
      let v = 0.7; // editor preview
      if (this.playing) {
        try {
          v = this.options.evaluate?.(bar.value, e) ?? 0;
        } catch {
          v = 0;
        }
      }
      const ring = bar.shape === 'ring';
      const track = el.querySelector<HTMLDivElement>('.ege-ui-track')!;
      node.text!.style.display = ring || !bar.label ? 'none' : '';
      track.style.display = ring ? 'none' : '';
      node.ring!.style.display = ring ? '' : 'none';
      if (ring) {
        paintRing(node.ring!, bar, s, v, this.text(bar.label, e));
        return;
      }
      const t = node.text!;
      t.style.fontSize = `${13 * s}px`;
      t.style.fontWeight = '600';
      t.style.color = '#ffffff';
      t.style.marginBottom = `${5 * s}px`;
      t.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
      this.setText(node, this.text(bar.label, e));
      el.style.height = '';
      track.style.height = `${Math.max(2, bar.size[1] * s)}px`;
      track.style.background = bar.background;
      track.style.borderRadius = `${bar.cornerRadius * s}px`;
      const f = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
      node.fill!.style.width = `${f * 100}%`;
      node.fill!.style.background = bar.color;
    }

    if (label) {
      const t = node.text ?? el;
      Object.assign(t.style, {
        fontSize: `${label.fontSize * s}px`,
        color: label.color,
        fontWeight: label.bold ? '700' : '400',
        textAlign: label.align,
        textShadow: label.shadow ? '0 1px 4px rgba(0,0,0,0.75)' : '',
        whiteSpace: label.size[0] > 0 ? 'pre-wrap' : 'pre',
        lineHeight: '1.25',
      } satisfies Partial<CSSStyleDeclaration>);
      if (!button) this.setText(node, this.text(label.text, e));
    }
  }

  private setText(node: Node, value: string): void {
    if (node.lastText === value) return;
    node.lastText = value;
    (node.text ?? node.el).textContent = value;
  }
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}
