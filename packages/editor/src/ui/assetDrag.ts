/**
 * Pointer-based drag of an asset tile to anywhere in the editor (works with touch, unlike
 * HTML5 drag & drop). Drop targets mark themselves with `data-asset-drop` and listen for the
 * `ege-asset-drop` event.
 */

export interface AssetDropDetail {
  assetId: string;
  /** One model out of a pack (a model file holding several). */
  part?: string;
  clientX: number;
  clientY: number;
}

export const ASSET_DROP_EVENT = 'ege-asset-drop';
const THRESHOLD = 5;

export function startAssetDrag(
  e: PointerEvent | React.PointerEvent,
  assetId: string,
  label: string,
  thumbnailUrl?: string,
  part?: string,
): void {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let lastTarget: HTMLElement | null = null;

  const targetAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-asset-drop]') ?? null;

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      ghost = document.createElement('div');
      ghost.className = 'asset-ghost';
      if (thumbnailUrl) {
        const img = document.createElement('img');
        img.src = thumbnailUrl;
        ghost.appendChild(img);
      }
      ghost.appendChild(document.createTextNode(label));
      document.body.appendChild(ghost);
      document.body.classList.add('asset-dragging');
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
    const t = targetAt(ev.clientX, ev.clientY);
    if (t !== lastTarget) {
      lastTarget?.classList.remove('asset-drop-hover');
      t?.classList.add('asset-drop-hover');
      lastTarget = t;
    }
  };

  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    lastTarget?.classList.remove('asset-drop-hover');
    if (!ghost) return; // it was a click
    ghost.remove();
    document.body.classList.remove('asset-dragging');
    // Swallow the click that follows so the drop doesn't also select something.
    window.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true });
    const t = targetAt(ev.clientX, ev.clientY);
    t?.dispatchEvent(
      new CustomEvent<AssetDropDetail>(ASSET_DROP_EVENT, {
        detail: { assetId, part, clientX: ev.clientX, clientY: ev.clientY },
      }),
    );
  };

  const cancel = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    lastTarget?.classList.remove('asset-drop-hover');
    ghost?.remove();
    document.body.classList.remove('asset-dragging');
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
