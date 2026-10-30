import { useEffect, useState } from 'react';
import { useEditor } from '../state/editorStore';
import { Icon } from '../ui/Icon';
import { closeGuide, goToStep, resumeGuide, tickGuide, useGuide } from './guide';

/** The tutorial guide, over the corner of the viewport: one step at a time, ticked off by doing it. */
export function GuidePanel() {
  const projectId = useEditor((s) => s.projectId);
  const hubOpen = useEditor((s) => s.hubOpen);
  const guide = useGuide((s) => s.guide);
  const step = useGuide((s) => s.step);
  const [small, setSmall] = useState(false);

  useEffect(() => resumeGuide(projectId), [projectId]);
  useEffect(() => {
    if (!guide) return;
    const t = setInterval(tickGuide, 400);
    return () => clearInterval(t);
  }, [guide]);

  if (!guide || hubOpen) return null;
  const total = guide.steps.length;
  const finished = step >= total;
  const current = guide.steps[Math.min(step, total - 1)];
  return (
    <div className={`guide ${small ? 'small' : ''}`}>
      <header className="guide-head">
        <Icon name="graduation-cap" size={14} />
        <span className="guide-title">{guide.title}</span>
        <span className="muted">{finished ? 'Done' : `${step + 1} / ${total}`}</span>
        <button className="icon-btn" title={small ? 'Show' : 'Make smaller'} onClick={() => setSmall(!small)}>
          <Icon name={small ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
        <button className="icon-btn" title="Close the tutorial" onClick={closeGuide}>
          <Icon name="x" size={14} />
        </button>
      </header>
      {!small && (
        <div className="guide-body">
          <div className="guide-bar">
            <span style={{ width: `${(Math.min(step, total) / total) * 100}%` }} />
          </div>
          {finished ? (
            <>
              <h4>You made a game!</h4>
              <p>That's the whole loop: build, play, change, play again. Keep adding to it, or press Export to share it.</p>
              <button className="small" onClick={closeGuide}>
                Close the tutorial
              </button>
            </>
          ) : (
            <>
              <h4>{current.title}</h4>
              <p>{current.text}</p>
              <div className="guide-actions">
                {step > 0 && (
                  <button className="small" onClick={() => goToStep(step - 1)}>
                    Back
                  </button>
                )}
                <span className="hub-spacer" />
                <button className="small" onClick={() => goToStep(step + 1)} title={current.done ? 'It ticks itself off when you do it' : ''}>
                  {current.done ? 'Skip' : 'Next'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
