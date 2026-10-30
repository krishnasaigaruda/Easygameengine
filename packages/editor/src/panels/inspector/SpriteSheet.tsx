import { useEffect, useRef, useState } from 'react';
import { Sprite, type Entity, type SpriteAnimation, type SpriteData } from '@ege/runtime';
import { getAssetRecord } from '../../assets/library';
import { detectGrid } from '../../assets/spriteSheet';
import { editComponent } from '../../editor/actions';
import { useEditor } from '../../state/editorStore';
import { Icon } from '../../ui/Icon';
import { NumberInput } from './fields';

/** Names characters use by themselves, offered in this order for new animations. */
const SUGGESTED = ['idle', 'walk', 'run', 'jump', 'fall', 'attack', 'hurt'];

/** Read a picture asset into pixels. */
async function pixelsOf(assetId: string) {
  const r = getAssetRecord(assetId);
  const blob = r?.files[r.main];
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { data: img.data, width: img.width, height: img.height, canvas: c };
}

/** Sprite sheets: split the picture into frames and name runs of them as animations. */
export function SpriteSheet({ entity }: { entity: Entity }) {
  useEditor((s) => s.revision);
  const d = entity.get(Sprite) as SpriteData | undefined;
  const [img, setImg] = useState<Awaited<ReturnType<typeof pixelsOf>>>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const image = d?.image ?? '';

  useEffect(() => {
    let live = true;
    if (image) void pixelsOf(image).then((p) => live && setImg(p));
    return () => {
      live = false;
    };
  }, [image]);

  const cols = Math.max(1, Math.round(d?.columns ?? 1));
  const rows = Math.max(1, Math.round(d?.rows ?? 1));
  const frames = cols * rows;
  const anims = d?.animations ?? [];

  // The sheet with its grid and frame numbers.
  useEffect(() => {
    const c = preview.current;
    if (!c || !img) return;
    const scale = Math.min(1, 520 / img.width);
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = img.width > 256;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img.canvas, 0, 0, c.width, c.height);
    if (frames <= 1) return;
    const fw = c.width / cols;
    const fh = c.height / rows;
    ctx.strokeStyle = 'rgba(224,178,58,0.85)';
    ctx.lineWidth = 1;
    for (let i = 1; i < cols; i++) ctx.strokeRect(Math.round(i * fw) + 0.5, 0, 0, c.height);
    for (let i = 1; i < rows; i++) ctx.strokeRect(0, Math.round(i * fh) + 0.5, c.width, 0);
    ctx.font = `${Math.max(9, Math.min(13, fh / 4))}px system-ui`;
    for (let f = 0; f < frames; f++) {
      const x = (f % cols) * fw;
      const y = Math.floor(f / cols) * fh;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + 1, y + 1, 18, 14);
      ctx.fillStyle = f === d?.frame ? '#e0b23a' : '#fff';
      ctx.fillText(String(f), x + 3, y + 12);
    }
  }, [img, cols, rows, frames, d?.frame]);

  if (!d || !image) return null;
  const set = (patch: Partial<SpriteData>, label: string) => editComponent(entity, Sprite.type, patch, label);

  /** Columns / rows changed: one frame keeps the sprite's height, its width follows the frame. */
  const setGrid = (columns: number, rowCount: number, label: string) => {
    const patch: Partial<SpriteData> = { columns, rows: rowCount, frame: 0 };
    if (img) {
      const aspect = img.width / columns / (img.height / rowCount);
      patch.size = [Math.round(d.size[1] * aspect * 100) / 100, d.size[1]];
    }
    // A new sheet gets one animation over all its frames.
    if (!anims.length && columns * rowCount > 1) patch.animations = [{ name: 'idle', from: 0, to: columns * rowCount - 1, loop: true }];
    set(patch, label);
  };

  const autoDetect = () => {
    if (!img) return;
    const g = detectGrid(img);
    if (g.columns * g.rows <= 1) {
      useEditor.getState().log('info', 'No frames found: it looks like one picture. Set Columns and Rows by hand if it is a sheet.');
      return;
    }
    setGrid(g.columns, g.rows, 'Find frames');
    useEditor.getState().log('info', `Found ${g.columns * g.rows} frames (${g.columns} across, ${g.rows} down).`);
  };

  const editAnim = (i: number, patch: Partial<SpriteAnimation>) =>
    set({ animations: anims.map((a, j) => (j === i ? { ...a, ...patch } : a)) }, 'Edit animation');
  const addAnim = () => {
    const name = SUGGESTED.find((n) => !anims.some((a) => a.name === n)) ?? `animation ${anims.length + 1}`;
    const last = anims[anims.length - 1];
    const from = last ? Math.min(frames - 1, last.to + 1) : 0;
    set({ animations: [...anims, { name, from, to: frames - 1, loop: name !== 'jump' && name !== 'attack' && name !== 'hurt' }] }, 'Add animation');
  };

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * cols);
    const rr = Math.floor(((e.clientY - r.top) / r.height) * rows);
    set({ frame: Math.min(frames - 1, rr * cols + c) }, 'Pick frame');
  };

  return (
    <div className="sprite-sheet">
      <div className="tool-title">Sprite sheet</div>
      <div className="sheet-grid-row">
        <label>
          Columns
          <NumberInput value={cols} min={1} max={64} step={1} onChange={(v) => setGrid(Math.max(1, Math.round(v)), rows, 'Columns')} />
        </label>
        <label>
          Rows
          <NumberInput value={rows} min={1} max={64} step={1} onChange={(v) => setGrid(cols, Math.max(1, Math.round(v)), 'Rows')} />
        </label>
        <button className="small" onClick={autoDetect} title="Find the frames by the gaps between them">
          <Icon name="wand" size={12} />
          Auto-detect frames
        </button>
      </div>
      {img && <canvas ref={preview} className={`sheet-preview ${img.width <= 256 ? 'pixelated' : ''}`} onClick={pick} title="Click a frame to show it when nothing animates" />}
      {frames > 1 && (
        <>
          <div className="sheet-grid-row">
            <label>
              Speed (frames / s)
              <NumberInput value={d.fps ?? 10} min={1} max={60} step={1} onChange={(fps) => set({ fps }, 'Animation speed')} />
            </label>
            <label>
              Play
              <select value={d.animation ?? ''} onChange={(e) => set({ animation: e.target.value }, 'Play animation')}>
                <option value="">{entity.has('CharacterController') ? 'Automatic (by movement)' : 'Automatic (the first)'}</option>
                {anims.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="sheet-anims">
            {anims.map((a, i) => (
              <div key={i} className="sheet-anim">
                <input className="sheet-anim-name" value={a.name} onChange={(e) => editAnim(i, { name: e.target.value })} aria-label="Animation name" />
                <span className="muted">frames</span>
                <NumberInput value={a.from} min={0} max={frames - 1} step={1} onChange={(v) => editAnim(i, { from: Math.round(v) })} />
                <span className="muted">to</span>
                <NumberInput value={a.to} min={0} max={frames - 1} step={1} onChange={(v) => editAnim(i, { to: Math.round(v) })} />
                <label className="sheet-loop" title="Start again at the end">
                  <input type="checkbox" checked={a.loop} onChange={(e) => editAnim(i, { loop: e.target.checked })} />
                  loop
                </label>
                <button className="icon-only" title="Remove animation" onClick={() => set({ animations: anims.filter((_, j) => j !== i) }, 'Remove animation')}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
            <button className="small" onClick={addAnim}>
              <Icon name="plus" size={12} />
              Add animation
            </button>
          </div>
          <p className="component-desc">Name them idle, walk, run, jump and fall: a character plays them by itself as it moves. Scripts can play any of them with animate.</p>
        </>
      )}
    </div>
  );
}
