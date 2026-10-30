import { ACTIONS, EVENTS, FUNCTIONS, TRAITS, allComponentDefs, type FieldSpec } from '@ege/runtime';
import { docPages } from '../hub/docs';

/*
 * The engine's documentation, cut into small pieces the assistant can look up: every component
 * (with its settings), trait, EasyScript action / event / function, and the guides. Each task
 * gets only the few pieces that match it (small models have little room).
 */

interface Piece {
  /** What it is, for the model. */
  text: string;
  /** Words it's found by. */
  words: Set<string>;
}

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');
function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1).map(stem);
}

function fieldText(name: string, f: FieldSpec): string {
  switch (f.kind) {
    case 'enum':
      return `${name} (${f.options.join('|')})`;
    case 'asset':
      return `${name} (${f.assetType})`;
    case 'number':
      return `${name} (number${f.min !== undefined ? ` ${f.min}..${f.max ?? ''}` : ''})`;
    default:
      return `${name} (${f.kind})`;
  }
}

let pieces: Piece[] | null = null;
let rarity = new Map<string, number>();

function build(): Piece[] {
  const out: { text: string; extra?: string }[] = [];
  for (const d of allComponentDefs()) {
    const fields = Object.entries(d.fields as Record<string, FieldSpec | undefined>)
      .filter((e): e is [string, FieldSpec] => !!e[1])
      .map(([k, f]) => fieldText(k, f));
    out.push({ text: `Component ${d.type} (${d.label}): ${d.description ?? ''} Settings: ${fields.join(', ')}.` });
  }
  for (const t of TRAITS) if (!t.comingIn) out.push({ text: `Trait "${t.name}": ${t.description}` });
  for (const a of ACTIONS) if (!a.comingIn) out.push({ text: `EasyScript action ${a.key}: ${a.description} Example: ${JSON.stringify(a.example)}`, extra: a.label + ' ' + a.category });
  for (const e of EVENTS) out.push({ text: `EasyScript event on.${e.key}: ${e.description}`, extra: e.label });
  for (const f of FUNCTIONS) out.push({ text: `EasyScript function ${f.signature}: ${f.description}` });
  out.push({
    text: 'EasyScript shape: { props: { speed: 2 }, on: { start: [ ...actions ], touch: [ { if: "other.is(\'player\')" }, ...actions ], key: { e: [ ...actions ] }, every: { 1: [ ...actions ] } }, functions: { name: [ ...actions ] } }. Actions run in order; "if" stops the list when false. Text can use {formulas} like "Score: {game.score}".',
    extra: 'script code write behaviour logic',
  });
  for (const page of docPages()) {
    if (page.group === 'Reference') continue;
    for (const b of page.blocks) {
      const text = 'p' in b && typeof b.p === 'string' ? b.p : 'list' in b && Array.isArray(b.list) ? b.list.join(' ') : '';
      if (text.length > 30) out.push({ text: `Guide "${page.title}": ${text}` });
    }
  }
  const list = out.map((o) => ({ text: o.text, words: new Set(wordsOf(`${o.text} ${o.extra ?? ''}`)) }));
  // Rare words matter more than common ones ("door" says more than "the").
  const counts = new Map<string, number>();
  for (const p of list) for (const w of p.words) counts.set(w, (counts.get(w) ?? 0) + 1);
  rarity = new Map([...counts].map(([w, n]) => [w, Math.log(1 + list.length / n)]));
  return list;
}

/** The pieces of documentation that best match a task, up to about `budget` characters. */
export function docsFor(task: string, budget = 2400): string {
  pieces ??= build();
  const want = new Set(wordsOf(task));
  const scored = pieces
    .map((p) => {
      let score = 0;
      for (const w of want) if (p.words.has(w)) score += rarity.get(w) ?? 0;
      return { p, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  let used = 0;
  for (const { p } of scored) {
    if (used + p.text.length > budget) continue;
    picked.push(p.text);
    used += p.text.length;
    if (picked.length >= 12) break;
  }
  return picked.join('\n');
}
