export type HudSlot = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom';
export const HUD_SLOTS: HudSlot[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top', 'bottom'];

/**
 * Minimal in-game text overlay: persistent corner text (score, health) and short pop-up
 * messages. Plain DOM over the canvas. (Phase 11 replaces this with a full UI builder.)
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly slots = new Map<HudSlot, HTMLDivElement>();
  private readonly toasts: HTMLDivElement;
  private dialogEl: HTMLDivElement | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ege-hud';
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      color: '#fff',
      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
      zIndex: '5',
    } satisfies Partial<CSSStyleDeclaration>);
    this.toasts = document.createElement('div');
    Object.assign(this.toasts.style, {
      position: 'absolute',
      left: '50%',
      bottom: '18%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.toasts);
    container.appendChild(this.root);
  }

  setText(slot: HudSlot, text: string | null): void {
    let el = this.slots.get(slot);
    if (text === null || text === '') {
      el?.remove();
      this.slots.delete(slot);
      return;
    }
    if (!el) {
      el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute',
        padding: '6px 12px',
        borderRadius: '8px',
        background: 'rgba(0,0,0,0.35)',
        fontSize: '18px',
        fontWeight: '700',
        whiteSpace: 'pre',
        ...slotPosition(slot),
      });
      this.root.appendChild(el);
      this.slots.set(slot, el);
    }
    el.textContent = text;
  }

  /** A labelled progress bar (health, stamina). `fraction` is 0…1. */
  setBar(slot: HudSlot, label: string, fraction: number, color = '#e0645a'): void {
    this.setText(slot, ' ');
    const el = this.slots.get(slot)!;
    const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    el.textContent = '';
    Object.assign(el.style, { minWidth: '180px', fontSize: '13px', fontWeight: '600' });
    const name = document.createElement('div');
    name.textContent = label;
    name.style.marginBottom = '5px';
    const track = document.createElement('div');
    Object.assign(track.style, { height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.18)', overflow: 'hidden' });
    const fill = document.createElement('div');
    Object.assign(fill.style, { height: '100%', width: `${f * 100}%`, background: color, transition: 'width 0.25s ease' });
    track.appendChild(fill);
    el.append(name, track);
  }

  /** A dialog box at the bottom: who is talking, and what they say. */
  dialog(speaker: string, text: string, seconds = 4): void {
    this.dialogEl?.remove();
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      left: '50%',
      bottom: '72px', // above the interaction prompt
      transform: 'translateX(-50%)',
      width: 'min(640px, 86%)',
      padding: '14px 18px',
      borderRadius: '10px',
      background: 'rgba(18,20,23,0.82)',
      border: '1px solid rgba(255,255,255,0.12)',
      textShadow: 'none',
      transition: 'opacity 0.3s',
    } satisfies Partial<CSSStyleDeclaration>);
    if (speaker) {
      const who = document.createElement('div');
      who.textContent = speaker;
      Object.assign(who.style, { fontSize: '12px', fontWeight: '700', letterSpacing: '0.04em', color: '#e0b23a', marginBottom: '6px' });
      el.appendChild(who);
    }
    const body = document.createElement('div');
    body.textContent = text;
    Object.assign(body.style, { fontSize: '16px', lineHeight: '1.45' });
    el.appendChild(body);
    this.root.appendChild(el);
    this.dialogEl = el;
    setTimeout(() => {
      if (this.dialogEl !== el) return;
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, seconds * 1000);
  }

  /** Pop-up message in the lower middle of the screen. */
  say(text: string, seconds = 2): void {
    const el = document.createElement('div');
    Object.assign(el.style, {
      padding: '8px 16px',
      borderRadius: '10px',
      background: 'rgba(0,0,0,0.55)',
      fontSize: '20px',
      fontWeight: '600',
      transition: 'opacity 0.3s',
      opacity: '1',
    } satisfies Partial<CSSStyleDeclaration>);
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => (el.style.opacity = '0'), Math.max(0, seconds * 1000 - 300));
    setTimeout(() => el.remove(), seconds * 1000);
  }

  clear(): void {
    for (const el of this.slots.values()) el.remove();
    this.slots.clear();
    this.toasts.replaceChildren();
    this.dialogEl?.remove();
    this.dialogEl = null;
  }

  dispose(): void {
    this.root.remove();
  }
}

function slotPosition(slot: HudSlot): Partial<CSSStyleDeclaration> {
  const m = '12px';
  switch (slot) {
    case 'top-left':
      return { top: m, left: m };
    case 'top-right':
      return { top: m, right: m };
    case 'bottom-left':
      return { bottom: m, left: m };
    case 'bottom-right':
      return { bottom: m, right: m };
    case 'top':
      return { top: m, left: '50%', transform: 'translateX(-50%)' };
    case 'bottom':
      return { bottom: m, left: '50%', transform: 'translateX(-50%)' };
  }
}
