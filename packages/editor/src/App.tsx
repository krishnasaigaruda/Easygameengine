import { useEffect, useState } from 'react';
import { Toolbar } from './panels/Toolbar';
import { Hierarchy } from './panels/Hierarchy';
import { Viewport } from './panels/Viewport';
import { Inspector } from './panels/Inspector';
import { ProjectPanel } from './panels/ProjectPanel';
import { ConsolePanel } from './panels/ConsolePanel';
import { Panel } from './panels/Panel';
import { Splitter } from './ui/Splitter';
import { useEditorShortcuts, useEngineErrorCapture } from './editor/shortcuts';
import { startAutosave } from './editor/project';
import { startAccessibility } from './ui/a11y';
import { AssetStore } from './store/AssetStore';
import { ScriptEditor } from './scripting/ScriptEditor';
import { ShortcutsDialog } from './panels/ShortcutsDialog';
import { AnimationStudio } from './rigging/AnimationStudio';
import { ExportDialog } from './export/ExportDialog';
import { RemoveBackgroundDialog } from './assets/RemoveBackgroundDialog';
import { ProjectHub } from './hub/ProjectHub';
import { ProfilerPanel } from './panels/ProfilerPanel';
import { AiSidebar } from './ai/AiSidebar';
import { GuidePanel } from './guide/GuidePanel';

const LAYOUT_KEY = 'ege.layout';
interface Layout {
  left: number;
  right: number;
  bottom: number;
}
const DEFAULT_LAYOUT: Layout = { left: 250, right: 320, bottom: 210 };
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<Layout> | null;
    return { ...DEFAULT_LAYOUT, ...saved };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function App() {
  useEditorShortcuts();
  useEngineErrorCapture();
  useEffect(() => startAutosave(), []);
  useEffect(() => startAccessibility(), []);
  const [layout, setLayout] = useState(loadLayout);
  const [bottomTab, setBottomTab] = useState<'console' | 'profiler'>('console');

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* storage unavailable: layout just won't persist */
    }
  }, [layout]);

  const resize = (key: keyof Layout, delta: number, min: number, max: number) =>
    setLayout((l) => ({ ...l, [key]: clamp(l[key] + delta, min, max) }));

  return (
    <div className="editor">
      <Toolbar />
      <div className="editor-main">
        <div
          className="editor-body"
          style={{
            gridTemplateColumns: `${layout.left}px 4px 1fr 4px ${layout.right}px`,
            gridTemplateRows: `1fr 4px ${layout.bottom}px`,
          }}
        >
          <Panel title="Hierarchy" className="area-hierarchy">
            <Hierarchy />
          </Panel>
          <Splitter
            direction="vertical"
            className="split-left"
            onDrag={(d) => resize('left', d, 160, 500)}
          />
          <div className="area-viewport">
            <Viewport />
            <GuidePanel />
          </div>
          <Splitter
            direction="vertical"
            className="split-right"
            onDrag={(d) => resize('right', -d, 220, 600)}
          />
          <Panel title="Inspector" className="area-inspector">
            <Inspector />
          </Panel>
          <Splitter
            direction="horizontal"
            className="split-bottom-left"
            onDrag={(d) => resize('bottom', -d, 80, 500)}
          />
          <Splitter
            direction="horizontal"
            className="split-bottom"
            onDrag={(d) => resize('bottom', -d, 80, 500)}
          />
          <Panel title="Project" className="area-project">
            <ProjectPanel />
          </Panel>
          <Panel
            title={
              <span className="panel-tabs">
                {(['console', 'profiler'] as const).map((t) => (
                  <button
                    key={t}
                    className={`panel-tab ${bottomTab === t ? 'active' : ''}`}
                    onClick={() => setBottomTab(t)}
                  >
                    {t === 'console' ? 'Console' : 'Profiler'}
                  </button>
                ))}
              </span>
            }
            className="area-console"
          >
            {bottomTab === 'console' ? <ConsolePanel /> : <ProfilerPanel />}
          </Panel>
        </div>
        <AiSidebar />
      </div>
      <ShortcutsDialog />
      <AnimationStudio />
      <ExportDialog />
      <RemoveBackgroundDialog />
      <ProjectHub />
      <AssetStore />
      <ScriptEditor />
    </div>
  );
}
