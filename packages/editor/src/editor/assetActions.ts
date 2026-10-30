import {
  BUILTIN_MATERIALS,
  MeshRenderer,
  ModelRenderer,
  newId,
  optimizedGlb,
  partBounds,
  THREE,
  type EntityData,
  type SceneSettings,
  type SpriteAnimation,
  type Vec3,
} from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { CreateEntityCommand, SetSceneSettingsCommand } from '../commands/commands';
import { assetSummary, createMaterial, getAssetRecord, removeAsset, assetUsage, useLibrary } from '../assets/library';
import { importFiles } from '../assets/importActions';
import { classifyTextureName } from '../assets/importer';
import { detectGrid } from '../assets/spriteSheet';
import { createObjectWith, editComponent, runCommand, uniqueName } from './actions';
import { viewportController } from '../viewport/viewportRef';
import { openScriptEditor } from '../scripting/scriptEditorState';
import { startsFolded } from '../panels/hierarchyFold';

const state = () => useEditor.getState();

/** Biggest side a freshly placed model gets, in meters. Store models come in any scale. */
const TARGET_SIZE = 2;
/** Don't touch models that are already a sensible size (a house can be 30 m, a castle 100 m). */
const SENSIBLE = { min: 0.2, max: 150 };

/**
 * Adds a model to the scene: fits it to a sensible size and stands it on the ground at `at`
 * (default: where the camera is looking). A pack (a file holding several models) comes in as a
 * group with each model as its own object inside, where it sat in the file.
 */
export async function placeModel(assetId: string, at?: Vec3, part?: string): Promise<string | null> {
  const { engine, history, select, log } = state();
  const summary = assetSummary(assetId);
  if (!engine || !history || !summary) return null;
  const spawn = at ?? viewportController()?.spawnPoint() ?? [0, 0, 0];
  // One model out of a pack: it's shown standing on its own origin.
  const piece = part ? summary.parts?.find((p) => p.path === part) : undefined;
  const name = piece?.name ?? summary.name;

  const round = (v: number) => Math.round(v * 1000) / 1000;
  let scale = 1;
  let lift = 0;
  let children: EntityData[] | undefined;
  try {
    const model = await engine.assets.loadModel(assetId);
    if (!piece && summary.parts?.length) {
      children = summary.parts.map((p) => {
        const b = partBounds(model.scene, p.path);
        const c = b.isEmpty() ? null : b.getCenter(new THREE.Vector3());
        return {
          id: newId(),
          name: p.name,
          components: {
            Transform: { position: c ? [round(c.x), round(b.min.y), round(c.z)] : [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            [ModelRenderer.type]: { model: assetId, part: p.path },
          },
        };
      });
    }
    const bounds = piece ? partBounds(model.scene, piece.path) : model.bounds;
    if (!bounds.isEmpty()) {
      const size = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
      // Too big is almost always made in centimeters or millimeters: convert, don't squash it to 2 m.
      if (size > SENSIBLE.max) while (size * scale > SENSIBLE.max) scale /= 10;
      else if (size > 0 && size < SENSIBLE.min) scale = TARGET_SIZE / size;
      lift = piece ? 0 : -bounds.min.y * scale; // stand on the ground instead of sinking into it
    }
  } catch (err) {
    log('error', `Couldn't load "${summary.name}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const data: EntityData = {
    id: newId(),
    name: uniqueName(name, engine.world.roots),
    components: {
      Transform: {
        position: [spawn[0], round(spawn[1] + lift), spawn[2]],
        rotation: [0, 0, 0],
        scale: [round(scale), round(scale), round(scale)],
      },
      // A pack's group only holds its models.
      ...(children ? {} : { [ModelRenderer.type]: piece ? { model: assetId, part: piece.path } : { model: assetId } }),
    },
    ...(children ? { children } : {}),
  };
  if (children) startsFolded.add(data.id);
  if (!runCommand(new CreateEntityCommand(data, null, undefined, `Add ${name}`))) return null;
  select(data.id);
  log('info', `Added ${name}${children ? ` (${children.length} models, each its own object)` : ''}${scale !== 1 ? ` (auto-scaled ×${round(scale)})` : ''}`, data.id);
  return data.id;
}

/** Applies a scene settings change through undo history. */
export function editSceneSettings(patch: Partial<SceneSettings>, label?: string): void {
  const { engine, history, touchData, playing } = state();
  if (!engine || !history) return;
  const next: SceneSettings = { ...structuredClone(engine.settings), ...structuredClone(patch) };
  const cmd = new SetSceneSettingsCommand(engine, next, touchData, label);
  if (playing) cmd.do();
  else history.execute(cmd);
}

/** Use an HDRI as the sky (lighting + background). '' removes the sky. */
export function setSky(assetId: string): void {
  const engine = state().engine;
  if (!engine) return;
  editSceneSettings(
    { environment: { ...engine.settings.environment, asset: assetId } },
    assetId ? 'Set sky' : 'Remove sky',
  );
  if (assetId) state().log('info', `Sky set to ${assetSummary(assetId)?.name ?? 'image'}`);
}

/** Put a material asset on an entity's Mesh (adds a cube mesh if it has none). */
export function applyMaterial(entityId: string, materialId: string): boolean {
  const { engine, log } = state();
  const e = engine?.world.getById(entityId);
  if (!e) return false;
  if (!e.has(MeshRenderer)) {
    log('warn', `${e.name} has no Mesh to put a material on.`);
    return false;
  }
  editComponent(e, MeshRenderer.type, { material: materialId }, 'Apply material');
  return true;
}

/**
 * Build a material from a texture. If other imported textures share its name stem
 * (rock_diff + rock_nor + rock_rough), the whole set is used.
 */
export async function materialFromTexture(textureId: string): Promise<string | null> {
  const tex = getAssetRecord(textureId);
  if (!tex || tex.type !== 'texture') return null;
  // Reuse a material that already uses this texture as its color map (e.g. made on import).
  for (const a of useLibrary.getState().assets) {
    if (a.type !== 'material') continue;
    const m = getAssetRecord(a.id)?.data as { map?: string } | undefined;
    if (m?.map === textureId) return a.id;
  }
  const data: Record<string, string> = {};
  const mine = classifyTextureName(tex.main);
  if (mine) {
    for (const a of useLibrary.getState().assets) {
      if (a.type !== 'texture') continue;
      const rec = getAssetRecord(a.id);
      const c = rec && classifyTextureName(rec.main);
      if (c && c.stem === mine.stem && !data[c.slot]) data[c.slot] = a.id;
    }
  } else {
    data.map = textureId;
  }
  const label = mine ? mine.stem.replace(/[_-]+/g, ' ') : tex.name;
  const id = await createMaterial(label, data);
  if (id) state().log('info', `Created material "${label}" from ${Object.keys(data).length} texture map(s)`);
  return id;
}

/** Dropping a texture on an object: make a material from it and apply it. */
export async function applyTexture(entityId: string, textureId: string): Promise<void> {
  // A sprite shows the picture itself, in the picture's shape.
  const e = state().engine?.world.getById(entityId);
  const sprite = e?.get('Sprite') as { size: [number, number] } | undefined;
  if (e && sprite) {
    editComponent(e, 'Sprite', { image: textureId, ...(await spriteFitFor(textureId, sprite.size[1])) }, 'Set sprite picture');
    return;
  }
  const materialId = await materialFromTexture(textureId);
  if (materialId) applyMaterial(entityId, materialId);
}

/**
 * Sprite settings for showing this picture: its own shape, `height` tall, crisp pixels when it's
 * small (pixel art), and a sprite sheet's frames found by themselves (playing as "idle").
 */
export async function spriteFitFor(
  textureId: string,
  height: number,
): Promise<{ size: [number, number]; pixelArt?: boolean; columns: number; rows: number; frame: number; animations?: SpriteAnimation[] }> {
  const blob = getAssetRecord(textureId)?.files[getAssetRecord(textureId)?.main ?? ''];
  const single = { size: [height, height] as [number, number], columns: 1, rows: 1, frame: 0 };
  if (!blob) return single;
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const { columns, rows } = detectGrid({ data: img.data, width: img.width, height: img.height });
    const frames = columns * rows;
    const aspect = img.width / columns / Math.max(1, img.height / rows);
    const small = Math.max(img.width / columns, img.height / rows) <= 256;
    if (frames > 1) state().log('info', `This picture is a sprite sheet: ${frames} frames found (${columns} across, ${rows} down). Name its animations under Sprite sheet; set Columns and Rows to 1 if it's one picture.`);
    // 2D pixel art: sized by its pixels (Scene Settings: pixels per meter), so all of it matches.
    const ppu = state().dimension === '2d' && small ? Math.max(1, state().engine?.settings.pixelsPerUnit ?? 16) : 0;
    const size: [number, number] = ppu ? [Math.round((img.width / columns / ppu) * 100) / 100, Math.round((img.height / rows / ppu) * 100) / 100] : [Math.round(height * aspect * 100) / 100, height];
    return {
      size,
      ...(small ? { pixelArt: true } : {}),
      columns,
      rows,
      frame: 0,
      ...(frames > 1 ? { animations: [{ name: 'idle', from: 0, to: frames - 1, loop: true }] } : { animations: [] }),
    };
  } catch {
    return single;
  }
}

/**
 * "Use" an asset the obvious way: models are placed, skies applied, materials put on the
 * selected object.
 */
export async function activateAsset(assetId: string, at?: Vec3): Promise<void> {
  const summary = assetSummary(assetId);
  if (!summary) return;
  switch (summary.type) {
    case 'model':
      await placeModel(assetId, at);
      break;
    case 'hdri':
      setSky(assetId);
      break;
    case 'material': {
      const sel = state().selection;
      if (!sel || !applyMaterial(sel, assetId)) {
        state().log('info', 'Select an object with a Mesh first, then use the material (or drag it onto the object).');
      }
      break;
    }
    case 'script':
      openScriptEditor(assetId);
      break;
    case 'audio':
      state().log('info', 'Sounds will be playable once Audio arrives (Phase 11).');
      break;
    case 'texture': {
      const sel = state().selection;
      // 2D games: a picture becomes a sprite (unless it goes onto the selected object).
      if (state().dimension === '2d' && (!sel || !state().engine?.world.getById(sel)?.has('Sprite'))) {
        const id = createObjectWith(summary.name, 'image', { Sprite: { image: assetId, ...(await spriteFitFor(assetId, 1)), layer: 1 } });
        if (id && at) {
          const e = state().engine?.world.getById(id);
          if (e) editComponent(e, 'Transform', { position: [at[0], at[1], 0] }, 'Place sprite');
        }
        break;
      }
      if (sel) await applyTexture(sel, assetId);
      else {
        const id = await materialFromTexture(assetId);
        if (id) state().selectAsset(id);
      }
      break;
    }
    default:
      break;
  }
}

/** Delete an asset, refusing if the scene or a material still uses it. */
export async function deleteAssetSafely(assetId: string): Promise<boolean> {
  const { engine, log, selectAsset, assetSelection } = state();
  const record = getAssetRecord(assetId);
  if (!engine || !record) return false;
  const uses = assetUsage(engine).get(assetId) ?? 0;
  if (uses > 0) {
    log('warn', `"${record.name}" is still used ${uses} time${uses > 1 ? 's' : ''}. Remove it from the scene first.`);
    return false;
  }
  await removeAsset(assetId);
  if (assetSelection === assetId) selectAsset(null);
  log('info', `Deleted asset "${record.name}"`);
  return true;
}

/** Point everything that uses one asset at another (models in objects, plant types, …). Undoable. */
export function swapAssetEverywhere(fromId: string, toId: string, label: string): number {
  const { engine } = state();
  if (!engine) return 0;
  let changed = 0;
  for (const e of [...engine.world.all()]) {
    for (const type of e.componentTypes()) {
      const json = JSON.stringify(e.get(type) ?? {});
      if (!json.includes(fromId)) continue;
      editComponent(e, type, JSON.parse(json.split(fromId).join(toId)), label);
      changed++;
    }
  }
  return changed;
}

/**
 * Optimize a model: each repeated part is kept once (copies just say where they go) and pictures
 * are saved compactly. Saved as a new model that everything switches to (undoable); the original
 * stays in the project until you delete it. Characters (models with a skeleton) are left as they are.
 */
export async function optimizeModelAsset(assetId: string): Promise<{ before: number; after: number; parts: number; shapes: number } | null> {
  const { engine, log } = state();
  const record = getAssetRecord(assetId);
  if (!engine || !record || record.type !== 'model') return null;
  const { object, animations } = await engine.assets.instantiate(assetId);
  let rigged = false;
  object.traverse((o) => {
    if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) rigged = true;
  });
  if (rigged) {
    log('info', `"${record.name}" has a skeleton (a character), so it's left as it is.`);
    return null;
  }
  const before = record.meta.size;
  const { blob, report } = await optimizedGlb(object, animations);
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  if (blob.size >= before * 0.9) {
    log('info', `"${record.name}" is already compact (${mb(before)}, ${report.parts} parts, ${report.shapes} shapes).`);
    return { before, after: before, ...report };
  }
  const name = `${record.name.replace(/ \(optimized\)$/, '')} (optimized)`;
  const [copy] = await importFiles([{ path: `${name.replace(/[^\w ()-]+/g, '') || 'model'}.glb`, blob }], record.meta.credit, { compact: false });
  if (!copy) return null;
  const swapped = swapAssetEverywhere(assetId, copy.id, 'Use optimized model');
  log('info', `Optimized "${record.name}": ${mb(before)} → ${mb(blob.size)} (${report.parts} parts share ${report.shapes} shapes). ${swapped ? `${swapped} object(s) now use it; undo switches back. ` : ''}The original is still in the Project panel: delete it when you're happy.`);
  return { before, after: blob.size, ...report };
}

/**
 * A pool of water to swim in (Create > Environment > Water): a wide, flat box whose top is the
 * surface, just above the ground in front of the camera, with the Water look (one shared material).
 */
export async function createWater(): Promise<void> {
  const existing = useLibrary.getState().assets.find((a) => a.type === 'material' && a.name === 'Water');
  const material = existing?.id ?? (await createMaterial('Water', BUILTIN_MATERIALS.find((m) => m.id === 'water')?.data));
  const id = createObjectWith('Water', 'droplets', {
    MeshRenderer: { shape: 'box', material: material ?? '', castShadow: false, receiveShadow: true },
    Collider: { isTrigger: true },
    Water: {},
    Traits: { traits: ['water'] },
  });
  const e = id ? state().engine?.world.getById(id) : undefined;
  if (!e) return;
  const engine = state().engine!;
  const p = (e.get('Transform') as { position: Vec3 }).position;
  // The ground there (terrain, or flat ground at 0); the surface sits just above it.
  let ground = 0;
  for (const t of engine.world.all()) {
    if (!t.has('Terrain')) continue;
    const h = engine.terrain.heightAt(t, p[0], p[2]);
    if (h !== null) ground = h;
  }
  // 20 × 20 m, 2 m deep.
  editComponent(e, 'Transform', { position: [p[0], ground + 0.05 - 1, p[2]], scale: [20, 2, 20] }, 'Place water');
  state().log('info', 'Water added. To swim in it, it needs depth: lower the ground under it (Terrain > Lower), or move the water up.');
}

