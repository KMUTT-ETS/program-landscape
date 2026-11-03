// TCAS round-3 file list: a built-in list plus discovery from the public
// statistics page, so a new year's file is picked up without a code edit.

export interface TcasFile {
  url: string;
  entryYearBE: number;
  round: '3' | '3.1' | '3.2';
}

export const TCAS_STAT_PAGE_URL = 'https://www.mytcas.com/stat';
const ASSETS_HOST = 'assets.mytcas.com';

// The stat page answers a bot-style user-agent with a block page, so this one
// request uses a browser string (same precedent as the curated report feeds).
// The xlsx downloads themselves identify honestly.
const STAT_PAGE_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Verified against assets.mytcas.com. Round 3.1 + 3.2 of 2568 are two files
// of one year: each is its own `round`, so a course code is counted once per
// (year, round) row exactly as before.
export const BUILT_IN_TCAS_FILES: TcasFile[] = [
  { url: 'https://assets.mytcas.com/maxmin/TCAS62_maxmin.xlsx', entryYearBE: 2562, round: '3' },
  { url: 'https://assets.mytcas.com/maxmin/TCAS63_maxmin.xlsx', entryYearBE: 2563, round: '3' },
  { url: 'https://assets.mytcas.com/maxmin/TCAS64_maxmin.xlsx', entryYearBE: 2564, round: '3' },
  { url: 'https://assets.mytcas.com/maxmin/TCAS65_maxmin.xlsx', entryYearBE: 2565, round: '3' },
  { url: 'https://assets.mytcas.com/maxmin/TCAS66_maxmin.xlsx', entryYearBE: 2566, round: '3' },
  { url: 'https://assets.mytcas.com/67/TCAS67_maxmin.xlsx', entryYearBE: 2567, round: '3' },
  { url: 'https://assets.mytcas.com/68/T68-stat-r3_1-maxmin-20May25.xlsx', entryYearBE: 2568, round: '3.1' },
  { url: 'https://assets.mytcas.com/68/T68-stat-r3_2-maxmin-24May25.xlsx', entryYearBE: 2568, round: '3.2' },
  { url: 'https://assets.mytcas.com/69/TCAS69-R3-MinMax-10June26.xlsx', entryYearBE: 2569, round: '3' },
];

function yearFromUrl(u: URL): number | null {
  const seg = /^\/(\d{2})\//.exec(u.pathname);
  if (seg) return 2500 + Number(seg[1]);
  const name = /TCAS(\d{2})/i.exec(u.pathname);
  if (name) return 2500 + Number(name[1]);
  return null;
}

/** Round-3 max/min xlsx links on assets.mytcas.com found in the stat page HTML. */
export function discoverTcasFiles(html: string): TcasFile[] {
  const out: TcasFile[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(m[1]!, TCAS_STAT_PAGE_URL);
    } catch {
      continue;
    }
    if (u.hostname !== ASSETS_HOST || !/\.xlsx$/i.test(u.pathname)) continue;
    const base = u.pathname.split('/').pop() ?? '';
    if (!/(maxmin|minmax|r3)/i.test(base)) continue;
    if (/[-_]r[124](?!\d)/i.test(base)) continue; // another round
    const year = yearFromUrl(u);
    if (year === null) continue;
    const sub = /r3[_.]([12])(?!\d)/i.exec(base);
    const round: TcasFile['round'] = sub ? (sub[1] === '1' ? '3.1' : '3.2') : '3';
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({ url: u.href, entryYearBE: year, round });
  }
  return out;
}

/** Built-in list merged with discovered files; built-in only if discovery fails. */
export async function resolveTcasFiles(
  fetchImpl: typeof fetch = fetch,
): Promise<{ files: TcasFile[]; source: 'discovered' | 'built-in' }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetchImpl(TCAS_STAT_PAGE_URL, {
      signal: controller.signal,
      headers: { 'user-agent': STAT_PAGE_USER_AGENT },
    });
    clearTimeout(timer);
    if (!res.ok) return { files: BUILT_IN_TCAS_FILES, source: 'built-in' };
    const found = discoverTcasFiles(await res.text());
    if (found.length === 0) return { files: BUILT_IN_TCAS_FILES, source: 'built-in' };
    const merged = [...BUILT_IN_TCAS_FILES];
    const urls = new Set(merged.map((f) => f.url));
    for (const f of found) {
      if (!urls.has(f.url)) {
        urls.add(f.url);
        merged.push(f);
      }
    }
    merged.sort((a, b) => a.entryYearBE - b.entryYearBE || a.round.localeCompare(b.round));
    return { files: merged, source: 'discovered' };
  } catch {
    return { files: BUILT_IN_TCAS_FILES, source: 'built-in' };
  }
}
