import { useEffect, useRef, useState } from 'react';
import { AUTO_TILE, Tilemap, type Entity, type TilemapData } from '@ege/runtime';
import { getAssetRecord } from '../../assets/library';
import { detectGrid } from '../../assets/spriteSheet';
import { editComponent } from '../../editor/actions';
import { useTileBrush } from '../../editor/tileBrush';
import { useEditor } from '../../state/editorStore';
import { Icon } from '../../ui/Icon';
import { NumberInput } from './fields';

/** Read a picture asset into a canvas (for the palette) and pixels (for finding the tile grid). */
async function load(assetId: string) {
  const r = getAssetRecord(assetId);
  const blob = r?.files[r.main];
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, data: img.data, width: img.width, height: img.height };
}

/** The tile grid of a tileset: by its gaps, else the usual tile sizes (16 px, 32 px…). */
export function guessTileGrid(img: { data: Uint8ClampedArray; width: number; height: number }): { columns: number; rows: number } {
  const g = detectGrid(img);
  if (g.columns * g.rows > 1) return g;
  for (const size of img.width <= 256 ? [16, 32, 8, 24, 48, 64] : [32, 16, 64, 48, 24, 128]) {
    if (img.width % size === 0 && img.height % size === 0 && img.width / size <= 64 && img.height / size <= 64 && img.width / size * (img.height / size) > 1)
      return { columns: img.width / size, rows: img.height / size };
  }
  return { columns: 1, rows: 1 };
}

/** Pick tiles and paint them in the viewport. */
export function TilemapTools({ entity }: { entity: Entity }) {
  useEditor((s) => s.revision);
  const d = entity.get(Tilemap) as TilemapData | undefined;
  const brush = useTileBrush();
  const set = useTileBrush.setState;
  const [loaded, setLoaded] = useState<{ id: string; img: Awaited<ReturnType<typeof load>> }>({ id: '', img: null });
  const palette = useRef<HTMLCanvasElement>(null);
  const tileset = d?.tileset ?? '';
  const img = loaded.id === tileset ? loaded.img : null;

  useEffect(() => {
    let live = true;
    if (tileset) void load(tileset).then((p) => live && setLoaded({ id: tileset, img: p }));
    return () => {
      live = false;
    };
  }, [tileset]);

  const cols = Math.max(1, Math.round(d?.columns ?? 1));
  const rows = Math.max(1, Math.round(d?.rows ?? 1));

  // A new tileset: find its grid by itself.
  const guessedFor = useRef('');
  useEffect(() => {
    if (!img || !d || guessedFor.current === tileset) return;
    guessedFor.current = tileset;
    if (cols * rows > 1) return; // already set up
    const g = guessTileGrid(img);
    if (g.columns * g.rows <= 1) return;
    // Tiles as big as their pixels say (Scene Settings: pixels per meter).
    const ppu = Math.max(1, useEditor.getState().engine?.settings.pixelsPerUnit ?? 16);
    const tileSize = Math.round((img.width / g.columns / ppu) * 100) / 100;
    editComponent(entity, Tilemap.type, { columns: g.columns, rows: g.rows, ...(tileSize > 0 ? { tileSize } : {}) }, 'Find tiles');
  }, [img, d, tileset, cols, rows, entity]);

  // The palette: the tileset with its grid; the chosen tile (or auto-tile block) outlined.
  useEffect(() => {
    const c = palette.current;
    if (!c || !img || !d) return;
    const scale = Math.max(1, Math.floor(260 / img.width)) || 1;
    c.width = img.width * scale;
    c.height = img.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = !d.pixelArt;
    ctx.drawImage(img.canvas, 0, 0, c.width, c.height);
    const tw = c.width / cols;
    const th = c.height / rows;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let i = 1; i < cols; i++) ctx.strokeRect(Math.round(i * tw) + 0.5, 0, 0, c.height);
    for (let i = 1; i < rows; i++) ctx.strokeRect(0, Math.round(i * th) + 0.5, c.width, 0);
    const pick = brush.tile === AUTO_TILE ? d.autoTile : brush.tile;
    const span = brush.tile === AUTO_TILE ? 3 : 1;
    ctx.strokeStyle = '#e0b23a';
    ctx.lineWidth = 2;
    ctx.strokeRect((pick % cols) * tw + 1, Math.floor(pick / cols) * th + 1, tw * span - 2, th * span - 2);
  }, [img, d, cols, rows, brush.tile]);

  if (!d) return null;
  const edit = (patch: Partial<TilemapData>, label: string) => editComponent(entity, Tilemap.type, patch, label);
  const count = Object.keys(d.cells).length;

  const clickPalette = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const c = Math.min(cols - 1, Math.floor(((e.clientX - r.left) / r.width) * cols));
    const rr = Math.min(rows - 1, Math.floor(((e.clientY - r.top) / r.height) * rows));
    const t = rr * cols + c;
    if (brush.tile === AUTO_TILE) edit({ autoTile: t }, 'Auto-tile block');
    else set({ tile: t });
    set({ active: true, erase: false });
  };

  return (
    <div className="tilemap-tools">
      <div className="tool-title">Paint</div>
      <div className="brush-grid">
        <button className={`small ${brush.active && !brush.erase ? 'active' : ''}`} onClick={() => set({ active: !(brush.active && !brush.erase), erase: false })} title="Hold the left mouse button in the viewport (Esc stops)">
          <Icon name="brush" size={12} />
          Paint
        </button>
        <button className={`small ${brush.active && brush.erase ? 'active' : ''}`} onClick={() => set({ active: !(brush.active && brush.erase), erase: true })} title="Remove tiles (or hold Shift while painting)">
          <Icon name="eraser" size={12} />
          Erase
        </button>
        <button className={`small ${brush.tile === AUTO_TILE ? 'active' : ''}`} onClick={() => set({ tile: AUTO_TILE, active: true, erase: false })} title="Edges, corners and the middle picked by themselves from a 3 × 3 block">
          <Icon name="wand" size={12} />
          Auto-tile
        </button>
        <button className={`small ${brush.tile !== AUTO_TILE ? 'active' : ''}`} onClick={() => set({ tile: Math.max(0, d.autoTile), active: true, erase: false })} title="Paint exactly the tile you pick">
          <Icon name="square" size={12} />
          Single tile
        </button>
      </div>
      {!tileset && <p className="component-desc">Pick a Tileset picture above (a grid of tiles), or paint plain blocks right away.</p>}
      {img && (
        <>
          <canvas ref={palette} className={`tile-palette ${d.pixelArt ? 'pixelated' : ''}`} onClick={clickPalette} title={brush.tile === AUTO_TILE ? 'Click the top-left tile of a 3 × 3 block (corners, edges, middle)' : 'Click a tile to paint with it'} />
          <div className="sheet-grid-row">
            <label>
              Tiles across
              <NumberInput value={cols} min={1} max={64} step={1} onChange={(v) => edit({ columns: Math.max(1, Math.round(v)) }, 'Tiles across')} />
            </label>
            <label>
              Tiles down
              <NumberInput value={rows} min={1} max={64} step={1} onChange={(v) => edit({ rows: Math.max(1, Math.round(v)) }, 'Tiles down')} />
            </label>
            <button
              className="small"
              onClick={() => {
                const g = guessTileGrid(img);
                edit({ columns: g.columns, rows: g.rows }, 'Find tiles');
              }}
              title="Find the tile grid by itself"
            >
              <Icon name="wand" size={12} />
              Find tiles
            </button>
          </div>
        </>
      )}
      <p className="component-desc">
        {brush.tile === AUTO_TILE
          ? 'Auto-tile: click the top-left tile of a 3 × 3 block in the tileset (top-left corner, top, top-right / left, middle, right / bottom-left, bottom, bottom-right). Painted ground then gets its edges and corners by itself.'
          : 'Single tile: click a tile in the tileset, then paint it.'}{' '}
        Hold Shift to erase. {count} tile{count === 1 ? '' : 's'} painted.
      </p>
      {count > 0 && (
        <div className="component-actions">
          <button className="small" onClick={() => edit({ cells: {} }, 'Clear tilemap')}>
            <Icon name="trash" size={12} />
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
