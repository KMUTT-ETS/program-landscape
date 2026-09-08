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
// Three things about it are worth knowing before changing it.
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
  // Open from the first paint when there is nothing linked yet. An unbound
  // user's only possible next step IS pasting a URL, so putting it behind a
  // click would add a step that leads nowhere else.
  const [pickerOpen, setPickerOpen] = React.useState<boolean>(view.opensPicker);
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
        toast.message('The Scholar fetch ended without recording a run. Nothing was changed.');
        return;
      }
      baselineRunId.current = run.id;
      if (run.status === 'SUCCEEDED' || run.status === 'PARTIAL') {
        toast.success(
          `Scholar fetch finished — ${run.papersInserted} papers added, ` +
            `${run.citationsUpdated} citation counts refreshed. ` +
            'The publication list below rebuilds in the background; reload this page in a minute to see them.',
        );
        router.refresh();
      } else {
        toast.error(run.errorText ?? 'The Scholar fetch did not complete.');
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [polling, router]);

  const onPrimaryClick = async () => {
    if (view.opensPicker) {
      setPickerOpen(true);
      return;
    }
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
      toast.success('Queued. This panel reports the result when the fetch finishes.');
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
            ) : (
              <p>
                {view.kind === 'unbound'
                  ? 'Paste the link to your own Google Scholar profile below. Nothing is fetched until the name on it is checked against your staff record.'
                  : 'One fetch per 30 days. Scholar papers are added to your record; nothing already there is removed.'}
              </p>
            )}
            {view.kind === 'cooling-down' && nextEligibleLabel && (
              <p className="mt-2 text-text-tertiary" data-testid="scholar-next-eligible">
                You can fetch again on {nextEligibleLabel}.
              </p>
            )}
            {/* Binding outranks the cooldown, because pasting a URL is still
                the right next step — but silently disabling the button the
                moment they finish would read as a bug. Reachable when a
                successful fetch is followed by an administrator unlinking the
                profile. */}
            {view.kind === 'unbound' && nextEligibleLabel && (
              <p className="mt-2 text-text-tertiary" data-testid="scholar-next-eligible">
                Note that a fetch already ran inside the last 30 days, so linking now will not
                start another one until {nextEligibleLabel}.
              </p>
            )}
          </div>
        </div>

        {polling && (
          <div className="mt-6" aria-live="polite">
            <p className="text-xs text-text-tertiary">
              Waiting for the fetch to finish — this usually takes under a minute.
            </p>
            <Skeleton className="mt-3 h-6 w-full max-w-[26rem]" />
          </div>
        )}

        {pollTimedOut && (
          <p className="mt-6 text-xs text-warning" role="status">
            Still running after three minutes, so this panel stopped checking. The fetch has
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
        If the wrong profile is linked and you cannot correct it here, a system administrator
        can unlink it for you.
      </p>
    </div>
  );
}

// ── Paste-your-profile-URL picker ──────────────────────────────────────────
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
        <code className="font-mono text-text-secondary">{EXAMPLE_URL}</code>. There is no
        search by name: Google puts author search behind a sign-in wall, so the link has to
        come from you.
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
            ? `No checks left today${capRetryLabel ? ` — the allowance resets on ${capRetryLabel}` : ''}.`
            : attemptsLeft > 0
              ? `You have ${attemptsLeft} of today's ${status.bind.maxPerDay} checks left.`
              : // Past the cap yet still allowed: an exempt account. Saying
                // "0 left" next to a working button would contradict itself.
                `${status.bind.attemptsToday} checks used today. The daily cap does not apply to your account.`}
        </p>
        <p className="mt-2 text-text-tertiary">
          Every check loads your Scholar page before it can tell whether the name matches, so a
          wrong link costs exactly what a right one does.
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
          Fetch from Google Scholar
        </Button>
        <p
          className="min-w-0 flex-1 text-xs leading-relaxed text-text-secondary"
          data-testid="scholar-disabled-reason"
        >
          Your Google Scholar status could not be read, so the sources behind the publication
          list below cannot be broken down and a fetch cannot be started. {message} Reload the
          page to try again.
        </p>
      </div>
    </div>
  );
}
