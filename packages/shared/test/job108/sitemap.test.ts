import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { announcementPageToText, countUrlBlocks, parseSitemap } from '../../src/job108';

const xml = readFileSync(join(__dirname, '../fixtures/job108/sitemap-sample.xml'), 'utf8');

describe('parseSitemap', () => {
  it('keeps only announcement pages', () => {
    const entries = parseSitemap(xml);
    expect(entries.map((e) => e.announcementId)).toEqual([
      'id20300',
      'id20285',
      'id20256',
      'id18228',
    ]);
  });

  it('carries the url and lastmod', () => {
    const [newest] = parseSitemap(xml);
    expect(newest?.url).toBe('https://www.job-108.com/id20300.html');
    expect(newest?.lastmod.toISOString().slice(0, 10)).toBe('2026-09-19');
  });

  it('sorts newest first so a capped run takes the freshest', () => {
    const dates = parseSitemap(xml).map((e) => e.lastmod.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('returns an empty list rather than throwing on junk', () => {
    expect(parseSitemap('<html>404</html>')).toEqual([]);
  });

  // Fix 1: a `<lastmod>` can be a full ISO-8601 timestamp rather than a bare
  // date, and a naive `${raw}T00:00:00Z` concatenation turns that into NaN —
  // silently emptying the whole sitemap. The fixture's id20300 entry carries
  // `2026-09-19T10:00:00+07:00`; only the date label must survive.
  it('parses a full ISO-8601 lastmod timestamp, keeping only the date label', () => {
    const entry = parseSitemap(xml).find((e) => e.announcementId === 'id20300');
    expect(entry).toBeDefined();
    expect(entry?.lastmod.toISOString().slice(0, 10)).toBe('2026-09-19');
  });
});

describe('countUrlBlocks', () => {
  // Fix 6: `parseSitemap` cannot distinguish "genuinely no announcements"
  // from "the tag shape changed" — both read as an empty list. A document
  // whose `<url>` blocks are all non-announcement pages (the site's home
  // page, a category listing) must report zero entries but a non-zero block
  // count, so the connector can tell the two apart.
  it('counts url blocks even when none of them are announcement pages', () => {
    const nonAnnouncementXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>https://www.job-108.com/</loc>
        <lastmod>2026-09-19</lastmod>
    </url>
    <url>
        <loc>https://www.job-108.com/jobs-cats2.html</loc>
        <lastmod>2026-09-17</lastmod>
    </url>
</urlset>`;
    expect(parseSitemap(nonAnnouncementXml)).toEqual([]);
    expect(countUrlBlocks(nonAnnouncementXml)).toBe(2);
  });

  it('reports zero blocks for a document that is not a sitemap at all', () => {
    expect(countUrlBlocks('<html>404</html>')).toBe(0);
  });
});

describe('announcementPageToText', () => {
  it('drops scripts, styles and tags and unescapes entities', () => {
    const html = '<html><head><style>a{}</style><script>var x=1</script></head>' +
      '<body><h1>ประกาศ</h1><p>&nbsp;จำนวน 3 &lt;ตำแหน่ง&gt;</p></body></html>';
    const text = announcementPageToText(html);
    expect(text).toContain('ประกาศ');
    expect(text).toContain('จำนวน 3 <ตำแหน่ง>');
    expect(text).not.toContain('var x');
    expect(text).not.toContain('a{}');
  });

  it('collapses runs of whitespace', () => {
    expect(announcementPageToText('<p>a</p>\n\n\n<p>b</p>')).toBe('a\nb');
  });

  // Fix 2: an unclosed `<script>` — a truncated fetch, injected ad markup —
  // otherwise leaks its body straight into the extractor's input, since the
  // paired drop pattern never matches and the generic tag strip removes only
  // the opening tag.
  it('drops an unclosed script instead of leaking its body', () => {
    const text = announcementPageToText('<script>var x = "leak this JS";<p>real text</p>');
    expect(text).not.toContain('leak this JS');
    expect(text).not.toContain('var x');
  });

  // Fix 3: inline tags wrap parts of a single Thai word (bolded degree
  // fragments, agency names) and must not introduce a space; block tags run
  // together with no whitespace in the real pages and must not fuse.
  it('does not split a Thai compound wrapped by an inline tag', () => {
    expect(announcementPageToText('<p>วุฒิ<b>ปริญญา</b>ตรี</p>')).toBe('วุฒิปริญญาตรี');
  });

  it('separates block-level content that has no whitespace between tags', () => {
    expect(announcementPageToText('<p>หนึ่ง</p><p>สอง</p>')).toBe('หนึ่ง\nสอง');
  });

  // A leading `<!DOCTYPE html>` leaked into the output on the first run
  // against a real fetched page, because `<!DOCTYPE ...>` and `<!-- ... -->`
  // don't start with a letter and the letter-anchored tag regex skipped them.
  it('drops a leading doctype declaration and HTML comments', () => {
    const text = announcementPageToText('<!DOCTYPE html><!-- note --><p>เนื้อหา</p>');
    expect(text).not.toContain('DOCTYPE');
    expect(text).not.toContain('note');
    expect(text).toBe('เนื้อหา');
  });
});
