/*
 * Accessibility helpers for the whole editor: icon-only buttons get a spoken name from their
 * tooltip (screen readers read aria-label, not always title), and keep it as tooltips change.
 */

function label(el: Element): void {
  if (!(el instanceof HTMLElement)) return;
  const targets = el.matches('button, [role=button]') ? [el] : [...el.querySelectorAll<HTMLElement>('button, [role=button]')];
  for (const b of targets) {
    const title = b.getAttribute('title');
    const own = b.getAttribute('aria-label');
    // Only buttons that show no words of their own (icons).
    if (!title || (own && own !== b.dataset.egeLabel) || (b.textContent ?? '').trim().length > 1) continue;
    b.setAttribute('aria-label', title);
    b.dataset.egeLabel = title;
  }
}

/** Start labelling (once, at startup). */
export function startAccessibility(root: HTMLElement = document.body): () => void {
  label(root);
  const observer = new MutationObserver((changes) => {
    for (const c of changes) {
      if (c.type === 'attributes') label(c.target as Element);
      else for (const n of c.addedNodes) label(n as Element);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  return () => observer.disconnect();
}
