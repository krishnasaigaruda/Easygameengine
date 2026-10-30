import { words, type StoreItem, type StoreKind } from './catalog';

/*
 * Sounds, music and images from Openverse (openverse.org, by WordPress): millions of openly
 * licensed files from Freesound, Wikimedia Commons, Jamendo, Flickr and more. Searched live;
 * only licenses that allow use in any game are asked for (CC0, public domain, CC-BY).
 */

const API = 'https://api.openverse.org/v1';

interface OvResult {
  id: string;
  title?: string;
  creator?: string;
  license: string;
  license_version?: string;
  url: string;
  thumbnail?: string;
  foreign_landing_url?: string;
  source?: string;
  duration?: number;
  filetype?: string;
  tags?: { name: string }[];
  width?: number;
  height?: number;
}

const cache = new Map<string, Promise<OpenversePage>>();

/** One page of results, and whether Openverse has more. */
export interface OpenversePage {
  items: StoreItem[];
  more: boolean;
}

/** Openverse can be very slow; past this it counts as not answering. */
const TIMEOUT_MS = 60_000;

/** Ideas shown as one-click searches. */
export const SUGGESTIONS: Partial<Record<StoreKind, string[]>> = {
  sound: ['footsteps', 'explosion', 'sword', 'gunshot', 'arrow', 'door', 'coin', 'jump', 'click', 'hit', 'water', 'fire', 'wind', 'birds', 'crowd', 'horse', 'monster'],
  music: ['medieval', 'epic orchestral', 'ambient', 'battle', 'calm piano', 'horror', 'chiptune', 'adventure', 'village', 'menu', 'victory'],
  image: ['texture', 'stone wall', 'wood', 'grass', 'sky', 'parchment', 'icon', 'pixel art', 'portrait', 'map'],
};

const DEFAULT_QUERY: Partial<Record<StoreKind, string>> = { sound: 'game sound effect', music: 'music loop', image: 'seamless texture' };

const ext = (url: string, fallback: string) => (url.split('?')[0].split('.').pop() ?? fallback).toLowerCase();

/** Search Openverse for sounds, music or images (cached per query). */
/** Results per page (the most Openverse allows without an account). */
export const OPENVERSE_PAGE = 20;

export function searchOpenverse(kind: 'sound' | 'music' | 'image', query: string, page = 1, signal?: AbortSignal): Promise<OpenversePage> {
  let q = query.trim() || DEFAULT_QUERY[kind] || '';
  // The Music tab looks for music: "medieval" means medieval music, not a medieval sound.
  if (kind === 'music' && !/\b(music|song|theme|loop|soundtrack|track)\b/i.test(q)) q = `${q} music`;
  const key = `${kind}:${q.toLowerCase()}:${page}`;
  let p = cache.get(key);
  if (p) return p;
  p = (async () => {
    const params = new URLSearchParams({ q, license: 'cc0,pdm,by', page_size: String(OPENVERSE_PAGE), page: String(page), mature: 'false' });
    if (kind === 'sound') params.set('length', 'shortest,short');
    if (kind === 'music') params.set('length', 'medium,long');
    // (No extension filter: it makes Openverse much slower. JPG/PNG are picked out below.)
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API}/${kind === 'image' ? 'images' : 'audio'}/?${params}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (err) {
      if (timeout.aborted) throw new Error('Openverse didn\'t answer in time. It is sometimes slow; try again.', { cause: err });
      throw err;
    }
    if (res.status === 429) throw new Error('Openverse is busy (too many searches). Wait a minute and try again.');
    if (!res.ok) throw new Error(`Openverse search failed (HTTP ${res.status})`);
    const data = (await res.json()) as { results: OvResult[]; page_count?: number };
    const items = data.results
      .filter((r) => r.url && (kind !== 'image' || /\.(jpe?g|png)(\?|$)/i.test(r.url)))
      .map((r): StoreItem => {
        const name = (r.title || 'Untitled').replace(/\.(wav|mp3|ogg|flac|aiff?|png|jpe?g)$/i, '').slice(0, 80);
        return {
          key: `ovs:${r.id}`,
          provider: 'openverse',
          kind,
          id: r.id,
          name,
          author: r.creator || r.source || 'Unknown',
          // The exact licence and version (CC-BY 2.0 and 3.0 differ from 4.0 in the details).
          license: r.license === 'by' ? `CC-BY-${r.license_version || '4.0'}` : r.license === 'pdm' ? 'Public Domain Mark' : 'CC0-1.0',
          thumbs: kind === 'image' ? [r.thumbnail ?? `${API}/images/${r.id}/thumb/`] : [],
          animations: 0,
          categories: r.source ? [r.source.replace(/_audio$/, '')] : [],
          nameWords: words(name),
          tagWords: words((r.tags ?? []).map((t) => t.name).join(' ')),
          authorText: (r.creator ?? '').toLowerCase(),
          pageUrl: r.foreign_landing_url ?? r.url,
          fileUrl: r.url,
          previewUrl: kind === 'image' ? undefined : r.url,
          duration: r.duration ? r.duration / 1000 : undefined,
          filetype: r.filetype || ext(r.url, kind === 'image' ? 'jpg' : 'mp3'),
        };
      });
    return { items, more: (data.page_count ?? 0) > page };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
