import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// job-108 connector settings — operator-editable via SystemSetting, so the
// weekly fetch cadence, the discovery URL and the Gap Analyzer's default
// counting window can change without a deploy (Task 17). Four keys under a
// `job108.` namespace; each is one SystemSetting row (key/value are both
// strings — numbers are serialised with String()/parsed back on read).
//
// Validation deliberately splits into two very different failure modes:
//
//   1. A malformed NUMBER (bad paste, stray character, empty string) falls
//      back to its default rather than throwing. This is read-path
//      behaviour (parseJob108Settings): an operator typo in a stored row
//      must not take the weekly connector down — a data-entry mistake is
//      not the same class of problem as a deliberate bad instruction.
//
//   2. A sitemap URL off the job-108.com origin, or on a path robots.txt
//      disallows (/go.php, /url.php — see apps/ingestion/src/job108/
//      fetch.ts), THROWS. That is not a typo — it is, functionally, a
//      request to fetch a site we have no agreement with using KKU's
//      identifying user-agent, and it must fail loudly rather than quietly
//      redirect the connector somewhere else.
//
//   3. requestSpacingMs below 1000 THROWS. job-108.com never published a
//      rate limit for us to honour — the spacing is a politeness courtesy
//      we chose, not a constraint they handed us. An operator "convenience"
//      that hammers someone else's server without an agreement in place is
//      not a convenience; it is refused rather than silently clamped to a
//      floor, so the operator sees exactly why the value was rejected.
//
// writeJob108Settings validates the MERGED result (current + patch) before
// writing anything, so a rejected value never lands and a half-applied
// patch (e.g. spacing written, sitemapUrl rejected) can never exist as an
// intermediate database state.
// ─────────────────────────────────────────────────────────────────────────────

export interface Job108Settings {
  /** The sitemap.xml URL the connector discovers announcements from. */
  sitemapUrl: string;
  /** Milliseconds between page fetches — politeness, not a limit we were given. */
  requestSpacingMs: number;
  /** Cap on how many announcements one scheduled (weekly) run will process. */
  maxAnnouncementsPerRun: number;
  /** DEFAULT counting window (months) for the Gap Analyzer's public-demand
   *  share. A `publicWindowMonths` URL parameter always overrides this —
   *  see gap.controller.ts's precedence chain and the provenance drawer,
   *  which states the window every response was actually computed with. */
  defaultWindowMonths: number;
}

export const JOB108_SETTING_KEYS: Record<keyof Job108Settings, string> = {
  sitemapUrl: 'job108.sitemapUrl',
  requestSpacingMs: 'job108.requestSpacingMs',
  maxAnnouncementsPerRun: 'job108.maxAnnouncementsPerRun',
  defaultWindowMonths: 'job108.defaultWindowMonths',
};

export const JOB108_SETTING_DEFAULTS: Job108Settings = {
  sitemapUrl: 'https://www.job-108.com/sitemap.xml',
  requestSpacingMs: 2_000,
  maxAnnouncementsPerRun: 60,
  defaultWindowMonths: 12,
};

const JOB108_ALLOWED_ORIGIN = 'https://www.job-108.com';
/** Paths robots.txt disallows for every user-agent — same list as
 *  apps/ingestion/src/job108/fetch.ts's DISALLOWED constant. Duplicated
 *  rather than imported: packages/db must not depend on apps/ingestion. */
const JOB108_DISALLOWED_PATH_PREFIXES = ['/go.php', '/url.php'];
const JOB108_MIN_REQUEST_SPACING_MS = 1_000;

function parseIntSetting(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Pure. Returns the reason `url` is refused (see module doc comment), or
 *  `null` when it's fine. Shared by `assertJob108SettingsValid` (throws the
 *  message) and `parseJob108Settings` (falls back on a non-null result) so
 *  the two paths can never drift on WHAT counts as invalid — only on what
 *  they do about it. */
function sitemapUrlIssue(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `job108 sitemapUrl is not a valid URL: "${url}"`;
  }
  if (parsed.origin !== JOB108_ALLOWED_ORIGIN) {
    return (
      `job108 sitemapUrl must be on ${JOB108_ALLOWED_ORIGIN}, got origin "${parsed.origin}" — ` +
      'we have no agreement to fetch any other site.'
    );
  }
  if (JOB108_DISALLOWED_PATH_PREFIXES.some((p) => parsed.pathname.startsWith(p))) {
    return `job108 sitemapUrl path "${parsed.pathname}" is disallowed by robots.txt for every user-agent.`;
  }
  return null;
}

/** Pure. Same shape as `sitemapUrlIssue` for the spacing floor. */
function requestSpacingIssue(ms: number): string | null {
  if (ms < JOB108_MIN_REQUEST_SPACING_MS) {
    return (
      `job108 requestSpacingMs must be at least ${JOB108_MIN_REQUEST_SPACING_MS}ms — job-108.com ` +
      'has never published a rate limit for us to honour, so the spacing is a courtesy, not a ' +
      'constraint, and it is not an operator convenience to hammer their server without one.'
    );
  }
  return null;
}

/**
 * Pure. Turns a `{ key: value }` slice of SystemSetting rows into a fully
 * populated Job108Settings, filling every missing or malformed field from
 * JOB108_SETTING_DEFAULTS.
 *
 * The read path never throws — a malformed row must not take the weekly
 * connector down — but it also never hands back a value that would make us
 * fetch a site we have no agreement with, or hammer one we do. An invalid
 * origin, a robots-disallowed path or a sub-floor spacing falls back to the
 * default. The write path rejects the same values loudly, because there a
 * human is watching and silently discarding their input would be worse.
 */
export function parseJob108Settings(rows: Record<string, string>): Job108Settings {
  const rawSitemapUrl = rows[JOB108_SETTING_KEYS.sitemapUrl] ?? JOB108_SETTING_DEFAULTS.sitemapUrl;
  const sitemapUrl = sitemapUrlIssue(rawSitemapUrl) === null ? rawSitemapUrl : JOB108_SETTING_DEFAULTS.sitemapUrl;

  const rawRequestSpacingMs = parseIntSetting(
    rows[JOB108_SETTING_KEYS.requestSpacingMs],
    JOB108_SETTING_DEFAULTS.requestSpacingMs,
  );
  const requestSpacingMs =
    requestSpacingIssue(rawRequestSpacingMs) === null
      ? rawRequestSpacingMs
      : JOB108_SETTING_DEFAULTS.requestSpacingMs;

  return {
    sitemapUrl,
    requestSpacingMs,
    maxAnnouncementsPerRun: parseIntSetting(
      rows[JOB108_SETTING_KEYS.maxAnnouncementsPerRun],
      JOB108_SETTING_DEFAULTS.maxAnnouncementsPerRun,
    ),
    defaultWindowMonths: parseIntSetting(
      rows[JOB108_SETTING_KEYS.defaultWindowMonths],
      JOB108_SETTING_DEFAULTS.defaultWindowMonths,
    ),
  };
}

/** Pure. Throws with a specific, readable message on the two settings that
 *  are refused outright (see module doc comment) — never on a malformed
 *  number, which is a `parseJob108Settings` read-path concern instead.
 *  Exported so it can be unit-tested without a database and so
 *  writeJob108Settings can validate the MERGED result before writing
 *  anything. */
export function assertJob108SettingsValid(settings: Job108Settings): void {
  const urlIssue = sitemapUrlIssue(settings.sitemapUrl);
  if (urlIssue !== null) throw new Error(urlIssue);

  const spacingIssue = requestSpacingIssue(settings.requestSpacingMs);
  if (spacingIssue !== null) throw new Error(spacingIssue);
}

/** Reads the four `job108.*` SystemSetting rows (whichever exist) and
 *  returns a fully populated Job108Settings, defaults filling any gap. */
export async function readJob108Settings(): Promise<Job108Settings> {
  const keys = Object.values(JOB108_SETTING_KEYS);
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const byKey: Record<string, string> = {};
  for (const row of rows) byKey[row.key] = row.value;
  return parseJob108Settings(byKey);
}

/** Merges `patch` onto the currently stored settings, validates the MERGED
 *  result, and only then writes — in one transaction, so a rejected patch
 *  never partially lands. Returns the settings as stored after the write. */
export async function writeJob108Settings(
  patch: Partial<Job108Settings>,
  userId: string,
): Promise<Job108Settings> {
  const current = await readJob108Settings();
  const merged: Job108Settings = { ...current, ...patch };

  assertJob108SettingsValid(merged);

  const changedKeys = Object.keys(patch) as (keyof Job108Settings)[];
  if (changedKeys.length === 0) return merged;

  await prisma.$transaction(
    changedKeys.map((key) =>
      prisma.systemSetting.upsert({
        where: { key: JOB108_SETTING_KEYS[key] },
        update: { value: String(merged[key]), updatedBy: userId },
        create: { key: JOB108_SETTING_KEYS[key], value: String(merged[key]), updatedBy: userId },
      }),
    ),
  );

  return merged;
}
