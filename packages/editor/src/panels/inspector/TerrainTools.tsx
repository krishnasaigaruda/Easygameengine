import { useState } from 'react';
import {
  Grass,
  PRESET_LOOK,
  Scatter,
  TERRAIN_PRESETS,
  Terrain,
  encodeHeights,
  generateHeightmap,
  heightmapFromPixels,
  type Entity,
  type ScatterData,
  type TerrainData,
  type TerrainPreset,
} from '@ege/runtime';
import { editComponent, removeComponent, rename, runCommand } from '../../editor/actions';
import { useTerrainBrush, type TerrainTool } from '../../editor/terrainBrush';
import { useEditor } from '../../state/editorStore';
import { CreateEntityCommand } from '../../commands/commands';
import { Icon } from '../../ui/Icon';
import { ColorField, EnumField, NumberField } from './fields';
import { AssetPicker } from './assetFields';
import { assetSummary } from '../../assets/library';
import { newId as THREE_ID } from '@ege/runtime';

const PRESET_LABEL: Record<TerrainPreset, string> = {
  flat: 'Flat',
  hills: 'Rolling hills',
  mountains: 'Mountains',
  valley: 'Mountain valley',
  island: 'Island',
  plateaus: 'Plateaus (canyons)',
  image: 'From an image (heightmap)…',
};

/** Pick a picture and read it as a heightmap (bright = high). */
function pickHeightmap(resolution: number): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const bmp = await createImageBitmap(file);
        const side = Math.min(1024, Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = c.height = side;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0, side, side);
        bmp.close();
        resolve(encodeHeights(heightmapFromPixels(ctx.getImageData(0, 0, side, side).data, side, resolution)));
      } catch {
        useEditor.getState().log('warn', `"${file.name}" couldn't be read as a picture.`);
        resolve(null);
      }
    };
    input.click();
  });
}

const SCULPT = [
  { brush: 'raise', label: 'Raise', icon: 'upload-from', hint: 'Hold to build up hills' },
  { brush: 'lower', label: 'Lower', icon: 'download', hint: 'Hold to dig' },
  { brush: 'smooth', label: 'Smooth', icon: 'waves', hint: 'Soften bumps' },
  { brush: 'flatten', label: 'Flatten', icon: 'minus', hint: 'Level to the height where you start' },
] as const;

const PAINT = [
  { brush: 'paint', label: 'Texture', icon: 'palette', hint: 'Paint ground layers (paths, rock, snow)' },
  { brush: 'grass', label: 'Grass', icon: 'sprout', hint: 'Paint grass (Shift erases)' },
  { brush: 'plants', label: 'Plants', icon: 'trees', hint: 'Paint flowers, bushes, rocks or any model (Shift erases)' },
] as const;

/** Plant types you can add and paint. */
const PLANT_TYPES: { label: string; shape: ScatterData['shape']; color: string; density: number; minScale: number; maxScale: number }[] = [
  { label: 'Flowers', shape: 'flowers', color: '#3f6b2a', density: 3, minScale: 0.7, maxScale: 1.3 },
  { label: 'Grass clumps', shape: 'grass clump', color: '#6f9a3a', density: 4, minScale: 0.7, maxScale: 1.4 },
  { label: 'Ferns', shape: 'fern', color: '#3f7a32', density: 1.2, minScale: 0.6, maxScale: 1.3 },
  { label: 'Bushes', shape: 'bush', color: '#3c6b2c', density: 0.25, minScale: 0.6, maxScale: 1.4 },
  { label: 'Fallen leaves', shape: 'fallen leaves', color: '#8a5a2b', density: 1.5, minScale: 0.7, maxScale: 1.4 },
  { label: 'Pebbles', shape: 'pebbles', color: '#8b877f', density: 1, minScale: 0.6, maxScale: 1.6 },
  { label: 'Rocks', shape: 'rock', color: '#7b7b78', density: 0.15, minScale: 0.4, maxScale: 1.8 },
  { label: 'Pine trees', shape: 'pine tree', color: '#2f5d2a', density: 0.04, minScale: 0.8, maxScale: 1.6 },
  { label: 'Round trees', shape: 'round tree', color: '#4a7a2e', density: 0.03, minScale: 0.8, maxScale: 1.5 },
  { label: 'Your own model', shape: 'model', color: '#ffffff', density: 0.2, minScale: 0.8, maxScale: 1.2 },
  { label: 'Grass model', shape: 'model', color: '#ffffff', density: 4, minScale: 0.8, maxScale: 1.25 },
];

/** Paint layers; a layer with a material is called by the material's name. */
const LAYERS = ['Base', 'Layer 2', 'Layer 3 (slopes)', 'Layer 4 (peaks)', 'Layer 5', 'Layer 6', 'Layer 7', 'Layer 8'] as const;

/** Shape the landscape (it updates as you change it), then sculpt and paint in the viewport. */
export function TerrainTools({ entity }: { entity: Entity }) {
  const d = entity.require(Terrain);
  useEditor((s) => s.revision);
  const brush = useTerrainBrush();
  const set = useTerrainBrush.setState;
  const [plantMenu, setPlantMenu] = useState(false);

  const fromImage = async () => {
    const heights = await pickHeightmap(Math.round(d.resolution));
    if (heights) editComponent(entity, Terrain.type, { preset: 'image', ...PRESET_LOOK.image, heights }, 'Terrain from image');
  };

  const shape = (patch: Partial<TerrainData>, label: string) => {
    if (patch.preset === 'image') return void fromImage();
    const next = { ...d, ...patch };
    // An imported shape stays as it is when other settings change.
    if (next.preset === 'image') return editComponent(entity, Terrain.type, patch, label);
    const res = Math.round(next.resolution);
    const heights = next.preset === 'flat' ? '' : encodeHeights(generateHeightmap(res, { preset: next.preset, seed: next.seed, roughness: next.roughness, scale: next.features }));
    const look = patch.preset ? PRESET_LOOK[next.preset] : {};
    editComponent(entity, Terrain.type, { ...patch, ...look, heights }, label);
  };

  const plants = entity.children.filter((c) => c.get(Scatter)?.placement === 'painted');
  const plant = plants.find((p) => p.id === brush.plant) ?? null;
  const pd = plant?.get(Scatter);

  const addPlant = (t: (typeof PLANT_TYPES)[number]) => {
    setPlantMenu(false);
    const id = THREE_ID();
    runCommand(
      new CreateEntityCommand(
        {
          id,
          name: t.label,
          components: {
            Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            Scatter: { ...Scatter.defaults(), shape: t.shape, color: t.color, density: t.density, minScale: t.minScale, maxScale: t.maxScale, placement: 'painted', maxHeight: 1, solid: t.shape === 'rock' || t.shape.includes('tree') },
          },
        },
        entity.id,
        undefined,
        `Add ${t.label}`,
      ),
    );
    useEditor.getState().select(entity.id); // stay on the terrain to paint
    set({ brush: 'plants', plant: id });
  };

  const toolButton = (b: { brush: string; label: string; icon: string; hint: string }) => (
    <button key={b.brush} className={`small ${brush.brush === b.brush ? 'active' : ''}`} title={b.hint} onClick={() => set({ brush: brush.brush === b.brush ? null : (b.brush as TerrainTool) })}>
      <Icon name={b.icon} size={12} />
      {b.label}
    </button>
  );

  return (
    <div className="terrain-tools">
      <div className="tool-title">Shape</div>
      <EnumField label="Landscape" options={TERRAIN_PRESETS.map((p) => PRESET_LABEL[p])} value={PRESET_LABEL[d.preset ?? 'flat']} onChange={(label) => shape({ preset: TERRAIN_PRESETS.find((p) => PRESET_LABEL[p] === label) ?? 'flat' }, 'Change landscape')} />
      {d.preset === 'image' && (
        <div className="component-actions">
          <button className="small" onClick={() => void fromImage()} title="A grey picture: white is the highest ground, black the lowest">
            <Icon name="image" size={12} />
            Pick another image
          </button>
        </div>
      )}
      {d.preset !== 'flat' && d.preset !== 'image' && (
        <>
          <NumberField label="Bumpiness" spec={{ kind: 'number', min: 0, max: 1, step: 0.01 }} value={d.roughness} onChange={(roughness) => shape({ roughness }, 'Bumpiness')} />
          <NumberField label="Features across" spec={{ kind: 'number', min: 1, max: 16, step: 0.5 }} value={d.features} onChange={(features) => shape({ features }, 'Features')} />
          <div className="component-actions">
            <button className="small" onClick={() => shape({ seed: Math.floor(Math.random() * 100000) }, 'New random landscape')} title="Same kind of landscape, different shape">
              <Icon name="shuffle" size={12} />
              New random
            </button>
          </div>
        </>
      )}

      <div className="tool-title">Sculpt</div>
      <div className="brush-grid">{SCULPT.map(toolButton)}</div>
      <div className="tool-title">Paint</div>
      <div className="brush-grid">{PAINT.map(toolButton)}</div>

      {brush.brush === 'paint' && (
        <>
          <div className="layer-row">
            {LAYERS.map((l, i) => {
              const mat = d[`layer${i + 1}Material` as 'layer1Material'];
              const name = (mat && assetSummary(mat)?.name) || l;
              return (
                <button key={l} className={`small layer-chip ${brush.layer === i ? 'active' : ''}`} onClick={() => set({ layer: i })} title={`Paint ${name}`}>
                  <span className="swatch" style={{ background: mat ? '#9a9a9a' : d[`layer${i + 1}Color` as 'layer1Color'] }} />
                  {name}
                </button>
              );
            })}
          </div>
          <AssetPicker label={`${LAYERS[brush.layer]} texture`} type="material" value={d[`layer${brush.layer + 1}Material` as 'layer1Material']} onChange={(id) => editComponent(entity, Terrain.type, { [`layer${brush.layer + 1}Material`]: id })} />
          {d[`layer${brush.layer + 1}Material` as 'layer1Material'] && (
            <NumberField
              label="Texture size (m, 0 = default)"
              spec={{ kind: 'number', min: 0, max: 100, step: 0.25 }}
              value={(d as unknown as Record<string, number>)[`layer${brush.layer + 1}Size`] ?? 0}
              onChange={(v) => editComponent(entity, Terrain.type, { [`layer${brush.layer + 1}Size`]: v })}
            />
          )}
          <AssetPicker
            label="Footsteps on it"
            type="audio"
            value={(d as unknown as Record<string, string>)[`layer${brush.layer + 1}Steps`] ?? ''}
            onChange={(id) => editComponent(entity, Terrain.type, { [`layer${brush.layer + 1}Steps`]: id })}
          />
          <NumberField label="Breakup (patches)" spec={{ kind: 'number', min: 0, max: 1, step: 0.05 }} value={brush.breakup} onChange={(breakup) => set({ breakup })} />
          {brush.breakup > 0 && <NumberField label="Patch size (m)" spec={{ kind: 'number', min: 0.3, max: 20, step: 0.1 }} value={brush.patchSize} onChange={(patchSize) => set({ patchSize })} />}
          <p className="component-desc">Tip: paint a few textures over each other with Breakup up (gravel over dirt over dust) for ground that looks real.</p>
          {!d[`layer${brush.layer + 1}Material` as 'layer1Material'] && <ColorField label={`${LAYERS[brush.layer]} color`} value={d[`layer${brush.layer + 1}Color` as 'layer1Color']} onChange={(c) => editComponent(entity, Terrain.type, { [`layer${brush.layer + 1}Color`]: c })} />}
        </>
      )}

      {brush.brush === 'grass' && (
        <>
          {entity.has(Grass) ? (
            <>
              <AssetPicker label="Grass model (empty = blades)" type="model" value={entity.require(Grass).model ?? ''} onChange={(model) => editComponent(entity, Grass.type, { model })} />
              {entity.require(Grass).model ? (
                <>
                  <NumberField label="Clumps per m²" spec={{ kind: 'number', min: 0.1, max: 40, step: 0.1 }} value={entity.require(Grass).clumps} onChange={(clumps) => editComponent(entity, Grass.type, { clumps })} />
                  <NumberField label="Clump height (m)" spec={{ kind: 'number', min: 0.05, max: 5, step: 0.05 }} value={entity.require(Grass).clumpHeight} onChange={(clumpHeight) => editComponent(entity, Grass.type, { clumpHeight })} />
                </>
              ) : (
                <>
                  <ColorField label="Grass root" value={entity.require(Grass).rootColor} onChange={(rootColor) => editComponent(entity, Grass.type, { rootColor })} />
                  <ColorField label="Grass tip" value={entity.require(Grass).tipColor} onChange={(tipColor) => editComponent(entity, Grass.type, { tipColor })} />
                  <NumberField label="Grass height" spec={{ kind: 'number', min: 0.05, max: 3, step: 0.01 }} value={entity.require(Grass).height} onChange={(height) => editComponent(entity, Grass.type, { height })} />
                </>
              )}
              <div className="component-actions">
                <button className="small" onClick={() => removeComponent(entity, Grass.type)}>
                  <Icon name="trash" size={12} />
                  Remove all grass
                </button>
              </div>
            </>
          ) : (
            <p className="component-desc">Paint in the viewport to grow grass.</p>
          )}
          <div className="component-actions">
            <button
              className="small"
              title="Paint copies of a grass model from the Asset Store or your files instead of the built-in blades"
              onClick={() => addPlant(PLANT_TYPES.find((t) => t.label === 'Grass model')!)}
            >
              <Icon name="box" size={12} />
              Use a 3D grass model
            </button>
          </div>
        </>
      )}

      {brush.brush === 'plants' && (
        <>
          <div className="layer-row">
            {plants.map((p) => (
              <button key={p.id} className={`small layer-chip ${brush.plant === p.id ? 'active' : ''}`} onClick={() => set({ plant: p.id })}>
                <Icon name="sprout" size={12} />
                {p.name}
              </button>
            ))}
            <button className="small" onClick={() => setPlantMenu((v) => !v)}>
              <Icon name="plus" size={12} />
              Add plant type
            </button>
          </div>
          {plantMenu && (
            <div className="plant-menu">
              {PLANT_TYPES.map((t) => (
                <button key={t.label} className="small" onClick={() => addPlant(t)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {plant && pd && (
            <>
              {pd.shape === 'model' && (
                <>
                  <AssetPicker
                    label="Model"
                    type="model"
                    value={pd.model}
                    onChange={(model) => {
                      editComponent(plant, Scatter.type, { model });
                      // Still called after the menu item: name it after the model instead.
                      const name = assetSummary(model)?.name;
                      if (name && PLANT_TYPES.some((t) => t.label === plant.name)) rename(plant.id, name);
                    }}
                  />
                  {!pd.model && <p className="component-desc">Pick a model (download grass, flowers or rocks from the Asset Store), then paint it.</p>}
                  <NumberField label="Fit to height (m, 0 = own size)" spec={{ kind: 'number', min: 0, max: 60, step: 0.05 }} value={pd.fitHeight} onChange={(fitHeight) => editComponent(plant, Scatter.type, { fitHeight })} />
                </>
              )}
              {pd.shape !== 'model' && <ColorField label="Color" value={pd.color} onChange={(color) => editComponent(plant, Scatter.type, { color })} />}
              <NumberField label="Per m²" spec={{ kind: 'number', min: 0.01, max: 30, step: 0.01 }} value={pd.density} onChange={(density) => editComponent(plant, Scatter.type, { density })} />
              <NumberField label="Smallest" spec={{ kind: 'number', min: 0.05, max: 20, step: 0.05 }} value={pd.minScale} onChange={(minScale) => editComponent(plant, Scatter.type, { minScale })} />
              <NumberField label="Largest" spec={{ kind: 'number', min: 0.05, max: 20, step: 0.05 }} value={pd.maxScale} onChange={(maxScale) => editComponent(plant, Scatter.type, { maxScale })} />
              <NumberField label="Seen up to (m)" spec={{ kind: 'number', min: 10, max: 1000, step: 5 }} value={pd.drawDistance} onChange={(drawDistance) => editComponent(plant, Scatter.type, { drawDistance })} />
            </>
          )}
          {!plants.length && <p className="component-desc">Add a plant type (flowers, rocks, trees or your own model), then paint it.</p>}
        </>
      )}

      {brush.brush && (
        <>
          <NumberField label="Brush size (m)" spec={{ kind: 'number', min: 0.5, max: 100, step: 0.5 }} value={brush.size} onChange={(size) => set({ size })} />
          <NumberField label="Strength" spec={{ kind: 'number', min: 0.01, max: 1, step: 0.01 }} value={brush.strength} onChange={(strength) => set({ strength })} />
          <p className="component-desc">
            Drag on the terrain. {brush.brush === 'grass' || brush.brush === 'plants' ? 'Hold Shift to erase. ' : ''}Right-drag looks around. Esc or the tool button stops.
          </p>
        </>
      )}
    </div>
  );
}

