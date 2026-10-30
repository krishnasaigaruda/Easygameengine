import { useState } from 'react';
import { MATERIAL_SHADERS, defaultMaterialData, type MaterialAssetData, type MaterialShader } from '@ege/runtime';
import { useLibrary, getAssetRecord, renameAsset, updateAssetData, CREDITS_FILE } from '../../assets/library';
import { CreditsEditor, OwnAssetCredit } from './CreditsEditor';
import { deleteAssetSafely, activateAsset, optimizeModelAsset } from '../../editor/assetActions';
import { BooleanField, ColorField, EnumField, NumberField, NumberInput } from './fields';
import { AssetPicker } from './assetFields';
import { TYPE_ICON, formatBytes } from '../ProjectPanel';
import { Icon } from '../../ui/Icon';
import { openAnimationStudio } from '../../rigging/AnimationStudio';
import { openRemoveBackground } from '../../assets/RemoveBackgroundDialog';
import { PROVIDERS } from '../../export/exportGame';

const LICENSE_NAMES: Record<string, string> = {
  'CC0-1.0': 'CC0 — public domain, no credit required',
  'CC-BY-4.0': 'CC BY 4.0 — free to use, credit the author',
};

/** Details of the asset selected in the Project panel; materials are editable here. */
export function AssetInspector({ assetId }: { assetId: string }) {
  const [optimizing, setOptimizing] = useState(false);
  const asset = useLibrary((s) => s.assets.find((a) => a.id === assetId));
  const [draft, setDraft] = useState<string | null>(null);
  if (!asset) return <p className="empty">This asset no longer exists.</p>;
  const record = getAssetRecord(assetId);

  return (
    <div className="inspector">
      <div className="inspector-header">
        <Icon name={TYPE_ICON[asset.type]} size={16} />
        <input
          className="name-input"
          value={draft ?? asset.name}
          onFocus={() => setDraft(asset.name)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null) void renameAsset(assetId, draft);
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>

      {asset.thumbnailUrl && <img className="asset-preview" src={asset.thumbnailUrl} alt="" />}

      <section className="component-card">
        <div className="component-body">
          <div className="kv"><span>Type</span><span>{asset.type}</span></div>
          <div className="kv"><span>Size</span><span>{formatBytes(asset.size)}</span></div>
          {asset.triangles !== undefined && (
            <div className="kv"><span>Triangles</span><span>{asset.triangles.toLocaleString()}</span></div>
          )}
          {record && record.main && (
            <div className="kv"><span>Files</span><span>{Object.keys(record.files).length}</span></div>
          )}
        </div>
      </section>

      {asset.type === 'texture' && (
        <div className="component-actions asset-tools">
          <button className="small" onClick={() => openRemoveBackground(assetId)} title="Make the background see-through (sprites, icons, decals)">
            <Icon name="eraser" size={12} />
            Remove background
          </button>
        </div>
      )}

      {asset.type === 'model' && (
        <section className="component-card">
          <header className="component-header">
            <Icon name="activity" className="component-icon" />
            <span className="component-title">Animations ({asset.animations.length})</span>
          </header>
          <div className="component-body">
            <div className="component-actions">
              <button className="small" onClick={() => openAnimationStudio({ assetId })} title="Give it a skeleton, pick free animations, make your own on a timeline, add code points">
                <Icon name="activity" size={12} />
                Animation Studio
              </button>
              <button
                className="small"
                disabled={optimizing}
                onClick={() => {
                  setOptimizing(true);
                  void optimizeModelAsset(assetId).finally(() => setOptimizing(false));
                }}
                title="Smaller file: repeated parts are kept once (copies just say where they go), pictures saved compactly"
              >
                <Icon name="zap" size={12} />
                {optimizing ? 'Optimizing…' : 'Optimize'}
              </button>
            </div>
            {asset.animations.length === 0 ? (
              <p className="component-desc">No animations in this model yet. The Animation Studio gives it a skeleton and free animations.</p>
            ) : (
              <>
                <p className="component-desc">Objects using this model play these with an Animator (idle / walk / run by themselves), or pick one in the Model component's Animation field.</p>
                <ul className="clip-list">
                  {asset.animations.map((a) => (
                    <li key={a}>
                      <Icon name="play" size={10} />
                      {a}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}

      {asset.type === 'material' && record && <MaterialEditor assetId={assetId} data={record.data} />}

      {asset.type === 'data' && asset.name === CREDITS_FILE && <CreditsEditor />}
      {asset.type !== 'data' && asset.type !== 'script' && asset.type !== 'material' && (!asset.credit || asset.credit.provider === 'user') && (
        <OwnAssetCredit key={assetId} assetId={assetId} credit={asset.credit} />
      )}

      {asset.credit && asset.credit.provider !== 'user' && (
        <section className="component-card">
          <header className="component-header">
            <Icon name="file" className="component-icon" />
            <span className="component-title">Credits & License</span>
          </header>
          <div className="component-body">
            <div className="kv"><span>Author</span><span>{asset.credit.author}</span></div>
            <div className="kv"><span>Source</span><span>{PROVIDERS[asset.credit.provider] ?? asset.credit.provider}</span></div>
            <p className="component-desc">{LICENSE_NAMES[asset.credit.license ?? ''] ?? asset.credit.license}</p>
            {asset.credit.url && (
              <a href={asset.credit.url} target="_blank" rel="noreferrer">
                <Icon name="link" size={12} />
                View original
              </a>
            )}
          </div>
        </section>
      )}

      <div className="asset-actions">
        {asset.type !== 'data' && (
          <button className="primary" onClick={() => void activateAsset(assetId)}>
            <Icon name={asset.type === 'model' ? 'plus' : asset.type === 'hdri' ? 'sunrise' : 'check'} size={13} />
            {asset.type === 'model' ? 'Add to scene' : asset.type === 'hdri' ? 'Use as sky' : 'Use'}
          </button>
        )}
        <button onClick={() => void deleteAssetSafely(assetId)}>
          <Icon name="trash" size={13} />
          Delete
        </button>
      </div>
    </div>
  );
}

const SHADER_HELP: Record<MaterialShader, string> = {
  standard: 'Realistic surface (PBR). Use texture maps from the Asset Store, or just a color.',
  water: 'Animated water that reflects the sky. Put it on a plane or a flat box.',
  lava: 'Glowing, slowly flowing lava. Add Post Processing (bloom) for extra glow.',
  glass: 'See-through glass that bends what is behind it.',
  ice: 'Frosty, slightly see-through ice with cracks.',
  toon: 'Cartoon look with hard light bands.',
  unlit: 'Flat color, no lighting or shadows (stylized and 2D looks).',
  hologram: 'Glowing sci-fi projection with moving scanlines.',
  forcefield: 'Glowing shield bubble with a pulsing grid.',
};

const materialData = (data: unknown): MaterialAssetData => ({
  ...defaultMaterialData(),
  ...(data as Partial<MaterialAssetData>),
});

function MaterialEditor({ assetId, data }: { assetId: string; data: unknown }) {
  const d = materialData(data);
  // Always build on the latest saved data, not this render's copy: two quick edits in a row
  // (e.g. tiling X then Y) must not overwrite each other.
  const set = (patch: Partial<MaterialAssetData> | ((cur: MaterialAssetData) => Partial<MaterialAssetData>)) => {
    const cur = materialData(getAssetRecord(assetId)?.data);
    void updateAssetData(assetId, { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) });
  };
  return (
    <section className="component-card">
      <header className="component-header">
        <Icon name="palette" className="component-icon" />
        <span className="component-title">Material</span>
      </header>
      <div className="component-body">
        <p className="component-desc">Changes apply to every object using this material.</p>
        <EnumField label="Shader" value={d.shader} options={MATERIAL_SHADERS} onChange={(shader) => set({ shader: shader as MaterialShader })} />
        <p className="component-desc">{SHADER_HELP[d.shader]}</p>
        {d.shader === 'water' && (
          <>
            <ColorField label="Shallow color" value={d.color} onChange={(color) => set({ color })} />
            <ColorField label="Deep color" value={d.color2} onChange={(color2) => set({ color2 })} />
            <NumberField label="Wave size (m)" spec={{ kind: 'number', min: 0.2, max: 50, step: 0.1 }} value={d.patternScale} onChange={(patternScale) => set({ patternScale })} />
            <NumberField label="Wave strength" spec={{ kind: 'number', min: 0, max: 4, step: 0.05 }} value={d.strength} onChange={(strength) => set({ strength })} />
            <NumberField label="Wave speed" spec={{ kind: 'number', min: 0, max: 5, step: 0.05 }} value={d.speed} onChange={(speed) => set({ speed })} />
            <NumberField label="Clarity" spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }} value={d.opacity} onChange={(opacity) => set({ opacity })} />
            <NumberField label="Roughness" spec={{ kind: 'number', min: 0, max: 0.3, step: 0.01 }} value={d.roughness} onChange={(roughness) => set({ roughness })} />
            <AssetPicker label="Wave texture" type="texture" value={d.normalMap} onChange={(normalMap) => set({ normalMap })} />
          </>
        )}
        {d.shader === 'lava' && (
          <>
            <ColorField label="Hot color" value={d.color} onChange={(color) => set({ color })} />
            <ColorField label="Crust color" value={d.color2} onChange={(color2) => set({ color2 })} />
            <NumberField label="Glow" spec={{ kind: 'number', min: 0, max: 5, step: 0.05 }} value={d.emissiveStrength} onChange={(emissiveStrength) => set({ emissiveStrength })} />
            <NumberField label="Cell size (m)" spec={{ kind: 'number', min: 0.2, max: 30, step: 0.1 }} value={d.patternScale} onChange={(patternScale) => set({ patternScale })} />
            <NumberField label="Flow speed" spec={{ kind: 'number', min: 0, max: 5, step: 0.05 }} value={d.speed} onChange={(speed) => set({ speed })} />
            <NumberField label="Bumps" spec={{ kind: 'number', min: 0, max: 4, step: 0.05 }} value={d.strength} onChange={(strength) => set({ strength })} />
          </>
        )}
        {(d.shader === 'glass' || d.shader === 'ice') && (
          <>
            <ColorField label="Tint" value={d.color} onChange={(color) => set({ color })} />
            <NumberField label="Frost (blur)" spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }} value={d.roughness} onChange={(roughness) => set({ roughness })} />
            <NumberField label="Thickness / cracks" spec={{ kind: 'number', min: 0, max: 4, step: 0.05 }} value={d.strength} onChange={(strength) => set({ strength })} />
            {d.shader === 'ice' && <NumberField label="Crack size (m)" spec={{ kind: 'number', min: 0.1, max: 20, step: 0.1 }} value={d.patternScale} onChange={(patternScale) => set({ patternScale })} />}
          </>
        )}
        {(d.shader === 'hologram' || d.shader === 'forcefield') && (
          <>
            <ColorField label="Color" value={d.color} onChange={(color) => set({ color })} />
            <NumberField label="Brightness" spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }} value={d.opacity} onChange={(opacity) => set({ opacity })} />
            <NumberField label="Effect" spec={{ kind: 'number', min: 0, max: 3, step: 0.05 }} value={d.strength} onChange={(strength) => set({ strength })} />
            <NumberField label="Pattern size" spec={{ kind: 'number', min: 0.1, max: 20, step: 0.1 }} value={d.patternScale} onChange={(patternScale) => set({ patternScale })} />
            <NumberField label="Speed" spec={{ kind: 'number', min: 0, max: 5, step: 0.05 }} value={d.speed} onChange={(speed) => set({ speed })} />
          </>
        )}
        {d.shader === 'toon' && (
          <>
            <ColorField label="Color" value={d.color} onChange={(color) => set({ color })} />
            <NumberField label="Light bands" spec={{ kind: 'number', min: 2, max: 8, step: 1 }} value={d.toonSteps} onChange={(toonSteps) => set({ toonSteps })} />
            <AssetPicker label="Color map" type="texture" value={d.map} onChange={(map) => set({ map })} />
          </>
        )}
        {d.shader === 'unlit' && (
          <>
            <ColorField label="Color" value={d.color} onChange={(color) => set({ color })} />
            <NumberField label="Opacity" spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }} value={d.opacity} onChange={(opacity) => set({ opacity })} />
            <AssetPicker label="Color map" type="texture" value={d.map} onChange={(map) => set({ map })} />
          </>
        )}
        {(d.shader === 'standard' || d.shader === 'toon' || d.shader === 'unlit') && (
          <div className="field">
            <label className="field-label">Tiling</label>
            <div className="field-control vec2">
              <NumberInput scrubLabel="X" step={0.1} min={0.01} value={d.tiling[0]} onChange={(x) => set((c) => ({ tiling: [x, c.tiling[1]] }))} />
              <NumberInput scrubLabel="Y" step={0.1} min={0.01} value={d.tiling[1]} onChange={(y) => set((c) => ({ tiling: [c.tiling[0], y] }))} />
            </div>
          </div>
        )}
        {d.shader === 'standard' && (
          <>
            <ColorField label="Tint" value={d.color} onChange={(color) => set({ color })} />
            <NumberField label="Roughness" spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }} value={d.roughness} onChange={(roughness) => set({ roughness })} />
            <NumberField label="Metalness" spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }} value={d.metalness} onChange={(metalness) => set({ metalness })} />
            <NumberField label="Bumpiness" spec={{ kind: 'number', min: 0, max: 3, step: 0.05 }} value={d.normalScale} onChange={(normalScale) => set({ normalScale })} />
            <NumberField label="Opacity" spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }} value={d.opacity} onChange={(opacity) => set({ opacity })} />
            <ColorField label="Glow color" value={d.emissive} onChange={(emissive) => set({ emissive })} />
            <NumberField label="Glow strength" spec={{ kind: 'number', min: 0, max: 20, step: 0.1 }} value={d.emissiveStrength} onChange={(emissiveStrength) => set({ emissiveStrength })} />
            <BooleanField label="Low-poly look" value={d.flatShading} onChange={(flatShading) => set({ flatShading })} />
            <AssetPicker label="Color map" type="texture" value={d.map} onChange={(map) => set({ map })} />
            <AssetPicker label="Normal map" type="texture" value={d.normalMap} onChange={(normalMap) => set({ normalMap })} />
            <AssetPicker label="Roughness map" type="texture" value={d.roughnessMap} onChange={(roughnessMap) => set({ roughnessMap })} />
            <AssetPicker label="Metal map" type="texture" value={d.metalnessMap} onChange={(metalnessMap) => set({ metalnessMap })} />
            <AssetPicker label="AO map" type="texture" value={d.aoMap} onChange={(aoMap) => set({ aoMap })} />
            <AssetPicker label="Height map" type="texture" value={d.heightMap ?? ''} onChange={(heightMap) => set({ heightMap })} />
          </>
        )}
        <BooleanField label="Both sides" value={d.doubleSided} onChange={(doubleSided) => set({ doubleSided })} />
      </div>
    </section>
  );
}
