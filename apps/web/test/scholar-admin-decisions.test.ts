import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROSTER_FILTERS,
  decideScholarBulkGate,
  describeScholarOutcome,
  filterScholarRows,
  summariseBulkProgress,
  type ScholarBulkPreview,
  type ScholarConsoleRow,
  type ScholarConsoleRun,
  type ScholarLedgerRun,
} from '../src/lib/scholar-admin';

// ────────────────────────────────────────────────────────────────────────────
// The two decisions the admin Scholar console cannot be allowed to get wrong:
// whether a fetch may be sent (it costs money), and what a finished run
// actually did (a clean walk that found nothing is NOT a success).
//
// Both are pure functions precisely so they can be asserted exhaustively —
// this workspace has no jsdom, so a click cannot be driven, and a guard that
// only exists inside an onClick handler could not be tested at all.
// ────────────────────────────────────────────────────────────────────────────

function preview(overrides: Partial<ScholarBulkPreview> = {}): ScholarBulkPreview {
  return {
    userIds: ['u1', 'u2'],
    targetCount: 2,
    duplicatesDropped: 0,
    chargeableCount: 2,
    quotaBlockedCount: 0,
    unboundCount: 0,
    unresolvableCount: 0,
    estimatedCredits: 30,
    estimatedCreditsCeiling: 630,
    maxTargets: 100,
    ...overrides,
  };
}

describe('decideScholarBulkGate — the confirmation cannot be bypassed', () => {
  it('REFUSES when nothing has been priced, however many people are selected', () => {
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u1', 'u2'],
      preview: null,
      submitting: false,
      maxTargets: 100,
    });
    expect(gate.canEnqueue).toBe(false);
    // The reason has to name the missing estimate — this is the sentence the
    // operator reads when the dialog has not answered yet.
    expect(gate.canEnqueue === false && gate.reason).toMatch(/priced/i);
  });

  it('allows exactly the priced set, and returns THAT set rather than the selection', () => {
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u2', 'u1'],
      preview: preview({ userIds: ['u1', 'u2'] }),
      submitting: false,
      maxTargets: 100,
    });
    expect(gate.canEnqueue).toBe(true);
    expect(gate.canEnqueue === true && gate.userIds).toEqual(['u1', 'u2']);
  });

  it('carries the PRICED chargeable count out as the token, not the selection size', () => {
    // The token the API checks has to be the number the operator was shown.
    // Deriving it from the selection would defeat the check it exists for:
    // people can link their own profiles between quote and confirmation, and
    // that is precisely what changes the bill without changing the selection.
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u1', 'u2'],
      preview: preview({ userIds: ['u1', 'u2'], chargeableCount: 1 }),
      submitting: false,
      maxTargets: 100,
    });
    expect(gate.canEnqueue === true && gate.chargeableCount).toBe(1);
  });

  it('REFUSES when the selection changed after it was priced, even at the same size', () => {
    // The trap this closes: swapping one person for another keeps the count
    // identical and changes the bill, because only linked profiles cost pages.
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u1', 'u3'],
      preview: preview({ userIds: ['u1', 'u2'] }),
      submitting: false,
      maxTargets: 100,
    });
    expect(gate.canEnqueue).toBe(false);
    expect(gate.canEnqueue === false && gate.reason).toMatch(/changed after it was priced/i);
  });

  it('REFUSES a selection that grew beyond the priced one', () => {
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u1', 'u2', 'u3'],
      preview: preview({ userIds: ['u1', 'u2'] }),
      submitting: false,
      maxTargets: 100,
    });
    expect(gate.canEnqueue).toBe(false);
  });

  it('REFUSES while a send is already in flight', () => {
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u1', 'u2'],
      preview: preview(),
      submitting: true,
      maxTargets: 100,
    });
    expect(gate.canEnqueue).toBe(false);
  });

  it('REFUSES an empty selection', () => {
    const gate = decideScholarBulkGate({
      selectedUserIds: [],
      preview: null,
      submitting: false,
      maxTargets: 100,
    });
    expect(gate.canEnqueue).toBe(false);
    expect(gate.canEnqueue === false && gate.reason).toMatch(/at least one/i);
  });

  it('REFUSES over the cap, naming both the cap and the number selected', () => {
    const many = Array.from({ length: 101 }, (_, i) => `u${i}`);
    const gate = decideScholarBulkGate({
      selectedUserIds: many,
      preview: preview({ userIds: many, maxTargets: 100 }),
      submitting: false,
      maxTargets: 100,
    });
    expect(gate.canEnqueue).toBe(false);
    expect(gate.canEnqueue === false && gate.reason).toContain('100');
    expect(gate.canEnqueue === false && gate.reason).toContain('101');
  });

  it('treats duplicate selections as one person rather than refusing them', () => {
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u1', 'u1', 'u2'],
      preview: preview({ userIds: ['u1', 'u2'] }),
      submitting: false,
      maxTargets: 100,
    });
    expect(gate.canEnqueue).toBe(true);
  });
});

// ── Outcomes ────────────────────────────────────────────────────────────────

function run(overrides: Partial<ScholarConsoleRun> = {}): ScholarConsoleRun {
  return {
    id: 'r1',
    status: 'SUCCEEDED',
    trigger: 'ADMIN',
    startedAt: '2026-09-08T03:00:00.000Z',
    finishedAt: '2026-09-08T03:00:20.000Z',
    papersFound: 12,
    papersInserted: 4,
    citationsUpdated: 8,
    creditsUsed: 30,
    errorText: null,
    needsBinding: false,
    ...overrides,
  };
}

describe('describeScholarOutcome — zero found is not a success', () => {
  it('a SUCCEEDED run that found nothing reads as "Zero found", never as success', () => {
    const outcome = describeScholarOutcome(
      run({ status: 'SUCCEEDED', papersFound: 0, papersInserted: 0, citationsUpdated: 0 }),
    );
    expect(outcome.kind).toBe('zero-found');
    expect(outcome.label).toBe('Zero found');
    // The tone is what paints the badge. Green here would put a tick against
    // the case an operator most needs to look at.
    expect(outcome.tone).not.toBe('success');
    expect(outcome.tone).toBe('warning');
    // And it must say the credits went anyway — that is the whole cost of the
    // misreading this branch exists to prevent.
    expect(outcome.detail).toMatch(/credits were still spent/i);
  });

  it('a PARTIAL run that found nothing also reads as "Zero found"', () => {
    const outcome = describeScholarOutcome(
      run({ status: 'PARTIAL', papersFound: 0, papersInserted: 0, citationsUpdated: 0 }),
    );
    expect(outcome.kind).toBe('zero-found');
    expect(outcome.tone).not.toBe('success');
  });

  it('a run that imported papers IS a success', () => {
    const outcome = describeScholarOutcome(run({ papersInserted: 4 }));
    expect(outcome.kind).toBe('imported');
    expect(outcome.tone).toBe('success');
  });

  it('distinguishes "nothing new" from "zero found" — papers were seen, none were new', () => {
    const outcome = describeScholarOutcome(
      run({ papersFound: 12, papersInserted: 0, citationsUpdated: 0 }),
    );
    expect(outcome.kind).toBe('nothing-new');
    expect(outcome.kind).not.toBe('zero-found');
    // Saying "0 added" without saying how many were seen reads as a failure.
    expect(outcome.detail).toContain('12');
  });

  it('reports a refreshed-citations run as a success without claiming new papers', () => {
    const outcome = describeScholarOutcome(
      run({ papersFound: 12, papersInserted: 0, citationsUpdated: 9 }),
    );
    expect(outcome.kind).toBe('refreshed');
    expect(outcome.tone).toBe('success');
    expect(outcome.detail).toMatch(/no new papers/i);
  });

  it('separates the needs-a-profile refusal from every other refusal', () => {
    const needs = describeScholarOutcome(
      run({
        status: 'REFUSED',
        needsBinding: true,
        papersFound: 0,
        creditsUsed: 75,
        errorText: 'no profile',
      }),
    );
    expect(needs.kind).toBe('needs-binding');

    const other = describeScholarOutcome(
      run({ status: 'REFUSED', needsBinding: false, papersFound: 0, errorText: 'Already fetched.' }),
    );
    expect(other.kind).toBe('refused');
    expect(other.detail).toBe('Already fetched.');
  });

  it('reads the spend off the run rather than claiming a needs-a-profile run was free', () => {
    // This asserted "no credits were spent" until 2026-09-09, and it was right
    // then: the run refused at the binding gate before touching the network.
    // The gate is now a name SEARCH, the dearest call this system makes, and it
    // is billed whether or not it finds anybody. Both shapes still occur — the
    // daily attempt cap can stop a run before it searches — so the sentence is
    // decided per run and never assumed.
    const searched = describeScholarOutcome(
      run({ status: 'REFUSED', needsBinding: true, papersFound: 0, creditsUsed: 75 }),
    );
    expect(searched.detail).toContain('75');
    expect(searched.detail).not.toMatch(/nothing was spent/i);

    const stoppedBeforeSpending = describeScholarOutcome(
      run({ status: 'REFUSED', needsBinding: true, papersFound: 0, creditsUsed: 0 }),
    );
    expect(stoppedBeforeSpending.detail).toMatch(/nothing was spent/i);

    // Both point at the one fix the person themselves can make.
    for (const outcome of [searched, stoppedBeforeSpending]) {
      expect(outcome.kind).toBe('needs-binding');
      expect(outcome.tone).toBe('warning');
      expect(outcome.detail).toMatch(/their own profile page/i);
    }
  });

  it('reports a FAILED run as a failure even when it found papers', () => {
    const outcome = describeScholarOutcome(
      run({ status: 'FAILED', papersFound: 5, papersInserted: 0, errorText: 'Upstream 500.' }),
    );
    expect(outcome.kind).toBe('failed');
    expect(outcome.tone).toBe('danger');
  });

  it('says so plainly when a person has never been fetched', () => {
    expect(describeScholarOutcome(null).kind).toBe('never-run');
  });
});

// ── Filtering ───────────────────────────────────────────────────────────────

function row(overrides: Partial<ScholarConsoleRow> = {}): ScholarConsoleRow {
  return {
    userId: 'u1',
    name: 'Somchai Example',
    email: 'somchai@kku.ac.th',
    role: 'FACULTY_USER',
    staff: {
      linked: true,
      facultyMemberId: 'fm1',
      nameEn: 'Somchai Example',
      nameTh: 'สมชาย ตัวอย่าง',
      facultyId: 'fac-sci',
      facultyName: 'Faculty of Science',
      departmentId: null,
      departmentName: null,
      isActive: true,
    },
    profileBound: true,
    scholarProfileId: 'ABC123',
    scholarBoundAt: '2026-09-01T03:00:00.000Z',
    papersFromScholar: 3,
    papersFromLibrary: 40,
    lastRun: null,
    quotaRetryAt: null,
    quotaReason: null,
    ...overrides,
  };
}

describe('filterScholarRows', () => {
  const rows = [
    row(),
    row({
      userId: 'u2',
      name: 'Malee Test',
      email: 'malee@kku.ac.th',
      staff: {
        linked: true,
        facultyMemberId: 'fm2',
        nameEn: 'Malee Test',
        nameTh: 'มาลี ทดสอบ',
        facultyId: 'fac-sci',
        facultyName: 'Faculty of Science',
        departmentId: null,
        departmentName: null,
        isActive: true,
      },
      profileBound: false,
      scholarProfileId: null,
    }),
    row({
      userId: 'u3',
      name: 'Unmatched Person',
      email: 'nobody@kku.ac.th',
      staff: { linked: false, reason: 'No staff record matches the name "Unmatched Person".' },
      profileBound: false,
      scholarProfileId: null,
    }),
  ];

  it('returns everything by default', () => {
    expect(filterScholarRows(rows, EMPTY_ROSTER_FILTERS)).toHaveLength(3);
  });

  it('separates linked, matched-but-unlinked, and unmatched', () => {
    expect(filterScholarRows(rows, { ...EMPTY_ROSTER_FILTERS, link: 'bound' })).toHaveLength(1);
    expect(filterScholarRows(rows, { ...EMPTY_ROSTER_FILTERS, link: 'unbound' })).toHaveLength(1);
    expect(filterScholarRows(rows, { ...EMPTY_ROSTER_FILTERS, link: 'unresolved' })).toHaveLength(1);
  });

  it('separates "ready to fetch" from "linked but fetched recently"', () => {
    // Being linked is not the same as being fetchable: the runner checks the
    // 30-day quota BEFORE it looks at the profile, so a recently fetched
    // person refuses for free however well linked they are. An operator
    // deciding what to spend wants the first list, not the second.
    const withQuota = [
      row({ userId: 'ready' }),
      row({ userId: 'blocked', quotaRetryAt: '2026-10-01T03:00:00.000Z', quotaReason: 'Already fetched.' }),
    ];
    expect(
      filterScholarRows(withQuota, { ...EMPTY_ROSTER_FILTERS, link: 'ready' }).map((r) => r.userId),
    ).toEqual(['ready']);
    expect(
      filterScholarRows(withQuota, { ...EMPTY_ROSTER_FILTERS, link: 'quota-blocked' }).map(
        (r) => r.userId,
      ),
    ).toEqual(['blocked']);
    // `bound` still means "has a linked profile", either way — the two new
    // filters partition it rather than replacing it.
    expect(filterScholarRows(withQuota, { ...EMPTY_ROSTER_FILTERS, link: 'bound' })).toHaveLength(2);
  });

  it('drops unmatched rows from a faculty filter — they belong to no faculty', () => {
    const filtered = filterScholarRows(rows, { ...EMPTY_ROSTER_FILTERS, facultyId: 'fac-sci' });
    expect(filtered.map((r) => r.userId)).toEqual(['u1', 'u2']);
  });

  it('searches the staff record’s Thai name as well as the account', () => {
    expect(
      filterScholarRows(rows, { ...EMPTY_ROSTER_FILTERS, search: 'สมชาย' }).map((r) => r.userId),
    ).toEqual(['u1']);
    expect(
      filterScholarRows(rows, { ...EMPTY_ROSTER_FILTERS, search: 'MALEE@' }).map((r) => r.userId),
    ).toEqual(['u2']);
  });
});

// ── Batch progress ──────────────────────────────────────────────────────────

function ledgerRun(overrides: Partial<ScholarLedgerRun> = {}): ScholarLedgerRun {
  return {
    ...run(),
    userId: 'u1',
    userName: 'Somchai Example',
    userEmail: 'somchai@kku.ac.th',
    triggeredByName: 'Admin',
    scholarProfileId: 'ABC123',
    ...overrides,
  };
}

describe('summariseBulkProgress', () => {
  const sentAt = '2026-09-08T03:00:00.000Z';

  it('ignores a run that started BEFORE the batch was sent', () => {
    const progress = summariseBulkProgress({
      watchedUserIds: ['u1'],
      sentAtIso: sentAt,
      runs: [ledgerRun({ startedAt: '2026-09-01T03:00:00.000Z' })],
    });
    expect(progress.done).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it('counts a run that started at or after the send', () => {
    const progress = summariseBulkProgress({
      watchedUserIds: ['u1', 'u2'],
      sentAtIso: sentAt,
      runs: [
        ledgerRun({ id: 'a', userId: 'u1', startedAt: '2026-09-08T03:00:05.000Z' }),
        ledgerRun({ id: 'b', userId: 'u2', startedAt: sentAt }),
      ],
    });
    expect(progress.done).toBe(2);
    expect(progress.complete).toBe(true);
  });

  it('ignores runs for people who are not in the batch', () => {
    const progress = summariseBulkProgress({
      watchedUserIds: ['u1'],
      sentAtIso: sentAt,
      runs: [ledgerRun({ id: 'c', userId: 'stranger', startedAt: '2026-09-08T03:00:05.000Z' })],
    });
    expect(progress.done).toBe(0);
  });
});
