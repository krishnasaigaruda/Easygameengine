import { ModelRenderer } from '@ege/runtime';
import { animate } from '../editor/componentActions';
import { openAnimationStudio } from '../rigging/AnimationStudio';
import { openExport } from '../export/ExportDialog';
import { toggleAiSidebar, useAiSidebar } from '../ai/sidebar';
import { assetSummary } from '../assets/library';
import { useEditor, type GizmoTool } from '../state/editorStore';
import { redo, undo } from '../editor/actions';
import {
  chooseFolder,
  exportProject,
  reconnectProjectFolder,
  renameProject,
  saveNow,
  stopUsingFolder,
  takeOverProject,
} from '../editor/project';
import { folderSupported, useFolder } from '../persistence/projectFolder';
import { keyLabel } from '../editor/keymap';
import { openShortcuts } from './ShortcutsDialog';
import { useMenu, type MenuEntry } from '../ui/Menu';
import { play, playInNewTab, stepFrame, stop, togglePause } from '../editor/play';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';

const TOOLS: { tool: GizmoTool; label: string; icon: string; key: string }[] = [
  { tool: 'view', label: 'Hand', icon: 'hand', key: 'Q' },
  { tool: 'translate', label: 'Move', icon: 'move', key: 'W' },
  { tool: 'rotate', label: 'Rotate', icon: 'rotate-3d', key: 'E' },
  { tool: 'scale', label: 'Scale', icon: 'scale-3d', key: 'R' },
];

const SAVE_TEXT = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed' } as const;
const SAVE_ICON = { saved: 'check', saving: 'refresh', unsaved: 'circle-dot', error: 'alert' } as const;

/** Project-folder entries for the project menu. */
function folderItems(): MenuEntry[] {
  if (!folderSupported()) {
    return [{ label: 'Save to a folder (needs Chrome or Edge)', icon: 'folder', disabled: true, onSelect: () => {} }];
  }
  const f = useFolder.getState();
  const items: MenuEntry[] = [];
  if (f.status === 'none') items.push({ label: 'Choose project folder…', icon: 'folder', onSelect: () => void chooseFolder() });
  else {
    if (f.status === 'locked') items.push({ label: `Reconnect folder "${f.name}"`, icon: 'refresh', onSelect: () => void reconnectProjectFolder() });
    items.push({ label: 'Move to another folder…', icon: 'folder', onSelect: () => void chooseFolder() });
    items.push({ label: `Stop saving to "${f.name}"`, icon: 'x', onSelect: () => void stopUsingFolder() });
  }
  return items;
}

export function Toolbar() {
  const aiOpen = useAiSidebar((s) => s.open);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const snap = useEditor((s) => s.snap);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const history = useEditor((s) => s.history);
  useEditor((s) => s.historyRevision);
  const engine = useEditor((s) => s.engine);
  const projectName = useEditor((s) => s.projectName);
  const saveStatus = useEditor((s) => s.saveStatus);
  const playing = useEditor((s) => s.playing);
  const paused = useEditor((s) => s.paused);
  const menu = useMenu();
  const folder = useFolder();
  const suspended = useEditor((s) => s.suspended);
  const dimension = useEditor((s) => s.dimension);

  /** Animation tools for the selected model (or the model inside it). */
  const openAnimateMenu = (x: number, y: number) => {
    const s = useEditor.getState();
    // A model object in the scene, or a model in the Project panel.
    const picked = s.selection ? s.engine?.world.getById(s.selection) : undefined;
    const object = picked && [...picked.descendants(true)].find((e) => e.has(ModelRenderer) && e.get(ModelRenderer)?.model);
    const asset = !object && s.assetSelection ? assetSummary(s.assetSelection) : undefined;
    const modelAsset = asset?.type === 'model' ? asset : undefined;
    const target = object ? { entityId: object.id } : modelAsset ? { assetId: modelAsset.id } : null;
    const hint = object ? object.name : modelAsset ? modelAsset.name : 'Select a model (in the scene or the Project panel)';
    menu.open(x, y, [
      { label: hint, disabled: true },
      { label: 'Animation Studio: skeleton, free animations, your own, code points', icon: 'activity', disabled: !target, onSelect: () => target && openAnimationStudio(target) },
      { label: 'Animator: idle / walk / run by itself (scene objects)', icon: 'footprints', disabled: !object, onSelect: () => object && animate(object) },
    ]);
  };

  const openProjectMenu = async (x: number, y: number) => {
    if (!engine) return;
    if (playing) stop(); // switching projects mid-game would save a half-played scene
    const items: MenuEntry[] = [
      { label: 'Projects…', icon: 'folder', onSelect: () => useEditor.getState().setHubOpen(true) },
      'separator',
      {
        label: 'Rename project…',
        icon: 'pencil',
        onSelect: () => {
          const name = window.prompt('Project name', projectName);
          if (name) void renameProject(name);
        },
      },
      { label: 'Save now', icon: 'save', shortcut: keyLabel('save'), onSelect: () => void saveNow() },
      ...folderItems(),
      { label: 'Export project file…', icon: 'download', onSelect: () => void exportProject() },
    ];
    menu.open(x, y, items);
  };

  return (
    <div className="toolbar">
      <span className="logo">
        <Logo />
        <span>Easy Game Engine</span>
      </span>
      <button
        className="project-button"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          void openProjectMenu(r.left, r.bottom + 2);
        }}
        title="Project menu"
      >
        <span>{projectName}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {suspended ? (
        <button className="small save-status error" onClick={() => takeOverProject()} title="This project is open in another tab, so this tab doesn't save. Click to work in this tab instead (the other one stops saving).">
          <Icon name="alert" size={12} />
          Open in another tab · Use here
        </button>
      ) : (
        <span className={`save-status ${saveStatus}`}>
          <Icon name={SAVE_ICON[saveStatus]} size={12} />
          {SAVE_TEXT[saveStatus]}
        </span>
      )}
      {folder.status === 'locked' && (
        <button className="small folder-chip locked" onClick={() => void reconnectProjectFolder()} title="The browser needs your OK to keep writing to this folder">
          <Icon name="folder" size={12} />
          Reconnect "{folder.name}"
        </button>
      )}
      {(folder.status === 'connected' || folder.status === 'error') && (
        <span className={`folder-chip ${folder.status}`} title={folder.error ?? `Everything is also saved as files in the folder "${folder.name}"`}>
          <Icon name={folder.status === 'error' ? 'alert' : 'folder-open'} size={12} />
          {folder.name}
        </span>
      )}

      <div className="toolbar-group">
        <button className="icon-only" disabled={!history?.canUndo} onClick={undo} title={`Undo ${history?.undoLabel ?? ''} (${keyLabel('undo')})`}>
          <Icon name="undo" />
        </button>
        <button className="icon-only" disabled={!history?.canRedo} onClick={redo} title={`Redo ${history?.redoLabel ?? ''} (${keyLabel('redo')})`}>
          <Icon name="redo" />
        </button>
      </div>

      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={tool === t.tool ? 'active' : ''}
            onClick={() => setTool(t.tool)}
            title={`${t.label} (${t.key})`}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
        <button className={snap ? 'active' : ''} onClick={toggleSnap} title="Snap to grid (G)">
          <Icon name="magnet" />
          Snap
        </button>
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openAnimateMenu(r.left, r.bottom + 2);
          }}
          title="Animation tools for the selected model: rig it, make your own animations, auto walk/run"
        >
          <Icon name="footprints" />
          Animate
        </button>
      </div>

      <div className="toolbar-group toolbar-center">
        <button
          className={`play icon-only ${playing ? 'active-play' : ''}`}
          title={`Play (${keyLabel('play')})`}
          onClick={() => void play()}
          disabled={playing || !engine}
        >
          <Icon name="play" />
        </button>
        <button
          className={`icon-only ${paused ? 'active' : ''}`}
          title={`${paused ? 'Resume' : 'Pause'} (${keyLabel('pause')})`}
          onClick={togglePause}
          disabled={!playing}
        >
          <Icon name="pause" />
        </button>
        <button className="icon-only" title={`Step one frame (${keyLabel('step')})`} onClick={stepFrame} disabled={!playing}>
          <Icon name="step" />
        </button>
        <button className="icon-only" title="Play in a new tab (full screen, like players see it)" onClick={() => void playInNewTab()}>
          <Icon name="external" />
        </button>
        <button className="icon-only" title="Stop (Esc)" onClick={stop} disabled={!playing}>
          <Icon name="stop" />
        </button>
      </div>

      <div className="toolbar-group">
        <span className="dimension-badge" title={dimension === '2d' ? 'A 2D project: seen from the side, everything on one flat plane' : 'A 3D project'}>
          {dimension === '2d' ? '2D' : '3D'}
        </span>
        <button className="icon-only" title="Keyboard shortcuts (?)" onClick={openShortcuts}>
          <Icon name="keyboard" />
        </button>
        <button className={`ai-toggle ${aiOpen ? 'active' : ''}`} onClick={toggleAiSidebar} title="AI assistant: builds and changes your game with you (runs on this computer)">
          <Icon name="sparkles" size={14} />
          AI
        </button>
        <button className="primary" onClick={openExport} disabled={!engine} title="Download the game as a website any static host can run">
          Export
        </button>
      </div>
      {menu.element}
    </div>
  );
}
