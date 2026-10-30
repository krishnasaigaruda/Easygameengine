import { useEffect, useRef, useState } from 'react';
import { Engine, QUALITY_LEVELS, UI_TYPES, type QualityLevel, type UILayout } from '@ege/runtime';

const formatTris = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** The component that holds an element's position (same order the UI system uses). */
const UI_LAYOUT_ORDER = ['UIPanel', 'UIImage', 'UIButton', 'UIProgressBar', 'UIText'];
const ANCHOR_FRACTION: Record<string, [number, number]> = {
  'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1],
};
import { selectedEntities, useEditor } from '../state/editorStore';
import { keyLabel } from '../editor/keymap';
import { EditorViewport } from '../viewport/EditorViewport';
import { commitLiveEdits, setSpawnPointProvider } from '../editor/actions';
import { attachTerrainPainter } from '../viewport/terrainPainter';
import { attachTilePainter } from '../viewport/tilePainter';
import { bootProject } from '../editor/project';
import { gameUsesEscape } from '../editor/play';
import { setViewportController } from '../viewport/viewportRef';
import { assetSummary, attachLibrary } from '../assets/library';
import { ASSET_DROP_EVENT, type AssetDropDetail } from '../ui/assetDrag';
import { applyMaterial, applyTexture, placeModel, activateAsset } from '../editor/assetActions';
import { importFiles } from '../assets/importActions';
import { filesFromDataTransfer } from '../assets/importer';
import { Icon } from '../ui/Icon';

/** The 3D view: boots the runtime, opens the last project, and hosts the editor gizmos. */
/** Chrome turned the graphics chip off for this page (after it crashed a few times). */
function graphicsOff(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const off = gl.isContextLost();
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // just a test: let it go
    return off;
  } catch {
    return true;
  }
}

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EditorViewport | null>(null);
  const [status, setStatus] = useState('Starting engine…');
  const gameView = useEditor((s) => s.gameView);
  const setGameView = useEditor((s) => s.setGameView);
  const [fileHover, setFileHover] = useState(false);
  const [showColliders, setShowColliders] = useState(false);
  const [stats, setStats] = useState({ fps: 0, triangles: 0 });
  /**
   * The browser reset the graphics chip (too much on it at once): the view is gone until it's
   * back. 'off': after a few resets Chrome turns it off for the page (a reload shows black).
   */
  const [gpuLost, setGpuLost] = useState<false | 'lost' | 'off'>(() => (graphicsOff() ? 'off' : false));
  const offAtStart = useRef(gpuLost === 'off');
  const [quality, setQualityState] = useState<QualityLevel>(() => {
    try {
      const q = localStorage.getItem('ege.quality') as QualityLevel | null;
      return q && QUALITY_LEVELS.includes(q) ? q : 'high';
    } catch {
      return 'high';
    }
  });
  const [editLight, setEditLight] = useState(() => {
    try {
      return localStorage.getItem('ege.editLight') === '1';
    } catch {
      return false;
    }
  });
  const playing = useEditor((s) => s.playing);
  const paused = useEditor((s) => s.paused);
  // Games with their own Esc (pause menus) stop with Shift+Esc; scripts start a moment after Play.
  const [stopKey, setStopKey] = useState('Esc');
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStopKey(gameUsesEscape() ? 'Shift+Esc' : 'Esc'), 1500);
    return () => clearTimeout(t);
  }, [playing]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const setEngine = useEditor((s) => s.setEngine);
  const selection = useEditor((s) => s.selection);
  const selected = useEditor((s) => s.selected);
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const engine = useEditor((s) => s.engine);
  const revision = useEditor((s) => s.revision);
  const sceneName = engine?.sceneName;
  const objectCount = engine?.world.size ?? 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (offAtStart.current) return;
    let eng: Engine;
    try {
      eng = new Engine({ container });
    } catch {
      queueMicrotask(() => setGpuLost('off'));
      return;
    }
    attachLibrary(eng);
    const canvas = eng.renderer.domElement;
    const onLost = () => setGpuLost((was) => was || 'lost');
    const onRestored = () => setGpuLost(false);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    const controller = new EditorViewport(eng, {
      onPick: (id, additive) => {
        const s = useEditor.getState();
        if (additive && id) s.toggleSelect(id);
        else if (!additive) s.select(id);
      },
      onTransformEnd: (edits) => commitLiveEdits(edits, 'Transform'),
      onLeaveGameView: () => useEditor.getState().setGameView(false),
    });
    controllerRef.current = controller;
    setViewportController(controller);
    const stopTerrainPainter = attachTerrainPainter(eng, controller);
    const stopTilePainter = attachTilePainter(eng, controller);
    const stopPainter = () => {
      stopTerrainPainter();
      stopTilePainter();
    };
    setSpawnPointProvider(() => controller.spawnPoint());

    eng
      .init()
      .then(async () => {
        if (eng.isDisposed) return;
        setEngine(eng);
        await bootProject(eng);
        if (eng.isDisposed) return;
        eng.start();
        setStatus('ready');
      })
      .catch((err: unknown) => setStatus(`Engine failed to start: ${String(err)}`));

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      stopPainter();
      attachLibrary(null);
      setViewportController(null);
      controller.dispose();
      controllerRef.current = null;
      setEngine(null);
      eng.dispose();
    };
  }, [setEngine]);

  // Keep the gizmo attached to the selected entity's (possibly re-created) node.
  useEffect(() => {
    const c = controllerRef.current;
    if (!c || !engine) return;
    c.setSelection(selection ? engine.world.getById(selection) ?? null : null, selectedEntities());
  }, [selection, selected, engine, revision]);

  useEffect(() => {
    controllerRef.current?.setTool(tool);
  }, [tool]);
  useEffect(() => {
    controllerRef.current?.setSnap(snap);
  }, [snap]);
  useEffect(() => {
    if (controllerRef.current) controllerRef.current.gameView = gameView;
  }, [gameView]);
  useEffect(() => {
    controllerRef.current?.setShowColliders(showColliders);
  }, [showColliders, engine]);
  // 2D projects: the editor looks straight at the flat plane.
  const dimension = useEditor((s) => s.dimension);
  useEffect(() => {
    controllerRef.current?.setFlat(dimension === '2d');
  }, [dimension, engine]);
  // The editor camera comes back where you left it, per project (like Unity's scene view).
  const projectId = useEditor((s) => s.projectId);
  useEffect(() => {
    const c = controllerRef.current;
    if (!engine || !c || !projectId) return;
    const key = `ege.view.${projectId}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) c.setView(JSON.parse(saved));
    } catch {
      // nothing saved, or storage blocked: keep the default view
    }
    let last = '';
    const t = setInterval(() => {
      const v = JSON.stringify(c.getView());
      if (v === last) return;
      last = v;
      try {
        localStorage.setItem(key, v);
      } catch {
        // per-browser convenience only
      }
    }, 1000);
    return () => clearInterval(t);
  }, [engine, projectId]);

  // Frame rate and triangles, twice a second (helps spot heavy scenes).
  useEffect(() => {
    if (!engine) return;
    const t = setInterval(() => setStats(engine.stats), 500);
    return () => clearInterval(t);
  }, [engine]);
  useEffect(() => {
    engine?.setQuality(quality);
    try {
      localStorage.setItem('ege.quality', quality);
    } catch {
      // per-browser convenience only
    }
  }, [engine, quality]);

  useEffect(() => {
    controllerRef.current?.setEditLight(editLight);
    try {
      localStorage.setItem('ege.editLight', editLight ? '1' : '0');
    } catch {
      // per-browser convenience only
    }
  }, [editLight, engine]);

  // Screen UI shows while playing, in the game camera view, or when a UI object is selected (like
  // Unity's Game view): a full-screen menu never covers the scene while you build it.
  useEffect(() => {
    if (!engine) return;
    const selected = selection ? engine.world.getById(selection) : undefined;
    let uiSelected = false;
    for (let e = selected ?? null; e && !uiSelected; e = e.parent) uiSelected = UI_TYPES.some((t) => e!.has(t));
    engine.ui.setVisible(playing || gameView || uiSelected);
  }, [engine, playing, gameView, selection]);

  // Screen UI: clicking an element selects it while editing; while playing, buttons work.
  useEffect(() => {
    if (!engine) return;
    engine.ui.setEditorState(!playing, playing ? null : selection);
    engine.ui.setClickHandler((e) => {
      if (useEditor.getState().playing) engine.scripts?.clickUI(e, (e.get('UIButton') as { sendMessage?: string } | undefined)?.sendMessage ?? '');
      else if (useEditor.getState().selection !== e.id) useEditor.getState().select(e.id);
    });
    // Drag UI elements to move them; drag the corner handle to resize.
    let drag: { type: string; before: UILayout & Record<string, unknown>; original: object } | null = null;
    engine.ui.setDragHandler((e, kind, [dx, dy], phase) => {
      const type = UI_LAYOUT_ORDER.find((t) => e.has(t));
      if (!type) return;
      if (phase === 'start') {
        const original = structuredClone(e.get(type)) as object;
        const before = structuredClone(original) as UILayout & Record<string, unknown>;
        if (kind === 'resize' && (before.size[0] <= 0 || before.size[1] <= 0)) {
          const m = engine.ui.measured(e.id) ?? [100, 40];
          before.size = [before.size[0] > 0 ? before.size[0] : m[0], before.size[1] > 0 ? before.size[1] : m[1]];
        }
        drag = { type, before, original };
        return;
      }
      if (!drag) return;
      const b = drag.before;
      if (phase === 'move') {
        if (kind === 'move') e.set(type, { offset: [b.offset[0] + dx, b.offset[1] + dy] });
        else {
          // Keep the top-left corner where it is, whatever the anchor.
          const [ax, ay] = ANCHOR_FRACTION[b.anchor] ?? [0.5, 0.5];
          const w = Math.max(8, b.size[0] + dx);
          const h = Math.max(8, b.size[1] + dy);
          e.set(type, { size: [w, h], offset: [Math.round(b.offset[0] + ax * (w - b.size[0])), Math.round(b.offset[1] + ay * (h - b.size[1]))] });
        }
        return;
      }
      commitLiveEdits([{ entity: e, before: drag.original }], drag.type);
      drag = null;
    });
  }, [engine, playing, selection]);

  // Asset tiles dragged from the Project panel.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onDrop = (ev: Event) => {
      const { assetId, part, clientX, clientY } = (ev as CustomEvent<AssetDropDetail>).detail;
      const c = controllerRef.current;
      const asset = assetSummary(assetId);
      if (!c || !asset) return;
      const hit = c.pickAt(clientX, clientY);
      if (asset.type === 'model') void placeModel(assetId, hit.point, part);
      else if (asset.type === 'material') {
        if (hit.entityId) applyMaterial(hit.entityId, assetId);
        else useEditor.getState().log('info', 'Drop materials onto an object.');
      } else if (asset.type === 'texture') {
        if (hit.entityId) void applyTexture(hit.entityId, assetId);
        else useEditor.getState().log('info', 'Drop textures onto an object to put them on it.');
      } else void activateAsset(assetId);
    };
    el.addEventListener(ASSET_DROP_EVENT, onDrop);
    return () => el.removeEventListener(ASSET_DROP_EVENT, onDrop);
  }, []);

  // Files dragged in from the computer: import, then place models where they were dropped.
  const onFileDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setFileHover(false);
    const at = controllerRef.current?.pickAt(ev.clientX, ev.clientY).point;
    const records = await importFiles(await filesFromDataTransfer(ev.dataTransfer));
    const models = records.filter((r) => r.type === 'model');
    for (const [i, m] of models.entries()) {
      await placeModel(m.id, at ? [at[0] + i * 2, at[1], at[2]] : undefined);
    }
    const sky = records.find((r) => r.type === 'hdri');
    if (sky && !models.length) void activateAsset(sky.id);
  };

  return (
    <div
      ref={viewportRef}
      className={`viewport ${fileHover ? 'file-hover' : ''} ${playing ? 'is-playing' : ''}`}
      data-asset-drop="viewport"
      onDragOver={(ev) => {
        if (!ev.dataTransfer.types.includes('Files')) return;
        ev.preventDefault();
        setFileHover(true);
      }}
      onDragLeave={() => setFileHover(false)}
      onDrop={(ev) => void onFileDrop(ev)}
    >
      <div ref={containerRef} className="viewport-canvas" />
      {playing && (
        <div className={`playing-badge ${paused ? 'paused' : ''}`} title={`${stopKey} stops the game`}>
          <span className="live-dot" />
          {paused ? 'Paused' : 'Playing'}
          <span className="hint">
            {paused
              ? `Inspect freely · ${keyLabel('pause')} resume · ${keyLabel('step')} step · ${stopKey} stop`
              : gameView
                ? `Click to look · ${stopKey} stop`
                : `WASD move · Space jump · E interact · ${stopKey} stop`}
          </span>
        </div>
      )}
      {fileHover && <div className="drop-hint">Drop to import & place in the scene</div>}
      {gpuLost && (
        <div className="gpu-lost" role="alert">
          <Icon name="alert" size={18} />
          <strong>The 3D view stopped</strong>
          {gpuLost === 'off' ? (
            <p>The graphics chip crashed a few times, so Chrome switched it off for this page, and reloading won&apos;t bring it back. Quit Chrome completely (Cmd+Q on a Mac, or close every Chrome window) and open it again. Your project is kept.</p>
          ) : (
            <>
              <p>The graphics chip had too much to do at once (a big scene and the AI together), so the browser reset it. Your project is kept. Reload to get the view back; lowering Quality or the AI&apos;s &quot;Use up to&quot; helps it not happen again.</p>
              <button className="primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </>
          )}
        </div>
      )}
      <div className="viewport-overlay">
        <select className="quality-select" value={quality} onChange={(e) => setQualityState(e.target.value as QualityLevel)} title="Quality: lower it if the scene is slow (fewer grass blades, shorter draw distance, simpler shadows)">
          {QUALITY_LEVELS.map((q) => (
            <option key={q} value={q}>
              Quality: {q[0].toUpperCase() + q.slice(1)}
            </option>
          ))}
        </select>
        <button
          className={editLight ? 'active' : ''}
          onClick={() => setEditLight((v) => !v)}
          title="Extra light and no fog while editing (the game still looks the same)"
        >
          <Icon name="lightbulb" />
          Bright editing
        </button>
        <button
          className={showColliders ? 'active' : ''}
          onClick={() => setShowColliders((v) => !v)}
          title="Show the invisible physics shapes"
        >
          <Icon name="brick-wall" />
          Colliders
        </button>
        <button
          className={gameView ? 'active' : ''}
          onClick={() => setGameView(!gameView)}
          title="Look through the scene's Main Camera"
        >
          <Icon name={gameView ? 'video' : 'camera'} />
          {gameView ? 'Game camera' : 'Editor camera'}
        </button>
      </div>
      <div className="viewport-status">
        {status === 'ready'
          ? `${sceneName} · ${objectCount} objects · ${stats.fps} FPS · ${formatTris(stats.triangles)} triangles`
          : status}
      </div>
    </div>
  );
}
