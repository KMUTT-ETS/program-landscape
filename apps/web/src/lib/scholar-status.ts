// Client-safe view of GET /scholar/status/me, plus the one function that
// decides what the profile panel's button does.
//
// No zod here and no `@kku/db` / `@kku/shared` barrel import: this module is
// pulled into the browser bundle by `app/profile/scholar-panel.tsx`. The
// response is validated (with zod) on the server, in
// `src/lib/actions/scholar.ts`, which annotates the parse result as
// `ScholarStatus` so the schema and these types cannot drift apart silently.
//
// Dates arrive as ISO strings rather than Date objects because they cross the
// server-action boundary; every one of them is formatted for display by the
// helpers below, which pin a timezone so the server and client renders agree.

export type ScholarRunStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'REFUSED';

/**
 * The parts of the API's `lastRun` the panel actually renders.
 *
 * Deliberately narrower than the endpoint's own shape. Everything here crosses
 * into the browser inside the RSC payload, and the fields that are not drawn
 * were not free: `creditsUsed` puts ScrapingBee spend in front of the person
 * being billed for, and `papersFound` / `trigger` / the per-run `needsBinding`
 * flag were shipped to nobody. The zod schema in `actions/scholar.ts` mirrors
 * this list and strips the rest on the server. Add a field back when something
 * draws it.
 */
export interface ScholarLastRun {
  id: string;
  status: ScholarRunStatus;
  startedAt: string;
  finishedAt: string | null;
  papersInserted: number;
  citationsUpdated: number;
  /** The refusal / failure sentence, already stripped of the machine-readable
   *  `needs-binding:` prefix by the server action. Null on a clean run. */
  errorText: string | null;
}

export interface ScholarStatus {
  userId: string;
  staffRecord:
    | { linked: true; facultyMemberId: string; nameEn: string; nameTh: string }
    | { linked: false; reason: string };
  profile:
    | {
        bound: true;
        scholarProfileId: string;
        scholarProfileUrl: string | null;
        boundAt: string | null;
      }
    | { bound: false };
  lastRun: ScholarLastRun | null;
  /** ISO timestamp of the earliest next fetch, or null when one may start now. */
  nextEligibleAt: string | null;
  quotaReason: string | null;
  needsBinding: boolean;
  fetchQueued: boolean;
  /**
   * The daily allowance for asserting an identity, and what it is worth.
   *
   * THE COUNT IS NO LONGER THE MEANINGFUL UNIT. The cap gates two attempts
   * that stopped costing the same on 2026-09-09: a pasted URL is verified with
   * one profile page, while the sync button's automatic name search is a
   * stealth search at five times that. Five attempts a day was 75 credits when
   * the cap was set and is now up to 375. Every price here is computed by the
   * API from the measured constants — the browser renders them, it never
   * multiplies its own.
   */
  bind: {
    attemptsToday: number;
    maxPerDay: number;
    retryAt: string | null;
    /** One automatic name search — what pressing sync costs while unlinked. */
    creditsPerSearch: number;
    /** One pasted-URL check: a single profile page. */
    creditsPerPastedCheck: number;
    /** The most today's remaining allowance can still spend on this account.
     *  Zero when the cap is reached, and zero for an account it exempts. */
    creditsAtRisk: number;
  };
}

/**
 * The one control, named once.
 *
 * Every actionable state now carries the SAME label, and that sameness is the
 * change: until 2026-09-09 an unlinked person's button said "Link your Scholar
 * profile" and opened a form, while everyone else's said "Fetch from Google
 * Scholar" and started a run. Two doors, and only one of them was the feature.
 *
 * "Sync" rather than "Fetch" because the button now does whichever of the two
 * things is needed — find the profile, then read it — and a person pressing it
 * should not have to know which. The word "fetch" survives everywhere it names
 * the RUN rather than the control (the 30-day allowance, the run ledger, the
 * admin console), because that is what a run is.
 */
const SYNC_LABEL = 'Sync Google Scholar';
const SYNC_AGAIN_LABEL = 'Sync Google Scholar again';

/** Exported for the panel's status-read-failed fallback, which draws the same
 *  disabled control without a status to decide it from. */
export const SCHOLAR_SYNC_LABEL = SYNC_LABEL;

export type ScholarPanelKind =
  | 'no-staff-record'
  | 'running'
  | 'unbound'
  | 'cooling-down'
  | 'ready';

export interface ScholarPanelView {
  kind: ScholarPanelKind;
  /** Label on the one primary control. */
  buttonLabel: string;
  /**
   * The button is DISABLED in these states, never hidden. A hidden control
   * produces a support ticket asking where the feature went; a disabled one
   * with a reason beside it answers the question on the page.
   */
  buttonDisabled: boolean;
  /**
   * Why the button is disabled. The invariant that matters, and that the tests
   * assert directly: this is non-null exactly when `buttonDisabled` is true.
   * A disabled control that does not say why is the failure being avoided.
   */
  disabledReason: string | null;
  /**
   * Offer the paste-your-own-URL form as a WAY ROUND the automatic search.
   *
   * It replaced `opensPicker`, and the difference is the whole of the
   * 2026-09-09 change. `opensPicker` meant "this state's button does not sync,
   * it asks for a URL first" — the unbound state had a different button from
   * every other state, and pasting was the only way in. The search made
   * pasting unnecessary, so every state now has the SAME button, and the form
   * is a correction: for the person the search cannot find, and for the person
   * it finds as somebody else.
   *
   * True only while nothing is linked. Once a profile IS linked the correction
   * lives beside it, on the linked-profile line, where the id it would be
   * replacing is on screen.
   */
  offersManualOverride: boolean;
  /** ISO timestamp the quota frees up, when inside the window. */
  nextEligibleAt: string | null;
  /** ISO timestamp of the last run that actually produced data. */
  lastFetchedAt: string | null;
}

/**
 * Decide the panel's state from the status payload.
 *
 * The order of the branches is the whole design, so it is spelled out:
 *
 *   1. No staff record — nothing else is possible, and neither binding nor
 *      fetching would do anything. The fix is an HR/name reconciliation, not
 *      something the user can do here, so the button is disabled and the
 *      server's own sentence explaining the mismatch is shown verbatim.
 *   2. A fetch was just asked for, or is on the queue — the most immediate
 *      truth about the button, and the thing that stops a second click piling
 *      on a second job. The local `starting` flag comes first within this
 *      step, because during the round trip the server still says nothing is
 *      queued.
 *   3. Inside the 30-day window — disabled, showing the date it reopens.
 *   4. No profile linked — the button STILL SYNCS.
 *   5. Otherwise ready.
 *
 * STEPS 3 AND 4 SWAPPED ON 2026-09-09, and the swap is a consequence of the
 * search, not a preference. Binding used to outrank the window because pasting
 * a URL was the unlinked person's real next step and it is not quota-gated —
 * an enabled button that opened a form was honest even inside the window. The
 * button no longer opens a form; it enqueues a run. And the runner checks the
 * quota at step 2, BEFORE it would search at step 4, so for an unlinked person
 * inside their window that click enqueues a job that refuses without searching:
 * a live button that does nothing but write a refusal to the ledger. Ordering
 * the window first disables it with the reason and the reopening date, and the
 * paste-a-URL override stays on offer underneath — which is the part that was
 * worth protecting, and it is protected by `offersManualOverride` rather than
 * by the branch order now.
 */
export function decideScholarPanelState(
  status: ScholarStatus,
  /** Local, pre-server state: the fetch request is in flight but the queue
   *  has not confirmed it yet. Passed in rather than inferred, because only
   *  the component knows a click is mid-round-trip. */
  options: { starting?: boolean } = {},
): ScholarPanelView {
  // "Last fetched" means a run that produced data. A REFUSED or FAILED run is
  // not a fetch date — presenting one as such would tell a user their record
  // is current when nothing was written.
  const producedData =
    status.lastRun &&
    (status.lastRun.status === 'SUCCEEDED' || status.lastRun.status === 'PARTIAL');
  const lastFetchedAt = producedData
    ? (status.lastRun?.finishedAt ?? status.lastRun?.startedAt ?? null)
    : null;

  // A property of the account, not of the branch that wins. The correction is
  // worth offering to anyone with a staff record and nothing linked — whether
  // the search has not run yet, has run and found the wrong person, or cannot
  // run today because the window is shut. It is withheld only where it could
  // not work (no staff record to check a pasted name against) or where it
  // would fight something already in progress (a queued run).
  const unlinkedWithRecord = status.staffRecord.linked && !status.profile.bound;

  if (!status.staffRecord.linked) {
    return {
      kind: 'no-staff-record',
      buttonLabel: SYNC_LABEL,
      buttonDisabled: true,
      disabledReason: status.staffRecord.reason,
      offersManualOverride: false,
      nextEligibleAt: null,
      lastFetchedAt,
    };
  }

  // BEFORE `fetchQueued`, and this ordering is the whole point of the flag.
  // `POST /scholar/fetch/me` is a round trip, and until it returns the status
  // still says nothing is queued — so an enabled button in that window takes a
  // second click and enqueues a second job. The credits survive it (the job id
  // is deterministic and collapses the pair) but a spurious REFUSED row lands
  // in the run ledger, and the API's own comment names that gap.
  if (options.starting) {
    return {
      kind: 'running',
      buttonLabel: 'Starting…',
      buttonDisabled: true,
      disabledReason: 'Asking for a sync — one moment.',
      offersManualOverride: false,
      nextEligibleAt: status.nextEligibleAt,
      lastFetchedAt,
    };
  }

  if (status.fetchQueued) {
    return {
      kind: 'running',
      buttonLabel: 'Syncing…',
      buttonDisabled: true,
      disabledReason:
        'A sync is already queued for you. This panel checks again every few seconds.',
      offersManualOverride: false,
      nextEligibleAt: status.nextEligibleAt,
      lastFetchedAt,
    };
  }

  if (status.nextEligibleAt) {
    return {
      kind: 'cooling-down',
      // Same "again" wording as the ready state. Reaching the window means a
      // sync has happened, so a bare SYNC_LABEL would read as if none ever had.
      buttonLabel: lastFetchedAt ? SYNC_AGAIN_LABEL : SYNC_LABEL,
      buttonDisabled: true,
      // The API's own sentence when it has one — it names the date of the run
      // that consumed the allowance, which is the part a user asks about.
      disabledReason:
        status.quotaReason ??
        'You have already fetched recently. One fetch per 30 days.',
      offersManualOverride: unlinkedWithRecord,
      nextEligibleAt: status.nextEligibleAt,
      lastFetchedAt,
    };
  }

  if (status.needsBinding) {
    return {
      kind: 'unbound',
      // The SAME label as every other actionable state, which is the point of
      // the change: there is one control, and what it does about the missing
      // link is the search, not a form.
      buttonLabel: SYNC_LABEL,
      buttonDisabled: false,
      disabledReason: null,
      // `unlinkedWithRecord`, not a bare `true`. This branch is also reached
      // when a profile IS linked and the last run still refused for a binding
      // reason; there the correction belongs on the linked-profile line, next
      // to the id being replaced, and a second copy of it up here would be two
      // affordances for one action.
      offersManualOverride: unlinkedWithRecord,
      nextEligibleAt: status.nextEligibleAt,
      lastFetchedAt,
    };
  }

  return {
    kind: 'ready',
    buttonLabel: lastFetchedAt ? SYNC_AGAIN_LABEL : SYNC_LABEL,
    buttonDisabled: false,
    disabledReason: null,
    offersManualOverride: unlinkedWithRecord,
    nextEligibleAt: null,
    lastFetchedAt,
  };
}

// ── Display helpers ────────────────────────────────────────────────────────
//
// Hand-rolled rather than `Intl.DateTimeFormat`, for one reason: this panel is
// server-rendered and then hydrated, and the two runtimes do not share ICU
// data. Node's en-GB short month for September is "Sept"; a browser on an
// older CLDR says "Sep". Same instant, two strings, and React reports a
// hydration mismatch — for a date label. Composing the string from UTC parts
// makes it identical everywhere.
//
// Asia/Bangkok is a fixed UTC+7 with no daylight saving and no historical
// change in the range these dates live in, so shifting the instant and reading
// the UTC fields is exact, not an approximation.

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function bangkokParts(
  iso: string | null | undefined,
): { day: number; month: string; year: number; hour: string; minute: string } | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const shifted = new Date(parsed.getTime() + BANGKOK_OFFSET_MS);
  return {
    day: shifted.getUTCDate(),
    month: MONTHS[shifted.getUTCMonth()] ?? '',
    year: shifted.getUTCFullYear(),
    hour: String(shifted.getUTCHours()).padStart(2, '0'),
    minute: String(shifted.getUTCMinutes()).padStart(2, '0'),
  };
}

/** "1 Sep 2026" in Bangkok time, or null when absent or unparseable. */
export function formatScholarDay(iso: string | null | undefined): string | null {
  const p = bangkokParts(iso);
  return p ? `${p.day} ${p.month} ${p.year}` : null;
}

/** "1 Sep 2026, 07:00" in Bangkok time. Used where hours matter — the bind
 *  allowance resets within a day, so a date alone would not answer "when". */
export function formatScholarDayTime(iso: string | null | undefined): string | null {
  const p = bangkokParts(iso);
  return p ? `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}` : null;
}
