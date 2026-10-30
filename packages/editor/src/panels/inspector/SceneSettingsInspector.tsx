import type { SceneSettings } from '@ege/runtime';
import { useEditor } from '../../state/editorStore';
import { editSceneSettings } from '../../editor/assetActions';
import { BooleanField, ColorField, NumberField } from './fields';
import { AssetPicker } from './assetFields';
import { Icon } from '../../ui/Icon';
import { LiveGameValues } from './LiveValues';
import { createObject, type CreatePreset } from '../../editor/actions';

const ENV_ITEMS: { type: string; preset: CreatePreset; label: string; icon: string; hint: string }[] = [
  { type: 'Terrain', preset: 'terrain', label: 'Terrain', icon: 'mountain', hint: 'Hills and mountains you can sculpt and paint' },
  { type: 'Sky', preset: 'sky', label: 'Sky', icon: 'sun', hint: 'Realistic sky with a fixed time of day' },
  { type: 'DayNightCycle', preset: 'dayNight', label: 'Day/Night Cycle', icon: 'sunrise', hint: 'Moves the Sky\'s time while playing' },
  { type: 'Fog', preset: 'fog', label: 'Fog', icon: 'cloud-fog', hint: 'Mist that fades distant things' },
  { type: 'PostProcessing', preset: 'postProcessing', label: 'Post Processing', icon: 'wand', hint: 'Glow, color grading, vignette' },
];

/** Shown when nothing is selected: sky, lighting and fog for the whole scene. */
export function SceneSettingsInspector() {
  const engine = useEditor((s) => s.engine);
  const select = useEditor((s) => s.select);
  useEditor((s) => s.revision);
  if (!engine) return null;
  const s = engine.settings;
  const env = s.environment;
  const fog = s.fog;
  const setEnv = (patch: Partial<SceneSettings['environment']>) =>
    editSceneSettings({ environment: { ...env, ...patch } }, 'Edit sky');
  const setFog = (patch: Partial<SceneSettings['fog']>) => editSceneSettings({ fog: { ...fog, ...patch } }, 'Edit fog');

  return (
    <div className="inspector">
      <div className="inspector-header">
        <span className="scene-title">
          <Icon name="globe" size={15} />
          {engine.sceneName}
        </span>
        <p className="component-desc" style={{ width: '100%' }}>
          Scene settings. Select an object to edit it instead.
        </p>
      </div>

      <LiveGameValues />

      <section className="component-card">
        <header className="component-header">
          <Icon name="sunrise" className="component-icon" />
          <span className="component-title">Sky & Lighting</span>
        </header>
        <div className="component-body">
          <p className="component-desc">
            An HDRI sky lights everything realistically. Get one from the Asset Store, Skies tab.
          </p>
          <AssetPicker label="Sky (HDRI)" type="hdri" value={env.asset} onChange={(asset) => setEnv({ asset })} />
          <NumberField
            label="Sky brightness"
            spec={{ kind: 'number', min: 0, max: 5, step: 0.05 }}
            value={env.intensity}
            onChange={(intensity) => setEnv({ intensity })}
          />
          <BooleanField label="Show sky" value={env.showAsBackground} onChange={(showAsBackground) => setEnv({ showAsBackground })} />
          <NumberField
            label="Sky blur"
            spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }}
            value={env.blur}
            onChange={(blur) => setEnv({ blur })}
          />
          <NumberField
            label="Exposure"
            spec={{ kind: 'number', min: 0.1, max: 4, step: 0.05 }}
            value={s.exposure}
            onChange={(exposure) => editSceneSettings({ exposure }, 'Edit exposure')}
          />
          <ColorField
            label="Background"
            value={s.background}
            onChange={(background) => editSceneSettings({ background }, 'Edit background')}
          />
          <BooleanField
            label="Touch controls"
            value={s.touchControls !== false}
            onChange={(touchControls) => editSceneSettings({ touchControls }, 'Touch controls')}
          />
          {s.dimension === '2d' && (
            <>
              <NumberField
                label="Pixels per meter"
                spec={{ kind: 'number', min: 1, max: 512, step: 1 }}
                value={s.pixelsPerUnit ?? 16}
                onChange={(pixelsPerUnit) => editSceneSettings({ pixelsPerUnit }, 'Pixels per meter')}
              />
              <BooleanField
                label="Pixel perfect"
                value={!!s.pixelPerfect}
                onChange={(pixelPerfect) => editSceneSettings({ pixelPerfect }, 'Pixel perfect')}
              />
              <NumberField
                label="Darkness (2D lights)"
                spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }}
                value={s.darkness2D ?? 0}
                onChange={(darkness2D) => editSceneSettings({ darkness2D }, 'Darkness')}
              />
            </>
          )}
        </div>
      </section>

      <section className="component-card">
        <header className="component-header">
          <Icon name="mountain" className="component-icon" />
          <span className="component-title">Environment</span>
        </header>
        <div className="component-body">
          <p className="component-desc">
            All optional. Add only what your game needs; each becomes an object you can edit or delete.
          </p>
          <div className="env-grid">
            {ENV_ITEMS.map((it) => {
              const existing = [...engine.world.query(it.type)][0];
              return (
                <button
                  key={it.type}
                  className={`small env-btn ${existing ? 'active' : ''}`}
                  title={existing ? `Select ${existing.name}` : it.hint}
                  onClick={() => (existing ? select(existing.id) : createObject(it.preset))}
                >
                  <Icon name={it.icon} size={13} />
                  {existing ? it.label : `Add ${it.label}`}
                </button>
              );
            })}
          </div>
          {fog.enabled && (
            <div className="legacy-fog">
              <BooleanField label="Legacy fog" value={fog.enabled} onChange={(enabled) => setFog({ enabled })} />
              <p className="component-desc">This older scene has scene-wide fog. Turn it off, or add a Fog object for more control.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
