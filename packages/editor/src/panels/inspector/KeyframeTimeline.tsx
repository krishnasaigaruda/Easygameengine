import { useEffect, useRef, useState } from 'react';
import { Keyframes, Transform, keyframesDuration, sampleKeyframes, type Entity, type Keyframe, type TransformData } from '@ege/runtime';
import { editComponent } from '../../editor/actions';
import { useEditor } from '../../state/editorStore';
import { Icon } from '../../ui/Icon';

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The Keyframes timeline: pick a time, pose the object (move / turn / scale it), add a key.
 * Picking a time shows the object posed there, so you see what you're keying.
 */
export function KeyframeTimeline({ entity }: { entity: Entity }) {
  useEditor((s) => s.revision);
  const engine = useEditor((s) => s.engine);
  const data = entity.require(Keyframes);
  const keys = [...data.keys].sort((a, b) => a.time - b.time);
  const duration = keyframesDuration(keys);
  const length = Math.max(2, Math.ceil(duration + 1));
  const [time, setTime] = useState(keys.length ? 0 : 0);
  const [previewing, setPreviewing] = useState(false);
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /** Show the object at a moment (by posing it; this is its pose in the editor from now on). */
  const goTo = (t: number) => {
    setTime(t);
    const pose = sampleKeyframes(keys, t, data.easing);
    if (pose) entity.set(Transform, pose);
  };

  const addKey = () => {
    const tr = entity.require(Transform) as TransformData;
    const key: Keyframe = { time: round(time), position: [...tr.position], rotation: [...tr.rotation], scale: [...tr.scale] };
    const next = [...keys.filter((k) => Math.abs(k.time - key.time) > 0.01), key].sort((a, b) => a.time - b.time);
    editComponent(entity, Keyframes.type, { keys: next }, `Key at ${key.time} s`);
  };

  const removeKey = (k: Keyframe) => editComponent(entity, Keyframes.type, { keys: keys.filter((x) => x !== k) }, 'Delete key');

  const preview = () => {
    if (!engine || keys.length < 2) return;
    cancelAnimationFrame(raf.current);
    setPreviewing(true);
    const start = performance.now();
    const step = () => {
      const t = ((performance.now() - start) / 1000) * (data.speed || 1);
      if (t > duration) {
        engine.keyframes.preview(entity.id, null);
        setPreviewing(false);
        return;
      }
      engine.keyframes.preview(entity.id, t);
      setTime(round(t));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  return (
    <div className="keyframe-timeline">
      <div className="kf-track" title="Keys on the timeline: click one to go to it">
        {keys.map((k) => (
          <button key={k.time} className="kf-key" style={{ left: `${(k.time / length) * 100}%` }} title={`${k.time} s`} onClick={() => goTo(k.time)} />
        ))}
        <span className="kf-cursor" style={{ left: `${(time / length) * 100}%` }} />
      </div>
      <div className="field">
        <label className="field-label">Time (s)</label>
        <div className="field-control">
          <input type="range" min={0} max={length} step={0.05} value={time} onChange={(e) => goTo(Number(e.target.value))} />
          <span className="kf-time">{time.toFixed(2)}</span>
        </div>
      </div>
      <div className="component-actions">
        <button className="small" onClick={addKey} title="Remember how the object is posed now, at this time">
          <Icon name="plus" size={12} />
          Add key at {time.toFixed(2)} s
        </button>
        <button className="small" onClick={preview} disabled={keys.length < 2 || previewing} title="Play it once in the viewport (nothing is changed)">
          <Icon name="play" size={12} />
          Preview
        </button>
      </div>
      {keys.length > 0 ? (
        <div className="layer-row">
          {keys.map((k) => (
            <span key={k.time} className="tag">
              <button className="tag-jump" onClick={() => goTo(k.time)}>
                {k.time} s
              </button>
              <button className="tag-remove" title="Delete this key" onClick={() => removeKey(k)}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="component-desc">Start with the starting pose: click "Add key at 0.00 s". Then pick a later time, move the object, and add another key.</p>
      )}
    </div>
  );
}
