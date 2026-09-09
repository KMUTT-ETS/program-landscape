import { describe, expect, it } from 'vitest';
import {
  decideScholarPanelState,
  formatScholarDay,
  type ScholarStatus,
} from '../src/lib/scholar-status';

// ────────────────────────────────────────────────────────────────────────────
// The profile panel's five states.
//
// This is where the states are pinned, because the component that renders them
// reads `decideScholarPanelState` in exactly one place and this workspace has
// no jsdom to click anything with. The render test next door asserts that the
// decision reaches the markup; this one asserts the decision.
//
// Written to fail under mutation: reordering the branches, dropping a reason,
// enabling the button in a blocked state, or hiding it instead of disabling it
// each break at least one assertion here or in the render test.
// ────────────────────────────────────────────────────────────────────────────

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

const SUCCEEDED_RUN: NonNullable<ScholarStatus['lastRun']> = {
  id: 'run-1',
  status: 'SUCCEEDED',
  startedAt: '2026-09-01T00:00:00.000Z',
  finishedAt: '2026-09-01T00:00:30.000Z',
  papersInserted: 12,
  citationsUpdated: 31,
  errorText: null,
};

describe('decideScholarPanelState — no staff record', () => {
  const NO_RECORD = statusOf({
    staffRecord: { linked: false, reason: 'No staff record matches the name "Somchai Example".' },
  });

  it('disables the button and shows the API reason verbatim', () => {
    const view = decideScholarPanelState(NO_RECORD);
    expect(view.kind).toBe('no-staff-record');
    expect(view.buttonDisabled).toBe(true);
    expect(view.disabledReason).toBe('No staff record matches the name "Somchai Example".');
    // Nothing to bind either — offering a profile URL would send the user
    // down a path that cannot succeed. The fix is an HR/name reconciliation.
    expect(view.offersManualOverride).toBe(false);
  });

  it('still produces a button label — the control is disabled, never absent', () => {
    expect(decideScholarPanelState(NO_RECORD).buttonLabel.length).toBeGreaterThan(0);
  });

  it('outranks every other blocker, so the reason shown is the real one', () => {
    // A queued fetch, an unbound profile and an open quota window all at once:
    // the answer is still "there is no staff record", because none of the
    // others can be acted on until that is fixed.
    const view = decideScholarPanelState(
      statusOf({
        staffRecord: { linked: false, reason: 'Two staff records match this account.' },
        fetchQueued: true,
        needsBinding: true,
        nextEligibleAt: '2026-10-01T00:00:00.000Z',
        quotaReason: 'One fetch per 30 days.',
      }),
    );
    expect(view.kind).toBe('no-staff-record');
    expect(view.disabledReason).toBe('Two staff records match this account.');
  });
});

describe('decideScholarPanelState — inside the 30-day window', () => {
  const COOLING = statusOf({
    lastRun: SUCCEEDED_RUN,
    nextEligibleAt: '2026-10-01T00:00:00.000Z',
    quotaReason: 'Already fetched on 2026-09-01. One fetch per 30 days.',
  });

  it('disables the button, keeps the retry date, and quotes the quota reason', () => {
    const view = decideScholarPanelState(COOLING);
    expect(view.kind).toBe('cooling-down');
    expect(view.buttonDisabled).toBe(true);
    expect(view.disabledReason).toBe('Already fetched on 2026-09-01. One fetch per 30 days.');
    expect(view.nextEligibleAt).toBe('2026-10-01T00:00:00.000Z');
    expect(formatScholarDay(view.nextEligibleAt)).toBe('1 Oct 2026');
    // Reaching the window means a sync has happened; the plain label would
    // read as if none ever had.
    expect(view.buttonLabel).toBe('Sync Google Scholar again');
  });

  it('falls back to its own sentence when the API sends no reason', () => {
    const view = decideScholarPanelState({ ...COOLING, quotaReason: null });
    expect(view.buttonDisabled).toBe(true);
    expect(view.disabledReason).toMatch(/30 days/);
  });
});

describe('decideScholarPanelState — unbound', () => {
  const UNBOUND = statusOf({ profile: { bound: false }, needsBinding: true });

  it('SYNCS rather than asking for a URL — the run searches by name now', () => {
    // The 2026-09-09 reversal, and the single most important assertion in this
    // file. This state used to hand back a different button that opened a
    // form, because a name could not be searched for. It can be, so the button
    // is the same button and it starts a run.
    const view = decideScholarPanelState(UNBOUND);
    expect(view.kind).toBe('unbound');
    expect(view.buttonDisabled).toBe(false);
    expect(view.disabledReason).toBeNull();
    expect(view.buttonLabel).toBe('Sync Google Scholar');
  });

  it('carries the SAME label as the ready state — there is one control, not two', () => {
    expect(decideScholarPanelState(UNBOUND).buttonLabel).toBe(
      decideScholarPanelState(statusOf({ profile: { bound: false } })).buttonLabel,
    );
  });

  it('offers the paste-a-URL override, for the search that finds the wrong person', () => {
    expect(decideScholarPanelState(UNBOUND).offersManualOverride).toBe(true);
  });

  it('withholds the override where it could not work or would fight a running job', () => {
    // No staff record: there is no name to check a pasted profile against.
    // A queued run: changing the binding underneath it is the confusing case.
    // Already linked: the correction lives beside the linked id instead.
    const withheld: ScholarStatus[] = [
      statusOf({ staffRecord: { linked: false, reason: 'none' }, needsBinding: true }),
      statusOf({ profile: { bound: false }, needsBinding: true, fetchQueued: true }),
      statusOf(),
    ];
    for (const s of withheld) {
      expect(decideScholarPanelState(s).offersManualOverride).toBe(false);
    }
    expect(decideScholarPanelState(UNBOUND, { starting: true }).offersManualOverride).toBe(false);
  });

  it('lands on the unbound state when a linked profile’s last run refused for binding', () => {
    // The API sets `needsBinding` from either side: no profile at all, or a run
    // that refused with SCHOLAR_NEEDS_BINDING.
    const view = decideScholarPanelState(
      statusOf({
        needsBinding: true,
        lastRun: {
          ...SUCCEEDED_RUN,
          status: 'REFUSED',
          errorText: 'No Google Scholar profile is linked to this staff record yet.',
        },
      }),
    );
    expect(view.kind).toBe('unbound');
    // ...but the profile IS linked here, so the correction belongs on the
    // linked-profile line rather than as a second affordance by the button.
    expect(view.offersManualOverride).toBe(false);
  });
});

describe('decideScholarPanelState — unlinked AND inside the 30-day window', () => {
  const BOTH = statusOf({
    profile: { bound: false },
    needsBinding: true,
    lastRun: SUCCEEDED_RUN,
    nextEligibleAt: '2026-10-01T00:00:00.000Z',
    quotaReason: 'Already fetched on 2026-09-01. One fetch per 30 days.',
  });

  it('the WINDOW wins, because the button would otherwise do nothing', () => {
    // The branch order swapped on 2026-09-09 and this is why. Binding used to
    // win, and an enabled button that opened a form was honest inside the
    // window. The button now enqueues a run, and the runner checks the quota
    // (step 2) before it would search (step 4) — so an enabled button here
    // would buy a refusal row and nothing else.
    const view = decideScholarPanelState(BOTH);
    expect(view.kind).toBe('cooling-down');
    expect(view.buttonDisabled).toBe(true);
    expect(view.disabledReason).toBe('Already fetched on 2026-09-01. One fetch per 30 days.');
    expect(view.nextEligibleAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('still offers the override — linking is not quota-gated', () => {
    // The part worth protecting when the branches swapped: a bind goes through
    // its own endpoint and its own daily cap, so someone locked out of syncing
    // can still put the right profile on their record today.
    expect(decideScholarPanelState(BOTH).offersManualOverride).toBe(true);
  });
});

describe('decideScholarPanelState — queued and ready', () => {
  it('reports a queued fetch instead of letting a second click through', () => {
    const view = decideScholarPanelState(statusOf({ fetchQueued: true }));
    expect(view.kind).toBe('running');
    expect(view.buttonDisabled).toBe(true);
    expect(view.disabledReason).toBeTruthy();
  });

  it('disables the button while the fetch request is still in flight', () => {
    // The window this closes: POST /scholar/fetch/me is a round trip, and
    // until it returns `fetchQueued` is still false. Without `starting` the
    // button stays live for the length of that request, and a second click
    // enqueues a second job — harmless to the credit bill (the job id
    // collapses the pair) but it writes a spurious REFUSED row to the ledger.
    const view = decideScholarPanelState(statusOf(), { starting: true });
    expect(view.kind).toBe('running');
    expect(view.buttonDisabled).toBe(true);
    expect(view.disabledReason).toBeTruthy();
    expect(view.buttonLabel).toBe('Starting…');
  });

  it('outranks the queue flag, so the label never goes backwards', () => {
    // Both true for one render, when the optimistic `fetchQueued` lands before
    // `starting` clears. "Starting…" is the truthful one at that moment.
    const view = decideScholarPanelState(statusOf({ fetchQueued: true }), { starting: true });
    expect(view.buttonLabel).toBe('Starting…');
  });

  it('never overrides the no-staff-record refusal', () => {
    const view = decideScholarPanelState(
      statusOf({ staffRecord: { linked: false, reason: 'no record' } }),
      { starting: true },
    );
    expect(view.kind).toBe('no-staff-record');
  });

  it('enables the button with no reason when nothing blocks it', () => {
    const view = decideScholarPanelState(statusOf());
    expect(view.kind).toBe('ready');
    expect(view.buttonDisabled).toBe(false);
    expect(view.disabledReason).toBeNull();
    expect(view.lastFetchedAt).toBeNull();
    expect(view.buttonLabel).toBe('Sync Google Scholar');
  });

  it('names the last fetch date once there has been one', () => {
    const view = decideScholarPanelState(statusOf({ lastRun: SUCCEEDED_RUN }));
    expect(view.lastFetchedAt).toBe('2026-09-01T00:00:30.000Z');
    expect(formatScholarDay(view.lastFetchedAt)).toBe('1 Sep 2026');
    expect(view.buttonLabel).toBe('Sync Google Scholar again');
  });

  it('does NOT treat a refused or failed run as a fetch date', () => {
    // "Last fetched on the 1st" next to a run that wrote nothing would tell a
    // user their record is current when it is not.
    for (const status of ['REFUSED', 'FAILED'] as const) {
      const view = decideScholarPanelState(
        statusOf({ lastRun: { ...SUCCEEDED_RUN, status, errorText: 'no' } }),
      );
      expect(view.lastFetchedAt).toBeNull();
      expect(view.buttonLabel).toBe('Sync Google Scholar');
    }
  });

  it('counts a PARTIAL run as a fetch — it produced data', () => {
    const view = decideScholarPanelState(
      statusOf({ lastRun: { ...SUCCEEDED_RUN, status: 'PARTIAL' } }),
    );
    expect(view.lastFetchedAt).toBe('2026-09-01T00:00:30.000Z');
  });
});

describe('decideScholarPanelState — the invariant every state must hold', () => {
  it('a disabled button ALWAYS carries a reason, and an enabled one never does', () => {
    const all: ScholarStatus[] = [
      statusOf({ staffRecord: { linked: false, reason: 'no record' } }),
      statusOf({ fetchQueued: true }),
      statusOf({ profile: { bound: false }, needsBinding: true }),
      statusOf({ nextEligibleAt: '2026-10-01T00:00:00.000Z', quotaReason: 'wait' }),
      statusOf({ nextEligibleAt: '2026-10-01T00:00:00.000Z', quotaReason: null }),
      statusOf(),
      statusOf({ lastRun: SUCCEEDED_RUN }),
    ];
    for (const s of all) {
      for (const starting of [false, true]) {
        const view = decideScholarPanelState(s, { starting });
        expect(view.buttonDisabled).toBe(view.disabledReason !== null);
      }
    }
  });
});

describe('formatScholarDay', () => {
  it('is null for absent and unparseable input rather than "Invalid Date"', () => {
    expect(formatScholarDay(null)).toBeNull();
    expect(formatScholarDay(undefined)).toBeNull();
    expect(formatScholarDay('not a date')).toBeNull();
  });

  it('pins Asia/Bangkok so a server render and a browser render agree', () => {
    // 17:30 UTC is already the next day in Bangkok. A floating timezone would
    // make the server and the client disagree and React would report a
    // hydration mismatch.
    expect(formatScholarDay('2026-09-30T17:30:00.000Z')).toBe('1 Oct 2026');
  });
});
