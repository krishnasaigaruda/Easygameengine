import { useRef } from 'react';
import type { ClipEvent } from '@ege/runtime';

/**
 * The Animation Studio's timeline: a ruler with the playhead, a row of pose keys and a row of code
 * points. Drag the playhead or a marker along the ruler; click a marker to select it.
 */
export function StudioTimeline({
  length,
  time,
  keys,
  events,
  selected,
  onTime,
  onMoveKey,
  onMoveEvent,
  onSelect,
  onDragStart = () => {},
}: {
  length: number;
  time: number;
  /** Times of the pose keys (null: this animation's poses can't be edited, e.g. a library clip). */
  keys: number[] | null;
  events: ClipEvent[];
  selected: { kind: 'key' | 'event'; index: number } | null;
  onTime: (t: number) => void;
  onMoveKey: (index: number, t: number) => void;
  onMoveEvent: (index: number, t: number) => void;
  onSelect: (s: { kind: 'key' | 'event'; index: number } | null) => void;
  /** A key or code point starts moving (so it can be undone). */
  onDragStart?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const span = Math.max(0.1, length);
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const t = ((clientX - r.left) / Math.max(1, r.width)) * span;
    return Math.round(Math.min(span, Math.max(0, t)) * 20) / 20; // 0.05 s steps
  };
  /** Press, then drag along the timeline. */
  const drag = (ev: React.PointerEvent, move: (t: number) => void) => {
    ev.preventDefault();
    ev.stopPropagation();
    move(timeAt(ev.clientX));
    const onMove = (e: PointerEvent) => move(timeAt(e.clientX));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const ticks: number[] = [];
  const step = span > 6 ? 1 : span > 2 ? 0.5 : 0.25;
  for (let t = 0; t <= span + 1e-6; t += step) ticks.push(Math.round(t * 100) / 100);
  const pct = (t: number) => `${(t / span) * 100}%`;

  return (
    <div className="studio-timeline">
      <div className="studio-rows-labels">
        <span>Time</span>
        <span>Poses</span>
        <span>Code</span>
      </div>
      <div className="studio-rows" ref={ref}>
        <div className="studio-ruler" onPointerDown={(e) => drag(e, onTime)} title="Drag to move through the animation">
          {ticks.map((t) => (
            <span key={t} className="studio-tick" style={{ left: pct(t) }}>
              {t}s
            </span>
          ))}
        </div>
        <div className="studio-row" onPointerDown={(e) => drag(e, onTime)}>
          {keys === null && <span className="studio-row-note">Ready-made animation: "Edit a copy" to change its poses</span>}
          {keys?.map((k, i) => (
            <button
              key={i}
              className={`studio-key ${selected?.kind === 'key' && selected.index === i ? 'selected' : ''}`}
              style={{ left: pct(k) }}
              title={`Pose at ${k.toFixed(2)} s: drag to change when`}
              onPointerDown={(e) => {
                onSelect({ kind: 'key', index: i });
                onDragStart();
                onTime(k);
                drag(e, (t) => {
                  onMoveKey(i, t);
                  onTime(t);
                });
              }}
            />
          ))}
        </div>
        <div className="studio-row" onPointerDown={(e) => drag(e, onTime)}>
          {events.map((ev, i) => (
            <button
              key={i}
              className={`studio-event ${selected?.kind === 'event' && selected.index === i ? 'selected' : ''}`}
              style={{ left: pct(ev.time) }}
              title={`At ${ev.time.toFixed(2)} s the object gets the message "${ev.message}": drag to change when`}
              onPointerDown={(e) => {
                onSelect({ kind: 'event', index: i });
                onDragStart();
                drag(e, (t) => onMoveEvent(i, t));
              }}
            >
              {ev.message}
            </button>
          ))}
        </div>
        <span className="studio-playhead" style={{ left: pct(Math.min(time, span)) }} />
      </div>
    </div>
  );
}
