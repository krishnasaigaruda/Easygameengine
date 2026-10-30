import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useStoreUi, closeAssetStore, type StoreTab, type StoreSource } from './storeState';
import { loadAmbientCG, loadObjaverse, loadPolyHaven, loadSmithsonian, searchItems, type StoreItem } from './catalog';
import { builtinEffects, loadBuiltinMaterials } from './builtin';
import { SUGGESTIONS, searchOpenverse } from './openverse';
import { searchCommons } from './commons';
import { useEditor } from '../state/editorStore';
import { markBroken, thumbLoaded, useBrokenItems } from './brokenItems';
import { addStoreItem, cancelStoreItem } from './downloader';
import { useLibrary } from '../assets/library';
import { activateAsset } from '../editor/assetActions';
import { Icon } from '../ui/Icon';

const TABS: { tab: StoreTab; label: string; icon: string }[] = [
  { tab: 'models', label: '3D Models', icon: 'shapes' },
  { tab: 'animated', label: 'Animated', icon: 'activity' },
  { tab: 'materials', label: 'Materials', icon: 'palette' },
  { tab: 'skies', label: 'Skies (HDRI)', icon: 'sunrise' },
  { tab: 'effects', label: 'Effects', icon: 'sparkles' },
  { tab: 'sounds', label: 'Sounds', icon: 'volume' },
  { tab: 'music', label: 'Music', icon: 'music' },
  { tab: 'images', label: 'Images', icon: 'image' },
];
/** What a 2D game can use (no 3D models, surfaces or skies). */
export const TABS_2D: ReadonlySet<StoreTab> = new Set<StoreTab>(['images', 'effects', 'sounds', 'music']);
/** Tabs searched live (images on Wikimedia Commons, sounds and music on Openverse). */
const REMOTE: Partial<Record<StoreTab, 'sound' | 'music' | 'image'>> = { sounds: 'sound', music: 'music', images: 'image' };

/** Live search, waiting a moment after typing stops. More pages load on request. */
function useRemoteItems(tab: StoreTab, query: string) {
  const kind = REMOTE[tab];
  const key = kind ? `${kind}:${query.trim().toLowerCase()}` : '';
  const [state, setState] = useState<{ key: string; items: StoreItem[] | null; error: string | null; pages: number; more: boolean }>({ key: '', items: null, error: null, pages: 0, more: false });
  const [wantPages, setWantPages] = useState({ key: '', pages: 1 });
  const pages = wantPages.key === key ? wantPages.pages : 1;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!kind) return;
    // A search nobody waits for any more is cancelled (don't queue up).
    const abort = new AbortController();
    const t = setTimeout(async () => {
      try {
        const all: StoreItem[] = [];
        let more = false;
        for (let p = 1; p <= pages; p++) {
          const page = kind === 'image' ? await searchCommons(query, p, abort.signal) : await searchOpenverse(kind, query, p, abort.signal);
          all.push(...page.items);
          more = page.more;
        }
        if (!abort.signal.aborted) setState({ key, items: all, error: null, pages, more });
      } catch (err) {
        if (!abort.signal.aborted) setState((s) => ({ key, items: s.key === key ? s.items : [], error: err instanceof Error ? err.message : String(err), pages, more: false }));
      }
    }, pages > 1 || attempt > 0 ? 0 : 700);
    return () => {
      abort.abort();
      clearTimeout(t);
    };
  }, [kind, key, query, pages, attempt]);
  if (!kind) return null;
  const current = state.key === key;
  return {
    items: current ? state.items : null,
    error: current ? state.error : null,
    retry: () => {
      setState((s) => ({ ...s, key: '' }));
      setAttempt((a) => a + 1);
    },
    more: current && state.more ? () => setWantPages({ key, pages: pages + 1 }) : null,
  };
}

/** "Searching…", with the seconds once it takes a while (Openverse can be slow). */
function SearchingNote({ source }: { source: string }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const waited = Math.floor((now - started) / 1000);
  return <>{waited >= 4 ? `Searching ${source}… ${waited} s (it can take a while)` : `Searching ${source}…`}</>;
}

/** One shared player for previews: starting one stops the last. */
let previewAudio: HTMLAudioElement | null = null;
function PreviewButton({ item }: { item: StoreItem }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => {
    if (playing) previewAudio?.pause();
  }, [playing]);
  const toggle = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (playing) {
      previewAudio?.pause();
      setPlaying(false);
      return;
    }
    previewAudio?.pause();
    previewAudio?.dispatchEvent(new Event('ended'));
    const a = new Audio(item.previewUrl);
    a.crossOrigin = 'anonymous';
    a.volume = 0.7;
    a.addEventListener('ended', () => setPlaying(false), { once: true });
    a.addEventListener('pause', () => setPlaying(false), { once: true });
    void a.play().catch(() => setPlaying(false));
    previewAudio = a;
    setPlaying(true);
  };
  return (
    <button className={`store-preview ${playing ? 'playing' : ''}`} onClick={toggle} title={playing ? 'Stop' : 'Listen'}>
      <Icon name={playing ? 'stop' : 'play'} size={26} strokeWidth={1.5} />
    </button>
  );
}

const KIND_ICON: Partial<Record<StoreItem['kind'], string>> = { hdri: 'sunrise', material: 'palette', sound: 'volume', music: 'music', effect: 'sparkles', image: 'image' };
const PAGE = 60;
const PREFIX: Record<string, string> = { objaverse: 'ov', polyhaven: 'ph', ambientcg: 'acg', smithsonian: 'si', openverse: 'ovs', commons: 'wc' };

function useItems(tab: StoreTab, source: StoreSource) {
  const [items, setItems] = useState<StoreItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState('');
  const key = `${tab}:${source}`;

  // Reset when the tab/source changes (state adjusted during render, not in an effect).
  if (requested !== key) {
    setRequested(key);
    setItems(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    const want = (p: StoreSource) => source === 'all' || source === p;
    const wantPh = want('polyhaven');
    const wantOv = want('objaverse') && (tab === 'models' || tab === 'animated');
    const jobs: Promise<StoreItem[]>[] = [];
    if (tab === 'effects') jobs.push(Promise.resolve(builtinEffects()));
    if (REMOTE[tab]) jobs.length = 0; // searched live instead
    if (tab === 'materials' && want('builtin')) jobs.push(loadBuiltinMaterials());
    if (tab === 'materials' && want('ambientcg')) jobs.push(loadAmbientCG());
    if (wantPh && tab !== 'animated' && tab !== 'effects' && !REMOTE[tab]) {
      jobs.push(loadPolyHaven(tab === 'skies' ? 'hdri' : tab === 'materials' ? 'material' : 'model'));
    }
    if (tab === 'models' && want('smithsonian')) jobs.push(loadSmithsonian());
    if (wantOv && !REMOTE[tab]) jobs.push(loadObjaverse().then((c) => (tab === 'animated' ? c.items.filter((i) => i.animations > 0) : c.items)));
    Promise.allSettled(jobs).then((results) => {
      if (cancelled) return;
      const ok = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length) setError(failed.map((f) => String(f.reason?.message ?? f.reason)).join(' · '));
      setItems(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, source]);

  return { items, error };
}

function Thumb({ item }: { item: StoreItem }) {
  const [i, setI] = useState(0);
  const src = item.thumbs[i];
  if (!src) {
    return (
      <div className={`store-thumb-missing kind-${item.kind}`}>
        {item.previewUrl ? <PreviewButton item={item} /> : <Icon name={KIND_ICON[item.kind] ?? 'shapes'} size={36} strokeWidth={1.25} />}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      referrerPolicy="no-referrer"
      onLoad={thumbLoaded}
      onError={() => {
        // Every preview gone: the author removed the model (Sketchfab deletes its images).
        if (i + 1 >= item.thumbs.length && item.provider === 'objaverse') markBroken(item.key);
        setI((n) => n + 1);
      }}
    />
  );
}

export function AssetStore() {
  const open = useStoreUi((s) => s.open);
  if (!open) return null;
  return <AssetStoreDialog />;
}

function AssetStoreDialog() {
  const { tab: chosenTab, source, query, category, downloads } = useStoreUi();
  const is2D = useEditor((s) => s.dimension === '2d');
  const tab: StoreTab = is2D && !TABS_2D.has(chosenTab) ? 'images' : chosenTab;
  const set = useStoreUi.setState;
  const local = useItems(tab, source);
  const remote = useRemoteItems(tab, query);
  const { items, error } = remote ?? local;

  const library = useLibrary((s) => s.assets);
  const broken = useBrokenItems((s) => s.keys);
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const added = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of library) if (a.credit?.sourceId && a.type !== 'texture') m.set(`${PREFIX[a.credit.provider] ?? 'ph'}:${a.credit.sourceId}`, a.id);
    return m;
  }, [library]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items ?? []) for (const c of it.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [items]);

  const filtered = useMemo(
    () =>
      // Openverse already searched for us (and ranked the results).
      (remote ? (x: StoreItem[]) => x : (x: StoreItem[]) => searchItems(x, query))(
        (items ?? []).filter((it) => !broken.has(it.key) && (!category || it.categories.includes(category))),
      ),
    [items, category, query, broken, remote],
  );

  // Show more as the user scrolls to the bottom.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  useEffect(() => {
    // Capture phase + stop, so Escape closes the store without also deselecting in the editor.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      closeAssetStore();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  const changeFilter = (patch: Partial<ReturnType<typeof useStoreUi.getState>>) => {
    set(patch);
    setLimit(PAGE);
  };

  return (
    <div className="store-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeAssetStore()}>
      <div className="store" role="dialog" aria-label="Asset Store">
        <header className="store-header">
          <h2>
            <Icon name="shop" size={17} />
            Asset Store
          </h2>
          <span className="muted">
            Built-in shaders, plus free assets. Powered by <a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a> (CC0),{' '}
            <a href="https://ambientcg.com" target="_blank" rel="noreferrer">ambientCG</a> (CC0),{' '}
            <a href="https://objaverse.allenai.org" target="_blank" rel="noreferrer">Objaverse</a> (Sketchfab models, CC0 / CC-BY),{' '}
            <a href="https://3d.si.edu" target="_blank" rel="noreferrer">Smithsonian Open Access</a> (CC0) and{' '}
            <a href="https://openverse.org" target="_blank" rel="noreferrer">Openverse</a> (sounds, music) and{' '}
            <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a> (images). Nothing downloads until you click Add.
          </span>
          <button className="icon-btn store-close" onClick={closeAssetStore} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="store-controls">
          <div className="store-tabs">
            {TABS.filter((t) => !is2D || TABS_2D.has(t.tab)).map((t) => (
              <button
                key={t.tab}
                className={tab === t.tab ? 'active' : ''}
                onClick={() => changeFilter({ tab: t.tab, category: '', query: t.tab === tab ? query : '' })}
              >
                <Icon name={t.icon} />
                {t.label}
              </button>
            ))}
          </div>
          <input
            className="search store-search"
            autoFocus
            placeholder={
              REMOTE[tab]
                ? `Search millions of free ${tab} on ${REMOTE[tab] === 'image' ? 'Wikimedia Commons' : 'Openverse'}… (e.g. "${SUGGESTIONS[REMOTE[tab]!]?.[0]}")`
                : `Search ${items?.length.toLocaleString() ?? ''} assets… (e.g. "rock", "tree", "robot")`
            }
            value={query}
            onChange={(e) => changeFilter({ query: e.target.value })}
          />
          {(tab === 'models' || tab === 'animated') && (
            <select value={source} onChange={(e) => changeFilter({ source: e.target.value as StoreSource, category: '' })}>
              <option value="all">All sources</option>
              <option value="builtin">Built-in (shaders, no download)</option>
              <option value="polyhaven">Poly Haven (realistic, CC0)</option>
              <option value="ambientcg">ambientCG (materials, CC0)</option>
              <option value="objaverse">Objaverse (community)</option>
              <option value="smithsonian">Smithsonian (museum scans, CC0)</option>
            </select>
          )}
          <select value={category} onChange={(e) => changeFilter({ category: e.target.value })}>
            <option value="">All categories</option>
            {categories.map(([c, n]) => (
              <option key={c} value={c}>
                {c.replace(/-/g, ' ')} ({n})
              </option>
            ))}
          </select>
        </div>

        {REMOTE[tab] && (
          <div className="store-suggestions">
            {SUGGESTIONS[REMOTE[tab]!]?.map((sug) => (
              <button key={sug} className={`small ${query === sug ? 'active' : ''}`} onClick={() => changeFilter({ query: sug })}>
                {sug}
              </button>
            ))}
          </div>
        )}
        {error && (
          <div className="store-error">
            <Icon name="alert" size={13} />
            {error}
            {remote && (
              <button className="small" onClick={remote.retry}>
                Try again
              </button>
            )}
          </div>
        )}

        <div className="store-grid">
          {items === null && (
            <p className="empty">
              {REMOTE[tab] ? <SearchingNote key={`${tab}:${query}`} source={REMOTE[tab] === 'image' ? 'Wikimedia Commons' : 'Openverse'} /> : 'Loading catalog…'}
            </p>
          )}
          {items && filtered.length === 0 && (
            <div className="empty">
              <p>Nothing found{query ? ` for "${query}"` : ''}. Try another word or category.</p>
              {(query || category) && (
                <button className="small" onClick={() => changeFilter({ query: '', category: '' })}>
                  <Icon name="x" size={12} />
                  Clear search
                </button>
              )}
            </div>
          )}
          {filtered.slice(0, limit).map((it) => {
            const progress = downloads[it.key];
            const assetId = added.get(it.key);
            return (
              <div key={it.key} className="store-card">
                <a className="store-thumb" href={it.pageUrl} target="_blank" rel="noreferrer" title="Open the original page">
                  <Thumb item={it} />
                  {it.animations > 0 && (
                    <span className="badge anim" title={`${it.animations} animation(s)`}>
                      <Icon name="play" size={8} strokeWidth={3} />
                      {it.animations}
                    </span>
                  )}
                  <span className={`badge license ${it.license === 'CC-BY-4.0' ? 'ccby' : 'cc0'}`}>
                    {it.license === 'CC0-1.0' ? 'CC0' : it.license === 'MIT' ? 'MIT' : 'CC-BY'}
                  </span>
                </a>
                <div className="store-info">
                  <div className="store-name" title={it.name}>
                    {it.name}
                  </div>
                  <div className="store-meta">
                    by {it.author}
                    {it.triangles ? ` · ${it.triangles >= 1000 ? `${Math.round(it.triangles / 1000)}k` : it.triangles} tris` : ''}
                    {it.duration ? ` · ${it.duration >= 60 ? `${Math.floor(it.duration / 60)}:${String(Math.round(it.duration % 60)).padStart(2, '0')}` : `${Math.max(1, Math.round(it.duration))} s`}` : ''}
                  </div>
                </div>
                {progress !== undefined ? (
                  <div className="store-progress" onClick={() => cancelStoreItem(it.key)} title="Click to cancel">
                    <div className="bar" style={{ width: progress < 0 ? '100%' : `${Math.round(progress * 100)}%` }} />
                    <span>{progress < 0 ? 'Downloading…' : `${Math.round(progress * 100)}%`}</span>
                  </div>
                ) : assetId ? (
                  <button className="small" onClick={() => void activateAsset(assetId)} title="Already in your project">
                    <Icon name="check" size={12} />
                    In project
                  </button>
                ) : (
                  <button className="primary small" onClick={() => void addStoreItem(it)}>
                    <Icon name="plus" size={12} />
                    Add
                  </button>
                )}
              </div>
            );
          })}
          {filtered.length > limit && <div ref={sentinel} className="store-more">Loading more…</div>}
          {remote?.more && (
            <div className="store-more">
              <button className="small" onClick={remote.more}>
                <Icon name="plus" size={12} />
                More results
              </button>
            </div>
          )}
        </div>

        <footer className="store-footer muted">
          {filtered.length.toLocaleString()} results · CC-BY assets are credited in your game's Credits automatically.
          {(REMOTE[tab] === 'sound' || REMOTE[tab] === 'music') && ' Sounds and music: made using Openverse; not endorsed by Openverse or the WordPress Foundation.'}
          {REMOTE[tab] === 'image' && ' Images from Wikimedia Commons.'}
        </footer>
      </div>
    </div>
  );
}
