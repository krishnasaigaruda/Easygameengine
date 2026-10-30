/**
 * "Made with Easy Game Engine" branding shown in played/exported games: a short splash on start
 * and a small corner badge. Plain DOM so it works in any page without a framework.
 */

const LOGO_SVG = `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5L12 2.5Z" stroke="#e0b23a" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M3.5 7.25 12 12l8.5-4.75M12 12v9.5" stroke="#e0b23a" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M12 12 16.25 9.6v4.8L12 16.8Z" fill="#e0b23a" opacity="0.35"/>
</svg>`;

const FONT = 'system-ui, -apple-system, "Segoe UI", Inter, sans-serif';

/** Full-screen splash. Resolves when it has faded out. */
export function showSplash(container: HTMLElement, holdMs = 1300): Promise<void> {
  const el = document.createElement('div');
  el.className = 'ege-splash';
  Object.assign(el.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '20',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    background: '#121417',
    color: '#d8dce3',
    fontFamily: FONT,
    transition: 'opacity 0.6s ease',
    opacity: '1',
  } satisfies Partial<CSSStyleDeclaration>);
  el.innerHTML = `${LOGO_SVG}
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8b93a1">Made with</div>
    <div style="font-size:22px;font-weight:600;letter-spacing:0.01em">Easy Game Engine</div>`;
  container.appendChild(el);
  return new Promise((resolve) => {
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        el.remove();
        resolve();
      }, 650);
    }, holdMs);
  });
}

/** Small, unobtrusive badge in a corner of the game. */
export function addBadge(container: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ege-badge';
  Object.assign(el.style, {
    position: 'absolute',
    right: '10px',
    bottom: '10px',
    zIndex: '10',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 9px 4px 7px',
    borderRadius: '6px',
    background: 'rgba(18, 20, 23, 0.6)',
    color: 'rgba(216, 220, 227, 0.85)',
    fontFamily: FONT,
    fontSize: '11px',
    pointerEvents: 'none',
    backdropFilter: 'blur(4px)',
  } satisfies Partial<CSSStyleDeclaration>);
  el.innerHTML = `${LOGO_SVG.replace('width="56" height="56"', 'width="14" height="14"')}<span>Made with Easy Game Engine</span>`;
  container.appendChild(el);
  return el;
}

/** One asset's credit, as listed on the Credits screen. */
export interface GameCredit {
  name: string;
  author?: string;
  license?: string;
  url?: string;
  source?: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A "Credits" button next to the badge; it opens a list of every asset's author and licence. */
export function addCredits(container: HTMLElement, credits: GameCredit[]): HTMLElement | null {
  if (!credits.length) return null;
  const button = document.createElement('button');
  button.className = 'ege-credits-button';
  button.textContent = 'Credits';
  Object.assign(button.style, {
    position: 'absolute',
    right: '10px',
    bottom: '40px',
    zIndex: '10',
    padding: '4px 9px',
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(18, 20, 23, 0.6)',
    color: 'rgba(216, 220, 227, 0.85)',
    fontFamily: FONT,
    fontSize: '11px',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.pointerLockElement) document.exitPointerLock();
    showCredits(container, credits);
  });
  container.appendChild(button);
  return button;
}

/** The Credits screen: every asset with its author, licence and where it came from. */
export function showCredits(container: HTMLElement, credits: GameCredit[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ege-credits';
  Object.assign(el.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '30',
    overflowY: 'auto',
    padding: '48px 24px',
    background: 'rgba(12, 14, 17, 0.94)',
    color: '#d8dce3',
    fontFamily: FONT,
    fontSize: '14px',
    lineHeight: '1.5',
  } satisfies Partial<CSSStyleDeclaration>);
  const rows = credits
    .map((c) => {
      const name = c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener" style="color:#e0b23a">${escapeHtml(c.name)}</a>` : escapeHtml(c.name);
      const by = c.author ? ` by ${escapeHtml(c.author)}` : '';
      const lic = [c.license, c.source].filter(Boolean).map((x) => escapeHtml(x!)).join(' · ');
      return `<li style="margin:6px 0">${name}${by}${lic ? `<div style="color:#8b93a1;font-size:12px">${lic}</div>` : ''}</li>`;
    })
    .join('');
  el.innerHTML = `<div style="max-width:640px;margin:0 auto">
    <h2 style="margin:0 0 4px;font-size:24px">Credits</h2>
    <p style="margin:0 0 18px;color:#8b93a1">This game uses these works. Thank you to their makers.</p>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
    <p style="margin-top:24px;color:#8b93a1">Some works were adapted for this game (resized, optimized, rigged or animated).</p>
    <p style="margin-top:8px;color:#8b93a1">Made with Easy Game Engine, using three.js (MIT) and Rapier (Apache-2.0).</p>
    <button class="ege-credits-close" style="margin-top:8px;padding:8px 16px;border:none;border-radius:8px;background:#e0b23a;color:#1b1d22;font:600 14px ${FONT};cursor:pointer">Back to the game</button>
  </div>`;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeIt();
  };
  const closeIt = () => {
    el.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  el.querySelector('.ege-credits-close')!.addEventListener('click', closeIt);
  window.addEventListener('keydown', onKey, true);
  container.appendChild(el);
  return el;
}

/** Loading screen for exported games: logo, title and a progress bar. */
export function showLoading(container: HTMLElement, title: string): { progress(done: number, total: number): void; remove(): void } {
  const el = document.createElement('div');
  el.className = 'ege-loading';
  Object.assign(el.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '25',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    background: '#121417',
    color: '#d8dce3',
    fontFamily: FONT,
  } satisfies Partial<CSSStyleDeclaration>);
  el.innerHTML = `${LOGO_SVG}
    <div style="font-size:22px;font-weight:600">${escapeHtml(title)}</div>
    <div style="width:min(320px,70vw);height:6px;border-radius:3px;background:rgba(255,255,255,0.1);overflow:hidden">
      <div class="ege-loading-bar" style="width:0%;height:100%;background:#e0b23a;transition:width 0.15s"></div>
    </div>
    <div class="ege-loading-text" style="font-size:12px;color:#8b93a1">Loading…</div>`;
  container.appendChild(el);
  const bar = el.querySelector<HTMLElement>('.ege-loading-bar')!;
  const text = el.querySelector<HTMLElement>('.ege-loading-text')!;
  const mb = (n: number) => (n / 1048576).toFixed(1);
  return {
    progress(done, total) {
      bar.style.width = `${total ? Math.min(100, (done / total) * 100) : 0}%`;
      text.textContent = total ? `Loading… ${mb(done)} / ${mb(total)} MB` : 'Loading…';
    },
    remove: () => el.remove(),
  };
}
