import { useState } from 'react';
import {
  ACTION_BY_KEY,
  ACTIONS,
  EVENT_BY_KEY,
  EVENTS,
  READY_TRAITS,
  TRAIT_BY_NAME,
  parseJson5,
  stringifyJson5,
  type ActionSpec,
  type ParamSpec,
} from '@ege/runtime';
import { Icon } from '../ui/Icon';
import { useMenu, type MenuEntry } from '../ui/Menu';

type Json = Record<string, unknown>;
type ActionJson = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const asList = (v: unknown): ActionJson[] => (Array.isArray(v) ? v.filter(isObj) : isObj(v) ? [v] : []);
const clone = <T,>(v: T): T => structuredClone(v);

/** How a raw value appears in a text box. */
function showValue(v: unknown, kind: ParamSpec['kind']): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (kind === 'args' && isObj(v)) return stringifyJson5(v);
  return stringifyJson5(v);
}

/** Text box → value. Numbers, true/false and [lists] become real values; the rest stays text. */
function readValue(text: string, kind: ParamSpec['kind']): unknown {
  const t = text.trim();
  if (kind === 'path' || kind === 'target' || kind === 'text' || kind === 'name') return text;
  if (t === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(t) || t === 'true' || t === 'false' || t === 'null' || /^\[.*\]$/.test(t) || (kind === 'args' && /^\{.*\}$/s.test(t))) {
    try {
      return parseJson5(t).value;
    } catch {
      return text;
    }
  }
  return text;
}

function actionKey(a: ActionJson): string | undefined {
  return Object.keys(a).find((k) => ACTION_BY_KEY.has(k));
}

function actionMenu(onPick: (spec: ActionSpec) => void): MenuEntry[] {
  const groups = new Map<string, ActionSpec[]>();
  for (const a of ACTIONS) {
    if (a.comingIn) continue;
    groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  }
  return [...groups].map(([label, specs]) => ({
    label,
    children: specs.map((s) => ({ label: s.label, icon: s.icon, onSelect: () => onPick(s) })),
  }));
}

// ── action list ─────────────────────────────────────────────────────────────

function ActionList({
  actions,
  onChange,
  depth = 0,
}: {
  actions: ActionJson[];
  onChange: (next: ActionJson[]) => void;
  depth?: number;
}) {
  const menu = useMenu();
  const update = (i: number, a: ActionJson | null) => {
    const next = [...actions];
    if (a) next[i] = a;
    else next.splice(i, 1);
    onChange(next);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= actions.length) return;
    const next = [...actions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className={`rb-actions depth-${Math.min(depth, 3)}`}>
      {actions.length === 0 && <div className="rb-empty">No actions yet.</div>}
      {actions.map((a, i) => (
        <ActionRow
          key={i}
          action={a}
          depth={depth}
          onChange={(x) => update(i, x)}
          onDelete={() => update(i, null)}
          onUp={i > 0 ? () => move(i, -1) : undefined}
          onDown={i < actions.length - 1 ? () => move(i, 1) : undefined}
        />
      ))}
      <button
        className="small rb-add"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          menu.open(r.left, r.bottom + 2, actionMenu((spec) => onChange([...actions, clone(spec.example)])));
        }}
      >
        <Icon name="plus" size={12} />
        Add action
      </button>
      {menu.element}
    </div>
  );
}

function ActionRow({
  action,
  depth,
  onChange,
  onDelete,
  onUp,
  onDown,
}: {
  action: ActionJson;
  depth: number;
  onChange: (a: ActionJson) => void;
  onDelete: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const key = actionKey(action);
  const spec = key ? ACTION_BY_KEY.get(key) : undefined;
  const menu = useMenu();
  if (!spec || !key) {
    return (
      <div className="rb-action unknown">
        <span className="muted">Unknown action — edit it in Code view: {stringifyJson5(action)}</span>
        <button className="icon-btn" onClick={onDelete} title="Remove">
          <Icon name="x" />
        </button>
      </div>
    );
  }
  const set = (name: string, value: unknown) => {
    const next = { ...action };
    if (value === undefined || (Array.isArray(value) && value.length === 0 && name !== key)) delete next[name];
    else next[name] = value;
    onChange(next);
  };
  const isGuard = key === 'if' && action.then === undefined && action.else === undefined;

  return (
    <div className="rb-action">
      <div className="rb-action-head">
        <button
          className="rb-kind"
          title="Change action"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            menu.open(r.left, r.bottom + 2, actionMenu((s) => onChange(clone(s.example))));
          }}
        >
          <Icon name={spec.icon} size={13} />
          {spec.label}
          <Icon name="chevron-down" size={11} />
        </button>
        {isGuard && <span className="rb-note">stops here unless true</span>}
        <span className="rb-spacer" />
        <button className="icon-btn" disabled={!onUp} onClick={onUp} title="Move up">
          <Icon name="chevron-down" size={12} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button className="icon-btn" disabled={!onDown} onClick={onDown} title="Move down">
          <Icon name="chevron-down" size={12} />
        </button>
        <button className="icon-btn" onClick={onDelete} title="Remove action">
          <Icon name="trash" size={12} />
        </button>
      </div>
      <div className="rb-params">
        {spec.params.map((p) => {
          const raw = action[p.name];
          if (p.kind === 'actions') {
            const show = raw !== undefined || p.required;
            if (!show) {
              return (
                <button key={p.name} className="small rb-add-branch" onClick={() => set(p.name, [])}>
                  <Icon name="plus" size={11} />
                  {p.label}
                </button>
              );
            }
            return (
              <div key={p.name} className="rb-branch">
                <div className="rb-branch-label">{p.label}</div>
                <ActionList actions={asList(raw)} depth={depth + 1} onChange={(list) => set(p.name, list)} />
              </div>
            );
          }
          return (
            <label key={p.name} className="rb-param" title={p.help}>
              <span>{p.label}</span>
              <input
                value={showValue(raw, p.kind)}
                placeholder={p.default !== undefined ? showValue(p.default, p.kind) : p.required ? 'required' : 'optional'}
                onChange={(e) => set(p.name, readValue(e.target.value, p.kind))}
                spellCheck={false}
              />
            </label>
          );
        })}
      </div>
      {menu.element}
    </div>
  );
}

// ── events ──────────────────────────────────────────────────────────────────

function EventBlock({
  eventKey,
  value,
  onChange,
  onDelete,
}: {
  eventKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  onDelete: () => void;
}) {
  const spec = EVENT_BY_KEY.get(eventKey);
  const [newName, setNewName] = useState('');
  if (!spec) return null;
  let body: React.ReactNode;

  if (spec.shape === 'actions') {
    body = <ActionList actions={asList(value)} onChange={onChange} />;
  } else if (spec.shape === 'keyed') {
    const map = isObj(value) ? value : {};
    const placeholder = eventKey === 'key' ? 'key name (space, e, jump…)' : 'message name';
    body = (
      <>
        {Object.entries(map).map(([name, list]) => (
          <div key={name} className="rb-branch">
            <div className="rb-branch-label">
              {eventKey === 'key' ? 'Key' : 'Message'} <code>{name}</code>
              <button
                className="icon-btn"
                title="Remove"
                onClick={() => {
                  const next = { ...map };
                  delete next[name];
                  onChange(next);
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
            <ActionList actions={asList(list)} onChange={(l) => onChange({ ...map, [name]: l })} />
          </div>
        ))}
        <div className="rb-inline-add">
          <input value={newName} placeholder={placeholder} onChange={(e) => setNewName(e.target.value)} />
          <button
            className="small"
            disabled={!newName.trim()}
            onClick={() => {
              onChange({ ...map, [newName.trim()]: [] });
              setNewName('');
            }}
          >
            <Icon name="plus" size={11} />
            Add
          </button>
        </div>
      </>
    );
  } else {
    // timers / near: lists of { …, do: [] }
    const items = asList(value);
    const fields = spec.shape === 'timers' ? ['every', 'after'] : ['distance', 'target'];
    const branches = spec.shape === 'timers' ? ['do'] : ['do', 'leave'];
    body = (
      <>
        {items.map((item, i) => {
          const setItem = (patch: Json) => {
            const next = [...items];
            next[i] = { ...item, ...patch };
            for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[i][k];
            onChange(next);
          };
          return (
            <div key={i} className="rb-action">
              <div className="rb-params">
                {fields.map((f) => (
                  <label key={f} className="rb-param">
                    <span>{f}</span>
                    <input value={showValue(item[f], 'expr')} onChange={(e) => setItem({ [f]: readValue(e.target.value, f === 'target' ? 'target' : 'expr') })} />
                  </label>
                ))}
                <button className="icon-btn" title="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
              {branches.map((b) => (
                <div key={b} className="rb-branch">
                  <div className="rb-branch-label">{b === 'do' ? 'Do' : 'When it leaves'}</div>
                  <ActionList actions={asList(item[b])} depth={1} onChange={(l) => setItem({ [b]: l })} />
                </div>
              ))}
            </div>
          );
        })}
        <button
          className="small rb-add"
          onClick={() => onChange([...items, spec.shape === 'timers' ? { every: 2, do: [] } : { distance: 3, do: [], leave: [] }])}
        >
          <Icon name="plus" size={12} />
          Add {spec.shape === 'timers' ? 'timer' : 'range'}
        </button>
      </>
    );
  }

  return (
    <section className="rb-event">
      <header>
        <Icon name={spec.icon} size={14} />
        <span className="rb-when">When</span>
        <strong>{spec.label}</strong>
        <span className="muted rb-desc">{spec.description}</span>
        <button className="icon-btn" onClick={onDelete} title="Remove this event">
          <Icon name="trash" size={12} />
        </button>
      </header>
      {body}
    </section>
  );
}

// ── whole script ────────────────────────────────────────────────────────────

/** Visual editor for a script's JSON. Calls onChange with new JSON5 text. */
export function RuleBuilder({ source, onChange }: { source: string; onChange: (text: string) => void }) {
  const menu = useMenu();
  const [newVar, setNewVar] = useState('');
  let json: Json;
  try {
    const v = parseJson5(source).value;
    json = isObj(v) ? v : {};
  } catch {
    return <p className="empty">This script has a syntax error. Fix it in Code view first.</p>;
  }
  const write = (next: Json) => onChange(stringifyJson5(next) + '\n');
  const on = isObj(json.on) ? json.on : {};
  const props = isObj(json.props) ? json.props : {};
  const traits = Array.isArray(json.traits) ? (json.traits as string[]) : [];
  const functions = isObj(json.functions) ? json.functions : {};

  const setOn = (key: string, value: unknown) => write({ ...json, on: { ...on, [key]: value } });
  const removeOn = (key: string) => {
    const next = { ...on };
    delete next[key];
    write({ ...json, on: next });
  };

  return (
    <div className="rule-builder">
      <section className="rb-section">
        <h4>Traits</h4>
        <div className="rb-traits">
          {READY_TRAITS.map((t) => {
            const def = TRAIT_BY_NAME.get(t)!;
            const on_ = traits.includes(t);
            return (
              <button
                key={t}
                className={`chip ${on_ ? 'active' : ''}`}
                title={def.description}
                onClick={() => write({ ...json, traits: on_ ? traits.filter((x) => x !== t) : [...traits, t] })}
              >
                <Icon name={def.icon} size={12} />
                {def.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rb-section">
        <h4>Variables</h4>
        <p className="component-desc">Values this object remembers. Use them as self.name in formulas.</p>
        {Object.entries(props).map(([k, v]) => (
          <div key={k} className="rb-param rb-var">
            <code>{k}</code>
            <input
              value={showValue(v, 'expr')}
              onChange={(e) => {
                const val = readValue(e.target.value, 'expr');
                write({ ...json, props: { ...props, [k]: val ?? 0 } });
              }}
            />
            <button
              className="icon-btn"
              title="Remove variable"
              onClick={() => {
                const next = { ...props };
                delete next[k];
                write({ ...json, props: next });
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <div className="rb-inline-add">
          <input value={newVar} placeholder="new variable name" onChange={(e) => setNewVar(e.target.value.replace(/[^\w]/g, ''))} />
          <button
            className="small"
            disabled={!newVar}
            onClick={() => {
              write({ ...json, props: { ...props, [newVar]: 0 } });
              setNewVar('');
            }}
          >
            <Icon name="plus" size={11} />
            Add
          </button>
        </div>
      </section>

      <section className="rb-section">
        <h4>Events</h4>
        {Object.keys(on).length === 0 && <p className="component-desc">Nothing happens yet. Add an event to begin.</p>}
        {Object.entries(on).map(([k, v]) => (
          <EventBlock key={k} eventKey={k} value={v} onChange={(x) => setOn(k, x)} onDelete={() => removeOn(k)} />
        ))}
        <button
          className="small"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const shapeDefault = (key: string) => {
              const s = EVENT_BY_KEY.get(key)!.shape;
              return s === 'keyed' ? {} : s === 'timers' ? [{ every: 2, do: [] }] : s === 'near' ? [{ distance: 3, do: [], leave: [] }] : [];
            };
            menu.open(
              r.left,
              r.bottom + 2,
              EVENTS.filter((ev) => !ev.aliasOf && !(ev.key in on)).map((ev) => ({
                label: ev.label,
                icon: ev.icon,
                onSelect: () => setOn(ev.key, shapeDefault(ev.key)),
              })),
            );
          }}
        >
          <Icon name="plus" size={12} />
          Add event
        </button>
      </section>

      <section className="rb-section">
        <h4>Functions</h4>
        <p className="component-desc">Named action lists you (or other objects) can run with the Call action.</p>
        {Object.entries(functions).map(([name, body]) => (
          <section key={name} className="rb-event">
            <header>
              <Icon name="phone" size={14} />
              <strong>{name}</strong>
              <span className="rb-spacer" />
              <button
                className="icon-btn"
                onClick={() => {
                  const next = { ...functions };
                  delete next[name];
                  write({ ...json, functions: next });
                }}
                title="Remove function"
              >
                <Icon name="trash" size={12} />
              </button>
            </header>
            <ActionList actions={asList(body)} onChange={(l) => write({ ...json, functions: { ...functions, [name]: l } })} />
          </section>
        ))}
        <FunctionAdd onAdd={(name) => write({ ...json, functions: { ...functions, [name]: [] } })} />
      </section>
      {menu.element}
    </div>
  );
}

function FunctionAdd({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="rb-inline-add">
      <input value={name} placeholder="new function name" onChange={(e) => setName(e.target.value.replace(/[^\w]/g, ''))} />
      <button
        className="small"
        disabled={!name}
        onClick={() => {
          onAdd(name);
          setName('');
        }}
      >
        <Icon name="plus" size={11} />
        Add
      </button>
    </div>
  );
}
