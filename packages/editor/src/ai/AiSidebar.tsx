import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { AssistantPanel } from './AssistantPanel';
import { useAiSidebar } from './sidebar';

const MIN = 300;
const NORMAL = 380;
const readWidth = () => {
  try {
    return Number(localStorage.getItem('ege-ai-width')) || NORMAL;
  } catch {
    return NORMAL;
  }
};
const saveWidth = (w: number) => {
  try {
    localStorage.setItem('ege-ai-width', String(Math.round(w)));
  } catch {
    // not remembered
  }
};
const maxWidth = () => Math.max(MIN, Math.round(window.innerWidth * 0.7));

/** The AI assistant beside the editor (toolbar: AI). Drag its edge to resize; expand for a wide view. */
export function AiSidebar() {
  const { open, used } = useAiSidebar();
  const [width, setWidth] = useState(readWidth);
  const [dragging, setDragging] = useState(false);
  if (!used) return null;
  const wide = width > NORMAL + 120;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setDragging(true);
    const move = (ev: PointerEvent) => setWidth(Math.max(MIN, Math.min(maxWidth(), startW + startX - ev.clientX)));
    const up = (ev: PointerEvent) => {
      setDragging(false);
      saveWidth(Math.max(MIN, Math.min(maxWidth(), startW + startX - ev.clientX)));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const toggleWide = () => {
    const w = wide ? NORMAL : Math.min(maxWidth(), 680);
    setWidth(w);
    saveWidth(w);
  };

  return (
    <aside className="ai-sidebar" hidden={!open} aria-label="AI assistant" style={{ '--ai-width': `${width}px` } as React.CSSProperties}>
      <div className={`ai-resize ${dragging ? 'dragging' : ''}`} onPointerDown={startDrag} title="Drag to resize" role="separator" aria-orientation="vertical" />
      <header className="ai-sidebar-head">
        <Icon name="sparkles" size={14} />
        <span>AI assistant</span>
        <button className="icon-only" title={wide ? 'Narrower' : 'Wider'} onClick={toggleWide}>
          <Icon name={wide ? 'minimize' : 'maximize'} size={13} />
        </button>
        <button className="icon-only" title="Close" onClick={() => useAiSidebar.setState({ open: false })}>
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="ai-sidebar-body">
        <AssistantPanel />
      </div>
    </aside>
  );
}
