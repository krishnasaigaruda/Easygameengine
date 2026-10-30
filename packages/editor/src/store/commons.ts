import { words, type StoreItem } from './catalog';
import type { OpenversePage } from './openverse';

/*
 * Images from Wikimedia Commons (commons.wikimedia.org): millions of freely licensed pictures,
 * searched live and fast. Only licences that allow use in any game are kept (CC0, public domain,
 * CC BY); share-alike, non-commercial and other licences are left out.
 */

const API = 'https://commons.wikimedia.org/w/api.php';
const PAGE = 40;
const TIMEOUT_MS = 20_000;
/**
 * Big photos are downloaded at this width at most (plenty for a game, a fraction of the size).
 * Commons only serves set widths (250, 330, 500, 960, 1280, 1920, 3840).
 */
const MAX_WIDTH = 1920;

interface CommonsPage {
  title: string;
  imageinfo?: {
    url: string;
    descriptionurl: string;
    thumburl?: string;
    width: number;
    height: number;
    mime: string;
    extmetadata?: Record<string, { value: string } | undefined>;
  }[];
}

/** "CC BY 3.0" → "CC-BY-3.0", "CC0" → "CC0-1.0"; null for licences games can't simply use. */
export function commonsLicense(short: string): string | null {
  const s = short.trim();
  if (/^cc0/i.test(s)) return 'CC0-1.0';
  if (/^(public domain|pd\b|pdm)/i.test(s)) return 'Public Domain Mark';
  const by = /^cc[ -]by[ -](\d\.\d)(?:[ -][a-z-]+)?$/i.exec(s);
  return by ? `CC-BY-${by[1]}` : null;
}

const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const cache = new Map<string, Promise<OpenversePage>>();

/** Search Commons for pictures (cached per query and page). */
export function searchCommons(
  query: string,
  page = 1,
  signal?: AbortSignal,
): Promise<OpenversePage> {
  const q = query.trim() || 'seamless texture';
  const key = `${q.toLowerCase()}:${page}`;
  let p = cache.get(key);
  if (p) return p;
  p = (async () => {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      // First page: files whose names have every word (most relevant), then the rest.
      const terms = q.split(/\s+/);
      const titled = page === 1 ? terms.map((w) => `intitle:${w}`).join(' ') : null;
      const [byName, byText] = await Promise.all([
        titled ? fetchPage(titled, 1, abort) : null,
        fetchPage(q, page, abort),
      ]);
      const seen = new Set<string>();
      const items = [...(byName?.items ?? []), ...byText.items].filter(
        (it) => !seen.has(it.key) && !!seen.add(it.key),
      );
      return { items, more: byText.more };
    } catch (err) {
      if (timeout.aborted)
        throw new Error("Wikimedia Commons didn't answer in time; try again.", { cause: err });
      throw err;
    }
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

async function fetchPage(q: string, page: number, signal: AbortSignal): Promise<OpenversePage> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${q} filetype:bitmap`,
    gsrlimit: String(PAGE),
    gsroffset: String((page - 1) * PAGE),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|Artist',
    iiurlwidth: '256',
  });
  const res = await fetch(`${API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Image search failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    query?: { pages?: Record<string, CommonsPage & { index?: number }> };
    continue?: unknown;
  };
  const pages = Object.values(data.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  const items: StoreItem[] = [];
  for (const pg of pages) {
    const info = pg.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png)$/.test(info.mime)) continue;
    const license = commonsLicense(info.extmetadata?.LicenseShortName?.value ?? '');
    if (!license) continue;
    const name = pg.title
      .replace(/^File:/, '')
      .replace(/\.(png|jpe?g)$/i, '')
      .replace(/_/g, ' ')
      .slice(0, 80);
    const author = plain(info.extmetadata?.Artist?.value ?? '') || 'Unknown';
    const thumb = info.thumburl ?? info.url;
    const fileUrl =
      info.width > MAX_WIDTH && info.thumburl
        ? info.thumburl.replace(/\/\d+px-/, `/${MAX_WIDTH}px-`)
        : info.url;
    items.push({
      key: `wc:${pg.title}`,
      provider: 'commons',
      kind: 'image',
      id: pg.title,
      name,
      author: author.slice(0, 80),
      license,
      thumbs: [thumb],
      animations: 0,
      categories: [],
      nameWords: words(name),
      tagWords: [],
      authorText: author.toLowerCase(),
      pageUrl: info.descriptionurl,
      fileUrl,
      filetype: info.mime === 'image/png' ? 'png' : 'jpg',
    });
  }
  return { items, more: !!data.continue };
}
