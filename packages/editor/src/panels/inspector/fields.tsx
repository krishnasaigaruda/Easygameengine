import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ROLE_WORDS, type AnimatorRole, type Entity, type FieldSpec, type Vec3 } from '@ege/runtime';
import { AnimationPicker, AssetPicker, ModelPartPicker } from './assetFields';
import { EntityField, FormulaField } from './formulaFields';
import { ScriptPropsField, TraitsField } from './scriptFields';
import { editComponent } from '../../editor/actions';

interface FieldProps<T> {
  label: string;
  value: T;
  onChange: (v: T) => void;
}

const decimals = (step: number) => Math.max(0, Math.min(4, Math.ceil(-Math.log10(step))));
const clamp = (v: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

/**
 * Number input that commits on Enter/blur, plus a draggable label: drag left/right to
 * scrub the value (hold Shift for fine steps).
 */
export function NumberInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  scrubLabel,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  scrubLabel?: string;
  className?: string;
}) {
  // While focused we show the user's draft text; otherwise always the live value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? format(value, step);

  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n)) onChange(clamp(n, min, max));
    setDraft(null);
  };

  const onScrubStart = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startValue = value;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) * step * (ev.shiftKey ? 0.1 : 1);
      const v = clamp(startValue + delta, min, max);
      onChange(Number(v.toFixed(decimals(step) + 1)));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <span className={`num ${className ?? ''}`}>
      {scrubLabel !== undefined && (
        <span className="num-scrub" onPointerDown={onScrubStart} title="Drag to change">
          {scrubLabel}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          setDraft(format(value, step));
          e.currentTarget.select();
        }}
        onBlur={commit}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp(value + (e.key === 'ArrowUp' ? step : -step), min, max);
            onChange(Number(v.toFixed(decimals(step))));
            setDraft(format(v, step));
          }
        }}
      />
    </span>
  );
}

function format(v: number, step: number): string {
  if (!Number.isFinite(v)) return '0';
  const d = decimals(step) + 1;
  return String(Number(v.toFixed(d)));
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-control">{children}</div>
    </div>
  );
}

export function NumberField({ label, value, onChange, spec }: FieldProps<number> & { spec: Extract<FieldSpec, { kind: 'number' }> }) {
  const slider = spec.min !== undefined && spec.max !== undefined && spec.max - spec.min <= 20;
  return (
    <div className="field">
      <NumberInput
        className="field-label-num"
        scrubLabel={label}
        value={value}
        onChange={onChange}
        step={spec.step}
        min={spec.min}
        max={spec.max}
      />
      {slider && (
        <input
          className="field-slider"
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 0.01}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
    </div>
  );
}

const AXES = ['X', 'Y', 'Z'] as const;

export function Vec3Field({ label, value, onChange, step = 0.1 }: FieldProps<Vec3> & { step?: number }) {
  return (
    <Row label={label}>
      <div className="vec3">
        {AXES.map((axis, i) => (
          <NumberInput
            key={axis}
            className={`axis-${axis.toLowerCase()}`}
            scrubLabel={axis}
            value={value[i]}
            step={step}
            onChange={(v) => {
              const next = [...value] as Vec3;
              next[i] = v;
              onChange(next);
            }}
          />
        ))}
      </div>
    </Row>
  );
}

export function Vec2Field({
  label,
  value,
  onChange,
  step = 1,
  axes = ['X', 'Y'],
}: FieldProps<[number, number]> & { step?: number; axes?: [string, string] }) {
  return (
    <Row label={label}>
      <div className="vec2">
        {axes.map((axis, i) => (
          <NumberInput
            key={axis}
            className={i === 0 ? 'axis-x' : 'axis-y'}
            scrubLabel={axis}
            value={value[i]}
            step={step}
            onChange={(v) => {
              const next = [...value] as [number, number];
              next[i] = v;
              onChange(next);
            }}
          />
        ))}
      </div>
    </Row>
  );
}

export function ColorField({ label, value, onChange }: FieldProps<string>) {
  return (
    <Row label={label}>
      <div className="color-field">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="color-hex">{value}</span>
      </div>
    </Row>
  );
}

export function BooleanField({ label, value, onChange }: FieldProps<boolean>) {
  return (
    <Row label={label}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  );
}

export function EnumField({ label, value, onChange, options }: FieldProps<string> & { options: readonly string[] }) {
  return (
    <Row label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function StringField({ label, value, onChange }: FieldProps<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Row label={label}>
      <input
        type="text"
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onChange(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </Row>
  );
}

/** Picks the right editor for a field spec. `entity`/`data` give context to asset/animation fields. */
export function FieldEditor({
  name,
  spec,
  value,
  onChange,
  entity,
  data,
}: {
  name: string;
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  entity?: Entity;
  data?: Record<string, unknown>;
}) {
  const label = spec.label ?? name;
  switch (spec.kind) {
    case 'number':
      return <NumberField label={label} spec={spec} value={Number(value) || 0} onChange={onChange} />;
    case 'vec3':
      return (
        <Vec3Field
          label={label}
          step={spec.step}
          value={Array.isArray(value) && value.length === 3 ? (value as Vec3) : [0, 0, 0]}
          onChange={onChange}
        />
      );
    case 'vec2':
      return (
        <Vec2Field
          label={label}
          step={spec.step}
          axes={spec.axes}
          value={Array.isArray(value) && value.length === 2 ? (value as [number, number]) : [0, 0]}
          onChange={onChange}
        />
      );
    case 'color':
      return <ColorField label={label} value={typeof value === 'string' ? value : '#ffffff'} onChange={onChange} />;
    case 'boolean':
      return <BooleanField label={label} value={!!value} onChange={onChange} />;
    case 'enum':
      return <EnumField label={label} options={spec.options} value={String(value)} onChange={onChange} />;
    case 'string':
      return <StringField label={label} value={String(value ?? '')} onChange={onChange} />;
    case 'formula':
      return <FormulaField label={label} spec={spec} value={String(value ?? '')} onChange={onChange} />;
    case 'entity':
      return <EntityField label={label} value={String(value ?? '')} onChange={onChange} self={entity} />;
    case 'asset':
      return <AssetPicker label={label} type={spec.assetType} value={String(value ?? '')} onChange={onChange} />;
    case 'animation':
      return entity ? (
        <AnimationPicker
          label={label}
          entity={entity}
          modelId={String(data?.[spec.modelField] ?? '')}
          role={name in ROLE_WORDS ? (name as AnimatorRole) : undefined}
          value={String(value ?? '')}
          onChange={onChange}
        />
      ) : null;
    case 'modelPart':
      return <ModelPartPicker label={label} modelId={String(data?.[spec.modelField] ?? '')} value={String(value ?? '')} onChange={onChange} />;
    case 'traits':
      return (
        <TraitsField
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          props={(data?.props as Record<string, unknown> | undefined) ?? {}}
          onProps={entity ? (p) => editComponent(entity, 'Traits', { props: p }, 'Trait values') : undefined}
        />
      );
    case 'scriptProps':
      return entity ? (
        <ScriptPropsField
          entity={entity}
          scriptId={String(data?.[spec.scriptField] ?? '')}
          value={value && typeof value === 'object' ? (value as Record<string, unknown>) : {}}
          onChange={onChange}
        />
      ) : null;
  }
}
