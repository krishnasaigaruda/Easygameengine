import type { Input } from '../input/Input';
import { INPUT_ACTIONS, keyBinding } from '../easyscript/spec';

/*
 * Touch controls for phones and tablets: a stick to walk (bottom left), buttons to jump, run and
 * use (bottom right, plus fire in games with weapons), and pause (top right). Dragging anywhere
 * else turns the camera; a quick tap clicks. Plain DOM over the game, shown only on touch screens.
 */

export function isTouchScreen(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
}

export interface TouchControlsOptions {
  /** Show a fire button (the game has weapons). */
  fire?: boolean;
  /** Hidden while true (a menu has paused the game). */
  hidden?: () => boolean;
  /** The keys the game's scripts use ("c", "q", "1"…): each gets its own button. */
  keys?: () => string[];
}

/** Keys the standard buttons already press (Jump = Space, Use = E, Run = Shift, Pause = Esc…). */
const COVERED = new Set(['space', 'jump', 'e', 'interact', 'shift', 'run', 'escape', 'pause', 'p', 'click', 'fire', 'w', 'a', 's', 'd', 'up', 'down', 'left', 'right']);
const LABELS: Record<string, string> = { enter: 'Enter', tab: 'Tab', rightclick: 'Aim', crouch: 'Crouch', aim: 'Aim' };

const BUTTON = 'position:absolute;display:grid;place-items:center;border-radius:50%;border:2px solid rgba(255,255,255,0.35);background:rgba(18,20,23,0.45);color:#fff;font:600 13px system-ui,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none;pointer-events:auto;backdrop-filter:blur(3px)';

export function addTouchControls(container: HTMLElement, input: Input, options: TouchControlsOptions = {}): { remove(): void } {
  const root = document.createElement('div');
  root.className = 'ege-touch';
  root.style.cssText = 'position:absolute;inset:0;z-index:12;pointer-events:none';
  container.appendChild(root);

  // ── stick ──
  const base = document.createElement('div');
  base.style.cssText = `${BUTTON};left:28px;bottom:28px;width:132px;height:132px;background:rgba(18,20,23,0.3)`;
  const knob = document.createElement('div');
  knob.style.cssText = 'width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.55);transition:transform 0.05s';
  base.appendChild(knob);
  base.setAttribute('aria-label', 'Move');
  root.appendChild(base);
  let stickId: number | null = null;
  const moveStick = (e: PointerEvent) => {
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const max = r.width / 2 - 20;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.touch.moveX = dx / max;
    input.touch.moveY = -dy / max;
    // Pushed all the way: run.
    input.holdVirtual('Touch:run', len > max * 1.15);
  };
  const endStick = () => {
    stickId = null;
    knob.style.transform = '';
    input.touch.moveX = input.touch.moveY = 0;
    input.holdVirtual('Touch:run', false);
  };
  base.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    stickId = e.pointerId;
    base.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  base.addEventListener('pointermove', (e) => e.pointerId === stickId && moveStick(e));
  base.addEventListener('pointerup', (e) => e.pointerId === stickId && endStick());
  base.addEventListener('pointercancel', endStick);

  // ── buttons ──
  const button = (label: string, binding: string | string[], css: string) => {
    const bindings = Array.isArray(binding) ? binding : [binding];
    const b = document.createElement('div');
    b.textContent = label;
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', label);
    b.style.cssText = `${BUTTON};${css}`;
    const up = () => {
      for (const x of bindings) input.holdVirtual(x, false);
      b.style.background = 'rgba(18,20,23,0.45)';
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      for (const x of bindings) input.holdVirtual(x, true);
      b.style.background = 'rgba(224,178,58,0.55)';
    });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    root.appendChild(b);
    return b;
  };
  // The standard buttons also press the keys games usually use for them.
  button('Jump', ['Touch:jump', 'Key:Space'], 'right:28px;bottom:40px;width:84px;height:84px;font-size:15px');
  button('Run', ['Touch:run', 'Key:ShiftLeft'], 'right:128px;bottom:28px;width:60px;height:60px');
  button('Use', ['Touch:interact', 'Key:KeyE'], 'right:44px;bottom:140px;width:60px;height:60px');
  if (options.fire) button('Fire', ['Touch:fire', 'Mouse:0'], 'right:124px;bottom:110px;width:64px;height:64px');
  button('II', ['Touch:pause', 'Key:Escape'], 'right:16px;top:16px;width:44px;height:44px;font-size:12px').setAttribute('aria-label', 'Pause');

  // Every other key the game's scripts use: its own button, in a column on the right.
  let extra: HTMLElement[] = [];
  let shownKeys = '';
  const refreshKeys = () => {
    const keys = (options.keys?.() ?? []).filter((k) => !COVERED.has(k)).sort();
    // As many as fit between the action buttons and the pause button, then another column.
    const perColumn = Math.max(1, Math.floor((root.clientHeight - 220 - 70) / 62));
    const sig = `${keys.join(',')}|${perColumn}`;
    if (sig === shownKeys) return;
    shownKeys = sig;
    for (const b of extra) b.remove();
    extra = keys.map((k, i) => {
      const binding = keyBinding(k) ?? (INPUT_ACTIONS.includes(k) ? `Touch:${k}` : null);
      const label = LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));
      const col = Math.floor(i / perColumn);
      const row = i % perColumn;
      return button(label, binding ? [binding] : [], `right:${28 + col * 64}px;bottom:${220 + row * 62}px;width:52px;height:52px`);
    });
  };
  let lastCheck = 0;

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    root.style.display = options.hidden?.() ? 'none' : '';
    // Scripts load a moment after Play: look again now and then.
    const now = performance.now();
    if (now - lastCheck > 1000) {
      lastCheck = now;
      refreshKeys();
    }
  };
  tick();

  return {
    remove() {
      cancelAnimationFrame(raf);
      endStick();
      for (const b of ['Touch:jump', 'Touch:run', 'Touch:interact', 'Touch:fire', 'Touch:pause', 'Key:Space', 'Key:ShiftLeft', 'Key:KeyE', 'Key:Escape', 'Mouse:0']) input.holdVirtual(b, false);
      root.remove();
    },
  };
}
