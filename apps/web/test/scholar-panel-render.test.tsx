import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ────────────────────────────────────────────────────────────────────────────
// The panel's states as they actually reach the page.
//
// `decideScholarPanelState` is tested next door; this asserts that its
// decisions survive the trip into markup — in particular the one that is easy
// to regress by "tidying up": the no-staff-record button must render DISABLED
// WITH ITS REASON, not be hidden. Deleting the reason, hiding the button, or
// wrapping it in a truthiness check each fail here.
//
// Static markup rather than a driven DOM because this workspace has no jsdom
// and no @testing-library. That rules out asserting a click — so the picker,
// which since 2026-09-09 opens ONLY from the "wrong person" affordance, is
// asserted by rendering `BindPicker` directly, and the bind refusal is
// rendered from a prop. What the unbound panel is checked for here is that the
// form is NOT on screen and the offer to open it is.
// ────────────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    error: () => undefined,
    message: () => undefined,
  }),
}));

// The real module is `'use server'` and pulls in `@kku/db` (and therefore
// Prisma) at import time. Nothing here calls the actions — the effects that
// would never run under renderToStaticMarkup anyway.
vi.mock('@/lib/actions/scholar', () => ({
  getScholarStatusAction: async () => ({ ok: false, message: 'not called in this test' }),
  bindScholarProfileAction: async () => ({
    ok: false,
    message: 'not called in this test',
    rateLimited: false,
  }),
  startScholarFetchAction: async () => ({ ok: false, message: 'not called in this test' }),
}));

import {
  BindPicker,
  ScholarPanel,
  ScholarPanelUnavailable,
} from '../app/profile/scholar-panel';
import type { ScholarStatus } from '../src/lib/scholar-status';

const LINKED = {
  linked: true as const,
  facultyMemberId: 'fm-1',
  nameEn: 'Somchai Example',
  nameTh: 'สมชาย ตัวอย่าง',
};

function statusOf(overrides: Partial<ScholarStatus> = {}): ScholarStatus {
  return {
    userId: 'u1',
    staffRecord: LINKED,
    profile: {
      bound: true,
      scholarProfileId: 'ABC123',
      scholarProfileUrl: 'https://scholar.google.com/citations?user=ABC123',
      boundAt: '2026-08-01T03:00:00.000Z',
    },
    lastRun: null,
    nextEligibleAt: null,
    quotaReason: null,
    needsBinding: false,
    fetchQueued: false,
    bind: {
      attemptsToday: 0,
      maxPerDay: 5,
      retryAt: null,
      creditsPerSearch: 75,
      creditsPerPastedCheck: 15,
      creditsAtRisk: 375,
    },
    ...overrides,
  };
}

function render(status: ScholarStatus): string {
  return renderToStaticMarkup(
    <ScholarPanel
      initialStatus={status}
      sources={{ googleScholar: 12, libraryIndex: 184 }}
    />,
  );
}

/** The opening tag of the primary control, so `disabled` can be asserted on
 *  that element rather than anywhere in the document. */
function primaryButtonTag(markup: string): string {
  const match = /<button[^>]*data-testid="scholar-fetch-button"[^>]*>/.exec(markup);
  if (!match) throw new Error('the primary Scholar button is not in the markup at all');
  return match[0];
}

/**
 * Whether a rendered `<button …>` tag carries the DISABLED ATTRIBUTE.
 *
 * Not `tag.includes('disabled')`: every Button in this design system ships
 * `disabled:pointer-events-none disabled:opacity-50` in its class list, so a
 * substring check reports every button as disabled and the assertion that
 * matters — that an enabled button is enabled — silently passes forever.
 */
function isDisabled(tag: string): boolean {
  return / disabled(=|\s|>)/.test(tag);
}

describe('ScholarPanel — no staff record', () => {
  const markup = render(
    statusOf({
      staffRecord: {
        linked: false,
        reason: 'No staff record matches the name "Somchai Example".',
      },
    }),
  );

  it('renders the button — hiding it is the failure this asserts against', () => {
    expect(() => primaryButtonTag(markup)).not.toThrow();
    expect(markup).toContain('Sync Google Scholar');
  });

  it('renders it disabled', () => {
    expect(isDisabled(primaryButtonTag(markup))).toBe(true);
    expect(primaryButtonTag(markup)).toContain('data-panel-kind="no-staff-record"');
  });

  it('renders the reason, so the disabled control explains itself', () => {
    expect(markup).toContain('data-testid="scholar-disabled-reason"');
    expect(markup).toContain('No staff record matches the name');
  });

  it('does NOT offer the profile picker — there is nothing to bind it to', () => {
    expect(markup).not.toContain('data-testid="scholar-bind-picker"');
  });
});

describe('ScholarPanel — inside the 30-day window', () => {
  const markup = render(
    statusOf({
      lastRun: {
        id: 'run-1',
        status: 'SUCCEEDED',
        startedAt: '2026-09-01T00:00:00.000Z',
        finishedAt: '2026-09-01T00:00:30.000Z',
        papersInserted: 12,
        citationsUpdated: 31,
        errorText: null,
      },
      nextEligibleAt: '2026-10-01T00:00:00.000Z',
      quotaReason: 'Already fetched on 2026-09-01. One fetch per 30 days.',
    }),
  );

  it('disables the button and shows the retry date as a date, not a timestamp', () => {
    expect(isDisabled(primaryButtonTag(markup))).toBe(true);
    expect(markup).toContain('data-testid="scholar-next-eligible"');
    expect(markup).toContain('You can sync again on 1 Oct 2026.');
  });

  it('shows the quota reason alongside it', () => {
    expect(markup).toContain('Already fetched on 2026-09-01.');
  });

  it('reports the last fetch and what it did, with the counts kept apart', () => {
    expect(markup).toContain('Last Scholar fetch on 1 Sep 2026');
    expect(markup).toContain('12 papers added');
    expect(markup).toContain('31 citation counts refreshed');
  });
});

describe('ScholarPanel — unbound', () => {
  const markup = render(statusOf({ profile: { bound: false }, needsBinding: true }));

  it('shows ONE enabled sync button and NO form — the picker no longer opens itself', () => {
    // The 2026-09-09 reversal as it reaches the page. This state used to paint
    // the paste-a-URL form immediately and label its button "Link your Scholar
    // profile"; both are gone, because the run finds the profile now.
    expect(isDisabled(primaryButtonTag(markup))).toBe(false);
    expect(primaryButtonTag(markup)).toContain('data-panel-kind="unbound"');
    expect(markup).toContain('Sync Google Scholar');
    expect(markup).not.toContain('Link your Scholar profile');
    expect(markup).not.toContain('data-testid="scholar-bind-picker"');
  });

  it('says what pressing it will actually do, before it is pressed', () => {
    expect(markup).toContain('searches Google Scholar for your');
    expect(markup).toContain('English staff name');
  });

  it('offers the paste-a-URL override as a correction, not as the way in', () => {
    expect(markup).toContain('data-testid="scholar-manual-override"');
    expect(markup).toContain('Paste your profile URL instead');
    // The offer and its lead-in must not run together into one phrase.
    expect(markup).toMatch(/nobody at all\?<!-- -->\s|nobody at all\? <button/);
  });

  it('prices the allowance in CREDITS, not only in attempts', () => {
    // A count stopped being the meaningful unit when the search (75) and the
    // pasted check (15) started sharing one cap. Five attempts is 75 credits
    // of pasted checks or 375 of searches, and only the credits say so.
    expect(markup).toContain('data-testid="scholar-search-cost"');
    expect(markup).toContain('75 ScrapingBee credits');
    expect(markup).toContain('15 credits');
    expect(markup).toContain('up to 375 credits');
    // …and the count is still there, in a dt/dd pair rather than two spans in
    // a flex row. `justify-between` separates them on screen and NOT in the
    // text: with spans the string is "Attempts left today5 of 5", which is
    // what a screen reader gets and what the line reads as when it wraps.
    // Caught by reading this panel back as rendered, which is the only way
    // this class of defect has ever been caught here.
    expect(markup).toContain('<dt>Attempts left today</dt>');
    expect(markup).toMatch(/<dd[^>]*>5 of 5 — up to 375 credits<\/dd>/);
    expect(markup).not.toContain('Attempts left today5');
  });

  it('keeps the label and its qualifier from reading as one word', () => {
    // JSX eats the whitespace around a newline, so a margin alone leaves the
    // accessible name as "KKU library indexprimary source".
    expect(markup).toContain('KKU library index <span');
    expect(markup).toContain('Google Scholar <span');
  });
});

describe('ScholarPanel — bound and ready', () => {
  const markup = render(statusOf());

  it('shows the linked profile id and a way to change it', () => {
    expect(markup).toContain('data-testid="scholar-bound-profile"');
    expect(markup).toContain('ABC123');
    expect(markup).toContain('Change');
    expect(markup).toContain('a system administrator');
  });

  it('does not open the picker over an already-linked profile', () => {
    expect(markup).not.toContain('data-testid="scholar-bind-picker"');
  });

  it('names the library index as primary, and Scholar as the top-up', () => {
    expect(markup).toContain('KKU library index');
    expect(markup).toContain('primary source');
    expect(markup).toContain('184 papers');
    expect(markup).toContain('12 papers');
    expect(markup).toContain('Google Scholar has never been fetched for this record.');
  });
});

describe('ScholarPanel — a failed run explains itself', () => {
  it('surfaces the refusal text of the last run', () => {
    const markup = render(
      statusOf({
        lastRun: {
          id: 'run-2',
          status: 'FAILED',
          startedAt: '2026-09-05T00:00:00.000Z',
          finishedAt: '2026-09-05T00:00:10.000Z',
          papersInserted: 0,
          citationsUpdated: 0,
          errorText: 'Google returned a sign-in wall on page 1.',
        },
      }),
    );
    expect(markup).toContain('data-testid="scholar-last-run-error"');
    expect(markup).toContain('Google returned a sign-in wall on page 1.');
    expect(markup).toContain('The attempt on 5 Sep 2026 did not');
  });
});

describe('ScholarPanelUnavailable — the status read failed', () => {
  const markup = renderToStaticMarkup(
    <ScholarPanelUnavailable message="Network error talking to API: ECONNREFUSED." />,
  );

  it('still draws the button, disabled, with the reason', () => {
    // The one place this feature used to make the control vanish. An API
    // outage is exactly when someone goes looking for a button they remember.
    expect(isDisabled(primaryButtonTag(markup))).toBe(true);
    expect(primaryButtonTag(markup)).toContain('data-panel-kind="unavailable"');
    expect(markup).toContain('data-testid="scholar-disabled-reason"');
    expect(markup).toContain('Network error talking to API: ECONNREFUSED.');
  });

  it('claims nothing about the account it could not read', () => {
    // Without a status read we do not know whether a staff record exists, so
    // the reason must name the read rather than the person.
    expect(markup).not.toContain('staff record');
    expect(markup).not.toContain('data-testid="scholar-bind-picker"');
  });
});

describe('ScholarPanel — unbound AND inside the window', () => {
  const markup = render(
    statusOf({
      profile: { bound: false },
      needsBinding: true,
      nextEligibleAt: '2026-10-01T00:00:00.000Z',
      quotaReason: 'Already fetched on 2026-09-01. One fetch per 30 days.',
    }),
  );

  it('disables the button, because pressing it would only buy a refusal', () => {
    // The branch order swapped on 2026-09-09. Binding used to win here and the
    // button opened a form, which was honest. It now enqueues a run, and the
    // runner refuses at the quota gate before it would search — so an enabled
    // button would spend a worker slot to write "already fetched" to the
    // ledger.
    expect(isDisabled(primaryButtonTag(markup))).toBe(true);
    expect(primaryButtonTag(markup)).toContain('data-panel-kind="cooling-down"');
    expect(markup).toContain('Already fetched on 2026-09-01.');
    expect(markup).toContain('You can sync again on 1 Oct 2026.');
  });

  it('still offers the paste-a-URL override — a bind is not quota-gated', () => {
    // What the swap had to preserve: someone locked out of syncing until
    // October can still put the right profile on their record today, so the
    // next sync uses it instead of searching.
    expect(markup).toContain('data-testid="scholar-manual-override"');
    expect(markup).toContain('Paste your profile URL instead');
    // Offered, not opened.
    expect(markup).not.toContain('data-testid="scholar-bind-picker"');
  });
});

describe('BindPicker — a refused bind names both sides', () => {
  // Verbatim from packages/db/src/scholar-fetch.ts. The whole value of the
  // message is that it quotes the profile AND the staff record, so the person
  // reading it can tell which of the two is wrong.
  const REFUSAL =
    'That Scholar profile does not appear to belong to this person. ' +
    'The profile is named "S. Example", "Somchai E."; the staff record says "Somchai Example". ' +
    'Refusing to link them.';

  // A bound status, so the field is pre-filled with the link being replaced —
  // the shape a refusal actually arrives in, since an empty field cannot be
  // submitted and so cannot be refused.
  const markup = renderToStaticMarkup(
    <BindPicker
      status={statusOf({ needsBinding: true })}
      error={REFUSAL}
      submitting={false}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />,
  );

  it('renders the refusal, with the profile name and the record name intact', () => {
    expect(markup).toContain('data-testid="scholar-bind-error"');
    expect(markup).toContain('S. Example');
    expect(markup).toContain('Somchai Example');
    expect(markup).toContain('Refusing to link them.');
  });

  it('marks the field invalid and the message as an alert', () => {
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-invalid="true"');
  });

  it('leaves the submit button usable — the fix is a different URL, not waiting', () => {
    // Only the daily cap greys out submit. A refusal must not, or a user who
    // pasted the wrong link once could not paste the right one.
    const submit = /<button[^>]*type="submit"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(isDisabled(submit)).toBe(false);
  });
});

describe('BindPicker — the daily cap', () => {
  it('leaves submit usable for an account the server exempts', () => {
    // `decideScholarBindQuota` exempts SUPER_ADMIN outright, so the API sends
    // `retryAt: null` however many attempts have been recorded. A client-side
    // `attemptsToday >= maxPerDay` check would grey out a button the API is
    // perfectly willing to serve — two opinions, and the wrong one winning.
    const markup = renderToStaticMarkup(
      <BindPicker
        status={statusOf({
          needsBinding: true,
          bind: { ...statusOf().bind, attemptsToday: 9, maxPerDay: 5, retryAt: null },
        })}
        error={null}
        submitting={false}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const submit = /<button[^>]*type="submit"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(isDisabled(submit)).toBe(false);
    // And the sentence does not claim "0 left" next to a working button.
    expect(markup).toContain('The daily cap does not apply to your account.');
    // Nor does it print an empty credit figure, which is what a partial
    // `bind` override in a fixture produces and what a partial API response
    // would produce in production.
    expect(markup).not.toContain('the same  credits');
  });

  it('greys out submit and says when the allowance returns', () => {
    const markup = renderToStaticMarkup(
      <BindPicker
        status={statusOf({
          profile: { bound: false },
          needsBinding: true,
          bind: {
            ...statusOf().bind,
            attemptsToday: 5,
            maxPerDay: 5,
            retryAt: '2026-09-09T04:30:00.000Z',
          },
        })}
        error={null}
        submitting={false}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const submit = /<button[^>]*type="submit"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(isDisabled(submit)).toBe(true);
    expect(markup).toContain('No attempts left today');
    expect(markup).toContain('the allowance resets on 9 Sep 2026, 11:30');
  });

  it('names BOTH prices the one cap covers, before either is spent', () => {
    // The cap gates a pasted check and an automatic search, and they stopped
    // costing the same on 2026-09-09. Stating the allowance as a bare count
    // says nothing about which of the two it is worth.
    const markup = renderToStaticMarkup(
      <BindPicker
        status={statusOf({ profile: { bound: false }, needsBinding: true })}
        error={null}
        submitting={false}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(markup).toContain('a wrong link costs the same 15 credits as a right one');
    expect(markup).toContain('An automatic search costs 75 credits');
    expect(markup).toContain('both draw on the same allowance');
  });
});
