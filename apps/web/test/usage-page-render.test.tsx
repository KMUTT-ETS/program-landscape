import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import type { ApiMeta } from '@kku/shared';

import { UsageSections } from '../app/usage/client';
import { mergeCaveats, pageCaveats, resolveUsageParams } from '../app/usage/types';
import type { UsageData } from '../app/usage/types';

// ────────────────────────────────────────────────────────────────────────────
// /usage renders every aggregate section from already-fetched data, and the
// access log ONLY for a viewer holding usage:read:detail.
//
// `UsageSections` is a pure function of `UsageData` precisely so this can be
// asserted without a DOM, a session or the api — apps/web has no jsdom, so
// component assertions go through renderToStaticMarkup (see vitest.config.ts).
// The two providers are the ones AppShell mounts in the real tree:
// ProvenanceButton reads the provenance context and throws outside it, and
// Radix's Tooltip requires its provider.
//
// The shapes below are the COMMITTED ones from packages/db/src/usage.ts, not
// an idealised version of them: `window` carries `rawFrom`, every timestamp is
// an ISO string (the api has already JSON-serialised the Dates), and
// `medianDwellMs` rides on the summary because UsageService.summary() adds it.
// ────────────────────────────────────────────────────────────────────────────

const meta: ApiMeta = {
  freshnessDate: null,
  sources: [{ id: 'page_views', name: 'Page views recorded in-app' }],
  caveats: ['Raw page views are kept 120 days, then rolled up to daily counts.'],
};

const data: UsageData = {
  days: 30,
  excludeAdmins: true,
  facultyId: null,
  q: null,
  facultyOptions: [
    { id: 'f1', nameEn: 'Faculty of Engineering', nameTh: 'วิศวกรรมศาสตร์' },
    { id: 'f2', nameEn: 'Faculty of Science', nameTh: 'วิทยาศาสตร์' },
  ],
  canSeeDetail: false,
  detailDays: 30,
  computedAt: '2026-09-14T04:00:00.000Z',
  summary: {
    data: {
      window: {
        days: 30,
        from: '2026-08-15T04:00:00.000Z',
        to: '2026-09-14T04:00:00.000Z',
        prevFrom: '2026-07-16T04:00:00.000Z',
        rawFrom: '2026-05-17T04:00:00.000Z',
        rollupFrom: null,
      },
      recordedSince: '2026-09-14',
      signinsToday: 3,
      medianDwellMs: 42_000,
      current: { activeUsers: 12, views: 340, sessions: 40, signins: 25, aiCalls: 7 },
      previous: { activeUsers: 8, views: 200, sessions: 30, signins: 20, aiCalls: 3 },
      dailyActiveUsers: [
        { day: '2026-09-13', users: 5, signins: 4 },
        { day: '2026-09-14', users: 7, signins: 3 },
      ],
    },
    meta,
  },
  modules: {
    data: [{ module: 'deep-dive', views: 200, users: 10, sessions: 20, medianDwellMs: 60_000 }],
    meta,
  },
  programs: {
    data: [
      {
        programId: 'p1',
        code: 'KKU-SEQ-0062',
        nameEn: 'Mechanical Engineering',
        nameTh: null,
        facultyTh: 'วิศวกรรมศาสตร์',
        views: 50,
        users: 6,
      },
    ],
    meta,
  },
  roles: {
    data: [{ role: 'FACULTY_USER', users: 6, views: 100, sessions: 12, signins: 10 }],
    meta,
  },
  faculties: {
    data: [
      { facultyId: 'f1', nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering', users: 6, views: 100 },
    ],
    meta,
  },
  actions: { data: [{ family: 'export', count: 4, users: 2 }], meta },
  users: null,
};

function render(d: UsageData): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ProvenanceProvider>
        <UsageSections data={d} />
      </ProvenanceProvider>
    </TooltipProvider>,
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const WITH_DETAIL: UsageData = {
  ...data,
  canSeeDetail: true,
  users: {
    data: [
      {
        userId: 'u1',
        name: 'A',
        email: 'a@kku.ac.th',
        role: 'FACULTY_USER',
        facultyTh: null,
        lastSeen: '2026-09-14T01:00:00.000Z',
        views: 9,
        sessions: 2,
        signins: 1,
        actions: 0,
      },
    ],
    meta,
  },
};

describe('UsageSections', () => {
  it('renders every aggregate section and the recorded-since line', () => {
    const html = render(data);
    for (const section of [
      'Active users',
      'Page views',
      'Sign-ins',
      'By module',
      'By programme',
      'By faculty',
      'By role',
      'Actions',
    ]) {
      expect(html).toContain(section);
    }
    expect(html).toContain('KKU-SEQ-0062');
    expect(text(html)).toContain('recorded since 2026-09-14');
  });

  it('omits the access log when the viewer cannot see detail', () => {
    expect(render(data)).not.toContain('Access log');
  });

  it('renders the access log when detail rows are present', () => {
    const html = render(WITH_DETAIL);
    expect(html).toContain('Access log');
    expect(html).toContain('a@kku.ac.th');
  });

  it('offers the per-programme drill-down only to a detail viewer', () => {
    expect(render(data)).not.toContain('Who viewed');
    expect(
      renderToStaticMarkup(
        <TooltipProvider>
          <ProvenanceProvider>
            <UsageSections data={WITH_DETAIL} onOpenProgram={() => undefined} />
          </ProvenanceProvider>
        </TooltipProvider>,
      ),
    ).toContain('Who viewed');
  });

  it('states the provenance the Council rules require, on every card', () => {
    // The drawer renders `meta.caveats`, so the page's own caveats must be
    // merged into each envelope's meta by the server page — assert here that
    // the button exists for every section, since the drawer itself only opens
    // on click and there is no DOM in this suite.
    const html = render(WITH_DETAIL);
    for (const title of [
      'Activity over the last 30 days',
      'Daily active users',
      'By module',
      'By programme',
      'By faculty',
      'By role',
      'Actions',
      'Access log',
    ]) {
      expect(html).toContain(`Show provenance for ${title}`);
    }
  });

  it('keeps adjacent counts apart with a unit word rather than a bare gap', () => {
    // The recurring readability defect: "50 views" and "6 users" rendering as
    // one token. Reading the flattened text is the only way to catch it.
    const flat = text(render(data));
    expect(flat).toContain('50 views');
    expect(flat).toContain('6 users');
    expect(flat).not.toMatch(/\d+views/);
  });

  it('describes an empty section as missing coverage rather than failure', () => {
    const empty: UsageData = {
      ...data,
      excludeAdmins: false,
      modules: { data: [], meta },
      programs: { data: [], meta },
      actions: { data: [], meta },
    };
    const flat = text(render(empty));
    expect(flat).toContain('No page views recorded in this window.');
    expect(flat).toContain('No programme pages were opened in this window.');
  });

  it('names the admin filter in the empty copy when it is the one hiding rows', () => {
    // "Nothing was recorded" and "nothing was recorded from the accounts you
    // left in" are different facts, and only the second has a control on the
    // page that changes it.
    const flat = text(render({ ...data, excludeAdmins: true, modules: { data: [], meta } }));
    expect(flat).toContain('No page views from non-admin accounts in this window.');
    expect(flat).not.toContain('No page views recorded in this window.');
  });

  it('says a failed card did not load rather than that nothing happened', () => {
    // The defect this guards: a null envelope (the service did not answer)
    // collapsing into an empty one (nothing was recorded), so a page that
    // knows nothing denies, in its own voice, that anybody opened anything.
    const flat = text(render({ ...data, modules: null, programs: null }));
    expect(flat).toContain('Module figures are unavailable');
    expect(flat).toContain('Programme figures are unavailable');
    expect(flat).not.toContain('No page views recorded');
    expect(flat).not.toContain('No page views from non-admin accounts');
    expect(flat).not.toContain('No programme pages were opened');
  });

  it('keeps a failed card’s provenance button', () => {
    // Council-readiness rule 1 is about the surface, not the happy path: the
    // render where a reader most wants to ask where a figure came from is the
    // one where it is missing.
    const html = render({ ...data, modules: null, roles: null, actions: null });
    for (const title of ['By module', 'By role', 'Actions']) {
      expect(html).toContain(`Show provenance for ${title}`);
    }
  });

  it('keeps the access log visible, and explained, when it fails to load', () => {
    const html = render({ ...WITH_DETAIL, users: null });
    expect(html).toContain('Access log');
    expect(html).toContain('Show provenance for Access log');
    expect(text(html)).toContain(
      'The access log is unavailable — the usage service did not answer.',
    );
  });

  it('renders without a summary rather than throwing', () => {
    const flat = text(render({ ...data, summary: null }));
    expect(flat).toContain('Summary figures are unavailable');
  });

  it('names the faculty in the by-programme subtitle when one is selected', () => {
    const flat = text(render({ ...data, facultyId: 'f1' }));
    expect(flat).toContain('Faculty of Engineering only');
    // Without a filter the card must NOT claim to be narrowed.
    expect(text(render(data))).not.toContain('only.');
  });

  it('offers every faculty in the by-programme filter', () => {
    const html = render(data);
    expect(html).toContain('Filter programmes by faculty');
    expect(html).toContain('All faculties');
    expect(html).toContain('value="f1"');
    expect(html).toContain('Faculty of Engineering');
    expect(html).toContain('value="f2"');
    expect(html).toContain('Faculty of Science');
  });

  it('reports the search term in the access-log subtitle', () => {
    const flat = text(render({ ...WITH_DETAIL, q: 'some' }));
    expect(flat).toContain('1 user matching “some”');
  });
});

describe('mergeCaveats', () => {
  // The REAL api strings, copied verbatim from USAGE_CAVEATS in
  // apps/api/src/usage/usage.controller.ts (RAW_RETENTION_DAYS = 120). Merging
  // against invented strings is what let the earlier six-word-prefix rule pass
  // its tests while deleting, in production, the only sentence on the page
  // that defines dwell.
  const apiBoundary =
    'Raw page views are kept 120 days, then rolled up to daily counts per user and page (Asia/Bangkok days).';
  const apiSession =
    'A session is a run of views with no gap over 30 minutes; dwell is the time to the next view and excludes the last view of a session.';
  const apiAdmins =
    'Admin-grade accounts are excluded by default (excludeAdmins=true); impersonated sessions are never counted.';
  const API = [apiBoundary, apiSession, apiAdmins];
  const PAGE = pageCaveats({ rawRetentionDays: 120, excludeAdmins: true });

  it('keeps the api’s definition of dwell, which no page caveat carries', () => {
    const merged = mergeCaveats(API, PAGE);
    expect(merged.some((c) => /dwell is the time to the next view/i.test(c))).toBe(true);
    // And every one of the page's own survives, in order, after the api's.
    expect(merged.slice(-PAGE.length)).toEqual(PAGE);
  });

  it('keeps an api caveat that opens like a page one but then says more', () => {
    // Both begin "Raw page views are kept 120 days…" and then diverge; the api
    // half names the roll-up's own grain, which the page half does not.
    expect(mergeCaveats(API, PAGE)).toContain(apiBoundary);
  });

  it('drops an api caveat the page says no more or less than', () => {
    const restated = 'A session is a run of views with no gap over 30 minutes';
    const page = [`${restated}; dwell is the time to the next view.`];
    expect(mergeCaveats([restated, apiAdmins], page)).toEqual([apiAdmins, ...page]);
    // And an exact duplicate, the simplest case of the same rule.
    expect(mergeCaveats([apiAdmins], [apiAdmins])).toEqual([apiAdmins]);
  });

  it('is a no-op on either side being empty', () => {
    expect(mergeCaveats([], PAGE)).toEqual(PAGE);
    expect(mergeCaveats(API, [])).toEqual(API);
  });
});

describe('pageCaveats', () => {
  it('states the admin filter in the tense it is actually set to', () => {
    expect(pageCaveats({ rawRetentionDays: 120, excludeAdmins: true }).join(' ')).toContain(
      'Exclude admin accounts is ON',
    );
    expect(pageCaveats({ rawRetentionDays: 120, excludeAdmins: false }).join(' ')).toContain(
      'Exclude admin accounts is OFF',
    );
  });

  it('quotes the retention it was given rather than a hard-coded one', () => {
    expect(pageCaveats({ rawRetentionDays: 45, excludeAdmins: true })[0]).toContain('kept 45 days');
  });
});

describe('resolveUsageParams', () => {
  const WINDOWS = [7, 30, 90, 365] as const;
  const resolve = (sp: Record<string, string | undefined>) => resolveUsageParams(sp, WINDOWS, 120);

  it('falls back to 30 days on anything that is not an offered window', () => {
    expect(resolve({ days: 'abc' }).days).toBe(30);
    expect(resolve({ days: '45' }).days).toBe(30);
    expect(resolve({}).days).toBe(30);
    expect(resolve({ days: '7' }).days).toBe(7);
  });

  it('narrows the drill-down window past raw retention, and only then', () => {
    // The panels read raw page_views, which the retention sweep has removed
    // past 120 days; asking for 365 there is a 400, not a longer answer.
    expect(resolve({ days: '365' }).detailDays).toBe(90);
    expect(resolve({ days: '90' }).detailDays).toBe(90);
    expect(resolve({ days: '7' }).detailDays).toBe(7);
  });

  it('treats exclude-admins as on unless it is explicitly the string false', () => {
    expect(resolve({}).excludeAdmins).toBe(true);
    expect(resolve({ excludeAdmins: 'false' }).excludeAdmins).toBe(false);
    expect(resolve({ excludeAdmins: 'maybe' }).excludeAdmins).toBe(true);
  });

  it('drops an over-long or blank id rather than truncating it', () => {
    expect(resolve({ facultyId: 'f1' }).facultyId).toBe('f1');
    expect(resolve({ facultyId: 'x'.repeat(65) }).facultyId).toBeNull();
    expect(resolve({ q: '  ' }).q).toBeNull();
    expect(resolve({ q: '  ann  ' }).q).toBe('ann');
    expect(resolve({ q: 'x'.repeat(81) }).q).toBeNull();
  });
});

describe('MODULE_LABEL', () => {
  it('names every usage module — a new module must get a label, not render as its slug', async () => {
    const { USAGE_MODULES } = await import('@kku/shared/usage');
    const { MODULE_LABEL } = await import('../app/usage/client');
    expect(Object.keys(MODULE_LABEL).sort()).toEqual([...USAGE_MODULES].sort());
  });
});
