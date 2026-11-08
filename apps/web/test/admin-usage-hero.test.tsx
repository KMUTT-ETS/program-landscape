import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import type { ApiMeta } from '@kku/shared';

// ────────────────────────────────────────────────────────────────────────────
// The three usage tiles on the /admin hero.
//
// `buildHeroStats` is a pure function of three already-fetched values, so the
// thing worth asserting — that a usage call which did not answer renders as
// "unavailable" and NEVER as zeros — can be checked without a session, the
// api, or a DOM. apps/web has no jsdom, so the rendered assertions go through
// renderToStaticMarkup (see vitest.config.ts), inside the two providers the
// real tree mounts in app/providers.tsx: ProvenanceButton reads the provenance
// context and throws outside it, and Radix's Tooltip requires its provider.
//
// The page module is imported for one exported function, but importing it
// pulls its whole server-side graph — auth, the api client, Prisma via
// @kku/db. Those are mocked to nothing: none of them participates in building
// the stat strip, and a test that needs a database to check a string is a test
// nobody runs.
// ────────────────────────────────────────────────────────────────────────────

vi.mock('@kku/db', () => ({ RAW_RETENTION_DAYS: 120 }));
vi.mock('@/lib/auth', () => ({ auth: async () => null }));
vi.mock('@/lib/branding', () => ({ orgShortNamesForRequest: async () => ({ en: 'University', th: 'มหาวิทยาลัย' }) }));
vi.mock('@/lib/api-client', () => ({
  apiFetch: async () => null,
  apiFetchEnvelope: async () => null,
}));
vi.mock('next/navigation', () => ({ redirect: () => undefined }));
vi.mock('@/components/shell/app-shell-server', () => ({
  AuthedAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/display-name', () => ({
  pickGreetingName: () => 'Denpong',
  resolveUserChrome: async () => ({ name: null, avatarUrl: null }),
  timeOfDayGreeting: () => 'Good afternoon',
}));

const { buildHeroStats } = await import('../app/admin/page');

const meta: ApiMeta = {
  freshnessDate: null,
  sources: [{ id: 'page_views', name: 'Page views recorded in-app' }],
  caveats: [],
};

// The committed response shape — `UsageSummaryT` in app/usage/types.ts, plus
// the `medianDwellMs` UsageService.summary() adds. Every timestamp is an ISO
// string because the api has already JSON-serialised it.
const summary = {
  window: {
    days: 7,
    from: '2026-09-07T14:00:00.000Z',
    to: '2026-09-14T14:00:00.000Z',
    prevFrom: '2026-08-31T14:00:00.000Z',
    rawFrom: '2026-05-17T14:00:00.000Z',
    rollupFrom: null,
  },
  recordedSince: '2026-08-18',
  signinsToday: 7,
  medianDwellMs: 10_477,
  current: { activeUsers: 12, views: 340, sessions: 40, signins: 25, aiCalls: 7 },
  previous: { activeUsers: 8, views: 200, sessions: 30, signins: 20, aiCalls: 3 },
  // Only days WITH activity come back, so this is not 30 points wide — the
  // sparkline has to take the series as given rather than pad it.
  dailyActiveUsers: [
    { day: '2026-09-08', users: 1, signins: 1 },
    { day: '2026-09-09', users: 4, signins: 24 },
    { day: '2026-09-13', users: 1, signins: 3 },
    { day: '2026-09-14', users: 12, signins: 7 },
  ],
};

const usage = {
  summary,
  meta,
  excludeAdmins: true,
  computedAt: '2026-09-14T14:00:00.000Z',
};

const ABSENT = { ...usage, summary: null };

const dataStats = {
  programs: { total: 301, withCurriculumPdf: 230, missingCurriculumPdf: 71 },
  curriculumDocs: { total: 230 },
  externalDocs: { total: 12 },
  facultyStaff: { total: 3803, active: 3173 },
  dataFeeds: { total: 24, live: 5, mocked: 15, deprecated: 4 },
  researchOutputs: { total: 81_237 },
};

type Stats = ReturnType<typeof buildHeroStats>;

function byLabel(stats: Stats, label: string) {
  const found = stats.find((s) => s.label === label);
  if (!found)
    throw new Error(`no stat labelled "${label}" — got ${stats.map((s) => s.label).join(', ')}`);
  return found;
}

function render(stats: Stats): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ProvenanceProvider>
        <div>
          {stats.map((s) => (
            <div key={s.label}>
              <span>{s.label}</span>
              <span>{s.value}</span>
              <span>{s.hint}</span>
            </div>
          ))}
        </div>
      </ProvenanceProvider>
    </TooltipProvider>,
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&middot;|&#xB7;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every number series passed as a prop anywhere in the tree — i.e. what a
 *  Sparkline was, or was not, handed. Read off the ELEMENT tree rather than
 *  the rendered markup for two reasons: recharts measures its container on
 *  mount and so renders nothing at all on the server, and the value cell is a
 *  component element whose children do not exist until it is called. */
function seriesIn(node: React.ReactNode): number[][] {
  const out: number[][] = [];
  const walk = (n: React.ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!React.isValidElement(n)) return;
    const props = n.props as Record<string, unknown>;
    for (const v of Object.values(props)) {
      if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number')) {
        out.push(v as number[]);
      }
    }
    walk((props as { children?: React.ReactNode }).children);
  };
  walk(node);
  return out;
}

const USAGE_LABELS = ['Active users · 7d', 'Page views · 7d', 'Sign-ins today'];

describe('buildHeroStats — usage tiles', () => {
  it('adds all three usage tiles, in a fixed 7-day window', () => {
    const stats = buildHeroStats(dataStats, null, usage);
    for (const label of USAGE_LABELS) expect(byLabel(stats, label)).toBeTruthy();
    expect(byLabel(stats, 'Active users · 7d').hint).toContain('+50% vs prior 7d');
    expect(byLabel(stats, 'Page views · 7d').hint).toContain('+70% vs prior 7d');
  });

  it('reads the figures from the committed response fields', () => {
    const flat = text(render(buildHeroStats(null, null, usage)));
    expect(flat).toContain('12'); // current.activeUsers
    expect(flat).toContain('340'); // current.views
    expect(flat).toContain('7'); // signinsToday — NOT current.signins
    expect(byLabel(buildHeroStats(null, null, usage), 'Sign-ins today').hint).toContain(
      '25 in the last 7 days',
    );
  });

  it('says a failed call did not answer rather than showing zeros', () => {
    // The defect this guards: a usage service that did not respond collapsing
    // into a strip of zeros, so the console asserts, in its own voice, that
    // nobody has opened the platform this week.
    const stats = buildHeroStats(dataStats, null, ABSENT);
    for (const label of USAGE_LABELS) {
      expect(byLabel(stats, label).hint).toBe('Unavailable — the usage service did not answer');
    }
    const flat = text(render(stats));
    expect(flat).toContain('Unavailable — the usage service did not answer');
    expect(flat).not.toMatch(/Active users · 7d — 0|\b0 in the last 7 days\b/);
    // The dash, not a number, is what each of the three renders.
    expect(flat.match(/—/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('draws no sparkline for a figure it does not have', () => {
    expect(
      seriesIn(byLabel(buildHeroStats(null, null, ABSENT), 'Active users · 7d').value),
    ).toEqual([]);
  });

  it('hands the sparkline exactly the days the api returned', () => {
    // Only days with activity come back, so padding to 30 would invent them
    // and slicing to 30 would be a lie about a longer history.
    const series = seriesIn(byLabel(buildHeroStats(null, null, usage), 'Active users · 7d').value);
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual([1, 4, 1, 12]);
    expect(series[0]).toHaveLength(summary.dailyActiveUsers.length);
  });

  it('omits a sparkline that would be a single point', () => {
    // One point draws no line, and a line chart with nothing in it reads as a
    // rendering failure rather than as a short history.
    const one = {
      ...usage,
      summary: { ...summary, dailyActiveUsers: summary.dailyActiveUsers.slice(0, 1) },
    };
    expect(seriesIn(byLabel(buildHeroStats(null, null, one), 'Active users · 7d').value)).toEqual(
      [],
    );
  });

  it('names the audience the figures actually describe', () => {
    // "nobody used the platform" and "nobody outside this room did" are
    // different facts, and only one of them is a problem.
    const on = buildHeroStats(null, null, usage);
    expect(byLabel(on, 'Active users · 7d').hint).toContain('non-admin accounts');
    expect(byLabel(on, 'Page views · 7d').hint).toContain('non-admin accounts');
    expect(byLabel(on, 'Sign-ins today').hint).toContain('non-admin accounts');

    const off = buildHeroStats(null, null, { ...usage, excludeAdmins: false });
    for (const label of USAGE_LABELS) {
      expect(byLabel(off, label).hint).toContain('all accounts');
      expect(byLabel(off, label).hint).not.toContain('non-admin');
    }
  });

  it('says nothing rather than divide by a zero baseline', () => {
    const cold = {
      ...usage,
      summary: {
        ...summary,
        previous: { activeUsers: 0, views: 0, sessions: 0, signins: 0, aiCalls: 0 },
      },
    };
    const stats = buildHeroStats(null, null, cold);
    expect(byLabel(stats, 'Active users · 7d').hint).toBe('non-admin accounts');
    expect(byLabel(stats, 'Page views · 7d').hint).not.toContain('%');
  });

  it('keeps numbers and their unit words apart', () => {
    // The recurring readability defect: a count and the next word rendering as
    // one token. Reading the flattened text is the only way to catch it.
    const flat = text(render(buildHeroStats(null, null, usage)));
    expect(flat).toContain('in 40 sessions');
    expect(flat).toContain('25 in the last 7 days');
    expect(flat).not.toMatch(/\d+sessions/);
  });

  it('carries provenance and freshness on every usage tile', () => {
    // Council-readiness rules 1 and 3, on the surface rather than on the happy
    // path — including the render where the figure itself is missing.
    for (const u of [usage, ABSENT]) {
      const html = render(buildHeroStats(null, null, u));
      for (const label of USAGE_LABELS) {
        expect(html).toContain(`Show provenance for ${label}`);
      }
      expect(html.match(/Updated /g) ?? []).toHaveLength(USAGE_LABELS.length);
    }
  });

  it('sends every usage tile to /usage', () => {
    const html = render(buildHeroStats(null, null, usage));
    expect(html.match(/href="\/usage"/g) ?? []).toHaveLength(USAGE_LABELS.length);
  });
});

describe('buildHeroStats — the tiles that were already there', () => {
  it('still renders the data and system tiles beside the usage ones', () => {
    const sys = {
      generatedAt: '2026-09-14T14:00:00.000Z',
      ai24h: { calls: 250, costUsd: 1.25, avgConfidence: 0.9 },
      pendingExtractions: 3,
      ingestionRuns7d: [{ status: 'FAILED', count: 0 }],
      dataFreshness: [{ metric: 'enrollment', stale: false }],
    };
    const labels = buildHeroStats(dataStats, sys, usage).map((s) => s.label);
    expect(labels).toEqual([
      'University programs',
      'Live data feeds',
      'Pending review',
      'AI spend · 24h',
      ...USAGE_LABELS,
    ]);
  });

  it('keeps the both-endpoints-failed placeholder, which the usage tiles no longer hide', () => {
    // The old guard was `stats.length === 0`, which the usage tiles fill
    // unconditionally — leaving it would have silently deleted the placeholder.
    const labels = buildHeroStats(null, null, usage).map((s) => s.label);
    expect(labels).toEqual(['Stats', ...USAGE_LABELS]);
  });
});
