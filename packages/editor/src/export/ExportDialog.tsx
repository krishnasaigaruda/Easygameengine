import { create } from 'zustand';
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../state/editorStore';
import { allAssetRecords } from '../assets/library';
import { Icon } from '../ui/Icon';
import { buildGameZip, buildSingleHtml, gameCredits, usedAssets } from './exportGame';

export const useExportDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openExport = () => useExportDialog.setState({ open: true });
const close = () => useExportDialog.setState({ open: false });

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const sizeOf = (records: { meta: { size: number } }[]) =>
  records.reduce((n, r) => n + (r.meta.size || 0), 0);

/** Export: download the game as a zip for any static host. */
export function ExportDialog() {
  const open = useExportDialog((s) => s.open);
  if (!open) return null;
  return <ExportWindow />;
}

function ExportWindow() {
  const engine = useEditor((s) => s.engine);
  const projectName = useEditor((s) => s.projectName);
  const playing = useEditor((s) => s.playing);
  const log = useEditor((s) => s.log);
  const [title, setTitle] = useState(projectName || 'My Game');
  const [onlyUsed, setOnlyUsed] = useState(true);
  const [installable, setInstallable] = useState(true);
  /** 'folder': game.zip for a website; 'file': one .html to double-click. */
  const [format, setFormat] = useState<'folder' | 'file'>('folder');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const scene = useMemo(() => (engine && !playing ? engine.saveScene() : null), [engine, playing]);
  const all = useMemo(() => allAssetRecords(), []);
  const used = useMemo(() => (scene ? usedAssets(scene, all) : all), [scene, all]);
  const included = onlyUsed ? used : all;
  const [credits, setCredits] = useState<{ length: number }>({ length: 0 });
  useEffect(() => {
    void gameCredits(included, all).then(setCredits);
  }, [included, all]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const download = async () => {
    if (!scene) return;
    setError('');
    setProgress(0);
    try {
      const res = await fetch(new URL('runtime/ege-player.js', document.baseURI));
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !/javascript/.test(type))
        throw new Error(
          "The game player couldn't be loaded. Reload the editor and try again.",
        );
      const name = title.trim() || 'My Game';
      const notices = await fetch(new URL('runtime/THIRD-PARTY-NOTICES.txt', document.baseURI))
        .then((r) => (r.ok && /text\/plain/.test(r.headers.get('content-type') ?? '') ? r.text() : ''))
        .catch(() => '');
      const file = name.replace(/[^\w -]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'game';
      const blob =
        format === 'file'
          ? await buildSingleHtml(scene, all, await res.text(), { title: name, onlyUsed, notices }, setProgress)
          : new Blob([(await buildGameZip(scene, all, new Uint8Array(await res.arrayBuffer()), { title: name, onlyUsed, installable, notices }, setProgress)) as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file}.${format === 'file' ? 'html' : 'zip'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      log('info', format === 'file' ? `Exported "${name}" as one file (${mb(blob.size)}): double-click it to play.` : `Exported "${name}" (${mb(blob.size)}). Unzip it onto any website host.`);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="store-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="export-dialog" role="dialog" aria-modal="true" aria-label="Export game">
        <header className="store-header">
          <Icon name="upload" size={16} />
          <h2>Export game</h2>
          <button className="icon-btn store-close" onClick={close} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="export-body">
          {playing && (
            <p className="export-warn">
              Stop the game first: the export takes the scene as it is before Play.
            </p>
          )}
          <div className="field">
            <label className="field-label">Game title</label>
            <div className="field-control">
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={onlyUsed}
              onChange={(e) => setOnlyUsed(e.target.checked)}
            />
            Leave out assets the game doesn't use ({used.length} of {all.length} used)
          </label>
          <div className="export-formats">
            <label className={`export-format ${format === 'folder' ? 'active' : ''}`}>
              <input type="radio" name="format" checked={format === 'folder'} onChange={() => setFormat('folder')} />
              <span>
                <b>Website folder</b> (game.zip)
                <small>For putting it online. Loads fastest.</small>
              </span>
            </label>
            <label className={`export-format ${format === 'file' ? 'active' : ''}`}>
              <input type="radio" name="format" checked={format === 'file'} onChange={() => setFormat('file')} />
              <span>
                <b>One file</b> (game.html)
                <small>Double-click it to play. Best for small games.</small>
              </span>
            </label>
          </div>
          {format === 'folder' && (
            <label className="checkbox-row">
              <input type="checkbox" checked={installable} onChange={(e) => setInstallable(e.target.checked)} />
              Installable app: players can add it to their home screen, and it works offline after the first visit
            </label>
          )}
          {format === 'file' && sizeOf(included) > 60 * 1048576 && (
            <p className="export-warn">This game is {mb(sizeOf(included))}: as one file it will be about {mb(sizeOf(included) * 1.34)} and take a while to open. The website folder loads faster.</p>
          )}
          <div className="export-summary">
            <div className="kv">
              <span>Assets</span>
              <span>
                {included.length} · {mb(sizeOf(included))}
              </span>
            </div>
            <div className="kv">
              <span>Credits screen</span>
              <span>{credits.length ? `${credits.length} author credits` : 'none needed'}</span>
            </div>
            <div className="kv">
              <span>Branding</span>
              <span>"Made with Easy Game Engine"</span>
            </div>
          </div>
          {error && <p className="export-warn">{error}</p>}
          <button
            className="primary"
            disabled={!scene || progress !== null}
            onClick={() => void download()}
          >
            <Icon name="download" size={12} />
            {progress !== null ? `Packing… ${Math.round(progress * 100)}%` : format === 'file' ? 'Download game.html' : 'Download game.zip'}
          </button>
          <div className="export-help">
            <div className="tool-title">{done ? 'Next: play it' : 'Then'}</div>
            {format === 'file' ? (
              <p className="component-desc">Double-click the .html file and it opens in your browser. Send it to friends the same way.</p>
            ) : (
              <p className="component-desc">
                Unzip it. Browsers won't run it by double-clicking index.html, so serve the folder: in a terminal in the folder run <code>python3 -m http.server 8000</code> (or <code>npx serve</code>) and open <code>http://localhost:8000</code>. To put it online, upload the folder to any website host (Netlify Drop, GitHub Pages, itch.io as an HTML game…).
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
