import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { getAssetRecord } from './library';
import { importFiles } from './importActions';
import { opaqueBounds, removeBackground, type Pixels } from './removeBackground';
import { swapAssetEverywhere } from '../editor/assetActions';
import { useEditor } from '../state/editorStore';
import { Icon } from '../ui/Icon';

const useBgRemove = create<{ assetId: string | null }>(() => ({ assetId: null }));
/** Open the background remover for a picture asset. */
export const openRemoveBackground = (assetId: string) => useBgRemove.setState({ assetId });
const close = () => useBgRemove.setState({ assetId: null });

export function RemoveBackgroundDialog() {
  const assetId = useBgRemove((s) => s.assetId);
  if (!assetId) return null;
  return <BgWindow key={assetId} assetId={assetId} />;
}

/** Read a picture into pixels. */
async function loadPixels(blob: Blob): Promise<Pixels> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { data: img.data, width: img.width, height: img.height };
}

/** How many different colours a picture has (sampled; stops counting at 4096). */
function colourCount(px: Pixels): number {
  const seen = new Set<number>();
  const step = Math.max(1, Math.floor((px.width * px.height) / 200_000));
  for (let p = 0; p < px.width * px.height && seen.size < 4096; p += step) {
    const i = p * 4;
    if (px.data[i + 3] > 16) seen.add((px.data[i] << 16) | (px.data[i + 1] << 8) | px.data[i + 2]);
  }
  return seen.size;
}

function BgWindow({ assetId }: { assetId: string }) {
  const record = getAssetRecord(assetId);
  const [px, setPx] = useState<Pixels | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(12);
  const [fromEdges, setFromEdges] = useState(true);
  const [soft, setSoft] = useState<boolean | null>(null);
  const [trim, setTrim] = useState(true);
  const [seeds, setSeeds] = useState<{ x: number; y: number }[]>([]);
  const [showBefore, setShowBefore] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const blob = record?.files[record.main];
    if (!blob) return;
    loadPixels(blob).then(setPx, (err: unknown) => setFailed(err instanceof Error ? err.message : String(err)));
  }, [record]);

  // Photos get soft edges; pixel art and drawings (few colours) stay crisp, unless asked otherwise.
  const looksLikePhoto = useMemo(() => (px ? colourCount(px) > 512 : true), [px]);
  const softEdges = soft ?? looksLikePhoto;
  const result = useMemo(() => (px ? removeBackground(px, { tolerance, fromEdges, seeds, softEdges }) : null), [px, tolerance, fromEdges, seeds, softEdges]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !px || !result) return;
    c.width = px.width;
    c.height = px.height;
    c.getContext('2d')!.putImageData(new ImageData(showBefore ? new Uint8ClampedArray(px.data) : new Uint8ClampedArray(result), px.width, px.height), 0, 0);
  }, [px, result, showBefore]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        setSeeds((s) => s.slice(0, -1));
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!px) return;
    // The picture is fitted inside the canvas box (letterboxed): undo that.
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.min(r.width / px.width, r.height / px.height);
    const x = Math.floor((e.clientX - r.left - (r.width - px.width * k) / 2) / k);
    const y = Math.floor((e.clientY - r.top - (r.height - px.height * k) / 2) / k);
    if (x < 0 || y < 0 || x >= px.width || y >= px.height) return;
    setSeeds((s) => [...s, { x, y }]);
  };

  const save = async () => {
    if (!px || !result || !record) return;
    setSaving(true);
    try {
      const box = trim ? opaqueBounds(result, px.width, px.height) : { x: 0, y: 0, width: px.width, height: px.height };
      if (!box) {
        useEditor.getState().log('warn', 'Nothing would be left of the picture: lower "How much to remove".');
        return;
      }
      const full = document.createElement('canvas');
      full.width = px.width;
      full.height = px.height;
      full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(result), px.width, px.height), 0, 0);
      const out = document.createElement('canvas');
      out.width = box.width;
      out.height = box.height;
      out.getContext('2d')!.drawImage(full, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
      if (!blob) return;
      const base = record.name.replace(/ \(no background\)$/, '');
      const [copy] = await importFiles([{ path: `${base.replace(/[^\w ()-]+/g, '').trim() || 'picture'} (no background).png`, blob }], record.meta.credit);
      if (!copy) return;
      const swapped = swapAssetEverywhere(assetId, copy.id, 'Remove background');
      useEditor.getState().log('info', `Removed the background of "${record.name}".${swapped ? ` ${swapped} object(s) now use the new picture; undo switches back.` : ''} The original is still in the Project panel.`);
      useEditor.setState({ assetSelection: copy.id });
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="store-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="bg-dialog" role="dialog" aria-modal="true" aria-label="Remove background">
        <header className="bg-head">
          <Icon name="image" size={16} />
          <b>Remove background</b>
          <span className="muted">{record?.name}</span>
          <button className="icon-only" title="Close" onClick={close}>
            <Icon name="x" />
          </button>
        </header>
        <div className="bg-body">
          <div className="bg-view">
            {failed ? (
              <p className="empty">This picture couldn't be read ({failed}).</p>
            ) : !px ? (
              <p className="empty">Loading…</p>
            ) : (
              <canvas
                ref={canvas}
                className={`bg-canvas ${looksLikePhoto ? '' : 'pixelated'}`}
                onClick={click}
                title="Click a part of the background to remove it too"
              />
            )}
          </div>
          <div className="bg-side">
            <p className="component-desc">The background colours are found from the picture's edges. Click anything else you want gone (Cmd/Ctrl+Z takes a click back).</p>
            <label className="bg-field">
              <span>How much to remove</span>
              <input type="range" min={0} max={60} value={tolerance} onChange={(e) => setTolerance(+e.target.value)} />
              <span className="bg-value">{tolerance}</span>
            </label>
            <label className="bg-check">
              <input type="checkbox" checked={fromEdges} onChange={(e) => setFromEdges(e.target.checked)} />
              Only background touching the edges
              <small>Off: that colour goes everywhere, also inside (holes between arms).</small>
            </label>
            <label className="bg-check">
              <input type="checkbox" checked={softEdges} onChange={(e) => setSoft(e.target.checked)} />
              Soft edges
              <small>For photos. Off keeps pixel art crisp.</small>
            </label>
            <label className="bg-check">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
              Trim empty space
              <small>Cuts the picture down to what's left.</small>
            </label>
            {seeds.length > 0 && (
              <button className="small" onClick={() => setSeeds([])}>
                <Icon name="undo" size={12} />
                Forget {seeds.length} click{seeds.length > 1 ? 's' : ''}
              </button>
            )}
            <div className="bg-actions">
              <button className="small" onPointerDown={() => setShowBefore(true)} onPointerUp={() => setShowBefore(false)} onPointerLeave={() => setShowBefore(false)}>
                Hold to see before
              </button>
              <span className="spacer" />
              <button onClick={close}>Cancel</button>
              <button className="primary" disabled={!result || saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
