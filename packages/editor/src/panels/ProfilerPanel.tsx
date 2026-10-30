import { useEffect, useState } from 'react';
import type { EngineProfile } from '@ege/runtime';
import { useEditor } from '../state/editorStore';

const HISTORY = 90;

/** What each engine part is, in words (system names are code names). */
const SYSTEM_LABELS: Record<string, string> = {
  physics: 'Physics',
  scripts: 'Scripts',
  render: 'Objects → 3D scene',
  models: 'Models & animation',
  terrain: 'Terrain',
  grass: 'Grass',
  scatter: 'Plants',
  cameras: 'Cameras',
  audio: 'Sound',
  ui: 'Screen UI',
  effects: 'Effects',
  environment: 'Sky, sun & fog',
  keyframes: 'Keyframes',
  sprites: 'Sprites',
  weapons: 'Weapons',
  instancing: 'Repeated models',
};

/** Plain advice when something is heavy. */
function tips(p: EngineProfile): string[] {
  const out: string[] = [];
  if (p.triangles > 3_000_000) out.push(`${(p.triangles / 1e6).toFixed(1)}M triangles: lower the Quality, Optimize big models, or shorten plants' "Seen up to".`);
  if (p.drawCalls > 1500) out.push(`${p.drawCalls} draw calls: many separate objects. Optimize models (shared parts draw together) and use Plants instead of many copies.`);
  const physics = p.systems.find((s) => s.name === 'physics');
  if (physics && physics.ms > 4) out.push('Physics is busy: exact-mesh colliders on big models are expensive; Auto or simple shapes are cheaper.');
  const scripts = p.systems.find((s) => s.name === 'scripts');
  if (scripts && scripts.ms > 3) out.push('Scripts are busy: "Every frame" handlers run 60 times a second; timers are cheaper.');
  if (p.textures > 300) out.push(`${p.textures} textures in memory: Optimize models to shrink their pictures.`);
  return out;
}

/** The profiler: how fast the game runs and what takes the time. */
export function ProfilerPanel() {
  const engine = useEditor((s) => s.engine);
  const [p, setP] = useState<EngineProfile | null>(null);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    if (!engine) return;
    engine.setProfiling(true);
    const t = setInterval(() => {
      const now = engine.profile();
      setP(now);
      setHistory((h) => [...h.slice(-(HISTORY - 1)), now.frameMs]);
    }, 250);
    return () => {
      clearInterval(t);
      engine.setProfiling(false);
    };
  }, [engine]);

  if (!p) return <p className="muted profiler-empty">Measuring…</p>;
  const total = Math.max(0.01, p.updateMs + p.renderMs);
  const most = Math.max(0.01, ...p.systems.map((s) => s.ms));
  const top = Math.max(33, ...history);
  const advice = tips(p);
  return (
    <div className="profiler">
      <div className="profiler-top">
        <div className={`profiler-big ${p.fps < 30 ? 'bad' : p.fps < 50 ? 'meh' : ''}`}>
          <b>{p.fps}</b>
          <span>FPS</span>
        </div>
        <div className="profiler-big">
          <b>{p.frameMs.toFixed(1)}</b>
          <span>ms a frame</span>
        </div>
        <svg className="profiler-graph" viewBox={`0 0 ${HISTORY} 40`} preserveAspectRatio="none" aria-label="Frame time, last 20 seconds">
          <line x1="0" x2={HISTORY} y1={40 - (16.7 / top) * 40} y2={40 - (16.7 / top) * 40} className="profiler-target" />
          <polyline points={history.map((ms, i) => `${i + HISTORY - history.length},${40 - (ms / top) * 40}`).join(' ')} />
        </svg>
      </div>
      <div className="profiler-split" title="Where each frame goes">
        <span style={{ width: `${(p.updateMs / total) * 100}%` }} className="update">
          Game {p.updateMs.toFixed(1)} ms
        </span>
        <span style={{ width: `${(p.renderMs / total) * 100}%` }} className="render">
          Drawing {p.renderMs.toFixed(1)} ms
        </span>
      </div>
      <div className="profiler-cols">
        <div className="profiler-systems">
          {p.systems
            .filter((s) => s.ms > 0.005)
            .slice(0, 10)
            .map((s) => (
              <div key={s.name} className="profiler-row">
                <span>{SYSTEM_LABELS[s.name] ?? s.name}</span>
                <span className="profiler-bar">
                  <i style={{ width: `${(s.ms / most) * 100}%` }} />
                </span>
                <span className="profiler-ms">{s.ms.toFixed(2)} ms</span>
              </div>
            ))}
        </div>
        <div className="profiler-counts">
          <div className="kv"><span>Draw calls</span><span>{p.drawCalls.toLocaleString()}</span></div>
          <div className="kv"><span>Triangles</span><span>{p.triangles.toLocaleString()}</span></div>
          <div className="kv"><span>Objects</span><span>{p.objects.toLocaleString()}</span></div>
          <div className="kv"><span>Meshes in memory</span><span>{p.geometries}</span></div>
          <div className="kv"><span>Textures in memory</span><span>{p.textures}</span></div>
          <div className="kv"><span>Shaders</span><span>{p.shaders}</span></div>
          {p.heapMB !== null && <div className="kv"><span>Memory (JS)</span><span>{p.heapMB.toFixed(0)} MB</span></div>}
        </div>
      </div>
      {advice.length > 0 && (
        <ul className="profiler-tips">
          {advice.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
