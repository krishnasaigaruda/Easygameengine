import { useEffect, useRef } from 'react';
import { Animator, autoClip, type AnimatorRole, type AssetType, type Entity, type THREE } from '@ege/runtime';
import { useLibrary, assetSummary } from '../../assets/library';
import { useEditor } from '../../state/editorStore';
import { ASSET_DROP_EVENT, type AssetDropDetail } from '../../ui/assetDrag';
import { openAssetStore } from '../../store/storeState';
import { TYPE_ICON } from '../ProjectPanel';
import { Icon } from '../../ui/Icon';

/** Dropdown of project assets of one type, with a thumbnail. Asset tiles can be dropped on it. */
export function AssetPicker({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: AssetType;
  value: string;
  onChange: (id: string) => void;
}) {
  const assets = useLibrary((s) => s.assets).filter((a) => a.type === type);
  const current = value ? assetSummary(value) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const log = useEditor((s) => s.log);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onDrop = (ev: Event) => {
      const { assetId } = (ev as CustomEvent<AssetDropDetail>).detail;
      const a = assetSummary(assetId);
      if (a?.type === type) onChange(assetId);
      else log('warn', `That slot needs a ${type}, not a ${a?.type ?? 'thing'}.`);
    };
    el.addEventListener(ASSET_DROP_EVENT, onDrop);
    return () => el.removeEventListener(ASSET_DROP_EVENT, onDrop);
  }, [type, onChange, log]);

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-control asset-picker" ref={ref} data-asset-drop={type}>
        <span className="asset-picker-thumb">
          {current?.thumbnailUrl ? <img src={current.thumbnailUrl} alt="" /> : <Icon name={TYPE_ICON[type]} size={13} />}
        </span>
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__store') openAssetStore(type === 'hdri' ? 'skies' : type === 'material' ? 'materials' : 'models');
            else onChange(e.target.value);
          }}
        >
          <option value="">None</option>
          {value && !current && <option value={value}>(missing asset)</option>}
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          {type !== 'texture' && type !== 'audio' && <option value="__store">Get more from the Asset Store…</option>}
        </select>
      </div>
    </div>
  );
}

/** Which model out of a pack (a file holding several) an object shows. Hidden for ordinary models. */
export function ModelPartPicker({ label, modelId, value, onChange }: { label: string; modelId: string; value: string; onChange: (path: string) => void }) {
  useLibrary((s) => s.assets); // parts are found in the background after an import
  const parts = assetSummary(modelId)?.parts ?? [];
  if (!parts.length && !value) return null;
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-control">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">All {parts.length} models</option>
          {parts.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
          {value && !parts.some((p) => p.path === value) && <option value={value}>Missing part</option>}
        </select>
      </div>
    </div>
  );
}

/** Dropdown of the animation clips inside an entity's model. */
export function AnimationPicker({
  label,
  entity,
  modelId,
  value,
  onChange,
  role,
}: {
  label: string;
  entity: Entity;
  modelId: string;
  /** An Animator slot: Auto shows the clip it finds by name. */
  role?: AnimatorRole;
  value: string;
  onChange: (clip: string) => void;
}) {
  const engine = useEditor((s) => s.engine);
  useEditor((s) => s.revision); // clips appear once the model has loaded
  const fromLoaded = engine?.models.clipsOf(entity) ?? [];
  const clips = fromLoaded.length ? fromLoaded : (assetSummary(modelId)?.animations ?? []);
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-control">
        {clips.length === 0 ? (
          <span className="muted">{modelId || fromLoaded.length || engine?.models.objectOf(entity) ? 'This model has no animations' : 'Needs an animated model (on this object or a child)'}</span>
        ) : (
          <select value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{autoLabel(clips, modelId, role, entity)}</option>
            {clips.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {value && !clips.includes(value) && <option value={value}>{value} (missing)</option>}
          </select>
        )}
      </div>
    </div>
  );
}

function autoLabel(clips: string[], modelId: string, role: AnimatorRole | undefined, entity: Entity): string {
  if (role) {
    const found = autoClip(clips.map((name) => ({ name }) as THREE.AnimationClip), {}, role);
    return found ? `Auto (${found})` : 'Auto (none found: pick one)';
  }
  if (!modelId) return 'Auto (found by name)';
  return entity.has(Animator) ? 'Auto (the Animator picks)' : `Auto (${clips[0]})`;
}
