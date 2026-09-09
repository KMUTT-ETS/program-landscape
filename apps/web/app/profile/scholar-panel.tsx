'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Input, Label, Skeleton } from '@kku/ui';
import { ExternalLink } from 'lucide-react';
// Client-safe subpath, NOT the `@kku/shared` barrel — the barrel re-exports
// modules that reach node:crypto and breaks the browser build. This is the
// same parser the server action and the API reject a bad URL with, so the
// inline error a user sees before submitting is the error they would have got
// after submitting, without spending a Scholar page fetch to find out.
import { parseScholarProfileUrl } from '@kku/shared/scholar/parse';
import {
  SCHOLAR_SYNC_LABEL,
  decideScholarPanelState,
  formatScholarDay,
  formatScholarDayTime,
  type ScholarStatus,
} from '@/lib/scholar-status';
import {
  bindScholarProfileAction,
  getScholarStatusAction,
  startScholarFetchAction,
} from '@/lib/actions/scholar';

// The Google Scholar self-service panel, rendered at the head of the profile
// page's publications section.
//
// Four things about it are worth knowing before changing it.
//
// THERE IS ONE BUTTON AND IT ALWAYS SYNCS. Until 2026-09-09 an unlinked person
// got a different button ("Link your Scholar profile") that opened a paste-a-URL
// form on first paint, because there was no way to find a profile from a name
// and the run would have refused. There is now: the run searches Google Scholar
// for the person's English full name, links what it resolves, and reads it. So
// the form is no longer the way in — it is the way to CORRECT a search that
// found nobody or found the wrong person, and it opens only when asked for.
// `view.offersManualOverride` decides whether that offer is on screen.
//
// THE BUTTON IS NEVER HIDDEN. Every state that cannot act renders it disabled
// with a sentence saying why, `decideScholarPanelState` guarantees the pairing
// (see the invariant on `disabledReason`), and the no-staff-record case is
// asserted in apps/web/test/. A hidden control produces a support ticket
// asking where the feature went; a disabled one answers on the page.
//
// THE FETCH HAS NO COMPLETION EVENT. `POST /scholar/fetch/me` enqueues a job
// and returns a reference; nothing pushes the result back. So the panel polls
// `GET /scholar/status/me`, and the polling has a hard stop — a page left open
// must not keep firing requests for the rest of the day. See POLL_INTERVAL_MS
// and POLL_MAX_TICKS.
//
// A NEW PAPER IS NOT VISIBLE IMMEDIATELY. The runner marks the publications
// cache stale (it backdates `fetchedAt`; it does not delete the row) and
// `loadPublicationsWithCache` serves a stale row immediately while refreshing
// in the background. So the load after a successful fetch still shows the old
// list and merely triggers the rebuild; the one after that shows the new
// papers. The copy says that rather than implying a live update.

const EXAMPLE_URL = 'https://scholar.google.com/citations?user=ABC123';

/** 4s. A profile walk is 1-2 pages at 3-8s each, so this lands a handful of
 *  polls across a typical run without hammering the API. */
const POLL_INTERVAL_MS = 4000;

/** 45 ticks × 4s = 3 minutes, then the panel stops by itself and says so. The
 *  ceiling exists because a queue can be backed up and a worker can be down,
 *  and neither should turn an open tab into an indefinite poller. */
const POLL_MAX_TICKS = 45;

export interface ScholarSourceCounts {
  /** `research_outputs` rows for this person written by `source='google-scholar'`. */
  googleScholar: number;
  /** Every other source — the Scopus / kku-publications library pipeline. */
  libraryIndex: number;
}

export function ScholarPanel({
  initialStatus,
  sources,
}: {
  initialStatus: ScholarStatus;
  sources: ScholarSourceCounts | null;
}) {
  const router = useRouter();
  const [status, setStatus] = React.useState<ScholarStatus>(initialStatus);
  // A fetch has been asked for and the round trip has not come back. Without
  // it the button stays enabled for the length of that request and a second
  // click enqueues a second job.
  const [starting, setStarting] = React.useState(false);
  const startingRef = React.useRef(false);
  const view = decideScholarPanelState(status, { starting });

  // Seeded from the server payload: a fetch queued by an administrator, or by
  // this user before a reload, must resume polling on mount rather than sit
  // silent while a job runs.
  const [polling, setPolling] = React.useState<boolean>(initialStatus.fetchQueued);
  const [pollTimedOut, setPollTimedOut] = React.useState(false);
  // CLOSED on first paint, in every state. It used to open by itself whenever
  // nothing was linked, because pasting a URL was then the unlinked person's
  // only possible next step. It is not any more — pressing sync is — and a form
  // that opens itself reads as the thing you are being asked to do.
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [bindError, setBindError] = React.useState<string | null>(null);
  const [binding, setBinding] = React.useState(false);

  // The run id when polling started. A run whose id differs from this is the
  // one this session is waiting for.
  const baselineRunId = React.useRef<string | null>(initialStatus.lastRun?.id ?? null);

  React.useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let ticks = 0;

    const timer = window.setInterval(async () => {
      ticks += 1;
      if (ticks > POLL_MAX_TICKS) {
        cancelled = true;
        window.clearInterval(timer);
        setPolling(false);
        setPollTimedOut(true);
        return;
      }

      const result = await getScholarStatusAction();
      if (cancelled) return;
      if (!result.ok) {
        // A transient read failure is no reason to abandon the run — the job
        // is still on the queue. Keep polling; the tick ceiling bounds it.
        return;
      }
      setStatus(result.status);
      if (result.status.fetchQueued) return;

      cancelled = true;
      window.clearInterval(timer);
      setPolling(false);

      const run = result.status.lastRun;
      if (!run || run.id === baselineRunId.current) {
        toast.message('The Scholar sync ended without recording a run. Nothing was changed.');
        return;
      }
      baselineRunId.current = run.id;
      if (run.status === 'SUCCEEDED' || run.status === 'PARTIAL') {
        toast.success(
          `Scholar sync finished — ${run.papersInserted} papers added, ` +
            `${run.citationsUpdated} citation counts refreshed. ` +
            'The publication list below rebuilds in the background; reload this page in a minute to see them.',
        );
        router.refresh();
      } else {
        toast.error(run.errorText ?? 'The Scholar sync did not complete.');
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [polling, router]);

  const onPrimaryClick = async () => {
    // No branch on the panel state any more: the button starts a run in every
    // state that lets it be pressed. What the run does about a missing profile
    // link is the runner's business, not this component's.
    //
    // The ref, not the state, is the guard. `setStarting` schedules a render;
    // two clicks that land before it flushes would both read the old `false`.
    // The ref changes on the spot.
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setPollTimedOut(false);
    baselineRunId.current = status.lastRun?.id ?? null;
    try {
      const result = await startScholarFetchAction();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Queued. This panel reports the result when the sync finishes.');
      // The job is on the queue by the time the action returns, so flip the
      // button to the queued state now rather than up to one poll interval
      // later.
      setStatus((prev) => ({ ...prev, fetchQueued: true }));
      setPolling(true);
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const onBindSubmit = async (url: string) => {
    // Validated here, with the same parser the server action re-runs, so a
    // typo costs nothing. The server still validates: a server action is a
    // public endpoint and the client is not the guard.
    const parsed = parseScholarProfileUrl(url);
    if (!parsed.ok) {
      setBindError(parsed.reason);
      return;
    }
    setBindError(null);
    setBinding(true);
    const result = await bindScholarProfileAction(url);
    setBinding(false);
    if (!result.ok) {
      // Verbatim. On a name mismatch the API's sentence quotes both the
      // Scholar profile's name and the staff record's name, which is the only
      // thing that tells the user which of the two is wrong.
      setBindError(result.message);
      return;
    }
    toast.success(`Linked to the Scholar profile of ${result.profileName}.`);
    setPickerOpen(false);
    const refreshed = await getScholarStatusAction();
    if (refreshed.ok) setStatus(refreshed.status);
    router.refresh();
  };

  const nextEligibleLabel = formatScholarDay(view.nextEligibleAt);
  const run = status.lastRun;
  const failedRun =
    run && run.status !== 'SUCCEEDED' && run.status !== 'PARTIAL' ? run : null;

  return (
    <div className="mb-8 rounded-lg border border-subtle bg-surface-2/60 p-8">
      <SourceComposition
        sources={sources}
        lastFetchedAt={view.lastFetchedAt}
        run={run}
      />

      <div className="mt-8 border-t border-subtle pt-8">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-6">
          <Button
            variant={view.buttonDisabled ? 'default' : 'primary'}
            size="sm"
            shape="square"
            disabled={view.buttonDisabled}
            onClick={onPrimaryClick}
            data-testid="scholar-fetch-button"
            data-panel-kind={view.kind}
          >
            {view.buttonLabel}
          </Button>

          <div className="min-w-0 flex-1 text-xs leading-relaxed text-text-secondary">
            {view.disabledReason ? (
              <p data-testid="scholar-disabled-reason">{view.disabledReason}</p>
            ) : view.kind === 'unbound' ? (
              <p>
                No Scholar profile is linked yet, so this searches Google Scholar for your
                English staff name and links the profile it finds. A profile whose name does
                not match your staff record is not linked, and nothing is imported from it.
              </p>
            ) : (
              <p>
                One fetch per 30 days. Scholar papers are added to your record; nothing
                already there is removed.
              </p>
            )}

            {view.kind === 'cooling-down' && nextEligibleLabel && (
              <p className="mt-2 text-text-tertiary" data-testid="scholar-next-eligible">
                You can sync again on {nextEligibleLabel}.
              </p>
            )}

            {/* Only while nothing is linked. Once a profile IS linked, the way
                to correct it sits on the linked-profile line below, beside the
                id it would replace. */}
            {view.offersManualOverride && !pickerOpen && (
              <p className="mt-3 text-text-tertiary" data-testid="scholar-manual-override">
                Searched and found the wrong person, or nobody at all?{' '}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="text-accent-default underline-offset-4 hover:underline"
                >
                  Paste your profile URL instead
                </button>
              </p>
            )}

            {view.kind === 'unbound' && <SearchCost bind={status.bind} />}
          </div>
        </div>

        {polling && (
          <div className="mt-6" aria-live="polite">
            <p className="text-xs text-text-tertiary">
              Waiting for the sync to finish. A first sync searches Google Scholar for your
              profile before it reads anything, so it takes longer than later ones.
            </p>
            <Skeleton className="mt-3 h-6 w-full max-w-[26rem]" />
          </div>
        )}

        {pollTimedOut && (
          <p className="mt-6 text-xs text-warning" role="status">
            Still running after three minutes, so this panel stopped checking. The sync has
            not been cancelled — reload the page later to see the result.
          </p>
        )}

        {!polling && failedRun?.errorText && (
          <p className="mt-6 text-xs leading-relaxed text-danger" data-testid="scholar-last-run-error">
            The attempt on {formatScholarDay(failedRun.startedAt) ?? 'an earlier date'} did not
            complete: {failedRun.errorText}
          </p>
        )}

        {status.profile.bound && (
          <BoundProfile profile={status.profile} onChange={() => setPickerOpen(true)} />
        )}

        {pickerOpen && (
          <BindPicker
            status={status}
            error={bindError}
            submitting={binding}
            onSubmit={onBindSubmit}
            onCancel={() => {
              setBindError(null);
              setPickerOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── What a search costs, and how much of it is still on the table ──────────

/**
 * The daily allowance, priced.
 *
 * IT USED TO BE A COUNT AND ONLY A COUNT — "You have 3 of today's 5 checks
 * left" — and that was a fair unit while every attempt was the same 15-credit
 * profile page. It stopped being fair on 2026-09-09: the automatic search is
 * five times the price of a pasted check, and it is now the DEFAULT path, so
 * the same five attempts moved from 75 credits a day to 375. A count says
 * nothing about that. The credits say it, so the credits lead and the count
 * qualifies them.
 *
 * Every figure here is the API's. Nothing on this page multiplies a price.
 */
function SearchCost({ bind }: { bind: ScholarStatus['bind'] }) {
  // The server's verdict, not a second one derived from the counts — the same
  // reasoning as BindPicker's: `decideScholarBindQuota` exempts SUPER_ADMIN
  // outright, and `attemptsToday >= maxPerDay` would claim an exhausted
  // allowance for an account the API is perfectly willing to serve.
  const capReached = bind.retryAt !== null;
  const attemptsLeft = Math.max(0, bind.maxPerDay - bind.attemptsToday);
  const resetLabel = formatScholarDayTime(bind.retryAt);

  return (
    <div className="mt-3 text-text-tertiary" data-testid="scholar-search-cost">
      <p>
        A search spends {bind.creditsPerSearch} ScrapingBee credits whether or not it finds
        you, and a pasted link is checked for {bind.creditsPerPastedCheck} credits. Both count
        against the same daily allowance.
      </p>
      {capReached ? (
        <p className="mt-2">
          No attempts left today.
          {resetLabel ? ` The allowance resets on ${resetLabel}.` : ''}
        </p>
      ) : attemptsLeft > 0 ? (
        // A definition list, not two spans in a flex row. `justify-between`
        // pushes them to opposite ends of the line and that is enough to READ
        // as two things — but it is only enough on screen: with spans, the
        // text is "Attempts left today3 of 5" with no separator in it at all,
        // which is what a screen reader gets and what the label reads as when
        // the layout wraps. `dt`/`dd` is the same fix the papers columns and
        // the source breakdown above already use.
        <dl className="mt-2 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
          <dt>Attempts left today</dt>
          <dd className="font-tabular text-text-secondary">
            {attemptsLeft} of {bind.maxPerDay} — up to {bind.creditsAtRisk} credits
          </dd>
        </dl>
      ) : (
        // Past the cap and still allowed: an exempt account. There is no
        // ceiling to price, so it is not priced.
        <p className="mt-2">
          {bind.attemptsToday} attempts used today. The daily cap does not apply to your
          account.
        </p>
      )}
    </div>
  );
}

// ── Source composition (which source is primary, and when Scholar last ran) ──

function SourceComposition({
  sources,
  lastFetchedAt,
  run,
}: {
  sources: ScholarSourceCounts | null;
  lastFetchedAt: string | null;
  run: ScholarStatus['lastRun'];
}) {
  const lastFetchedLabel = formatScholarDay(lastFetchedAt);
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-text-tertiary">
        Where these publications come from
      </h3>

      {/* The `{' '}` between each label and its qualifier is load-bearing, not
          formatting noise: JSX drops the whitespace around a newline, so
          without it the accessible name reads "KKU library indexprimary
          source" — one run-on token — even though a margin keeps them apart
          on screen. */}
      <dl className="mt-6 space-y-4 text-sm">
        <div className="flex items-baseline justify-between gap-8">
          <dt className="min-w-0 text-text-primary">
            KKU library index{' '}
            <span className="rounded-sm bg-accent-subtle px-3 py-0.5 text-xs font-medium text-accent-fg">
              primary source
            </span>
          </dt>
          <dd className="shrink-0 tabular-nums text-text-secondary">
            {sources ? `${sources.libraryIndex} papers` : 'count unavailable'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-8">
          <dt className="min-w-0 text-text-primary">
            Google Scholar{' '}
            <span className="text-xs text-text-tertiary">— added on request</span>
          </dt>
          <dd className="shrink-0 tabular-nums text-text-secondary">
            {sources ? `${sources.googleScholar} papers` : 'count unavailable'}
          </dd>
        </div>
      </dl>

      <p className="mt-6 text-xs text-text-tertiary" data-testid="scholar-last-fetch">
        {lastFetchedLabel && run ? (
          <>
            Last Scholar fetch on {lastFetchedLabel} — {run.papersInserted} papers added,{' '}
            {run.citationsUpdated} citation counts refreshed.
          </>
        ) : (
          'Google Scholar has never been fetched for this record.'
        )}
      </p>

      <details className="mt-4 text-xs text-text-tertiary">
        <summary className="cursor-pointer select-none text-text-secondary">
          Why the two totals differ
        </summary>
        <p className="mt-3 max-w-[46rem] leading-relaxed">
          The library index — Scopus by author ID, with the KKU publications mirror behind it —
          is curated, and is the record this platform treats as authoritative. Google Scholar
          also indexes preprints, theses, technical reports and venues the library index does
          not, so a Scholar total runs higher for the same person. Higher is not better here:
          Scholar fills gaps, and a colleague who has never pressed this button is not less
          productive, only less fetched.
        </p>
      </details>
    </div>
  );
}

// ── The linked profile, once there is one ──────────────────────────────────

function BoundProfile({
  profile,
  onChange,
}: {
  profile: Extract<ScholarStatus['profile'], { bound: true }>;
  onChange: () => void;
}) {
  const boundLabel = formatScholarDay(profile.boundAt);
  const href =
    profile.scholarProfileUrl ??
    `https://scholar.google.com/citations?user=${encodeURIComponent(profile.scholarProfileId)}`;

  return (
    <div
      className="mt-8 border-t border-subtle pt-6 text-xs text-text-tertiary"
      data-testid="scholar-bound-profile"
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="text-text-secondary">Linked Scholar profile</span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 font-mono text-accent-default hover:underline"
        >
          {profile.scholarProfileId}
          <ExternalLink className="size-icon-sm" aria-hidden />
        </a>
        {boundLabel && <span>linked on {boundLabel}</span>}
        <button
          type="button"
          onClick={onChange}
          className="text-accent-default underline-offset-4 hover:underline"
        >
          Change
        </button>
      </div>
      <p className="mt-3 max-w-[46rem] leading-relaxed">
        This may have been linked by the search rather than by you. If it is the wrong person,
        Change replaces it with a profile URL you paste. If you cannot correct it here, a
        system administrator can unlink it for you.
      </p>
    </div>
  );
}

// ── Paste-your-profile-URL picker: the manual override ─────────────────────
//
// NO LONGER THE WAY IN. It opened on first paint while a name could not be
// searched for; now the sync button does the finding, and this is what a
// person reaches for when the search came back with nobody, or with somebody
// else. It opens only from the "wrong person" affordance beside the button, or
// from "Change" on an already-linked profile.
//
// Presentational apart from the text field: validation, the server round-trip
// and the resulting message all live in `ScholarPanel`. That split is what
// lets a refusal be rendered — and asserted — without driving a browser, which
// this workspace has no jsdom to do.

export function BindPicker({
  status,
  error,
  submitting,
  onSubmit,
  onCancel,
}: {
  status: ScholarStatus;
  /** The refusal to show inline. Server-supplied text is passed through
   *  verbatim so a name mismatch keeps both names in it. */
  error: string | null;
  submitting: boolean;
  onSubmit: (url: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [url, setUrl] = React.useState(
    status.profile.bound ? (status.profile.scholarProfileUrl ?? '') : '',
  );

  // The server's verdict, not a second one computed from the counts.
  // `decideScholarBindQuota` exempts SUPER_ADMIN outright and always sets
  // `retryAt` when it refuses, so `retryAt !== null` IS "not allowed" — while
  // `attemptsToday >= maxPerDay` would grey the button out for an exempt
  // account the API is perfectly willing to serve.
  const capReached = status.bind.retryAt !== null;
  const attemptsLeft = Math.max(0, status.bind.maxPerDay - status.bind.attemptsToday);
  const capRetryLabel = formatScholarDayTime(status.bind.retryAt);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (capReached || submitting) return;
        void onSubmit(url);
      }}
      className="mt-8 rounded-md border border-default bg-surface-1 p-8"
      data-testid="scholar-bind-picker"
    >
      <Label htmlFor="scholar-profile-url">Your Google Scholar profile URL</Label>
      <Input
        id="scholar-profile-url"
        value={url}
        spellCheck={false}
        placeholder={EXAMPLE_URL}
        onChange={(e) => setUrl(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby="scholar-profile-url-help"
        className="mt-3"
      />

      <p id="scholar-profile-url-help" className="mt-3 text-xs leading-relaxed text-text-tertiary">
        Open your own profile on Google Scholar and copy the address bar. It looks like{' '}
        <code className="font-mono text-text-secondary">{EXAMPLE_URL}</code>. Use this when the
        search by name found nobody, or found somebody else — a link you paste is taken over
        anything a search resolved.
      </p>

      {error && (
        <p
          className="mt-6 rounded-md border border-[oklch(var(--color-danger-default)/0.3)] bg-danger-subtle px-6 py-4 text-xs leading-relaxed text-danger"
          role="alert"
          data-testid="scholar-bind-error"
        >
          {error}
        </p>
      )}

      {/* Two counts in one sentence ("0 of 5. 5 left.") read as one number, so
          the allowance is stated once, as a sentence, on its own line. */}
      <div className="mt-6 text-xs leading-relaxed" data-testid="scholar-bind-cap">
        <p className="text-text-secondary">
          {capReached
            ? `No attempts left today${capRetryLabel ? ` — the allowance resets on ${capRetryLabel}` : ''}.`
            : attemptsLeft > 0
              ? `You have ${attemptsLeft} of today's ${status.bind.maxPerDay} attempts left.`
              : // Past the cap yet still allowed: an exempt account. Saying
                // "0 left" next to a working button would contradict itself.
                `${status.bind.attemptsToday} attempts used today. The daily cap does not apply to your account.`}
        </p>
        {/* "Checks" became "attempts" because one allowance now covers two
            things that cost differently — this pasted check, and the automatic
            search the sync button runs. Naming both prices is the point: the
            cap is five of EITHER, so what it is worth depends on which. */}
        <p className="mt-2 text-text-tertiary">
          A pasted link is checked by loading your Scholar page before it can tell whether the
          name matches, so a wrong link costs the same {status.bind.creditsPerPastedCheck}{' '}
          credits as a right one. An automatic search costs {status.bind.creditsPerSearch}{' '}
          credits, and both draw on the same allowance.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-6">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          shape="square"
          disabled={capReached || submitting || url.trim().length === 0}
        >
          {submitting ? 'Checking…' : 'Link profile'}
        </Button>
        <Button type="button" variant="ghost" size="sm" shape="square" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── When the status read itself fails ──────────────────────────────────────

/**
 * Rendered in the panel's place when `GET /scholar/status/me` did not answer.
 *
 * It draws the button — disabled, with the reason — for the same reason every
 * other blocked state does. Replacing the whole panel with a sentence was the
 * one place this feature still made the control vanish, and "the API is down"
 * is exactly the moment someone goes looking for a button that used to be
 * there. Nothing is synthesised about the account: without a status read we do
 * not know whether a staff record exists, so the reason names the read, not
 * the person.
 */
export function ScholarPanelUnavailable({ message }: { message: string }) {
  return (
    <div className="mb-8 rounded-lg border border-subtle bg-surface-2/60 p-8">
      <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-text-tertiary">
        Where these publications come from
      </h3>
      <div className="mt-8 flex flex-wrap items-start gap-x-8 gap-y-6">
        <Button
          variant="default"
          size="sm"
          shape="square"
          disabled
          data-testid="scholar-fetch-button"
          data-panel-kind="unavailable"
        >
          {SCHOLAR_SYNC_LABEL}
        </Button>
        <p
          className="min-w-0 flex-1 text-xs leading-relaxed text-text-secondary"
          data-testid="scholar-disabled-reason"
        >
          Your Google Scholar status could not be read, so the sources behind the publication
          list below cannot be broken down and a sync cannot be started. {message} Reload the
          page to try again.
        </p>
      </div>
    </div>
  );
}
