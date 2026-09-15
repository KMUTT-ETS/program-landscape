import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import type { ApiMeta } from '@kku/shared';

import { UsageSections } from '../app/usage/client';
import { mergeCaveats, pageCaveats, resolveUsageParams } from '../app/usage/types';
import type { UsageData, UsersResponseT, UserUsageT } from '../app/usage/types';

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
  activity: 'views',
  page: 1,
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

const userRow = (over: Partial<UserUsageT> = {}): UserUsageT => ({
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
  ...over,
});

const WITH_DETAIL: UsageData = {
  ...data,
  canSeeDetail: true,
  users: {
    data: { rows: [userRow()], total: 1, signinOnly: 0, page: 1, pageSize: 25 },
    meta,
  },
};

/** `WITH_DETAIL` with the access-log envelope patched — every access-log
 *  assertion is about that envelope, and spelling it out each time buries
 *  the one field the case is actually about. */
function withUsers(over: Partial<UsersResponseT>): UsageData {
  return {
    ...WITH_DETAIL,
    ...(over.page !== undefined ? { page: over.page } : {}),
    users: {
      data: { rows: [userRow()], total: 1, signinOnly: 0, page: 1, pageSize: 25, ...over },
      meta,
    },
  };
}

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

  it('does not report a count when the access log failed to load', () => {
    // The counts fall back to 0 on a null envelope, so the counted wording
    // would state "0 people opened pages" as a finding about the platform,
    // directly above a line saying the service never answered.
    const flat = text(render({ ...WITH_DETAIL, users: null }));
    expect(flat).not.toContain('0 people');
    expect(flat).toContain('The access log is unavailable');
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
    expect(flat).toContain('matching “some”');
  });
});

describe('UsageSections — the access log’s scope and paging', () => {
  // The defect this whole group exists for: a 365-day window listed ~575
  // people, because sign-ins are read from audit_logs for the WHOLE window
  // while page views stop at retention. The card now leads with the people who
  // actually read something and says how many it is leaving out.

  it('leads with the people who opened pages, and offers the rest', () => {
    const flat = text(render(withUsers({ total: 128, signinOnly: 447 })));
    expect(flat).toContain('128 people opened pages in this window');
    expect(flat).toContain('447 more signed in but opened no page');
    expect(flat).toContain('Include them');
    expect(flat).not.toContain('Only people who opened pages');
  });

  it('says nothing about sign-in-only accounts when there are none', () => {
    const flat = text(render(withUsers({ total: 3, signinOnly: 0 })));
    expect(flat).toContain('3 people opened pages in this window');
    expect(flat).not.toContain('signed in but opened no page');
    expect(flat).not.toContain('Include them');
  });

  it('says it is showing sign-ins too in all mode, and offers the way back', () => {
    const flat = text(
      render({ ...withUsers({ total: 575, signinOnly: 447 }), activity: 'all' as const }),
    );
    expect(flat).toContain('575 people active in this window · showing sign-ins too');
    expect(flat).toContain('Only people who opened pages');
    expect(flat).not.toContain('Include them');
  });

  it('pages only when there is more than one page', () => {
    // 128 of 25 per page is five pages; 20 of 25 is one, and a pager on one
    // page is a control that can only ever be disabled.
    const paged = text(render(withUsers({ total: 128, pageSize: 25 })));
    expect(paged).toContain('of 128');
    expect(paged).toContain('Previous');
    expect(paged).toContain('Next');

    const single = text(render(withUsers({ total: 20, pageSize: 25 })));
    expect(single).not.toContain('Previous');
    expect(single).not.toContain('Next');
  });

  it('numbers the range from the rows actually returned', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      userRow({ userId: `u${i}`, email: `${i}@x` }),
    );
    const flat = text(render(withUsers({ rows, total: 128, page: 2, pageSize: 25 })));
    expect(flat).toContain('26–50 of 128');
  });

  it('disables Previous on the first page and Next on the last', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      userRow({ userId: `u${i}`, email: `${i}@x` }),
    );
    const first = render(withUsers({ rows, total: 128, page: 1, pageSize: 25 }));
    // One disabled button on page 1 (Previous), one on the last (Next).
    expect(first.match(/disabled=""/g)?.length).toBe(1);
    expect(text(first)).toContain('1–25 of 128');

    const last = render(withUsers({ rows: rows.slice(0, 3), total: 128, page: 6, pageSize: 25 }));
    expect(last.match(/disabled=""/g)?.length).toBe(1);
    expect(text(last)).toContain('126–128 of 128');
  });

  it('names the sign-in-only accounts when the page itself is empty', () => {
    // The one emptiness with a remedy on screen. "Nobody has been active"
    // would be false — 447 people signed in.
    const flat = text(render(withUsers({ rows: [], total: 0, signinOnly: 447 })));
    expect(flat).toContain('Nobody opened a page in this window; 447 people signed in.');
    expect(flat).toContain('Include them');
    expect(flat).not.toContain('Nobody has been active in this window.');
  });

  it('offers a way back when the page is past the end of the list', () => {
    // A bookmarked or hand-edited `?page=` lands here. Every other empty
    // branch would say nobody was active, which the count on the same card
    // contradicts — and none of them offers a control that fixes it.
    const flat = text(
      render(withUsers({ rows: [], total: 575, signinOnly: 574, page: 100, pageSize: 25 })),
    );
    expect(flat).toContain('past the end');
    expect(flat).toContain('Back to the first page');
    expect(flat).not.toContain('Nobody has been active in this window.');
  });

  it('keeps the search term in the sign-in-only empty copy, and the remedy with it', () => {
    // A search that matched only sign-in-only accounts: "Nobody has been
    // active" is false, and the unqualified sign-in line would claim NOBODY
    // at all opened a page when it is only nobody named somchai.
    const flat = text(
      render({
        ...withUsers({ rows: [], total: 0, signinOnly: 12 }),
        q: 'somchai',
        activity: 'views' as const,
      }),
    );
    expect(flat).toContain('matching “somchai” opened a page');
    expect(flat).toContain('Include them');
    expect(flat).not.toContain('has been active');
  });

  it('falls back to the plain empty copy when nobody signed in either', () => {
    const flat = text(
      render({ ...withUsers({ rows: [], total: 0, signinOnly: 0 }), excludeAdmins: false }),
    );
    expect(flat).toContain('Nobody has been active in this window.');
    expect(flat).not.toContain('Include them');
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

  it('defaults the access log to people who opened pages', () => {
    expect(resolve({}).activity).toBe('views');
    expect(resolve({ activity: 'all' }).activity).toBe('all');
    // An unrecognised value lands on the default, never on the wide list.
    expect(resolve({ activity: 'everyone' }).activity).toBe('views');
  });

  it('treats anything that is not a whole page at or past one as page one', () => {
    expect(resolve({}).page).toBe(1);
    expect(resolve({ page: '3' }).page).toBe(3);
    expect(resolve({ page: '0' }).page).toBe(1);
    expect(resolve({ page: '-2' }).page).toBe(1);
    expect(resolve({ page: '1.5' }).page).toBe(1);
    expect(resolve({ page: 'abc' }).page).toBe(1);
  });

  it('caps a huge page rather than sending one the api will refuse', () => {
    // `1e18` IS a whole number at or past one, so it clears every guard above
    // and then asks the api for an OFFSET it bounds — which renders as "the
    // usage service did not answer", not as "that page does not exist".
    expect(resolve({ page: '1e18' }).page).toBe(100_000);
    expect(resolve({ page: '100001' }).page).toBe(100_000);
    // Infinity is not an integer, so it falls all the way back to page one.
    expect(resolve({ page: '1e999' }).page).toBe(1);
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
