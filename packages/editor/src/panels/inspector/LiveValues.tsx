import { useEffect, useReducer } from 'react';
import type { Entity, Vec3 } from '@ege/runtime';
import { useEditor } from '../../state/editorStore';
import { BooleanField, NumberField, StringField, Vec3Field } from './fields';
import { Icon } from '../../ui/Icon';

/** Re-render ~10× a second while the game runs, so physics/script changes show up live. */
export function useLiveRefresh(): void {
  const playing = useEditor((s) => s.playing);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [playing]);
}

/** Internal bookkeeping variables the user didn't write. */
const HIDDEN = new Set(['startPosition', 'baseY']);

function ValueField({ name, value, onChange }: { name: string; value: unknown; onChange: (v: unknown) => void }) {
  if (typeof value === 'number') return <NumberField label={name} spec={{ kind: 'number', step: 0.1 }} value={value} onChange={onChange} />;
  if (typeof value === 'boolean') return <BooleanField label={name} value={value} onChange={onChange} />;
  if (Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number')) {
    return <Vec3Field label={name} value={value as Vec3} onChange={onChange} />;
  }
  if (typeof value === 'string') return <StringField label={name} value={value} onChange={onChange} />;
  return (
    <div className="field">
      <label className="field-label">{name}</label>
      <div className="field-control">
        <span className="muted mono">{value === null || value === undefined ? 'nothing' : JSON.stringify(value)}</span>
      </div>
    </div>
  );
}

function LiveCard({ title, values, onChange, empty }: { title: string; values: Record<string, unknown>; onChange: (k: string, v: unknown) => void; empty: string }) {
  const entries = Object.entries(values).filter(([k]) => !HIDDEN.has(k));
  return (
    <section className="component-card live-card">
      <header className="component-header">
        <span className="live-dot" />
        <span className="component-title">{title}</span>
        <span className="muted live-note">resets on Stop</span>
      </header>
      <div className="component-body">
        {entries.length === 0 ? <p className="component-desc">{empty}</p> : entries.map(([k, v]) => <ValueField key={k} name={k} value={v} onChange={(x) => onChange(k, x)} />)}
      </div>
    </section>
  );
}

/** An object's script variables while playing (health, points…), editable on the fly. */
export function LiveEntityValues({ entity }: { entity: Entity }) {
  const engine = useEditor((s) => s.engine);
  const playing = useEditor((s) => s.playing);
  useLiveRefresh();
  const scripts = engine?.scripts;
  if (!playing || !scripts || !scripts.isScripted(entity)) return null;
  return (
    <LiveCard
      title="Live values"
      values={scripts.varsSnapshot(entity)}
      onChange={(k, v) => scripts.setVar(entity, k, v)}
      empty="This object's scripts haven't stored any values yet."
    />
  );
}

/** game.* values while playing (score, checkpoint…). */
export function LiveGameValues() {
  const engine = useEditor((s) => s.engine);
  const playing = useEditor((s) => s.playing);
  useLiveRefresh();
  const scripts = engine?.scripts;
  if (!playing || !scripts) return null;
  return (
    <LiveCard
      title="Game values"
      values={{ ...scripts.game }}
      onChange={(k, v) => scripts.setGameValue(k, v)}
      empty="Nothing yet. Scripts store shared values like game.score here."
    />
  );
}

export function PlayingHint() {
  const playing = useEditor((s) => s.playing);
  if (!playing) return null;
  return (
    <div className="se-notice live-hint">
      <Icon name="info" size={13} />
      Changes made while playing are temporary. Stop to return to your saved scene.
    </div>
  );
}
