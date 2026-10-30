import { Fragment, useRef, useState, type DragEvent } from 'react';
import type { AssetType } from '@ege/runtime';
import { createMaterial, createScript, useLibrary, type AssetSummary } from '../assets/library';
import { openScriptEditor } from '../scripting/scriptEditorState';
import { useEditor } from '../state/editorStore';
import { importFiles } from '../assets/importActions';
import { filesFromDataTransfer, filesFromInput } from '../assets/importer';
import {
  deleteAssetSafely,
  activateAsset,
  materialFromTexture,
  placeModel,
} from '../editor/assetActions';
import { startAssetDrag } from '../ui/assetDrag';
import { useMenu } from '../ui/Menu';
import { openAssetStore } from '../store/storeState';
import { Icon } from '../ui/Icon';

const FILTERS: { type: AssetType | 'all'; label: string }[] = [
  { type: 'all', label: 'All' },
  { type: 'model', label: 'Models' },
  { type: 'material', label: 'Materials' },
  { type: 'texture', label: 'Textures' },
  { type: 'hdri', label: 'Skies' },
  { type: 'audio', label: 'Audio' },
  { type: 'script', label: 'Scripts' },
];

/** 2D projects don't use these. */
const NOT_IN_2D = new Set<AssetType | 'all'>(['model', 'material', 'hdri']);

export const TYPE_ICON: Record<AssetType, string> = {
  model: 'shapes',
  material: 'palette',
  texture: 'image',
  hdri: 'sunrise',
  audio: 'volume',
  script: 'script',
  data: 'file',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectPanel() {
  const assets = useLibrary((s) => s.assets);
  const loading = useLibrary((s) => s.loading);
  const assetSelection = useEditor((s) => s.assetSelection);
  const selectAsset = useEditor((s) => s.selectAsset);
  const is2D = useEditor((s) => s.dimension === '2d');
  const [chosenFilter, setFilter] = useState<AssetType | 'all'>('all');
  const filter = is2D && NOT_IN_2D.has(chosenFilter) ? 'all' : chosenFilter;
  const [query, setQuery] = useState('');
  const [fileHover, setFileHover] = useState(false);
  /** Model packs opened with their arrow (showing the models inside). */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggleOpen = (id: string) =>
    setOpened((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const menu = useMenu();

  const q = query.trim().toLowerCase();
  const partMatches = (a: AssetSummary) =>
    (a.parts ?? []).filter((p) => p.name.toLowerCase().includes(q));
  const visible = assets.filter(
    (a) =>
      (filter === 'all' || a.type === filter) &&
      (!q || a.name.toLowerCase().includes(q) || partMatches(a).length > 0),
  );
  // Searching finds models inside packs too: those packs open on the matches.
  const shownParts = (a: AssetSummary) =>
    !a.parts?.length
      ? []
      : q && !a.name.toLowerCase().includes(q)
        ? partMatches(a)
        : opened.has(a.id)
          ? a.parts
          : [];

  const onDrop = async (ev: DragEvent) => {
    ev.preventDefault();
    setFileHover(false);
    const records = await importFiles(await filesFromDataTransfer(ev.dataTransfer));
    if (records[0]) selectAsset(records[0].id);
  };

  const tileMenu = (a: AssetSummary, x: number, y: number) =>
    menu.open(x, y, [
      {
        label:
          a.type === 'model'
            ? 'Add to scene'
            : a.type === 'hdri'
              ? 'Use as sky'
              : a.type === 'texture' || a.type === 'material'
                ? 'Apply to selected object'
                : a.type === 'script'
                  ? 'Edit script'
                  : 'Use',
        icon: 'plus',
        onSelect: () => void activateAsset(a.id),
      },
      ...(a.type === 'texture'
        ? [
            {
              label: 'Create material',
              icon: 'palette',
              onSelect: async () => {
                const id = await materialFromTexture(a.id);
                if (id) selectAsset(id);
              },
            },
          ]
        : []),
      { label: 'Show details', icon: 'info', onSelect: () => selectAsset(a.id) },
      'separator',
      {
        label: 'Delete',
        icon: 'trash',
        danger: true,
        onSelect: () => void deleteAssetSafely(a.id),
      },
    ]);

  return (
    <div
      className={`project ${fileHover ? 'file-hover' : ''}`}
      onDragOver={(ev) => {
        if (!ev.dataTransfer.types.includes('Files')) return;
        ev.preventDefault();
        setFileHover(true);
      }}
      onDragLeave={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setFileHover(false);
      }}
      onDrop={(ev) => void onDrop(ev)}
    >
      <div className="project-toolbar">
        <button
          className="primary small"
          onClick={() => openAssetStore()}
          title="Browse 20,000+ free assets"
        >
          <Icon name="shop" size={12} />
          Asset Store
        </button>
        <button
          className="small"
          onClick={(ev) => {
            const r = ev.currentTarget.getBoundingClientRect();
            menu.open(r.left, r.bottom + 2, [
              {
                label: 'Import models, textures, sounds…',
                icon: 'file',
                onSelect: () => fileInput.current?.click(),
              },
              {
                label: 'Import folder…',
                icon: 'folder-open',
                onSelect: () => folderInput.current?.click(),
              },
              'separator',
              {
                label: 'New material',
                icon: 'palette',
                onSelect: async () => {
                  const id = await createMaterial('New Material');
                  if (id) selectAsset(id);
                },
              },
              {
                label: 'New script',
                icon: 'script',
                onSelect: async () => {
                  const id = await createScript('New Script');
                  if (id) {
                    selectAsset(id);
                    openScriptEditor(id);
                  }
                },
              },
            ]);
          }}
        >
          <Icon name="plus" size={12} />
          New
        </button>
        <div className="chips">
          {FILTERS.filter((f) => !is2D || !NOT_IN_2D.has(f.type)).map((f) => (
            <button
              key={f.type}
              className={`chip ${filter === f.type ? 'active' : ''}`}
              onClick={() => setFilter(f.type)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="Search assets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="empty">Loading assets…</p>
      ) : assets.length === 0 ? (
        <div className="project-empty">
          <p>
            <strong>No assets yet.</strong> Drag 3D models (.glb .gltf .fbx .obj), textures (.png
            .jpg .webp), skies (.hdr .exr) or sounds here, or grab free ones from the Asset Store.
          </p>
          <button className="primary" onClick={() => openAssetStore()}>
            <Icon name="shop" />
            Open Asset Store
          </button>
        </div>
      ) : (
        <div
          className="asset-grid"
          onClick={(e) => e.target === e.currentTarget && selectAsset(null)}
        >
          {visible.map((a) => (
            <Fragment key={a.id}>
              <div
                className={`asset-tile ${assetSelection === a.id ? 'selected' : ''}`}
                title={`${a.name} — ${a.type}, ${formatBytes(a.size)}\nDouble-click to use, drag into the scene`}
                onClick={() => selectAsset(a.id)}
                onDoubleClick={() => void activateAsset(a.id)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  selectAsset(a.id);
                  tileMenu(a, ev.clientX, ev.clientY);
                }}
                onPointerDown={(ev) => startAssetDrag(ev, a.id, a.name, a.thumbnailUrl)}
              >
                <div className="asset-thumb">
                  {a.thumbnailUrl ? (
                    <img src={a.thumbnailUrl} alt="" draggable={false} />
                  ) : (
                    <Icon name={TYPE_ICON[a.type]} size={28} strokeWidth={1.25} className="muted" />
                  )}
                  {a.animations.length > 0 && (
                    <span className="badge anim" title={`${a.animations.length} animation(s)`}>
                      <Icon name="play" size={8} strokeWidth={3} />
                      {a.animations.length}
                    </span>
                  )}
                  {a.credit && a.credit.provider !== 'user' && (
                    <span className="badge license">
                      {a.credit.license?.replace('-4.0', '').replace('-1.0', '')}
                    </span>
                  )}
                </div>
                <div className="asset-name">{a.name}</div>
                {a.parts && a.parts.length > 0 && (
                  <button
                    className={`asset-open ${shownParts(a).length ? 'open' : ''}`}
                    title={
                      shownParts(a).length
                        ? 'Hide the models inside'
                        : `Show the ${a.parts.length} models inside, to use them one by one`
                    }
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onDoubleClick={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      toggleOpen(a.id);
                    }}
                  >
                    <Icon name="chevron-right" size={16} strokeWidth={2.5} />
                    <span>{a.parts.length}</span>
                  </button>
                )}
              </div>
              {shownParts(a).map((p) => (
                <div
                  key={`${a.id}#${p.path}`}
                  className="asset-tile part"
                  title={`${p.name}: one of the models in ${a.name}\nDouble-click to add it, or drag it into the scene`}
                  onDoubleClick={() => void placeModel(a.id, undefined, p.path)}
                  onPointerDown={(ev) => startAssetDrag(ev, a.id, p.name, p.thumbnailUrl, p.path)}
                >
                  <div className="asset-thumb">
                    {p.thumbnailUrl ? (
                      <img src={p.thumbnailUrl} alt="" draggable={false} />
                    ) : (
                      <Icon name="shapes" size={24} strokeWidth={1.25} className="muted" />
                    )}
                  </div>
                  <div className="asset-name">{p.name}</div>
                </div>
              ))}
            </Fragment>
          ))}
          {visible.length === 0 && (
            <p className="empty">No {filter === 'all' ? '' : filter} assets match.</p>
          )}
        </div>
      )}

      {fileHover && <div className="drop-hint">Drop files to import</div>}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(filesFromInput(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        // @ts-expect-error non-standard but supported by all major browsers
        webkitdirectory=""
        onChange={(e) => {
          if (e.target.files) void importFiles(filesFromInput(e.target.files));
          e.target.value = '';
        }}
      />
      {menu.element}
    </div>
  );
}
