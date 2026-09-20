export interface SitemapEntry {
  /** The site's own id, e.g. `id20256`. */
  announcementId: string;
  url: string;
  lastmod: Date;
}

const URL_BLOCK = /<url>([\s\S]*?)<\/url>/g;
const LOC = /<loc>\s*([^<]+?)\s*<\/loc>/;
const LASTMOD = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/;
const ANNOUNCEMENT = /\/(id\d+)\.html$/;

/** `<lastmod>` is usually a bare `YYYY-MM-DD` here, but the sitemap protocol
 *  permits a full ISO-8601 timestamp and a CMS can start emitting one without
 *  warning. Appending the time unconditionally would turn every such entry
 *  into NaN and empty the whole archive in one silent step, so the date part
 *  is taken first and the time, if any, discarded — the day label is all this
 *  is ever compared on.
 *
 *  Anchored to UTC deliberately: this is a DATE LABEL from the sitemap, not a
 *  wall-clock moment. Rewriting it to `+07:00` to be "more correct for a Thai
 *  site" shifts a 2026-09-19 entry to 2026-09-18 once read back as a date, and
 *  desyncs our stored lastmod from the label the site published. */
function parseLastmod(raw: string): Date | null {
  const datePart = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const d = new Date(`${datePart}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Announcement pages from the sitemap, newest first.
 *
 * The sitemap is the discovery surface rather than `now.html`: it is the
 * complete dated list (2,000 entries reaching back to 2024-12-18), whereas
 * `now.html` is a 30-item slice of currently-open posts. A malformed or
 * error body yields an empty list rather than an exception — an unreachable
 * sitemap is the connector's problem to report, not this function's. Use
 * `countUrlBlocks` alongside this to tell a genuinely announcement-free
 * document from one whose shape changed.
 */
export function parseSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const [, block] of xml.matchAll(URL_BLOCK)) {
    const loc = block?.match(LOC)?.[1];
    const lastmodRaw = block?.match(LASTMOD)?.[1];
    if (!loc || !lastmodRaw) continue;
    const id = loc.match(ANNOUNCEMENT)?.[1];
    if (!id) continue;
    const lastmod = parseLastmod(lastmodRaw);
    if (!lastmod) continue;
    out.push({ announcementId: id, url: loc, lastmod });
  }
  return out.sort((a, b) => b.lastmod.getTime() - a.lastmod.getTime());
}

/** How many `<url>` blocks the document contained, parsed or not. Zero blocks
 *  means we did not receive a sitemap; many blocks and no entries means its
 *  shape changed. `parseSitemap` cannot tell those apart and should not decide
 *  what either means. */
export function countUrlBlocks(xml: string): number {
  return [...xml.matchAll(URL_BLOCK)].length;
}
