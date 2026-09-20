/**
 * HTTP for job-108.com.
 *
 * No scraping proxy. Measured 2026-09-20: the site returns 200 to any
 * user-agent that is not literally `curl/*`, so an honest identifying one is
 * enough and costs nothing. robots.txt disallows four AI crawlers by name and
 * permits the wildcard everywhere except /go.php and /url.php, which this
 * module refuses to request rather than relying on never happening to build
 * such a URL.
 */
export const JOB108_BASE_URL = 'https://www.job-108.com';

export const JOB108_USER_AGENT =
  'KKU-ProgramLandscape/1.0 (+https://program-landscape.kku.ac.th; denpong@kku.ac.th)';

/** One request per this many milliseconds. Politeness, not a limit we were given. */
export const JOB108_REQUEST_SPACING_MS = 2_000;

const JOB108_TIMEOUT_MS = 30_000;

/** Paths robots.txt disallows for every user-agent. */
const DISALLOWED = ['/go.php', '/url.php'];

export class Job108FetchError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'Job108FetchError';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Fetches one page, refusing any path robots.txt disallows before making a
 *  network call — this is asserted by a unit test, not just trusted. */
export async function fetchJob108Page(url: string): Promise<string> {
  const path = new URL(url).pathname;
  if (DISALLOWED.some((d) => path.startsWith(d))) {
    throw new Job108FetchError(url, null, `robots.txt disallows ${path}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB108_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': JOB108_USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Job108FetchError(url, res.status, `HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err: unknown) {
    if (err instanceof Job108FetchError) throw err;
    const cause = err instanceof Error ? (err.cause ?? err.message) : String(err);
    throw new Job108FetchError(url, null, `fetch failed for ${url}: ${String(cause)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with the politeness delay applied BEFORE the request. */
export async function fetchJob108PagePolitely(url: string, spacingMs = JOB108_REQUEST_SPACING_MS): Promise<string> {
  await sleep(spacingMs);
  return fetchJob108Page(url);
}

export const job108SitemapUrl = (): string => `${JOB108_BASE_URL}/sitemap.xml`;
