import { useEffect, useState } from 'react';
import { ScriptSystem, TRAITS, type Entity, type Vec3 } from '@ege/runtime';
import { Icon } from '../../ui/Icon';
import { BooleanField, NumberField, StringField, Vec3Field } from './fields';
import { getAssetText, useLibrary, createScript } from '../../assets/library';
import { openScriptEditor } from '../../scripting/scriptEditorState';
import { editComponent } from '../../editor/actions';
import { useEditor } from '../../state/editorStore';

/** A ticked trait's settings for this object (its script's props). */
function TraitValues({ trait, values, onChange }: { trait: string; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const def = TRAITS.find((t) => t.name === trait);
  // 2D games run a trait's 2D version (sideways instead of in depth), with its own defaults.
  const flat = useEditor((s) => s.dimension === '2d');
  const source = (flat && def?.script2D) || def?.script;
  const defaults = source ? ScriptSystem.check(source).props : {};
  const entries = Object.entries(defaults);
  if (!entries.length) return null;
  return (
    <div className="script-props trait-values">
      {entries.map(([k, d]) => {
        const overridden = k in values;
        const v = overridden ? values[k] : d;
        const set = (x: unknown) => onChange({ ...values, [k]: x });
        const reset = () => {
          const next = { ...values };
          delete next[k];
          onChange(next);
        };
        let field: React.ReactNode;
        if (typeof d === 'number') field = <NumberField label={k} spec={{ kind: 'number', step: 0.1 }} value={Number(v)} onChange={set} />;
        else if (typeof d === 'boolean') field = <BooleanField label={k} value={!!v} onChange={set} />;
        else if (Array.isArray(d) && d.length === 3 && d.every((n) => typeof n === 'number')) field = <Vec3Field label={k} value={v as Vec3} onChange={set} />;
        else field = <StringField label={k} value={typeof v === 'string' ? v : JSON.stringify(v)} onChange={set} />;
        return (
          <div key={k} className={`script-prop ${overridden ? 'overridden' : ''}`}>
            {field}
            {overridden && (
              <button className="icon-btn" title="Use the trait's default" onClick={reset}>
                <Icon name="refresh" size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Checkbox list of traits, grouped by category; ticked ones show this object's values for them. */
export function TraitsField({
  value,
  onChange,
  props = {},
  onProps,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  props?: Record<string, unknown>;
  onProps?: (v: Record<string, unknown>) => void;
}) {
  const categories = [...new Set(TRAITS.map((t) => t.category))];
  return (
    <div className="traits-field">
      {categories.map((cat) => (
        <div key={cat} className="traits-group">
          <div className="traits-group-label">{cat}</div>
          {TRAITS.filter((t) => t.category === cat).map((t) => {
            const on = value.includes(t.name);
            const label = (
              <label className={`trait-row ${t.comingIn ? 'soon' : ''}`} title={t.description}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!!t.comingIn}
                  onChange={() => onChange(on ? value.filter((x) => x !== t.name) : [...value, t.name])}
                />
                <Icon name={t.icon} size={13} />
                <span className="trait-name">{t.label}</span>
                {t.comingIn ? <span className="trait-soon">{t.comingIn}</span> : <span className="trait-desc">{t.description}</span>}
              </label>
            );
            const row = (
              <div key={t.name}>
                {label}
                {on && onProps && <TraitValues trait={t.name} values={props} onChange={onProps} />}
              </div>
            );
            return row;
          })}
        </div>
      ))}
    </div>
  );
}

/** Script picker + per-object values for the script's props. */
export function ScriptPropsField({
  entity,
  scriptId,
  value,
  onChange,
}: {
  entity: Entity;
  scriptId: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const updatedAt = useLibrary((s) => s.assets.find((a) => a.id === scriptId)?.size);
  // Remember which script the loaded defaults belong to, so switching scripts never shows stale values.
  const [loaded, setLoaded] = useState<{ id: string; props: Record<string, unknown> } | null>(null);
  const defaults = loaded && loaded.id === scriptId ? loaded.props : null;

  useEffect(() => {
    if (!scriptId) return;
    let alive = true;
    void getAssetText(scriptId).then((t) => {
      if (alive) setLoaded({ id: scriptId, props: ScriptSystem.check(t).props });
    });
    return () => {
      alive = false;
    };
  }, [scriptId, updatedAt]);

  const actions = (
    <div className="component-actions">
      {scriptId && (
        <button className="small" onClick={() => openScriptEditor(scriptId)}>
          <Icon name="pencil" size={12} />
          Edit script
        </button>
      )}
      <button
        className="small"
        onClick={async () => {
          const id = await createScript(`${entity.name} Script`);
          if (!id) return;
          editComponent(entity, 'Script', { script: id }, 'New script');
          openScriptEditor(id);
        }}
      >
        <Icon name="plus" size={12} />
        New script
      </button>
    </div>
  );

  if (!scriptId || !defaults) return actions;
  const entries = Object.entries(defaults);
  return (
    <>
      {entries.length > 0 && (
        <div className="script-props">
          <div className="traits-group-label">Values for this object</div>
          {entries.map(([k, def]) => {
            const overridden = k in value;
            const v = overridden ? value[k] : def;
            const set = (x: unknown) => onChange({ ...value, [k]: x });
            const reset = () => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            };
            let field: React.ReactNode;
            if (typeof def === 'number') field = <NumberField label={k} spec={{ kind: 'number', step: 0.1 }} value={Number(v)} onChange={set} />;
            else if (typeof def === 'boolean') field = <BooleanField label={k} value={!!v} onChange={set} />;
            else if (Array.isArray(def) && def.length === 3 && def.every((n) => typeof n === 'number'))
              field = <Vec3Field label={k} value={v as Vec3} onChange={set} />;
            else field = <StringField label={k} value={typeof v === 'string' ? v : JSON.stringify(v)} onChange={set} />;
            return (
              <div key={k} className={`script-prop ${overridden ? 'overridden' : ''}`}>
                {field}
                {overridden && (
                  <button className="icon-btn" title="Use the script's default" onClick={reset}>
                    <Icon name="refresh" size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {actions}
    </>
  );
}
