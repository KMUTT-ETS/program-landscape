import { describe, expect, it, vi } from 'vitest';

// Coverage for the two /admin/job-fields "derived-layer rebuild" buttons:
// "Rebuild programme links" (free, deterministic) and "Full derived
// refresh" (spends real AI money). Same testing approach as
// job-fields-admin-bulk-approve.test.tsx — this package's vitest env is
// `node` (no jsdom), so interactive logic lives in exported pure functions
// and is tested directly; only markup/text is asserted via
// renderToStaticMarkup, with react's useState mocked by call index to force
// the refreshStatus hook (index 11) into a chosen state without a real DOM
// to click through.

const hooks = vi.hoisted(() => ({ callIndex: 0, forcedRefreshStatus: undefined as unknown }));

// Hook order inside JobFieldsReview: fields(1) assignments(2) selected(3)
// busy(4) renaming(5) merging(6) mergeTarget(7) query(8) selectedIds(9)
// assignmentSelectedIds(10) refreshStatus(11). This mock forces index 11
// only when a test sets hooks.forcedRefreshStatus; every other hook passes
// straight through to React.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      hooks.callIndex += 1;
      if (hooks.forcedRefreshStatus !== undefined && hooks.callIndex === 11) {
        return [hooks.forcedRefreshStatus, () => {}];
      }
      return actual.useState(initial as never);
    },
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@kku/ui';
import {
  JobFieldsReview,
  JOBTHAI_FULL_REFRESH_COST_MAX_USD,
  JOBTHAI_FULL_REFRESH_COST_MIN_USD,
  LINK_REBUILD_HELP_TEXT,
  buildFullRefreshConfirmation,
  describeJobsInFlight,
  describeRefreshOutcome,
  fullRefreshCostLabel,
  runFullRefresh,
  runLinkRebuild,
} from '../app/admin/job-fields/client';
import type { JobFieldRowDto, ProgramJobFieldRowDto, RefreshStatusDto } from '../app/admin/job-fields/client';

// ── Pure function tests ──────────────────────────────────────────────────

describe('LINK_REBUILD_HELP_TEXT', () => {
  it('is free and deterministic, and never claims a cost', () => {
    expect(LINK_REBUILD_HELP_TEXT).toMatch(/free/i);
    expect(LINK_REBUILD_HELP_TEXT).toMatch(/deterministic/i);
    expect(LINK_REBUILD_HELP_TEXT).not.toMatch(/USD|\$|cost|spend/i);
  });
});

describe('buildFullRefreshConfirmation', () => {
  it('names the cost figure before the click', () => {
    const text = buildFullRefreshConfirmation();
    expect(text).toContain('USD');
    expect(text).toContain(JOBTHAI_FULL_REFRESH_COST_MIN_USD.toFixed(2));
    expect(text).toContain(JOBTHAI_FULL_REFRESH_COST_MAX_USD.toFixed(2));
  });

  it('says what will be spent, not just "are you sure"', () => {
    const text = buildFullRefreshConfirmation();
    expect(text).toMatch(/spend/i);
    expect(text).toMatch(/AI model/i);
  });

  it('fullRefreshCostLabel matches the constants used in the confirmation', () => {
    expect(fullRefreshCostLabel()).toBe(
      `~USD ${JOBTHAI_FULL_REFRESH_COST_MIN_USD.toFixed(2)}–${JOBTHAI_FULL_REFRESH_COST_MAX_USD.toFixed(2)} per run`,
    );
  });
});

describe('runLinkRebuild', () => {
  it('posts without ever confirming — deps has no confirm to call', async () => {
    const post = vi.fn(async () => true);
    const ok = await runLinkRebuild({ post });
    expect(post).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });
});

describe('runFullRefresh', () => {
  it('confirms with exactly buildFullRefreshConfirmation() before posting', async () => {
    const confirm = vi.fn(() => true);
    const post = vi.fn(async () => true);
    const ok = await runFullRefresh({ confirm, post });
    expect(confirm).toHaveBeenCalledWith(buildFullRefreshConfirmation());
    expect(post).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it('never posts when the confirmation is declined', async () => {
    const confirm = vi.fn(() => false);
    const post = vi.fn(async () => true);
    const ok = await runFullRefresh({ confirm, post });
    expect(post).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });
});

describe('describeJobsInFlight', () => {
  it('null status → no reason', () => {
    expect(describeJobsInFlight(null)).toBeNull();
  });

  const base: RefreshStatusDto = {
    linkRebuildRunning: false,
    fullRefreshRunning: false,
    linkState: null,
    lastLinkRebuild: null,
    lastFullRefresh: null,
  };

  it('neither running → no reason', () => {
    expect(describeJobsInFlight(base)).toBeNull();
  });

  it('link rebuild running → names it', () => {
    const reason = describeJobsInFlight({ ...base, linkRebuildRunning: true });
    expect(reason).toMatch(/link rebuild/i);
  });

  it('full refresh running → names it', () => {
    const reason = describeJobsInFlight({ ...base, fullRefreshRunning: true });
    expect(reason).toMatch(/full derived refresh/i);
  });

  it('both running → names both', () => {
    const reason = describeJobsInFlight({ ...base, linkRebuildRunning: true, fullRefreshRunning: true });
    expect(reason).toMatch(/both/i);
  });
});

describe('describeRefreshOutcome', () => {
  it('null outcome → nothing to show', () => {
    expect(describeRefreshOutcome(null, 'Rebuild programme links')).toBeNull();
  });

  it('a full success is tone success and says "done"', () => {
    const d = describeRefreshOutcome(
      { status: 'SUCCEEDED', partial: false, message: 'wrote 1716 links across 82 programmes', finishedAt: '2026-09-20T00:00:00Z' },
      'Rebuild programme links',
    );
    expect(d?.tone).toBe('success');
    expect(d?.text).toMatch(/done/i);
    expect(d?.text).not.toMatch(/partial/i);
  });

  // The load-bearing distinction: a partial full-refresh (taxonomy step
  // failed, links still landed) must render DIFFERENTLY from a full success
  // — different tone AND different wording, never a flat "done" either way.
  it('a partial success is tone warning, says "partial", and differs from a full success', () => {
    const full = describeRefreshOutcome(
      { status: 'SUCCEEDED', partial: false, message: 'links + fields both completed', finishedAt: '2026-09-20T00:00:00Z' },
      'Full derived refresh',
    );
    const partial = describeRefreshOutcome(
      { status: 'SUCCEEDED', partial: true, message: 'fields: FAILED — provider outage', finishedAt: '2026-09-20T01:00:00Z' },
      'Full derived refresh',
    );
    expect(partial?.tone).toBe('warning');
    expect(partial?.text).toMatch(/partial/i);
    expect(partial?.tone).not.toBe(full?.tone);
    expect(partial?.text).not.toBe(full?.text);
  });

  it('a hard job failure (JOB_FAILED) is tone danger', () => {
    const d = describeRefreshOutcome(
      { status: 'JOB_FAILED', partial: false, message: 'threw: ECONNREFUSED', finishedAt: '2026-09-20T00:00:00Z' },
      'Full derived refresh',
    );
    expect(d?.tone).toBe('danger');
    expect(d?.text).toMatch(/failed/i);
  });

  it('a handler-reported FAILED is also tone danger', () => {
    const d = describeRefreshOutcome(
      { status: 'FAILED', partial: false, message: 'No SUCCEEDED jobthai run to attribute to.', finishedAt: '2026-09-20T00:00:00Z' },
      'Rebuild programme links',
    );
    expect(d?.tone).toBe('danger');
  });
});

// ── Render tests (renderToStaticMarkup, no DOM interaction) ───────────────

const fields: JobFieldRowDto[] = [
  {
    id: 'cnr1a2b3c4d5e6f7g8h9i0j1k',
    slug: 'accounting',
    nameTh: 'การบัญชี',
    nameEn: 'Accounting',
    synonyms: ['บัญชี'],
    mentionCount: 852,
    reviewStatus: 'PROPOSED',
    methodVersion: 'job-field-taxonomy.v1',
    programmeCount: 2,
    updatedAt: '2026-09-15T00:00:00Z',
  },
];
const assignments: ProgramJobFieldRowDto[] = [
  {
    id: 'cas1a2b3c4d5e6f7g8h9i0j1k',
    programId: 'cpr1a2b3c4d5e6f7g8h9i0j1k',
    programCode: 'KKU-SEQ-0245',
    programNameTh: 'บัญชีบัณฑิต',
    programNameEn: 'Accountancy',
    programLevel: 'BACHELOR',
    fieldId: 'cnr1a2b3c4d5e6f7g8h9i0j1k',
    fieldSlug: 'accounting',
    source: 'rule',
    confidence: null,
    reviewStatus: 'PROPOSED',
  },
];

function render(refreshStatus?: RefreshStatusDto): { html: string; text: string } {
  hooks.callIndex = 0;
  hooks.forcedRefreshStatus = refreshStatus;
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <JobFieldsReview fields={fields} assignments={assignments} />
    </TooltipProvider>,
  );
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
}

/**
 * The button's own opening tag. React emits attributes in its own order
 * (`disabled=""` does not necessarily land after `data-action` in the
 * source), so a substring split on one or the other is a coin flip — find
 * the element by its data-action and look inside the whole tag.
 */
function buttonTag(html: string, action: string): string {
  const match = new RegExp(`<button[^>]*data-action="${action}"[^>]*>`).exec(html);
  if (!match) throw new Error(`no button with data-action="${action}" in the rendered page`);
  return match[0];
}

const NOT_RUNNING: RefreshStatusDto = {
  linkRebuildRunning: false,
  fullRefreshRunning: false,
  linkState: { totalLinks: 1716, linkedProgrammes: 82, methodologyVersion: 'jobthai-bridge.v3' },
  lastLinkRebuild: null,
  lastFullRefresh: null,
};

describe('JobFieldsReview — derived-layer rebuild controls', () => {
  it('renders both buttons enabled when nothing is running', () => {
    const { html } = render(NOT_RUNNING);
    // React SSR omits the `disabled` attribute entirely for disabled={false}.
    expect(buttonTag(html, 'rebuild-links')).not.toContain('disabled=');
    expect(buttonTag(html, 'refresh-all')).not.toContain('disabled=');
  });

  it('disables BOTH buttons, with the reason visible, while the link rebuild is running', () => {
    const { html, text } = render({ ...NOT_RUNNING, linkRebuildRunning: true });
    expect(buttonTag(html, 'rebuild-links')).toContain('disabled=""');
    expect(buttonTag(html, 'refresh-all')).toContain('disabled=""');
    expect(text).toMatch(/programme-link rebuild is running/i);
  });

  it('disables BOTH buttons, with the reason visible, while the full refresh is running', () => {
    const { html, text } = render({ ...NOT_RUNNING, fullRefreshRunning: true });
    expect(buttonTag(html, 'rebuild-links')).toContain('disabled=""');
    expect(buttonTag(html, 'refresh-all')).toContain('disabled=""');
    expect(text).toMatch(/full derived refresh is running/i);
  });

  it('button 1 states it is free; button 2 states its cost, on the page itself', () => {
    const { text } = render(NOT_RUNNING);
    expect(text).toMatch(/free.*deterministic/i);
    expect(text).toMatch(/spends real money/i);
    expect(text).toContain(`USD ${JOBTHAI_FULL_REFRESH_COST_MIN_USD.toFixed(2)}`);
  });

  it('shows the live link state (not hardcoded — comes from the refreshStatus prop)', () => {
    const { text } = render(NOT_RUNNING);
    expect(text).toContain('1,716');
    expect(text).toContain('82');
    expect(text).toContain('jobthai-bridge.v3');
  });

  it('a partial full-refresh outcome renders visibly differently from a full success', () => {
    const fullSuccess = render({
      ...NOT_RUNNING,
      lastFullRefresh: { status: 'SUCCEEDED', partial: false, message: 'links + fields both completed', finishedAt: '2026-09-20T00:00:00Z' },
    });
    const partial = render({
      ...NOT_RUNNING,
      lastFullRefresh: { status: 'SUCCEEDED', partial: true, message: 'fields: FAILED — provider outage', finishedAt: '2026-09-20T01:00:00Z' },
    });
    expect(fullSuccess.text).not.toEqual(partial.text);
    expect(partial.text).toMatch(/partial/i);
    expect(fullSuccess.text).not.toMatch(/full-taxonomy step did not complete|field-taxonomy step did not complete/i);
    expect(partial.text).toMatch(/field-taxonomy step did not complete/i);
  });

  it('never renders a raw cuid anywhere on the page, including outcome text', () => {
    const { text } = render({
      ...NOT_RUNNING,
      lastLinkRebuild: { status: 'SUCCEEDED', partial: false, message: 'wrote 1716 program_jobthai_links across 82 programme(s)', finishedAt: '2026-09-20T00:00:00Z' },
      lastFullRefresh: { status: 'JOB_FAILED', partial: false, message: 'threw: ECONNREFUSED', finishedAt: '2026-09-20T01:00:00Z' },
    });
    expect(text).not.toMatch(/\bc[a-z0-9]{24}\b/);
  });
});
