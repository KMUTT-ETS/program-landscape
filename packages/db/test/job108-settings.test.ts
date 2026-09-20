import { describe, expect, it } from 'vitest';
import {
  assertJob108SettingsValid,
  JOB108_SETTING_DEFAULTS,
  JOB108_SETTING_KEYS,
  parseJob108Settings,
  type Job108Settings,
} from '../src/job108-settings';

describe('parseJob108Settings', () => {
  it('empty rows give the defaults', () => {
    expect(parseJob108Settings({})).toEqual(JOB108_SETTING_DEFAULTS);
  });

  it('stored values are read', () => {
    const rows = {
      [JOB108_SETTING_KEYS.sitemapUrl]: 'https://www.job-108.com/sitemap.xml',
      [JOB108_SETTING_KEYS.requestSpacingMs]: '3500',
      [JOB108_SETTING_KEYS.maxAnnouncementsPerRun]: '25',
      [JOB108_SETTING_KEYS.defaultWindowMonths]: '18',
    };
    expect(parseJob108Settings(rows)).toEqual({
      sitemapUrl: 'https://www.job-108.com/sitemap.xml',
      requestSpacingMs: 3500,
      maxAnnouncementsPerRun: 25,
      defaultWindowMonths: 18,
    });
  });

  it('an unparseable number falls back rather than throwing', () => {
    const rows = {
      [JOB108_SETTING_KEYS.requestSpacingMs]: 'not-a-number',
      [JOB108_SETTING_KEYS.defaultWindowMonths]: '',
    };
    expect(() => parseJob108Settings(rows)).not.toThrow();
    const parsed = parseJob108Settings(rows);
    expect(parsed.requestSpacingMs).toBe(JOB108_SETTING_DEFAULTS.requestSpacingMs);
    expect(parsed.defaultWindowMonths).toBe(JOB108_SETTING_DEFAULTS.defaultWindowMonths);
  });

  it('leaves an unaffected field untouched by a malformed sibling', () => {
    const rows = {
      [JOB108_SETTING_KEYS.requestSpacingMs]: 'garbage',
      [JOB108_SETTING_KEYS.maxAnnouncementsPerRun]: '99',
    };
    const parsed = parseJob108Settings(rows);
    expect(parsed.requestSpacingMs).toBe(JOB108_SETTING_DEFAULTS.requestSpacingMs);
    expect(parsed.maxAnnouncementsPerRun).toBe(99);
  });

  // The read path never throws on these three — it falls back to the
  // default instead. `describe('assertJob108SettingsValid', ...)` below
  // asserts the SAME three values are REFUSED on write: the two paths
  // behaving differently on identical input is the point, not a bug.
  it('a stored off-origin sitemap URL falls back to the default rather than being honoured', () => {
    const rows = { [JOB108_SETTING_KEYS.sitemapUrl]: 'https://evil.example.com/sitemap.xml' };
    expect(() => parseJob108Settings(rows)).not.toThrow();
    expect(parseJob108Settings(rows).sitemapUrl).toBe(JOB108_SETTING_DEFAULTS.sitemapUrl);
  });

  it('a stored /go.php sitemap URL falls back to the default rather than being honoured', () => {
    const rows = { [JOB108_SETTING_KEYS.sitemapUrl]: 'https://www.job-108.com/go.php?x=1' };
    expect(() => parseJob108Settings(rows)).not.toThrow();
    expect(parseJob108Settings(rows).sitemapUrl).toBe(JOB108_SETTING_DEFAULTS.sitemapUrl);
  });

  it('a stored 50ms spacing falls back to the default rather than being honoured', () => {
    const rows = { [JOB108_SETTING_KEYS.requestSpacingMs]: '50' };
    expect(() => parseJob108Settings(rows)).not.toThrow();
    expect(parseJob108Settings(rows).requestSpacingMs).toBe(JOB108_SETTING_DEFAULTS.requestSpacingMs);
  });
});

describe('assertJob108SettingsValid', () => {
  const valid = (over: Partial<Job108Settings> = {}): Job108Settings => ({
    ...JOB108_SETTING_DEFAULTS,
    ...over,
  });

  it('accepts the defaults', () => {
    expect(() => assertJob108SettingsValid(valid())).not.toThrow();
  });

  it('a sub-1000 spacing is refused', () => {
    expect(() => assertJob108SettingsValid(valid({ requestSpacingMs: 500 }))).toThrow(
      /requestSpacingMs must be at least 1000/,
    );
  });

  it('exactly 1000 is accepted (the floor, not the refusal)', () => {
    expect(() => assertJob108SettingsValid(valid({ requestSpacingMs: 1000 }))).not.toThrow();
  });

  it('an off-origin sitemap URL is refused', () => {
    expect(() =>
      assertJob108SettingsValid(valid({ sitemapUrl: 'https://evil.example.com/sitemap.xml' })),
    ).toThrow(/must be on https:\/\/www\.job-108\.com/);
  });

  it('a /go.php URL is refused even on the right origin', () => {
    expect(() =>
      assertJob108SettingsValid(valid({ sitemapUrl: 'https://www.job-108.com/go.php?x=1' })),
    ).toThrow(/disallowed by robots\.txt/);
  });

  it('a /url.php URL is refused even on the right origin', () => {
    expect(() =>
      assertJob108SettingsValid(valid({ sitemapUrl: 'https://www.job-108.com/url.php?x=1' })),
    ).toThrow(/disallowed by robots\.txt/);
  });

  it('a malformed URL is refused', () => {
    expect(() => assertJob108SettingsValid(valid({ sitemapUrl: 'not a url' }))).toThrow(
      /not a valid URL/,
    );
  });
});
