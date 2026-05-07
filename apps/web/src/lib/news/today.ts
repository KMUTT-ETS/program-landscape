// Live "today's headlines" feed for the sign-in page right pane.
//
// Pulls multiple Google News RSS feeds in parallel — Thailand top
// stories, education, technology, and policy keywords — caches in
// memory for 1 hour, and returns up to 20 items dated within the
// last 36 hours. The sign-in page picks 5 at random per render so
// repeat visits show different headlines.
//
// Server-only. No external dependency on rss-parser; small inline
// XML parser handles Google News' canonical RSS shape (title /
// link / pubDate / source / description, with CDATA + the standard
// entity escapes).
//
// Failure path: every feed has a 5s timeout; if all of them fail
// or the network is unreachable (dev box on KKU LAN with no
// outbound), the function returns an empty array. The sign-in page
// then falls back to TrendSignal-table data (which the application
// already curates internally).

const FEEDS: Array<{ url: string; category: NewsCategory }> = [
  // Thailand top stories (English-language, Thailand region).
  {
    url: 'https://news.google.com/rss?hl=en-TH&gl=TH&ceid=TH:en',
    category: 'thailand',
  },
  // Higher education + universities — global.
  {
    url: 'https://news.google.com/rss/search?q=higher+education+OR+university+OR+curriculum&hl=en&gl=US&ceid=US:en',
    category: 'education',
  },
  // Technology — AI / digital transformation, global.
  {
    url: 'https://news.google.com/rss/search?q=artificial+intelligence+OR+technology+education&hl=en&gl=US&ceid=US:en',
    category: 'technology',
  },
  // Thai education policy + MHESI signals.
  {
    url: 'https://news.google.com/rss/search?q=Thailand+education+OR+MHESI+OR+%22Khon+Kaen%22&hl=en-TH&gl=TH&ceid=TH:en',
    category: 'policy',
  },
];

const TIMEOUT_MS = 5_000;
const TTL_MS = 60 * 60 * 1_000; // 1 hour

export type NewsCategory = 'thailand' | 'education' | 'technology' | 'policy';

export interface NewsItem {
  id: string;
  title: string;
  source: string | null;
  url: string;
  publishedAtIso: string;
  category: NewsCategory;
}

interface Cache {
  items: NewsItem[];
  expiresAt: number;
}
let cache: Cache | null = null;

export async function fetchTodaysHeadlines(): Promise<NewsItem[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now && cache.items.length > 0) return cache.items;

  const all = await Promise.all(FEEDS.map(({ url, category }) => fetchOne(url, category)));
  const merged = all.flat();

  // Dedupe by URL or title (Google News often shows the same story
  // across feeds with different snippets).
  const seen = new Set<string>();
  const unique: NewsItem[] = [];
  for (const it of merged) {
    const key = it.url || it.title;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }

  // Last 36h window — "today" with overnight headroom.
  const cutoff = now - 36 * 60 * 60 * 1_000;
  const fresh = unique.filter((i) => Date.parse(i.publishedAtIso) > cutoff);

  // Sort newest first; cap at 20.
  fresh.sort((a, b) => Date.parse(b.publishedAtIso) - Date.parse(a.publishedAtIso));
  const capped = fresh.slice(0, 20);

  if (capped.length > 0) {
    cache = { items: capped, expiresAt: now + TTL_MS };
  }
  return capped;
}

// ── RSS fetch + parse ──────────────────────────────────────────────

async function fetchOne(url: string, category: NewsCategory): Promise<NewsItem[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Google News blocks no-User-Agent calls.
        'User-Agent': 'KKU-Curriculum-Landscape/1.0 (+https://program-landscape.kku.ac.th)',
        accept: 'application/rss+xml, application/xml',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, category);
  } catch {
    return [];
  }
}

function parseRssItems(xml: string, category: NewsCategory): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1] ?? '';
    const titleRaw = extractTag(block, 'title');
    if (!titleRaw) continue;
    const link = extractTag(block, 'link') ?? '';
    const pubDate = extractTag(block, 'pubDate');
    const source = extractTag(block, 'source');
    if (!pubDate) continue;
    const ts = Date.parse(pubDate);
    if (Number.isNaN(ts)) continue;
    // Google News titles often end with " - Source Name" — strip when
    // we have a separate <source> tag, otherwise leave it alone.
    const title = source
      ? titleRaw.replace(new RegExp(`\\s*-\\s*${escapeRe(source)}\\s*$`), '')
      : titleRaw;
    items.push({
      id: link || `${ts}-${title.slice(0, 40)}`,
      title,
      source,
      url: link,
      publishedAtIso: new Date(ts).toISOString(),
      category,
    });
  }
  return items;
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(xml);
  if (!m || m[1] === undefined) return null;
  let content = m[1].trim();
  // Strip CDATA wrapping if present.
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(content);
  if (cdata && cdata[1] !== undefined) content = cdata[1];
  // Decode the four canonical XML entities + a couple of common HTML ones.
  content = content
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
  return content || null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
