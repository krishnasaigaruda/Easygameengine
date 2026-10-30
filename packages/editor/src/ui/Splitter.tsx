import type { PointerEvent as ReactPointerEvent } from 'react';

/** Drag handle between panels. Reports pixel deltas while dragging. */
export function Splitter({
  direction,
  onDrag,
  className,
}: {
  direction: 'vertical' | 'horizontal';
  onDrag: (delta: number) => void;
  className?: string;
}) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = direction === 'vertical' ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const pos = direction === 'vertical' ? ev.clientX : ev.clientY;
      onDrag(pos - last);
      last = pos;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return <div className={`splitter splitter-${direction} ${className ?? ''}`} onPointerDown={onPointerDown} />;
}
