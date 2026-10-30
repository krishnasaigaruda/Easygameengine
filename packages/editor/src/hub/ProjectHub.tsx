import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/editorStore';
import {
  deleteAllData,
  deleteProjectById,
  emptyScene,
  emptyScene2D,
  getProjects,
  importProject,
  listTemplates,
  newFromTemplate,
  newProject,
  openFolder,
  openProject,
  renameProjectById,
  type ProjectTemplate,
} from '../editor/project';
import { listAssets, loadProject, type ProjectSummary } from '../persistence/projectStore';
import { downloadBytes, projectFileName, toProjectZip, PROJECT_FILE_EXTENSION } from '../persistence/projectFile';
import { folderSupported } from '../persistence/projectFolder';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { HubCredits, HubDocs } from './HubPages';

/** How long ago, in words. */
function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return Math.floor(s / 86400) === 1 ? '1 day ago' : `${Math.floor(s / 86400)} days ago`;
  return new Date(t).toLocaleDateString();
}

/** What a "new" card makes: an empty 3D or 2D project, or a template. */
type Starter = { kind: 'empty'; dimension: '3d' | '2d' } | { kind: 'template'; template: ProjectTemplate };

/** The Project Hub: every project, new 3D / 2D projects, and templates. Shown when the editor opens. */
export function ProjectHub() {
  const open = useEditor((s) => s.hubOpen);
  if (!open) return null;
  return <HubWindow />;
}

function HubWindow() {
  const engine = useEditor((s) => s.engine);
  const currentId = useEditor((s) => s.projectId);
  const setHubOpen = useEditor((s) => s.setHubOpen);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [starting, setStarting] = useState<Starter | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState<'projects' | 'learn' | 'credits'>('projects');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => void getProjects().then(setProjects, () => setProjects([]));
  useEffect(() => {
    refresh();
    void listTemplates().then(setTemplates);
  }, [currentId]);

  const close = () => setHubOpen(false);
  const run = async (job: () => Promise<unknown>) => {
    if (!engine || busy) return;
    setBusy(true);
    try {
      await job();
      close();
    } finally {
      setBusy(false);
    }
  };

  const begin = (s: Starter) => {
    setStarting(s);
    setName(s.kind === 'template' ? s.template.name : s.dimension === '2d' ? 'My 2D Game' : 'My 3D Game');
  };
  const create = () => {
    const s = starting;
    if (!s || !engine) return;
    const n = name.trim() || 'My Game';
    void run(async () => {
      if (s.kind === 'template') await newFromTemplate(engine, s.template, n);
      else await newProject(engine, n, s.dimension === '2d' ? emptyScene2D() : emptyScene());
      setStarting(null);
    });
  };

  const exportOne = async (p: ProjectSummary) => {
    const record = await loadProject(p.id);
    if (!record) return;
    downloadBytes(projectFileName(record.name), await toProjectZip(record.name, record.scene, await listAssets(p.id)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (starting) setStarting(null);
      else if (currentId) close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const shown = (projects ?? []).filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));
  const tutorials = templates.filter((t) => /tutorial/i.test(t.id));
  const games = templates.filter((t) => !/tutorial/i.test(t.id));

  const card = (s: Starter, title: string, sub: string, icon: string, key: string) => (
    <button key={key} className="hub-card" disabled={busy || !engine} onClick={() => begin(s)}>
      <span className="hub-card-icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="hub-card-title">{title}</span>
      <span className="hub-card-sub">{sub}</span>
    </button>
  );

  return (
    <div className="hub">
      <header className="hub-top">
        <Logo />
        <span className="hub-brand">Easy Game Engine</span>
        <nav className="hub-tabs">
          {(
            [
              ['projects', 'Projects', 'folder'],
              ['learn', 'Learn', 'graduation-cap'],
              ['credits', 'Credits & licences', 'heart'],
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} className={`hub-tab ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
              <Icon name={icon} size={13} />
              {label}
            </button>
          ))}
        </nav>
        <span className="hub-spacer" />
        <button className="small" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Icon name="upload" size={12} />
          Open a project file
        </button>
        {folderSupported() && engine && (
          <button className="small" onClick={() => void run(() => openFolder(engine))} disabled={busy}>
            <Icon name="folder-open" size={12} />
            Open a project folder
          </button>
        )}
        {currentId && (
          <button className="small" onClick={close} title="Back to the open project (Esc)">
            <Icon name="x" size={12} />
            Back to the editor
          </button>
        )}
      </header>

      {page === 'learn' && <HubDocs />}
      {page === 'credits' && (
        <div className="hub-body">
          <HubCredits />
        </div>
      )}
      <div className="hub-body" hidden={page !== 'projects'}>
        <section>
          <h2 className="hub-h">Start something new</h2>
          <div className="hub-cards">
            {card({ kind: 'empty', dimension: '3d' }, 'New 3D project', 'An empty 3D world', 'box', 'new3d')}
            {card({ kind: 'empty', dimension: '2d' }, 'New 2D project', 'An empty side-on 2D world', 'square', 'new2d')}
            {tutorials.map((t) => card({ kind: 'template', template: t }, t.name, t.description, 'graduation-cap', t.id))}
            {games.map((t) => card({ kind: 'template', template: t }, t.name, t.description, t.dimension === '2d' ? 'gamepad' : 'trees', t.id))}
          </div>
        </section>

        <section>
          <div className="hub-row-head">
            <h2 className="hub-h">Your projects</h2>
            <input className="hub-search" placeholder="Search projects…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {projects === null && <p className="muted">Loading…</p>}
          {projects?.length === 0 && <p className="muted">No projects yet. Start one above.</p>}
          <div className="hub-list">
            {shown.map((p) => (
              <div key={p.id} className={`hub-project ${p.id === currentId ? 'current' : ''}`}>
                <span className="hub-kind">{p.dimension === '2d' ? '2D' : '3D'}</span>
                {renaming === p.id ? (
                  <input
                    className="hub-rename"
                    autoFocus
                    defaultValue={p.name}
                    onBlur={(e) => {
                      setRenaming(null);
                      void renameProjectById(p.id, e.target.value).then(refresh);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button className="hub-project-name" onClick={() => engine && void run(() => (p.id === currentId ? Promise.resolve() : openProject(engine, p.id)))}>
                    {p.name}
                    {p.id === currentId && <span className="hub-open-tag">open now</span>}
                  </button>
                )}
                <span className="muted hub-meta">
                  {p.objects} object{p.objects === 1 ? '' : 's'} · edited {ago(p.updatedAt)}
                </span>
                {confirmDelete === p.id ? (
                  <span className="hub-confirm">
                    Delete it and its assets? This can't be undone.
                    <button
                      className="small danger"
                      onClick={() => {
                        setConfirmDelete(null);
                        if (engine) void deleteProjectById(engine, p.id).then(refresh);
                      }}
                    >
                      Delete
                    </button>
                    <button className="small" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className="hub-actions">
                    <button className="icon-btn" title="Rename" onClick={() => setRenaming(p.id)}>
                      <Icon name="pencil" size={14} />
                    </button>
                    <button className="icon-btn" title={`Save as a project file (${PROJECT_FILE_EXTENSION})`} onClick={() => void exportOne(p)}>
                      <Icon name="download" size={14} />
                    </button>
                    <button className="icon-btn" title="Delete" onClick={() => setConfirmDelete(p.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                    <button className="small" disabled={busy} onClick={() => engine && void run(() => (p.id === currentId ? Promise.resolve() : openProject(engine, p.id)))}>
                      Open
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>

        <footer className="hub-foot">
          {confirmWipe ? (
            <span className="hub-confirm">
              Delete every project and asset saved in this browser? Project folders on your computer stay.
              <button className="small danger" onClick={() => void deleteAllData()}>
                Delete everything
              </button>
              <button className="small" onClick={() => setConfirmWipe(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button className="link-btn" onClick={() => setConfirmWipe(true)}>
              Delete all saved data…
            </button>
          )}
        </footer>
      </div>

      {starting && (
        <div className="hub-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setStarting(null)}>
          <div className="hub-modal" role="dialog" aria-modal="true" aria-label="New project">
            <h3>{starting.kind === 'template' ? starting.template.name : starting.dimension === '2d' ? 'New 2D project' : 'New 3D project'}</h3>
            {starting.kind === 'template' && <p className="muted">{starting.template.description}</p>}
            <label className="field-label">Project name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
            <div className="hub-modal-actions">
              <button className="small" onClick={() => setStarting(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={create}>
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={`${PROJECT_FILE_EXTENSION},application/json`}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && engine) void run(() => importProject(engine, file));
        }}
      />
    </div>
  );
}
