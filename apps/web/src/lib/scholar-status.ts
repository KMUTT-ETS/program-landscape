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
export type ScholarRunTrigger = 'SELF' | 'ADMIN' | 'ADMIN_BULK';

export interface ScholarLastRun {
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
   *  `needs-binding:` prefix by the server action. Null on a clean run. */
  errorText: string | null;
  /** The run refused because no Scholar profile is linked. Branch on this,
   *  never on the text of `errorText`. */
  needsBinding: boolean;
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
  bind: { attemptsToday: number; maxPerDay: number; retryAt: string | null };
}

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
  /** Clicking opens the paste-your-profile-URL picker instead of fetching. */
  opensPicker: boolean;
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
 *   2. A fetch is on the queue — the most immediate truth about the button,
 *      and the thing that stops a second click piling on a second job.
 *   3. No profile linked — the next step is pasting a URL, so the button
 *      opens the picker rather than starting a fetch that would refuse.
 *   4. Inside the 30-day window — disabled, showing the date it reopens.
 *   5. Otherwise ready.
 */
export function decideScholarPanelState(status: ScholarStatus): ScholarPanelView {
  // "Last fetched" means a run that produced data. A REFUSED or FAILED run is
  // not a fetch date — presenting one as such would tell a user their record
  // is current when nothing was written.
  const producedData =
    status.lastRun &&
    (status.lastRun.status === 'SUCCEEDED' || status.lastRun.status === 'PARTIAL');
  const lastFetchedAt = producedData
    ? (status.lastRun?.finishedAt ?? status.lastRun?.startedAt ?? null)
    : null;

  if (!status.staffRecord.linked) {
    return {
      kind: 'no-staff-record',
      buttonLabel: 'Fetch from Google Scholar',
      buttonDisabled: true,
      disabledReason: status.staffRecord.reason,
      opensPicker: false,
      nextEligibleAt: null,
      lastFetchedAt,
    };
  }

  if (status.fetchQueued) {
    return {
      kind: 'running',
      buttonLabel: 'Fetching…',
      buttonDisabled: true,
      disabledReason:
        'A fetch is already queued for you. This panel checks again every few seconds.',
      opensPicker: false,
      nextEligibleAt: status.nextEligibleAt,
      lastFetchedAt,
    };
  }

  if (status.needsBinding) {
    return {
      kind: 'unbound',
      buttonLabel: 'Link your Scholar profile',
      buttonDisabled: false,
      disabledReason: null,
      opensPicker: true,
      nextEligibleAt: status.nextEligibleAt,
      lastFetchedAt,
    };
  }

  if (status.nextEligibleAt) {
    return {
      kind: 'cooling-down',
      // Same "again" wording as the ready state. Reaching the window means a
      // fetch has happened, so a bare "Fetch from Google Scholar" would read
      // as if none ever had.
      buttonLabel: lastFetchedAt
        ? 'Fetch again from Google Scholar'
        : 'Fetch from Google Scholar',
      buttonDisabled: true,
      // The API's own sentence when it has one — it names the date of the run
      // that consumed the allowance, which is the part a user asks about.
      disabledReason:
        status.quotaReason ??
        'You have already fetched recently. One fetch per 30 days.',
      opensPicker: false,
      nextEligibleAt: status.nextEligibleAt,
      lastFetchedAt,
    };
  }

  return {
    kind: 'ready',
    buttonLabel: lastFetchedAt
      ? 'Fetch again from Google Scholar'
      : 'Fetch from Google Scholar',
    buttonDisabled: false,
    disabledReason: null,
    opensPicker: false,
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
