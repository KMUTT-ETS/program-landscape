import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ────────────────────────────────────────────────────────────────────────────
// The console's decisions as they actually reach the page.
//
// `decideScholarBulkGate` and `describeScholarOutcome` are tested next door;
// this asserts that their verdicts survive the trip into markup — in
// particular the two that are easy to regress by "tidying up":
//
//   1. The credit figure is the SERVER's. A render that recomputed it from the
//      selection would pass a naive eyeball check and quote a different number
//      from the one ScrapingBee bills, so the fixture below deliberately gives
//      the server a figure that no local arithmetic could produce.
//   2. A run that completed and found nothing must not read as a success.
//
// Static markup rather than a driven DOM because this workspace has no jsdom
// and no @testing-library. That rules out asserting a click, which is why the
// confirmation panel is a separate exported component taking its gate as a
// prop — and why the gate itself is a pure function rather than a condition
// buried in an onClick.
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
// Prisma) at import time. Nothing here calls the actions.
vi.mock('@/lib/actions/scholar-admin', () => ({
  previewScholarBulkAction: async () => ({ ok: false, message: 'not called in this test' }),
  bulkFetchScholarAction: async () => ({ ok: false, message: 'not called in this test' }),
  fetchScholarForUserAction: async () => ({ ok: false, message: 'not called in this test' }),
  listScholarRunsAction: async () => ({ ok: false, message: 'not called in this test' }),
}));

import { BulkConfirmPanel, OutcomeBadge, ProfileCell, RunLedger } from '../app/admin/scholar/client';
import {
  decideScholarBulkGate,
  describeScholarOutcome,
  type ScholarBulkPreview,
  type ScholarConsoleRow,
  type ScholarLedgerRun,
} from '../src/lib/scholar-admin';

function preview(overrides: Partial<ScholarBulkPreview> = {}): ScholarBulkPreview {
  return {
    userIds: ['u1', 'u2', 'u3'],
    targetCount: 3,
    duplicatesDropped: 0,
    chargeableCount: 3,
    quotaBlockedCount: 0,
    unboundCount: 0,
    unresolvableCount: 0,
    // 3 bound targets × 15 credits would be 45. This is deliberately NOT 45:
    // the panel must render what the server said, and a component that
    // recomputed the figure locally would print 45 and fail here.
    estimatedCredits: 987,
    // Likewise not 987 + 3 × 20 × 15: the server's ceiling, rendered verbatim.
    estimatedCreditsCeiling: 1543,
    maxTargets: 100,
    ...overrides,
  };
}

/**
 * The send button's own tag.
 *
 * React emits attributes in its own order (`disabled=""` lands before
 * `data-testid`), so a single regex spanning both is a coin flip. This finds
 * the element and lets each assertion look inside it.
 */
function confirmButton(html: string): string {
  const match = /<button[^>]*data-testid="scholar-bulk-confirm-button"[^>]*>/.exec(html);
  if (!match) throw new Error('no confirm button in the rendered panel');
  return match[0];
}

describe('BulkConfirmPanel — the estimate is the server’s', () => {
  it('renders the server’s credit figure verbatim, not a locally recomputed one', () => {
    const html = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={preview()}
        pricing={false}
        error={null}
        gate={{ canEnqueue: true }}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('987');
    expect(html).not.toContain('>45<');
  });

  it('presents the estimate with its author-list ceiling, and names each gate that will stop a target', () => {
    // Four targets, one at each gate. The runner checks resolution, then
    // quota, then binding, so the dialog has to say which gate each person
    // will hit rather than merely that some of them will not be read.
    const html = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={preview({
          targetCount: 4,
          chargeableCount: 1,
          quotaBlockedCount: 1,
          unboundCount: 1,
          unresolvableCount: 1,
        })}
        pricing={false}
        error={null}
        gate={{ canEnqueue: true }}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toMatch(/Send — estimated \d+, at most \d+ credits/);
    expect(html).toMatch(/costs 15 more for each further page/);
    expect(html).toMatch(/Linked, ready to read/);
    expect(html).toMatch(/Already fetched this month/);
    expect(html).toMatch(/quota gate/i);
    expect(html).toMatch(/No profile linked/);
    expect(html).toMatch(/Will not be sent at all/);
  });

  it('says the unlinked line is the DEAREST one, not the free one', () => {
    // The 2026-09-08 wording said an unlinked target "stops at the binding
    // gate. It costs nothing." That was true then and is the single most
    // expensive falsehood this dialog could now carry: the run searches by
    // name instead of refusing, at five times a profile page, billed whether
    // or not it finds anybody. An operator selecting a faculty of unlinked
    // staff must read that before pressing send.
    const html = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={preview({
          targetCount: 4,
          chargeableCount: 1,
          quotaBlockedCount: 1,
          unboundCount: 2,
          unresolvableCount: 0,
        })}
        pricing={false}
        error={null}
        gate={{ canEnqueue: true }}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toMatch(/searched by name/i);
    expect(html).toMatch(/five times a profile page/i);
    expect(html).toMatch(/whether or not it finds anyone/i);
    // Exactly ONE line may still claim to be free, and it is the quota one.
    expect(html).toMatch(/only line here that costs nothing/i);
    expect(html).not.toMatch(/binding gate/i);
  });

  it('prices only what reaches Google — a recently fetched profile is not billed', () => {
    // Ten linked people, nine of them refreshed inside the window. The runner
    // checks quota BEFORE binding, so those nine spend nothing however well
    // linked they are; quoting them would over-charge by 135 credits.
    const html = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={preview({
          targetCount: 10,
          chargeableCount: 1,
          quotaBlockedCount: 9,
          unboundCount: 0,
          unresolvableCount: 0,
          estimatedCredits: 15,
          estimatedCreditsCeiling: 315,
        })}
        pricing={false}
        error={null}
        gate={{ canEnqueue: true }}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('Send — estimated 15, at most 315 credits');
    expect(html).not.toContain('150');
  });

  it('disables the send button until the run has been priced, and says why', () => {
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u1', 'u2'],
      preview: null,
      submitting: false,
      maxTargets: 100,
    });
    const html = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={null}
        pricing={false}
        error={null}
        gate={gate}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    // The button carries a real `disabled` attribute — an operator cannot
    // click past the estimate even if the handler's own guard were removed.
    // `disabled=""` the ATTRIBUTE, not the substring — the class list carries
    // `disabled:opacity-50`, which contains the word and means nothing here.
    expect(confirmButton(html)).toContain('disabled=""');
    expect(html).toContain('scholar-gate-reason');
    expect(html).toMatch(/priced/i);
  });

  it('enables the send button once a price is on screen', () => {
    const gate = decideScholarBulkGate({
      selectedUserIds: ['u1', 'u2', 'u3'],
      preview: preview(),
      submitting: false,
      maxTargets: 100,
    });
    const html = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={preview()}
        pricing={false}
        error={null}
        gate={gate}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(confirmButton(html)).not.toContain('disabled=""');
  });

  it('puts the figure on the send button, and never threatens a bill of zero', () => {
    const paid = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={preview({ estimatedCredits: 987, estimatedCreditsCeiling: 1543 })}
        pricing={false}
        error={null}
        gate={{ canEnqueue: true }}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(paid).toContain('Send — estimated 987, at most 1543 credits');
    // The headline says both figures and why they differ.
    expect(paid).toContain('scholar-estimated-credits-ceiling');
    expect(paid).toMatch(/up to 20 author lists Google Scholar shortened, at 15 credits each/);
    // Both figures are one profile page per person; the copy must still say a
    // longer profile costs more, or "at most" would be a promise it cannot keep.
    expect(paid).toMatch(/longer profile/i);

    // A free run — and note WHICH shape that is now. Every target refreshed
    // inside its 30-day window, so every one of them refuses at the quota gate
    // before spending. It used to be the all-unlinked batch that landed here,
    // and that batch is now the dearest thing this console can send.
    const free = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={preview({
          chargeableCount: 0,
          quotaBlockedCount: 3,
          estimatedCredits: 0,
          estimatedCreditsCeiling: 0,
        })}
        pricing={false}
        error={null}
        gate={{ canEnqueue: true }}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(free).toContain('nothing will be spent');
    expect(free).not.toMatch(/spend the credits/i);
  });

  it('shows a pricing failure instead of a number, and keeps the button shut', () => {
    const html = renderToStaticMarkup(
      <BulkConfirmPanel
        preview={null}
        pricing={false}
        error="Forbidden — scholar:admin required"
        gate={{ canEnqueue: false, reason: 'Nothing has been priced yet.' }}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('scholar-preview-error');
    expect(html).toContain('scholar:admin required');
    // `disabled=""` the ATTRIBUTE, not the substring — the class list carries
    // `disabled:opacity-50`, which contains the word and means nothing here.
    expect(confirmButton(html)).toContain('disabled=""');
  });
});

// ── Zero found ──────────────────────────────────────────────────────────────

function ledgerRun(overrides: Partial<ScholarLedgerRun> = {}): ScholarLedgerRun {
  return {
    id: 'r1',
    userId: 'u1',
    userName: 'Somchai Example',
    userEmail: 'somchai@kku.ac.th',
    triggeredByName: 'Admin',
    scholarProfileId: 'ABC123',
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

function ledgerHtml(runs: ScholarLedgerRun[]): string {
  return renderToStaticMarkup(
    <RunLedger
      ledger={{ runs, totalCreditsUsed: runs.reduce((s, r) => s + r.creditsUsed, 0) }}
      error={null}
      watching={false}
      timedOut={false}
      lastOutcome={null}
    />,
  );
}

/**
 * The outcome badge, pulled out of the row.
 *
 * Asserting against the whole section would be worthless here: the ledger's
 * own explanatory paragraph contains the words "Zero found" on purpose, so a
 * `not.toContain('Zero found')` on the full markup passes and fails for
 * reasons that have nothing to do with the badge. This reads the badge the
 * operator actually looks at.
 */
function badge(html: string): { kind: string; label: string; classes: string } {
  const match = /<span class="([^"]*)"[^>]*data-outcome="([^"]+)"[^>]*>([^<]*)<\/span>/.exec(html);
  if (!match) throw new Error('no outcome badge in the rendered ledger row');
  return { classes: match[1]!, kind: match[2]!, label: match[3]! };
}

describe('RunLedger — a completed run that found nothing is not a success', () => {
  it('badges a SUCCEEDED run with no papers as "Zero found", never as an import', () => {
    const html = ledgerHtml([
      ledgerRun({ status: 'SUCCEEDED', papersFound: 0, papersInserted: 0, citationsUpdated: 0 }),
    ]);
    const b = badge(html);
    expect(b.kind).toBe('zero-found');
    expect(b.label).toBe('Zero found');
    // Warning-toned, so it cannot be read as a green tick.
    expect(b.classes).toContain('bg-warning-subtle');
    expect(b.classes).not.toContain('bg-success-subtle');
    // And the row must say the credits went anyway.
    expect(html).toMatch(/credits were still spent/i);
  });

  it('still badges a real import as a success, so the distinction means something', () => {
    const b = badge(ledgerHtml([ledgerRun({ papersFound: 12, papersInserted: 4 })]));
    expect(b.kind).toBe('imported');
    expect(b.label).toBe('Imported');
    expect(b.classes).toContain('bg-success-subtle');
  });

  it('badges "Nothing new" separately from "Zero found"', () => {
    const b = badge(
      ledgerHtml([ledgerRun({ papersFound: 12, papersInserted: 0, citationsUpdated: 0 })]),
    );
    expect(b.kind).toBe('nothing-new');
    expect(b.label).toBe('Nothing new');
  });

  it('names the empty case rather than rendering a bare table', () => {
    const html = renderToStaticMarkup(
      <RunLedger
        ledger={{ runs: [], totalCreditsUsed: 0 }}
        error={null}
        watching={false}
        timedOut={false}
        lastOutcome={null}
      />,
    );
    expect(html).toMatch(/No Scholar fetch has been run yet/);
  });

  it('renders the API’s post-send credit figure verbatim', () => {
    const html = renderToStaticMarkup(
      <RunLedger
        ledger={{ runs: [], totalCreditsUsed: 0 }}
        error={null}
        watching={false}
        timedOut={false}
        lastOutcome={{
          enqueuedCount: 3,
          skippedCount: 1,
          targetCount: 4,
          duplicatesDropped: 0,
          // Again deliberately not 3 × 15: it is the service's own figure.
          estimatedCredits: 861,
          estimatedCreditsCeiling: 1761,
          chargeableCount: 3,
          enqueuedUserIds: ['u1', 'u2', 'u3'],
        }}
      />,
    );
    expect(html).toContain('861');
    expect(html).toContain('1761');
    expect(html).not.toContain('>45<');
  });
});

// ── The third gate, in the table ───────────────────────────────────────────

function consoleRow(overrides: Partial<ScholarConsoleRow> = {}): ScholarConsoleRow {
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

describe('ProfileCell — a linked profile is not the same as a fetchable one', () => {
  it('says a linked, out-of-window person is ready', () => {
    const html = renderToStaticMarkup(<ProfileCell row={consoleRow()} />);
    expect(html).toContain('Ready to fetch.');
    expect(html).not.toContain('scholar-quota-blocked');
  });

  it('names the date the window reopens for a recently fetched person', () => {
    // The gate the console previously left to be inferred from a last-fetch
    // date. Selecting a faculty refreshed three weeks ago otherwise quotes
    // credits for work that will refuse at the runner's step 2.
    const html = renderToStaticMarkup(
      <ProfileCell row={consoleRow({ quotaRetryAt: '2026-09-29T03:00:00.000Z' })} />,
    );
    expect(html).toContain('scholar-quota-blocked');
    expect(html).toMatch(/Fetched recently/);
    expect(html).toContain('29 Sep 2026');
    expect(html).not.toContain('Ready to fetch.');
  });

  it('renders the profile id either way — the link is still the link', () => {
    const html = renderToStaticMarkup(
      <ProfileCell row={consoleRow({ quotaRetryAt: '2026-09-29T03:00:00.000Z' })} />,
    );
    expect(html).toContain('ABC123');
  });
});

describe('OutcomeBadge', () => {
  it('tags every kind so a regression in tone or label is visible in markup', () => {
    const html = renderToStaticMarkup(
      <OutcomeBadge outcome={describeScholarOutcome(null)} />,
    );
    expect(html).toContain('data-outcome="never-run"');
    expect(html).toContain('Never fetched');
  });
});
