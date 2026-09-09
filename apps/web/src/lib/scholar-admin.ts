// Client-safe view of the admin Scholar console, plus the two decisions that
// keep it honest: what a finished run actually did, and whether a bulk fetch
// may be sent.
//
// No zod here and no `@kku/db` / `@kku/shared` barrel import — this module is
// pulled into the browser bundle by `app/admin/scholar/client.tsx`. Server
// responses are validated with zod in `src/lib/actions/scholar-admin.ts`,
// which annotates each parse result with the types below so the schema and
// these types cannot drift apart silently.
//
// Dates are ISO strings rather than Date objects because they cross the
// server-action boundary. They are formatted by the helpers in
// `./scholar-status`, which pin Asia/Bangkok so the server and client renders
// agree — see the hydration note there.

/**
 * How many ledger rows the console reads, on first paint AND on every poll.
 *
 * ONE number, because `totalCreditsUsed` is summed server-side over whatever
 * page is returned and rendered as "across the runs listed below". Paginating
 * differently in the two places made a budget-facing figure change the first
 * time a batch landed — from the sum of the last 50 runs to the sum of the
 * last 200 — for a reason that had nothing to do with the batch.
 */
export const SCHOLAR_LEDGER_LIMIT = 200;

export type ScholarRunStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'REFUSED';
export type ScholarRunTrigger = 'SELF' | 'ADMIN' | 'ADMIN_BULK';

export interface ScholarConsoleRun {
  id: string;
  status: ScholarRunStatus;
  trigger: ScholarRunTrigger;
  startedAt: string;
  finishedAt: string | null;
  papersFound: number;
  papersInserted: number;
  citationsUpdated: number;
  creditsUsed: number;
  /** The refusal / failure sentence, already stripped of the machine-readable
   *  `needs-binding:` prefix by the server. Null on a clean run. */
  errorText: string | null;
  /** This run ended with no Scholar profile attached to the record. Decided on
   *  the server from the raw `errorText` prefix — the constant that names it
   *  lives in `@kku/db` and must not be pulled into the browser bundle — and it
   *  is the one refusal the person themselves can fix, so the console words it
   *  differently from every other refusal. It is NO LONGER a free outcome:
   *  since 2026-09-09 the run searches by name before it gives up, so read
   *  `creditsUsed` rather than assuming zero. */
  needsBinding: boolean;
}

/** One person in the roster table. */
export interface ScholarConsoleRow {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  staff:
    | {
        linked: true;
        facultyMemberId: string;
        nameEn: string;
        nameTh: string;
        facultyId: string;
        facultyName: string;
        departmentId: string | null;
        departmentName: string | null;
        isActive: boolean;
      }
    | { linked: false; reason: string };
  profileBound: boolean;
  scholarProfileId: string | null;
  scholarBoundAt: string | null;
  papersFromScholar: number;
  papersFromLibrary: number;
  lastRun: ScholarConsoleRun | null;
  /** The third gate. Non-null means a fetch for this person refuses at the
   *  30-day quota and spends nothing — whatever the profile column says. It is
   *  the only gate left that stops a run before it spends. */
  quotaRetryAt: string | null;
  quotaReason: string | null;
}

/** A row in the run ledger (`GET /scholar/runs`). */
export interface ScholarLedgerRun extends ScholarConsoleRun {
  userId: string;
  userName: string | null;
  /** The target's address. Admin-only surface; rendered as secondary text
   *  under the name, never as the row's identity. */
  userEmail: string | null;
  triggeredByName: string | null;
  scholarProfileId: string | null;
}

export interface ScholarLedger {
  runs: ScholarLedgerRun[];
  totalCreditsUsed: number;
}

// ── What a run actually did ────────────────────────────────────────────────

export type ScholarOutcomeKind =
  | 'never-run'
  | 'imported'
  | 'refreshed'
  | 'zero-found'
  | 'nothing-new'
  | 'incomplete'
  | 'needs-binding'
  | 'refused'
  | 'failed';

export interface ScholarOutcome {
  kind: ScholarOutcomeKind;
  /** Short badge text. */
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  /** One sentence saying what happened, in the words an operator would use. */
  detail: string;
}

/**
 * Read a finished run.
 *
 * THE ORDER OF THESE BRANCHES IS THE POINT, and specifically the zero-found
 * one. `runScholarFetch` records a walk that completed with no anomalies as
 * `SUCCEEDED` even when the profile listed nothing at all — status is about
 * whether the fetch worked, not about whether it found anything. So a console
 * that renders status alone puts a green tick against a run that imported
 * nothing, and the operator's reasonable conclusion is "that person has no
 * papers we were missing", when the truth is "the profile we walked was empty,
 * and it may well be the wrong profile". Zero found is therefore checked
 * BEFORE success and is never toned as success.
 *
 * `nothing-new` is the neighbouring case and a genuinely different one: papers
 * were found, and every one of them was already on the record. That IS a
 * successful, useful run — it re-confirmed the record — so it is not an alarm,
 * but it is not "imported" either, and saying "0 papers added" without saying
 * how many were seen reads as a failure.
 */
export function describeScholarOutcome(run: ScholarConsoleRun | null): ScholarOutcome {
  if (!run) {
    return {
      kind: 'never-run',
      label: 'Never fetched',
      tone: 'neutral',
      detail: 'Google Scholar has never been fetched for this person.',
    };
  }

  if (run.status === 'REFUSED') {
    return run.needsBinding
      ? {
          kind: 'needs-binding',
          label: 'No profile found',
          tone: 'warning',
          // WHETHER THIS SPENT ANYTHING IS NOW A PER-RUN FACT, so it is read
          // off the run rather than stated. Before 2026-09-09 the answer was
          // always "nothing": the run refused at the binding gate before
          // touching the network. It now searches by name first, so the same
          // refusal usually means "we searched, at 75 credits, and found
          // nobody we could safely attach" — and occasionally still means
          // nothing was spent, when the daily attempt cap stopped it before
          // the search. Saying "no credits were spent" for both, as this used
          // to, would understate the commonest one.
          detail:
            run.creditsUsed > 0
              ? 'Google Scholar was searched for this person and no profile could be linked to ' +
                `their staff record, so nothing was imported. The search still cost ${run.creditsUsed} ` +
                'credits. They can link a profile themselves from their own profile page.'
              : 'The run refused before reaching Google, so nothing was spent and nothing was ' +
                'imported. They can link a profile themselves from their own profile page.',
        }
      : {
          kind: 'refused',
          label: 'Refused',
          tone: 'warning',
          detail: run.errorText ?? 'The run was refused before it fetched anything.',
        };
  }

  if (run.status === 'FAILED') {
    return {
      kind: 'failed',
      label: 'Failed',
      tone: 'danger',
      detail: run.errorText ?? 'The run did not complete. Nothing was imported.',
    };
  }

  // SUCCEEDED or PARTIAL from here on — and neither one means data arrived.
  if (run.papersFound === 0) {
    return {
      kind: 'zero-found',
      label: 'Zero found',
      tone: 'warning',
      detail:
        'The fetch completed but the profile listed no publications, so nothing was imported. ' +
        'Credits were still spent. Check that the linked profile is the right one.',
    };
  }

  const changed = run.papersInserted > 0 || run.citationsUpdated > 0;
  if (!changed) {
    return {
      kind: 'nothing-new',
      label: 'Nothing new',
      tone: 'neutral',
      detail:
        `${run.papersFound} papers were read, and every one of them was already on the record. ` +
        'Nothing was added or changed.',
    };
  }

  if (run.status === 'PARTIAL') {
    return {
      kind: 'incomplete',
      label: 'Incomplete',
      tone: 'warning',
      detail:
        run.errorText ??
        `Some of the profile could not be read. ${run.papersInserted} papers were added from what could.`,
    };
  }

  if (run.papersInserted === 0) {
    return {
      kind: 'refreshed',
      label: 'Citations refreshed',
      tone: 'success',
      detail:
        `No new papers — ${run.citationsUpdated} citation counts were brought up to date.`,
    };
  }

  return {
    kind: 'imported',
    label: 'Imported',
    tone: 'success',
    detail:
      `${run.papersInserted} papers added, and ${run.citationsUpdated} citation counts refreshed.`,
  };
}

// ── The confirmation gate ──────────────────────────────────────────────────

/**
 * What the server quoted for a specific set of people.
 *
 * `estimatedCredits` is SERVER-SUPPLIED and is never recomputed in the
 * browser. The console is the one place in this product where a click can
 * spend four figures of ScrapingBee credits, and a locally-derived figure
 * would be a second opinion about money that could drift from the one the API
 * bills against — see `estimateScholarBulkCredits` in @kku/shared, which both
 * sides call.
 */
export interface ScholarBulkPreview {
  /** Exactly the ids that were priced. The gate below compares this against
   *  the live selection, so a quote can never be spent on a different set of
   *  people from the one it described. */
  userIds: string[];
  targetCount: number;
  duplicatesDropped: number;
  /**
   * Targets that go STRAIGHT to a profile — linked AND outside their 30-day
   * window — and therefore the only ones that cost pages and nothing else.
   *
   * It is deliberately NOT "everything that costs something" any more. Since
   * 2026-09-09 an unlinked target reaches Google too, by searching, and costs
   * more than one of these; it is counted in `unboundCount` instead so the
   * four buckets still partition the target count.
   *
   * Sent back to the API on confirmation as `expectedChargeableCount`. That is
   * what turns this quote from an advisory into a token: between quoting and
   * confirming, people can link their own profiles from /profile, which moves
   * them out of the search bucket and into this one and changes the bill. The
   * API refuses rather than silently billing for a run the operator never saw
   * priced.
   */
  chargeableCount: number;
  /** Resolvable and linked, but already fetched inside the window. Enqueued;
   *  refuses at the runner's step 2; spends nothing. The only free bucket. */
  quotaBlockedCount: number;
  /** Resolvable and outside the window, but with no profile linked. Enqueued,
   *  and since 2026-09-09 it does NOT refuse: the runner searches Google
   *  Scholar for the person's English name at five times a page price, then
   *  reads whatever profile it resolves. The dearest bucket per person.
   *  Counted only for targets the quota would not have stopped first, so the
   *  four buckets sum to the target count. */
  unboundCount: number;
  /** Not enqueued at all: the pre-flight already proved no single staff
   *  record matches the account. */
  unresolvableCount: number;
  estimatedCredits: number;
  maxTargets: number;
}

export type ScholarBulkGate =
  | {
      canEnqueue: true;
      userIds: string[];
      /**
       * The quote to hand back to the API on confirmation.
       *
       * It comes off the preview the gate has just validated, not off the
       * selection, so the token that is sent is structurally the one the
       * operator was shown — there is no way to send a number the dialog did
       * not display.
       */
      chargeableCount: number;
    }
  | { canEnqueue: false; reason: string };

/**
 * May this bulk fetch be sent?
 *
 * The rule that matters is the fourth one: WITHOUT A PRICED PREVIEW, NO.
 * Nothing in this console reaches `POST /scholar/fetch/bulk` except through
 * this function, so the confirmation dialog is not a courtesy the operator can
 * click past — it is the only path that produces a preview, and a missing
 * preview refuses.
 *
 * The fifth rule closes the gap the fourth leaves open: a quote describes a
 * specific set of people, and if the selection changes after it is priced the
 * number on screen no longer describes what would be sent. Comparing the sets
 * rather than their sizes matters — swapping one bound person for one unbound
 * person keeps the count identical and changes the bill.
 */
export function decideScholarBulkGate(input: {
  selectedUserIds: readonly string[];
  preview: ScholarBulkPreview | null;
  submitting: boolean;
  maxTargets: number;
}): ScholarBulkGate {
  if (input.submitting) {
    return { canEnqueue: false, reason: 'This fetch is already being sent.' };
  }

  const selected = [...new Set(input.selectedUserIds)];
  if (selected.length === 0) {
    return { canEnqueue: false, reason: 'Select at least one person first.' };
  }

  if (selected.length > input.maxTargets) {
    return {
      canEnqueue: false,
      reason:
        `A bulk fetch is capped at ${input.maxTargets} people, and ${selected.length} are selected. ` +
        'Split it into smaller batches — each person costs real ScrapingBee credits.',
    };
  }

  if (!input.preview) {
    return {
      canEnqueue: false,
      reason: 'Nothing has been priced yet. Review the credit estimate before sending.',
    };
  }

  if (!sameSet(selected, input.preview.userIds)) {
    return {
      canEnqueue: false,
      reason:
        'The selection changed after it was priced, so the estimate on screen no longer describes ' +
        'what would be sent. Review the new estimate.',
    };
  }

  return {
    canEnqueue: true,
    userIds: input.preview.userIds,
    chargeableCount: input.preview.chargeableCount,
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

// ── Roster filtering ───────────────────────────────────────────────────────

export type ScholarLinkFilter =
  | 'all'
  /** Linked and outside the 30-day window — a fetch would actually run, and
   *  would cost credits. The selection an operator making a spend decision
   *  wants. */
  | 'ready'
  /** Linked, but inside the window: a fetch refuses at step 2 for free. The
   *  only refusal left that costs nothing. */
  | 'quota-blocked'
  | 'bound'
  | 'unbound'
  | 'unresolved';

export interface ScholarRosterFilters {
  search: string;
  facultyId: string | 'all';
  departmentId: string | 'all';
  link: ScholarLinkFilter;
}

export const EMPTY_ROSTER_FILTERS: ScholarRosterFilters = {
  search: '',
  facultyId: 'all',
  departmentId: 'all',
  link: 'all',
};

/**
 * Apply the console's filters. Pure, so the table's contents and the
 * selection's meaning can be asserted without a DOM.
 *
 * The search matches the account name, the address, AND the staff record's
 * English and Thai names — an operator looking someone up types whichever of
 * those they happen to know, and a search that only covered the account name
 * would silently miss the person whose HR record spells it differently.
 */
export function filterScholarRows(
  rows: readonly ScholarConsoleRow[],
  filters: ScholarRosterFilters,
): ScholarConsoleRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.facultyId !== 'all') {
      if (!row.staff.linked || row.staff.facultyId !== filters.facultyId) return false;
    }
    if (filters.departmentId !== 'all') {
      if (!row.staff.linked || row.staff.departmentId !== filters.departmentId) return false;
    }
    if (filters.link === 'bound' && !row.profileBound) return false;
    if (filters.link === 'ready' && (!row.profileBound || row.quotaRetryAt !== null)) return false;
    if (filters.link === 'quota-blocked' && (!row.profileBound || row.quotaRetryAt === null)) {
      return false;
    }
    if (filters.link === 'unbound' && (!row.staff.linked || row.profileBound)) return false;
    if (filters.link === 'unresolved' && row.staff.linked) return false;
    if (needle) {
      const haystack = [
        row.name ?? '',
        row.email,
        row.staff.linked ? row.staff.nameEn : '',
        row.staff.linked ? row.staff.nameTh : '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * How far a bulk run has got, judged by run rows rather than by job ids.
 *
 * `POST /scholar/fetch/bulk` returns job references, and `GET /scholar/runs`
 * is keyed by user — there is no id shared between them. What ties the two
 * together is time: a run for a watched person that STARTED at or after the
 * moment the batch was sent is that batch's run. Ordinary equality on the
 * user id would also match the person's previous run and report a batch
 * finished before it began.
 */
export function summariseBulkProgress(input: {
  watchedUserIds: readonly string[];
  sentAtIso: string;
  runs: readonly ScholarLedgerRun[];
}): { done: number; total: number; complete: boolean; runs: ScholarLedgerRun[] } {
  const watched = new Set(input.watchedUserIds);
  const sentAt = new Date(input.sentAtIso).getTime();
  const matched = new Map<string, ScholarLedgerRun>();
  for (const run of input.runs) {
    if (!watched.has(run.userId)) continue;
    if (Number.isFinite(sentAt) && new Date(run.startedAt).getTime() < sentAt) continue;
    // Newest wins; the ledger arrives newest-first, so only the first is kept.
    if (!matched.has(run.userId)) matched.set(run.userId, run);
  }
  return {
    done: matched.size,
    total: watched.size,
    complete: matched.size >= watched.size,
    runs: [...matched.values()],
  };
}
