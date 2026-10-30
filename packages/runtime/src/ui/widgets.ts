import type { UIProgressBarData } from '../components/ui';

/*
 * Drawing for the ring shape of a progress bar. It keeps its own child elements and only touches
 * the DOM when something changed.
 */

const SVG = 'http://www.w3.org/2000/svg';

export function paintRing(el: HTMLElement, d: UIProgressBarData, scale: number, value: number, label: string): void {
  const size = Math.max(10, Math.min(d.size[0] || 80, d.size[1] || 80)) * scale;
  const stroke = size * d.thickness;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const key = `${size}|${d.color}|${d.background}|${d.thickness}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = `<svg xmlns="${SVG}" width="${size}" height="${size}" style="display:block;transform:rotate(-90deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${d.background}" stroke-width="${stroke}"/>
      <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${circ}" style="transition:stroke-dashoffset 0.25s ease"/>
    </svg><div class="ring-label" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.8);font-size:${size * 0.24}px"></div>`;
  }
  el.querySelector<SVGCircleElement>('.ring-fill')!.style.strokeDashoffset = String(circ * (1 - v));
  const lab = el.querySelector<HTMLDivElement>('.ring-label')!;
  if (lab.textContent !== label) lab.textContent = label;
}
