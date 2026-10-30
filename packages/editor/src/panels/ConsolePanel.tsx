import { useEffect, useRef } from 'react';
import { useEditor } from '../state/editorStore';
import { Icon } from '../ui/Icon';

const ICON = { info: 'info', warn: 'alert', error: 'x-circle' } as const;

export function ConsolePanel() {
  const logs = useEditor((s) => s.logs);
  const select = useEditor((s) => s.select);
  const clear = useEditor((s) => s.clearLogs);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  return (
    <div className="console">
      <div className="console-toolbar">
        <button className="small" onClick={clear}>
          Clear
        </button>
        <span className="muted">{logs.length} messages</span>
      </div>
      {logs.map((l) => (
        <div
          key={l.id}
          className={`log log-${l.level} ${l.entityId ? 'clickable' : ''}`}
          onClick={() => l.entityId && select(l.entityId)}
        >
          <span className="log-time">{new Date(l.time).toLocaleTimeString()}</span>
          <span className="log-icon"><Icon name={ICON[l.level]} size={12} /></span>
          <span>{l.message}</span>
        </div>
      ))}
      <div ref={bottom} />
    </div>
  );
}
