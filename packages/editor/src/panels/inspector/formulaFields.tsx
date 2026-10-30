import { useRef, useState } from 'react';
import { TRAITS, Script, Traits, type Entity, type FieldSpec } from '@ege/runtime';
import { useEditor } from '../../state/editorStore';
import { allAssetRecords } from '../../assets/library';
import { useMenu, type MenuEntry } from '../../ui/Menu';
import { Icon } from '../../ui/Icon';

type FormulaSpec = Extract<FieldSpec, { kind: 'formula' }>;

/** Script texts, read once and refreshed when the menu opens (they're stored as files). */
const scriptTexts = new Map<string, string>();
async function refreshScriptTexts(): Promise<void> {
  for (const r of allAssetRecords()) {
    if (r.type !== 'script' || scriptTexts.has(`${r.id}:${r.updatedAt}`)) continue;
    const blob = r.files[r.main];
    if (blob) scriptTexts.set(`${r.id}:${r.updatedAt}`, await blob.text());
  }
}

const NICE: Record<string, string> = {
  score: 'Score',
  coins: 'Coins collected',
  timeLeft: 'Time left',
  checkpoint: 'Last checkpoint',
  level: 'Level',
  lives: 'Lives',
  kills: 'Enemies defeated',
};
const nice = (name: string) => NICE[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

interface Choice {
  label: string;
  expr: string;
}

/** Everything a formula can read, grouped for the picker. */
function gatherChoices(): { group: string; items: Choice[] }[] {
  const engine = useEditor.getState().engine;
  const sources = [...TRAITS.map((t) => t.script ?? ''), ...scriptTexts.values()];
  const game = new Set<string>();
  for (const src of sources) for (const m of src.matchAll(/game\.([A-Za-z_]\w*)/g)) game.add(m[1]);
  const playerVars = new Set<string>();
  const tags = new Set<string>();
  const objects: Choice[] = [];
  for (const e of engine?.world.all() ?? []) {
    for (const t of e.tags) tags.add(t);
    const traits = (e.get(Traits) as { traits?: string[] } | undefined)?.traits ?? [];
    for (const t of traits) tags.add(t);
    const props = Object.keys(((e.get(Script) as { props?: Record<string, unknown> } | undefined)?.props) ?? {});
    if (traits.includes('player')) {
      if (traits.includes('health')) playerVars.add('health').add('maxHealth');
      for (const p of props) playerVars.add(p);
    } else if (/^[A-Za-z_]\w*$/.test(e.name)) {
      for (const p of props) objects.push({ label: `${e.name}: ${nice(p)}`, expr: `${e.name}.${p}` });
    }
  }
  game.delete('interactTarget');
  return [
    { group: 'Game values', items: [...game].sort().map((g) => ({ label: nice(g), expr: `game.${g}` })) },
    {
      group: 'Player',
      items: [
        ...[...playerVars].map((p) => ({ label: nice(p), expr: `player.${p}` })),
        { label: 'Position X', expr: 'player.x' },
        { label: 'Height (Y)', expr: 'player.y' },
        { label: 'Position Z', expr: 'player.z' },
        { label: 'On the ground', expr: 'player.grounded' },
        { label: 'Swimming', expr: 'player.swimming' },
        { label: 'Climbing', expr: 'player.climbing' },
      ],
    },
    { group: 'Count objects', items: [...tags].sort().map((t) => ({ label: `How many "${t}"`, expr: `count('${t}')` })) },
    { group: 'Other objects', items: objects.slice(0, 30) },
    { group: 'Time', items: [{ label: 'Seconds since start', expr: 'round(time.elapsed)' }] },
  ].filter((g) => g.items.length);
}

/** Text box for a live value, with a list of everything it can show. */
export function FormulaField({ label, spec, value, onChange }: { label: string; spec: FormulaSpec; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const menu = useMenu();

  const insert = (expr: string) => {
    if (spec.insert === 'expression') return onChange(expr);
    // Text: put {expr} where the cursor was (or at the end).
    const cur = draft ?? value;
    const at = caret.current ?? cur.length;
    onChange(`${cur.slice(0, at)}{${expr}}${cur.slice(at)}`);
    setDraft(null);
  };

  const open = async (x: number, y: number) => {
    await refreshScriptTexts().catch(() => {});
    const groups = gatherChoices();
    const items: MenuEntry[] = [];
    if (spec.presets?.length) {
      for (const p of spec.presets) items.push({ label: p.label, shortcut: p.value, onSelect: () => onChange(p.value) });
      items.push('separator');
    }
    for (const g of groups) {
      items.push({
        label: g.group,
        children: g.items.map((c) => ({ label: c.label, shortcut: c.expr, onSelect: () => insert(c.expr) })),
      });
    }
    if (!items.length) items.push({ label: 'Nothing to show yet: add scripts or traits first', disabled: true, onSelect: () => {} });
    menu.open(x, y, items);
  };

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-control formula-control">
        <input
          ref={input}
          type="text"
          value={draft ?? value}
          spellCheck={false}
          onFocus={() => setDraft(value)}
          onChange={(e) => setDraft(e.target.value)}
          onSelect={(e) => (caret.current = e.currentTarget.selectionStart)}
          onBlur={(e) => {
            caret.current = e.currentTarget.selectionStart;
            if (draft !== null && draft !== value) onChange(draft);
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button
          className="icon-only small"
          title={spec.insert === 'text' ? 'Insert a live value' : 'Choose a value'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            void open(r.left, r.bottom + 2);
          }}
        >
          <Icon name="list-checks" size={13} />
        </button>
      </div>
      {menu.element}
    </div>
  );
}

/** Pick an object in the scene by name (stores the name). */
export function EntityField({ label, value, onChange, self }: { label: string; value: string; onChange: (v: string) => void; self?: Entity }) {
  const engine = useEditor((s) => s.engine);
  useEditor((s) => s.revision);
  const names = [...new Set([...(engine?.world.all() ?? [])].filter((e) => e !== self).map((e) => e.name))].sort((a, b) => a.localeCompare(b));
  if (value && !names.includes(value)) names.unshift(value);
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-control">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">(automatic)</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
