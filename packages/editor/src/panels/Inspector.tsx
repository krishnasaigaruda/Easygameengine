import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  allComponentDefs,
  COMPONENT_CATEGORIES,
  getComponentDef,
  type ComponentCategory,
  type Entity,
  type FieldSpec,
} from '@ege/runtime';
import { useEditor, useSelectedEntity } from '../state/editorStore';
import { AssetInspector } from './inspector/AssetInspector';
import { SceneSettingsInspector } from './inspector/SceneSettingsInspector';
import { addComponent, editComponent, removeComponent, rename, setEnabled, setTags } from '../editor/actions';
import { FieldEditor } from './inspector/fields';
import { COMPONENT_ACTIONS } from '../editor/componentActions';
import { spriteFitFor } from '../editor/assetActions';
import { SpriteSheet } from './inspector/SpriteSheet';
import { TilemapTools } from './inspector/TilemapTools';
import { TerrainTools } from './inspector/TerrainTools';
import { KeyframeTimeline } from './inspector/KeyframeTimeline';

/** Extra tools shown at the top of some components' cards. */
const COMPONENT_PANELS: Record<string, (entity: Entity) => ReactNode> = {
  Terrain: (entity) => <TerrainTools entity={entity} />,
  Keyframes: (entity) => <KeyframeTimeline entity={entity} />,
};
/** Extra tools shown under a component's fields. */
const COMPONENT_PANELS_AFTER: Record<string, (entity: Entity) => ReactNode> = {
  Sprite: (entity) => <SpriteSheet entity={entity} />,
  Tilemap: (entity) => <TilemapTools entity={entity} />,
};
import { Icon } from '../ui/Icon';
import { LiveEntityValues, PlayingHint, useLiveRefresh } from './inspector/LiveValues';

/** Hide fields that don't apply to the current choice (e.g. box size for a sphere collider). */
const FIELD_VISIBILITY: Record<string, Record<string, (d: Record<string, unknown>) => boolean>> = {
  // A picture or a plain shape: show what applies.
  Sprite: {
    color: (d) => !d.image,
    tint: (d) => !!d.image,
    tile: (d) => !!d.image,
    pixelArt: (d) => !!d.image,
  },
  // Blades or a grass model: show what applies.
  Grass: {
    density: (d) => !d.model,
    width: (d) => !d.model,
    height: (d) => !d.model,
    rootColor: (d) => !d.model,
    tipColor: (d) => !d.model,
    clumps: (d) => !!d.model,
    clumpHeight: (d) => !!d.model,
  },
  // A layer's color only tints layers without a material.
  Terrain: {
    layer1Color: (d) => !d.layer1Material,
    layer2Color: (d) => !d.layer2Material,
    layer3Color: (d) => !d.layer3Material,
    layer4Color: (d) => !d.layer4Material,
    layer5Color: (d) => !d.layer5Material,
    layer6Color: (d) => !d.layer6Material,
    layer7Color: (d) => !d.layer7Material,
    layer8Color: (d) => !d.layer8Material,
    layer1Size: (d) => !!d.layer1Material,
    layer2Size: (d) => !!d.layer2Material,
    layer3Size: (d) => !!d.layer3Material,
    layer4Size: (d) => !!d.layer4Material,
    layer5Size: (d) => !!d.layer5Material,
    layer6Size: (d) => !!d.layer6Material,
    layer7Size: (d) => !!d.layer7Material,
    layer8Size: (d) => !!d.layer8Material,
    // Set per layer in the Paint tool.
    layer1Steps: () => false,
    layer2Steps: () => false,
    layer3Steps: () => false,
    layer4Steps: () => false,
    layer5Steps: () => false,
    layer6Steps: () => false,
    layer7Steps: () => false,
    layer8Steps: () => false,
  },
  Camera: {
    fov: (d) => !d.orthographic,
    viewHeight: (d) => !!d.orthographic,
  },
  Collider: {
    size: (d) => d.shape === 'box',
    radius: (d) => ['sphere', 'capsule', 'cylinder'].includes(String(d.shape)),
    height: (d) => ['capsule', 'cylinder'].includes(String(d.shape)),
  },
  RigidBody: {
    mass: (d) => d.type === 'dynamic',
    gravityScale: (d) => d.type === 'dynamic',
    linearDamping: (d) => d.type === 'dynamic',
    angularDamping: (d) => d.type === 'dynamic',
    lockRotation: (d) => d.type === 'dynamic',
    continuousCollision: (d) => d.type === 'dynamic',
  },
  Sky: {
    dawnTop: (d) => !!d.customColors,
    dawnHorizon: (d) => !!d.customColors,
    dayTop: (d) => !!d.customColors,
    dayHorizon: (d) => !!d.customColors,
    sunsetTop: (d) => !!d.customColors,
    sunsetHorizon: (d) => !!d.customColors,
    nightTop: (d) => !!d.customColors,
    nightHorizon: (d) => !!d.customColors,
    skyLightIntensity: (d) => !!d.skyLighting,
    cloudSpeed: (d) => Number(d.clouds) > 0,
  },
  FollowCamera: {
    target: (d) => d.mode !== 'look-around',
    distance: (d) => d.mode === 'third-person' || d.mode === 'top-down' || d.mode === 'side-view',
    height: (d) => d.mode !== 'look-around',
    shoulder: (d) => d.mode === 'third-person',
    avoidWalls: (d) => d.mode === 'third-person',
    lockMouse: (d) => d.mode === 'third-person' || d.mode === 'first-person' || (d.mode === 'look-around' && !d.edgePan),
    sensitivity: (d) => d.mode !== 'top-down' && d.mode !== 'side-view',
    yawRange: (d) => d.mode === 'look-around',
    edgePan: (d) => d.mode === 'look-around',
    minPitch: (d) => d.mode !== 'top-down' && d.mode !== 'side-view',
    maxPitch: (d) => d.mode !== 'top-down' && d.mode !== 'side-view',
  },
  Light: {
    range: (d) => d.kind === 'point' || d.kind === 'spot',
    angle: (d) => d.kind === 'spot',
    groundColor: (d) => d.kind === 'hemisphere',
    castShadow: (d) => d.kind !== 'hemisphere' && d.kind !== 'ambient',
  },
};

function isFieldVisible(type: string, key: string, data: Record<string, unknown>): boolean {
  return FIELD_VISIBILITY[type]?.[key]?.(data) ?? true;
}

export function Inspector() {
  const entity = useSelectedEntity();
  useLiveRefresh(); // transforms moved by physics update the fields live
  const assetSelection = useEditor((s) => s.assetSelection);
  if (!entity) return assetSelection ? <AssetInspector assetId={assetSelection} /> : <SceneSettingsInspector />;
  return (
    <div className="inspector">
      <PlayingHint />
      <MultiSelectHint entity={entity} />
      <EntityHeader entity={entity} />
      <LiveEntityValues entity={entity} />
      {entity.componentTypes().map((type) => (
        <ComponentCard key={type} entity={entity} type={type} />
      ))}
      <AddComponentMenu entity={entity} />
    </div>
  );
}

/** With several objects selected, edits here apply to each one that has the same component. */
function MultiSelectHint({ entity }: { entity: Entity }) {
  const count = useEditor((s) => s.selected.length);
  const select = useEditor((s) => s.select);
  if (count < 2) return null;
  return (
    <div className="multi-hint">
      <Icon name="layers" size={13} />
      <span>
        {count} objects selected. Changing a value here changes it on all of them that have it. Showing <b>{entity.name}</b>.
      </span>
      <button className="small" onClick={() => select(entity.id)}>
        Only this
      </button>
    </div>
  );
}

/** Tags: scripts find objects by them (count('enemy'), closest('coin')); "interactable" lets E talk/use. */
function TagEditor({ entity }: { entity: Entity }) {
  const [adding, setAdding] = useState<string | null>(null);
  const tags = [...entity.tags];
  const commit = () => {
    if (adding?.trim()) setTags(entity.id, [...tags, adding]);
    setAdding(null);
  };
  return (
    <div className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
          <button className="tag-remove" title={`Remove tag "${t}"`} onClick={() => setTags(entity.id, tags.filter((x) => x !== t))}>
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      {adding === null ? (
        <button className="small tag-add" title="Tag this object so scripts can find it (enemy, coin, interactable…)" onClick={() => setAdding('')}>
          <Icon name="plus" size={10} />
          Tag
        </button>
      ) : (
        <input
          className="tag-input"
          autoFocus
          value={adding}
          placeholder="enemy, coin, interactable…"
          onChange={(e) => setAdding(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setAdding(null);
          }}
        />
      )}
    </div>
  );
}

function EntityHeader({ entity }: { entity: Entity }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="inspector-header">
      <input
        type="checkbox"
        title="Enabled"
        checked={entity.enabled}
        onChange={(e) => setEnabled(entity.id, e.target.checked)}
      />
      <input
        className="name-input"
        value={draft ?? entity.name}
        onFocus={() => setDraft(entity.name)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) rename(entity.id, draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(entity.name);
            e.currentTarget.blur();
          }
        }}
      />
      <TagEditor entity={entity} />
    </div>
  );
}

/** How to reach this component from a script: every field can be read and changed there. */
function CodePath({ entity, type, fields }: { entity: Entity; type: string; fields: string[] }) {
  if (type === 'Transform' || type === 'Script' || fields.length === 0) return null;
  const ref = /^[A-Za-z_][A-Za-z0-9_]*$/.test(entity.name) ? entity.name : `find('${entity.name.replace(/'/g, "\\'")}')`;
  const example = `${ref}.${type}.${fields[0]}`;
  return (
    <p className="component-code" title={`Any field works from a script, for example:\n{ set: "${example}", to: ... }\n\nFields: ${fields.join(', ')}`}>
      <Icon name="code" size={11} />
      In code: <code>{example}</code>
    </p>
  );
}

function ComponentCard({ entity, type }: { entity: Entity; type: string }) {
  const [open, setOpen] = useState(true);
  const def = getComponentDef(type);
  const data = entity.get(type) as Record<string, unknown> | undefined;
  if (!data) return null;

  return (
    <section className="component-card">
      <header className="component-header" onClick={() => setOpen((o) => !o)}>
        <span className="caret">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
        <Icon name={def?.icon ?? 'box'} className="component-icon" />
        <span className="component-title">{def?.label ?? type}</span>
        {!def?.required && (
          <button
            className="icon-btn"
            title={`Remove ${def?.label ?? type}`}
            onClick={(e) => {
              e.stopPropagation();
              removeComponent(entity, type);
            }}
          >
            <Icon name="x" />
          </button>
        )}
      </header>
      {open && (
        <div className="component-body">
          {def?.description && <p className="component-desc">{def.description}</p>}
          {def && <CodePath entity={entity} type={type} fields={Object.keys(def.fields)} />}
          {COMPONENT_PANELS[type]?.(entity)}
          {def ? (
            Object.entries(def.fields as Record<string, FieldSpec | undefined>).filter(([key]) => isFieldVisible(type, key, data)).map(([key, spec]) =>
              spec ? (
                <FieldEditor
                  key={key}
                  name={key}
                  spec={spec}
                  value={data[key]}
                  entity={entity}
                  data={data}
                  onChange={(v) => {
                    // A sprite's new picture keeps its own shape (same height).
                    if (type === 'Sprite' && key === 'image' && typeof v === 'string' && v) {
                      const height = (data.size as [number, number] | undefined)?.[1] ?? 1;
                      void spriteFitFor(v, height).then((fit) => editComponent(entity, type, { image: v, ...fit }, 'Set sprite picture'));
                    } else editComponent(entity, type, { [key]: v });
                  }}
                />
              ) : null,
            )
          ) : (
            <>
              <p className="component-desc">
                Unknown component — kept as-is so nothing is lost. It may come from a newer version.
              </p>
              <pre className="raw-json">{JSON.stringify(data, null, 2)}</pre>
            </>
          )}
          {COMPONENT_PANELS_AFTER[type]?.(entity)}
          {COMPONENT_ACTIONS[type] && (
            <div className="component-actions">
              {COMPONENT_ACTIONS[type].map((a) => (
                <button key={a.label} className="small" title={a.title} onClick={() => a.run(entity)}>
                  <Icon name={a.icon} size={12} />
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const CATEGORY_ICON: Record<ComponentCategory, string> = {
  Rendering: 'box',
  Environment: 'mountain',
  Camera: 'video',
  Physics: 'atom',
  Gameplay: 'script',
  UI: 'monitor',
  Audio: 'volume',
  Effects: 'sparkles',
};

/** Unity-style Add Component menu: categories you open, or search across everything. */
function AddComponentMenu({ entity }: { entity: Entity }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ComponentCategory | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const available = allComponentDefs().filter((d) => d.category && !entity.has(d));
  const q = query.trim().toLowerCase();
  const results = q
    ? available.filter((d) => `${d.label} ${d.description ?? ''} ${d.category}`.toLowerCase().includes(q))
    : category
      ? available.filter((d) => d.category === category)
      : [];
  const showCategories = !q && !category;

  const add = (type: string) => {
    addComponent(entity, type);
    setOpen(false);
    setQuery('');
    setCategory(null);
  };
  const reset = () => {
    setOpen((o) => !o);
    setQuery('');
    setCategory(null);
    setActive(0);
  };

  return (
    <div className="add-component" ref={ref}>
      <button className="wide" onClick={reset}>
        <Icon name="plus" size={12} />
        Add Component
      </button>
      {open && (
        <div className="dropdown ac-menu">
          <input
            autoFocus
            placeholder="Search components…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              const count = showCategories ? COMPONENT_CATEGORIES.length : results.length;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(count - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                if (showCategories) setCategory(COMPONENT_CATEGORIES[active] ?? null);
                else if (results[active]) add(results[active].type);
                setActive(0);
              } else if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'Backspace' && !query && category) setCategory(null);
            }}
          />
          {category && !q && (
            <button className="ac-row ac-back" onClick={() => setCategory(null)}>
              <Icon name="chevron-down" size={12} style={{ transform: 'rotate(90deg)' }} />
              <span className="ac-title">{category}</span>
            </button>
          )}
          <div className="ac-list">
            {showCategories &&
              COMPONENT_CATEGORIES.map((c, i) => {
                const n = available.filter((d) => d.category === c).length;
                return (
                  <button
                    key={c}
                    className={`ac-row ${i === active ? 'active-row' : ''}`}
                    disabled={n === 0}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      setCategory(c);
                      setActive(0);
                    }}
                  >
                    <Icon name={CATEGORY_ICON[c]} className="dropdown-icon" />
                    <span className="ac-title">{c}</span>
                    <span className="ac-count">{n}</span>
                    <Icon name="chevron-right" size={12} className="muted" />
                  </button>
                );
              })}
            {!showCategories && results.length === 0 && <div className="dropdown-empty">No components match.</div>}
            {!showCategories &&
              results.map((d, i) => (
                <button
                  key={d.type}
                  className={`ac-row ac-item ${i === active ? 'active-row' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(d.type)}
                >
                  <Icon name={d.icon} className="dropdown-icon" />
                  <span className="ac-text">
                    <span className="ac-title">
                      {d.label}
                      {q && <span className="ac-cat">{d.category}</span>}
                    </span>
                    {d.description && <small>{d.description}</small>}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
