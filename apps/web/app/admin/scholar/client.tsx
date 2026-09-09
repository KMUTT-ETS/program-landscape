'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  type ColumnDef,
} from '@kku/ui';
import { formatScholarDay, formatScholarDayTime } from '@/lib/scholar-status';
import {
  EMPTY_ROSTER_FILTERS,
  SCHOLAR_LEDGER_LIMIT,
  decideScholarBulkGate,
  describeScholarOutcome,
  filterScholarRows,
  summariseBulkProgress,
  type ScholarBulkPreview,
  type ScholarConsoleRow,
  type ScholarLedger,
  type ScholarLedgerRun,
  type ScholarLinkFilter,
  type ScholarOutcome,
  type ScholarRosterFilters,
} from '@/lib/scholar-admin';
import {
  bulkFetchScholarAction,
  fetchScholarForUserAction,
  listScholarRunsAction,
  previewScholarBulkAction,
  type ScholarBulkOutcome,
} from '@/lib/actions/scholar-admin';

// ────────────────────────────────────────────────────────────────────────────
// The admin Scholar console.
//
// NOTHING HERE ENQUEUES WITHOUT A PRICE IN FRONT OF IT. Both the row action
// and "Fetch selected" open the same dialog, which asks the server to price
// the run and refuses to send until that price comes back and still describes
// the current selection. `decideScholarBulkGate` is the rule; this component
// has no second path to `bulkFetchScholarAction` or `fetchScholarForUserAction`
// that could bypass it.
//
// AN UNLINKED PERSON IS THE DEAREST KIND OF TARGET, NOT THE FREE ONE. This
// reversed on 2026-09-09 and every number and sentence on this page had to move
// with it. The run used to refuse at the binding gate before touching the
// network, so a batch of unlinked staff was quoted — correctly — at zero. It no
// longer refuses: it searches Google Scholar for the person's English full name
// at 75 credits, five times a profile page, and then reads whatever profile that
// resolves. A hundred unlinked people went from free to roughly 9,000 credits.
// If a sentence here still says an unlinked target costs nothing, it is stale.
//
// THE ADMIN CANNOT LINK SOMEONE ELSE'S PROFILE HERE, and that is deliberate,
// not an omission. `POST /scholar/bind/me` is self-only — there is no
// admin-side bind endpoint — so a paste field on this page would have nowhere
// to send what was pasted. Rather than build a control that cannot work, an
// unlinked row says so and says whose job it is. Fetching an unlinked person
// still works — the search is exactly what makes it work — but it is now the
// expensive path, and someone linking their own profile first is what makes it
// cheap.
//
// A FETCH HAS NO COMPLETION EVENT. The endpoints enqueue and return a job
// reference; nothing pushes the result back. So the run ledger is polled after
// a send, with a hard stop — a page left open must not fire requests for the
// rest of the day. See POLL_INTERVAL_MS and POLL_MAX_TICKS.
// ────────────────────────────────────────────────────────────────────────────

/** 5s. A profile walk is 1-2 pages at 3-8s each, and a batch runs them
 *  through a shared worker, so the ledger moves in steps of seconds. */
const POLL_INTERVAL_MS = 5000;

/** 36 ticks × 5s = 3 minutes, then the panel stops by itself and says so. A
 *  large batch outlives that; the copy says the run continues and a reload
 *  shows where it got to. */
const POLL_MAX_TICKS = 36;

interface FilterOption {
  id: string;
  name: string;
  count: number;
}

/** What the confirmation dialog is being opened for. `one` maps to
 *  `POST /scholar/fetch/:userId` so the run is recorded with trigger ADMIN;
 *  `selection` maps to the bulk endpoint and records ADMIN_BULK. The ledger
 *  shows the trigger, so collapsing the two would mislabel history. */
type PendingFetch =
  | { kind: 'one'; userId: string; label: string }
  | { kind: 'selection' };

export function ScholarConsoleClient({
  rows,
  faculties,
  departments,
  totals,
  maxTargets,
  initialLedger,
  ledgerError,
}: {
  rows: ScholarConsoleRow[];
  faculties: FilterOption[];
  departments: Array<FilterOption & { facultyId: string }>;
  totals: {
    accounts: number;
    resolved: number;
    bound: number;
    unbound: number;
    unresolved: number;
    quotaBlocked: number;
    ready: number;
  };
  /** The API's own bulk cap, read from the same env var it reads. Known from
   *  first paint so an over-cap selection is refused at the toolbar rather
   *  than after resolving several hundred accounts to price it. */
  maxTargets: number;
  initialLedger: ScholarLedger | null;
  ledgerError: string | null;
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState<ScholarRosterFilters>(EMPTY_ROSTER_FILTERS);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const [pending, setPending] = React.useState<PendingFetch | null>(null);
  const [preview, setPreview] = React.useState<ScholarBulkPreview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [pricing, setPricing] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [ledger, setLedger] = React.useState<ScholarLedger | null>(initialLedger);
  const [watch, setWatch] = React.useState<{ userIds: string[]; sentAt: string } | null>(null);
  const [pollTimedOut, setPollTimedOut] = React.useState(false);
  const [lastOutcome, setLastOutcome] = React.useState<ScholarBulkOutcome | null>(null);

  const visible = React.useMemo(() => filterScholarRows(rows, filters), [rows, filters]);
  const selectedIds = React.useMemo(() => [...selected], [selected]);

  // Departments narrow to the chosen faculty. Every resolved staff record in
  // this database currently has a null department, so this list is usually
  // empty — the picker says so rather than rendering as a dead control.
  const departmentOptions = React.useMemo(
    () =>
      filters.facultyId === 'all'
        ? departments
        : departments.filter((d) => d.facultyId === filters.facultyId),
    [departments, filters.facultyId],
  );

  const gate = decideScholarBulkGate({
    selectedUserIds: pending?.kind === 'one' ? [pending.userId] : selectedIds,
    preview,
    submitting,
    // The server's figure once a preview exists; the page's own read of the
    // same env var until then. They agree unless the deployment changed
    // between render and click.
    maxTargets: preview?.maxTargets ?? maxTargets,
  });

  // ── Polling the ledger after a send ──────────────────────────────────────
  React.useEffect(() => {
    if (!watch) return;
    let cancelled = false;
    let ticks = 0;

    const timer = window.setInterval(async () => {
      ticks += 1;
      if (ticks > POLL_MAX_TICKS) {
        cancelled = true;
        window.clearInterval(timer);
        setWatch(null);
        setPollTimedOut(true);
        return;
      }
      const result = await listScholarRunsAction({ limit: SCHOLAR_LEDGER_LIMIT });
      if (cancelled) return;
      if (!result.ok) return; // transient read failure; the jobs are still queued
      setLedger(result.ledger);
      const progress = summariseBulkProgress({
        watchedUserIds: watch.userIds,
        sentAtIso: watch.sentAt,
        runs: result.ledger.runs,
      });
      if (!progress.complete) return;
      cancelled = true;
      window.clearInterval(timer);
      setWatch(null);
      toast.success(
        progress.total === 1
          ? 'The Scholar fetch finished. Its outcome is in the run ledger below.'
          : `All ${progress.total} Scholar fetches finished. Their outcomes are in the run ledger below.`,
      );
      // The roster's paper counts and last-run column are server-rendered.
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watch, router]);

  // ── Opening the dialog (which is the only way to price anything) ─────────
  const openFetch = async (target: PendingFetch) => {
    const ids = target.kind === 'one' ? [target.userId] : selectedIds;
    setPending(target);
    setPreview(null);
    setPreviewError(null);
    // Pricing an over-cap selection resolves every one of those accounts
    // against the staff roster to produce a quote the gate will refuse anyway.
    // The dialog still opens — the operator asked a question and deserves the
    // answer — but it shows the cap refusal instead of a wasted round trip.
    if (ids.length > maxTargets) return;
    setPricing(true);
    const result = await previewScholarBulkAction(ids);
    setPricing(false);
    if (!result.ok) {
      setPreviewError(result.message);
      return;
    }
    setPreview(result.preview);
  };

  const closeDialog = () => {
    if (submitting) return;
    setPending(null);
    setPreview(null);
    setPreviewError(null);
  };

  const onConfirm = async () => {
    // The gate, not the button's disabled attribute, is what decides. A
    // disabled attribute is a rendering detail; this is the rule.
    if (!gate.canEnqueue || !pending) return;
    setSubmitting(true);
    const sentAt = new Date().toISOString();

    if (pending.kind === 'one') {
      const result = await fetchScholarForUserAction(pending.userId);
      setSubmitting(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setPending(null);
      setPreview(null);
      setLastOutcome(null);
      setPollTimedOut(false);
      setWatch({ userIds: [pending.userId], sentAt });
      toast.success(`Queued a Scholar fetch for ${pending.label}.`);
      return;
    }

    // The chargeable count goes with the request as a token. If somebody has
    // linked or unlinked a profile since the estimate was taken, the API's own
    // pre-flight disagrees and refuses the whole batch rather than billing for
    // a run this operator never saw priced.
    const result = await bulkFetchScholarAction(gate.userIds, gate.chargeableCount);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setPending(null);
    setPreview(null);
    setSelected(new Set());
    setPollTimedOut(false);
    setLastOutcome(result.outcome);
    if (result.outcome.enqueuedUserIds.length === 0) {
      // Nothing on the queue means nothing will ever land, so polling would
      // run its full three minutes and then announce "All 0 Scholar fetches
      // finished."
      toast.message('Nothing was queued — none of the selected people could be fetched.');
      return;
    }
    setWatch({ userIds: result.outcome.enqueuedUserIds, sentAt });
    toast.success(
      `Queued ${result.outcome.enqueuedCount} Scholar ${
        result.outcome.enqueuedCount === 1 ? 'fetch' : 'fetches'
      }.`,
    );
  };

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.userId));

  const columns: ColumnDef<ScholarConsoleRow, unknown>[] = [
    {
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          // A STABLE label. Swapping it to "Clear selection" when checked
          // renames the control under a screen-reader user mid-interaction —
          // the checked state already conveys which way it will go.
          aria-label="Select every listed person"
          checked={allVisibleSelected}
          onChange={(e) => {
            // Read the checkbox BEFORE the updater runs, not inside it. This
            // is a controlled input, and React defers the updater to the
            // render phase — by which point it may have restored the DOM node
            // from `allVisibleSelected` (still false). Reading `e.target`
            // there is reading a value React owns and has already reset.
            const checked = e.target.checked;
            setSelected((prev) => {
              const next = new Set(prev);
              for (const row of visible) {
                if (checked) next.add(row.userId);
                else next.delete(row.userId);
              }
              return next;
            });
          }}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.original.name ?? row.original.email}`}
          checked={selected.has(row.original.userId)}
          onChange={() => toggle(row.original.userId)}
        />
      ),
    },
    {
      id: 'person',
      header: 'Person',
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-text-primary">
            {row.original.name ?? '(no name on the account)'}
          </span>
          <span className="truncate text-xs text-text-tertiary">{row.original.email}</span>
        </div>
      ),
    },
    {
      id: 'staff',
      header: 'Staff record',
      cell: ({ row }) => <StaffCell row={row.original} />,
    },
    {
      id: 'profile',
      header: 'Scholar profile',
      cell: ({ row }) => <ProfileCell row={row.original} />,
    },
    {
      id: 'papers',
      header: 'Papers on record',
      cell: ({ row }) => <PapersCell row={row.original} />,
    },
    {
      id: 'last',
      header: 'Last fetch',
      cell: ({ row }) => <LastFetchCell row={row.original} />,
    },
    {
      id: 'action',
      header: '',
      cell: ({ row }) => {
        const linked = row.original.staff.linked;
        return (
          <Button
            size="xs"
            variant="outline"
            shape="square"
            disabled={!linked}
            title={
              linked
                ? undefined
                : 'This account matches no single staff record, so a fetch has nothing to attach papers to.'
            }
            onClick={() =>
              void openFetch({
                kind: 'one',
                userId: row.original.userId,
                label: row.original.name ?? row.original.email,
              })
            }
          >
            Fetch
          </Button>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <CostPreamble totals={totals} ledger={ledger} />

      <Card padding="none">
        <div className="flex flex-col gap-6 border-b border-subtle p-8">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-xs font-medium text-text-secondary">Search</span>
              <Input
                value={filters.search}
                placeholder="Name or email address"
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                className="w-[16rem]"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-secondary">Faculty</span>
              <Select
                value={filters.facultyId}
                onChange={(value) =>
                  setFilters((f) => ({ ...f, facultyId: value, departmentId: 'all' }))
                }
                options={faculties}
                allLabel="All faculties"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-secondary">Department</span>
              <Select
                value={filters.departmentId}
                onChange={(value) => setFilters((f) => ({ ...f, departmentId: value }))}
                options={departmentOptions}
                allLabel="All departments"
                disabled={departmentOptions.length === 0}
                disabledTitle="No staff record in this list carries a department, so there is nothing to narrow by."
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-secondary">Profile status</span>
              <select
                value={filters.link}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, link: e.target.value as ScholarLinkFilter }))
                }
                className={SELECT_CLASS}
              >
                <option value="all">Everyone</option>
                <option value="ready">Ready to fetch</option>
                <option value="quota-blocked">Linked, fetched recently</option>
                <option value="bound">Profile linked (either way)</option>
                <option value="unbound">Matched, no profile linked</option>
                <option value="unresolved">No staff record matched</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <div className="text-xs text-text-tertiary">
              <p>
                Showing {visible.length} of {totals.accounts} accounts.
                {selected.size > 0 && (
                  <span className="text-text-secondary"> {selected.size} selected.</span>
                )}
              </p>
              {/* Said where the selection is made, not only inside the dialog:
                  ticking the header box selects everything on screen, and
                  finding out afterwards that it was hundreds over the cap is a
                  wasted trip. */}
              {selected.size > maxTargets && (
                <p className="mt-1 text-warning" data-testid="scholar-over-cap">
                  That is more than the {maxTargets}-person limit for one bulk fetch. Narrow the
                  selection before sending.
                </p>
              )}
            </div>
            <div className="flex items-center gap-6">
              {selected.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  shape="square"
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                shape="square"
                disabled={selected.size === 0}
                title={
                  selected.size === 0
                    ? 'Tick at least one person in the table first.'
                    : undefined
                }
                data-testid="scholar-bulk-open"
                onClick={() => void openFetch({ kind: 'selection' })}
              >
                Fetch selected…
              </Button>
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={visible}
          variant="ghost"
          pageSize={50}
          emptyState={
            <div className="p-12 text-center text-sm text-text-tertiary">
              No account matches these filters.
            </div>
          }
        />

        <LinkingNote />
      </Card>

      <RunLedger
        ledger={ledger}
        error={ledgerError}
        watching={watch !== null}
        timedOut={pollTimedOut}
        lastOutcome={lastOutcome}
      />

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent
          onEscapeKeyDown={(e) => {
            if (submitting) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'one'
                ? `Fetch Google Scholar for ${pending.label}`
                : 'Fetch Google Scholar for the selected people'}
            </DialogTitle>
            <DialogDescription>
              This spends ScrapingBee credits. Nothing is sent until you confirm.
            </DialogDescription>
          </DialogHeader>
          <BulkConfirmPanel
            preview={preview}
            pricing={pricing}
            error={previewError}
            gate={gate}
            submitting={submitting}
            onConfirm={() => void onConfirm()}
            onCancel={closeDialog}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The one thing this console cannot do, said once rather than on every row.
 *
 * `POST /scholar/bind/me` is self-only — there is no admin-side bind endpoint
 * — so there is nowhere for a pasted profile URL to go from here. Rather than
 * offer a control that cannot work, the console says whose job it is.
 */
function LinkingNote() {
  return (
    <p className="border-t border-subtle px-8 py-6 text-xs leading-relaxed text-text-tertiary">
      A Scholar profile can only be linked by the person it belongs to, from their own profile
      page — the link is checked against the name on the Scholar page before it is accepted, and
      that check is theirs to make. Fetching an unlinked person still works: the run searches
      Google Scholar for their English staff name and links the profile it finds. That search is
      the most expensive call this system makes, and it is spent whether or not it finds anyone,
      so a batch of people who have never linked a profile costs several times what the same
      batch costs once they have.
    </p>
  );
}

const SELECT_CLASS =
  'h-10 w-[15rem] rounded-md border border-default bg-surface-1 px-4 text-sm text-text-primary ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40 ' +
  'disabled:cursor-not-allowed disabled:text-text-disabled';

function Select({
  value,
  onChange,
  options,
  allLabel,
  disabled,
  disabledTitle,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly FilterOption[];
  allLabel: string;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="all">{allLabel}</option>
      {options.map((o) => (
        // "Faculty of Science" and "37" would read as one token side by side,
        // so the count is spelled out with its unit inside the label.
        <option key={o.id} value={o.id}>
          {o.name} — {o.count} {o.count === 1 ? 'person' : 'people'}
        </option>
      ))}
    </select>
  );
}

// ── The money statement, said once, at the top ─────────────────────────────

function CostPreamble({
  totals,
  ledger,
}: {
  totals: {
    accounts: number;
    resolved: number;
    bound: number;
    unbound: number;
    unresolved: number;
    quotaBlocked: number;
    ready: number;
  };
  ledger: ScholarLedger | null;
}) {
  const cards: Array<{ label: string; value: string; note: string }> = [
    {
      label: 'Accounts',
      value: String(totals.accounts),
      note: 'Every account on the platform.',
    },
    {
      label: 'Matched to a staff record',
      value: String(totals.resolved),
      note: 'Only these can be fetched at all.',
    },
    {
      label: 'Ready to fetch',
      value: String(totals.ready),
      note: 'Linked, and outside the 30-day window. The cheap ones: a profile page each.',
    },
    {
      label: 'Linked, fetched recently',
      value: String(totals.quotaBlocked),
      note: 'Inside the 30-day window, so a fetch refuses for free.',
    },
    {
      label: 'Matched, not linked',
      value: String(totals.unbound),
      note: 'The dearest ones: each is searched for by name before anything is read.',
    },
    {
      label: 'Credits spent so far',
      value: ledger ? String(ledger.totalCreditsUsed) : '—',
      note: 'Across the runs listed below.',
    },
  ];

  return (
    <section>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-subtle bg-surface-1 p-6">
            <div className="text-xs text-text-tertiary">{c.label}</div>
            <div className="mt-2 font-tabular text-2xl font-semibold text-text-primary">
              {c.value}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-tertiary">{c.note}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 max-w-[52rem] text-xs leading-relaxed text-text-secondary">
        Every page fetched from Google costs 15 ScrapingBee credits, and a prolific
        researcher&rsquo;s profile runs to several pages. Estimates below are a floor, never a
        forecast.
      </p>
    </section>
  );
}

// ── Table cells ────────────────────────────────────────────────────────────

function StaffCell({ row }: { row: ScholarConsoleRow }) {
  if (!row.staff.linked) {
    return (
      <div className="flex min-w-0 max-w-[22rem] flex-col items-start gap-2">
        <Badge tone="neutral" size="sm">
          Not matched
        </Badge>
        <span className="text-xs leading-relaxed text-text-tertiary">{row.staff.reason}</span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 max-w-[18rem] flex-col">
      <span className="truncate text-sm text-text-primary">{row.staff.nameEn}</span>
      <span className="truncate text-xs text-text-tertiary">
        {row.staff.facultyName}
        {row.staff.departmentName ? ` · ${row.staff.departmentName}` : ''}
      </span>
    </div>
  );
}

/**
 * The profile column, exported so the quota branch can be asserted.
 *
 * The dev database has no Scholar runs at all, so this state cannot be reached
 * by clicking — and seeding a fake run to see it would be exactly the mock
 * data this project forbids. A render test is the honest way to prove it.
 */
export function ProfileCell({ row }: { row: ScholarConsoleRow }) {
  if (!row.staff.linked) {
    return <span className="text-xs text-text-tertiary">—</span>;
  }
  if (!row.profileBound) {
    // Badge only. The explanation — that nobody but this person can link the
    // profile — is identical on every unlinked row, and printing it 376 times
    // buries the table it is meant to clarify. It is said once, under the
    // table, in `LinkingNote`.
    return (
      <Badge tone="neutral" size="sm">
        Not linked
      </Badge>
    );
  }
  const retryLabel = formatScholarDay(row.quotaRetryAt);
  return (
    <div className="flex max-w-[16rem] flex-col items-start gap-1">
      <a
        href={`https://scholar.google.com/citations?user=${encodeURIComponent(
          row.scholarProfileId ?? '',
        )}`}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-2 font-mono text-xs text-accent-default hover:underline"
      >
        {row.scholarProfileId}
        <ExternalLink className="size-icon-sm" aria-hidden />
      </a>
      {/* The THIRD gate, stated rather than left to be worked out from the
          last-fetch date. Without it, selecting a faculty refreshed three
          weeks ago quotes credits for work that will refuse. */}
      {row.quotaRetryAt ? (
        <span className="text-xs leading-relaxed text-warning" data-testid="scholar-quota-blocked">
          Fetched recently — not again until {retryLabel ?? 'the window reopens'}.
        </span>
      ) : (
        <span className="text-xs text-text-tertiary">Ready to fetch.</span>
      )}
    </div>
  );
}

/**
 * Two counts, on two lines, each with its own label.
 *
 * "12 40" side by side reads as one number, and even "12 Scholar 40 library"
 * reads as a run-on. Each figure gets its own row with the source named
 * beside it and the number pushed to the right.
 */
function PapersCell({ row }: { row: ScholarConsoleRow }) {
  if (!row.staff.linked) {
    return <span className="text-xs text-text-tertiary">—</span>;
  }
  return (
    <dl className="flex w-[8rem] flex-col gap-1 pr-6 text-xs">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-text-tertiary">Scholar</dt>
        <dd className="font-tabular text-text-secondary">{row.papersFromScholar}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-text-tertiary">Library index</dt>
        <dd className="font-tabular text-text-secondary">{row.papersFromLibrary}</dd>
      </div>
    </dl>
  );
}

function LastFetchCell({ row }: { row: ScholarConsoleRow }) {
  const outcome = describeScholarOutcome(row.lastRun);
  const day = formatScholarDay(row.lastRun?.startedAt ?? null);
  return (
    <div className="flex max-w-[12rem] flex-col items-start gap-1">
      <OutcomeBadge outcome={outcome} />
      {day && <span className="text-xs text-text-tertiary">on {day}</span>}
    </div>
  );
}

/**
 * The outcome badge.
 *
 * `zero-found` is toned as a WARNING and labelled "Zero found", never
 * "Succeeded" and never green — a run that walked a profile cleanly and
 * imported nothing is recorded as SUCCEEDED by the runner, and rendering that
 * status verbatim would put a green tick against the case an operator most
 * needs to look at. `describeScholarOutcome` makes that decision; this only
 * paints it.
 */
export function OutcomeBadge({ outcome }: { outcome: ScholarOutcome }) {
  return (
    <Badge tone={outcome.tone} size="sm" className="whitespace-nowrap" data-outcome={outcome.kind}>
      {outcome.label}
    </Badge>
  );
}

// ── The confirmation panel ─────────────────────────────────────────────────

/**
 * The dialog's body, separated from the Dialog itself so it can be rendered —
 * and asserted — without a DOM. Radix portals its content, and
 * `react-dom/server` cannot render a portal, so a test that drove the real
 * dialog could not run in this workspace at all (no jsdom, no
 * @testing-library).
 *
 * Every number here comes from `preview`, which the SERVER produced. Nothing
 * is derived from the selection in the browser: a locally-computed credit
 * figure would be a second opinion about money and could drift from the one
 * ScrapingBee actually bills.
 */
export function BulkConfirmPanel({
  preview,
  pricing,
  error,
  gate,
  submitting,
  onConfirm,
  onCancel,
}: {
  preview: ScholarBulkPreview | null;
  pricing: boolean;
  error: string | null;
  gate: { canEnqueue: boolean; reason?: string };
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-6" data-testid="scholar-bulk-confirm">
      {pricing && (
        <div aria-live="polite">
          <p className="text-xs text-text-tertiary">Working out what this would cost…</p>
          <Skeleton className="mt-4 h-12 w-full" />
        </div>
      )}

      {!pricing && error && (
        <p
          className="rounded-md border border-[oklch(var(--color-danger-default)/0.3)] bg-danger-subtle px-6 py-4 text-xs leading-relaxed text-danger"
          role="alert"
          data-testid="scholar-preview-error"
        >
          {error}
        </p>
      )}

      {!pricing && preview && (
        <div className="flex flex-col gap-6">
          {/* The headline figure, on its own line, with its unit spelled out.
              A bare number beside the target count would read as one token. */}
          <div className="rounded-lg border border-default bg-surface-2 p-6">
            <div className="text-xs text-text-tertiary">Estimated cost</div>
            <div
              className="mt-2 font-tabular text-3xl font-semibold text-text-primary"
              data-testid="scholar-estimated-credits"
            >
              {preview.estimatedCredits}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-secondary">
              ScrapingBee credits, at least. A profile longer than one page costs more, and
              this cannot know how many pages it runs to without fetching it. Someone with no
              linked profile is searched for by name first, which is the single most expensive
              call here and is spent even when it finds nobody.
            </p>
          </div>

          <dl className="flex flex-col gap-3 text-sm">
            <PlanLine
              label="People in this run"
              value={preview.targetCount}
              note={
                preview.duplicatesDropped > 0
                  ? `${preview.duplicatesDropped} duplicate selections were collapsed.`
                  : null
              }
            />
            {/* Still the three gates, in the order the runner applies them:
                resolution, then quota, then binding. A person stopped by an
                earlier gate is counted there and nowhere else, so these four
                lines add up to the target count.

                What changed on 2026-09-09 is what the BINDING gate means. It
                used to be the cheapest outcome on this list — a refusal that
                spent nothing — and it is now the dearest, because the run
                searches instead of refusing. The two lines below are ordered
                and worded so an operator reads that: the quota line is the only
                free one left. */}
            <PlanLine
              label="Linked, ready to read"
              value={preview.chargeableCount}
              note="A linked Scholar profile and outside the 30-day window. These go straight to the profile — a page each, and the cheapest thing in this run."
            />
            <PlanLine
              label="Already fetched this month"
              value={preview.quotaBlockedCount}
              note={
                preview.quotaBlockedCount > 0
                  ? 'A profile is linked, but the record was refreshed inside the last 30 days, so the run stops at the quota gate before reaching Google. This is the only line here that costs nothing.'
                  : null
              }
            />
            <PlanLine
              label="No profile linked — searched by name"
              value={preview.unboundCount}
              note={
                preview.unboundCount > 0
                  ? 'Each is searched for on Google Scholar by their English staff name before anything can be read. That search costs five times a profile page and is billed whether or not it finds anyone, so these are the largest part of the estimate above. A profile it finds is linked to their record and read; if none is, the prompt to link one appears on their own profile page.'
                  : null
              }
            />
            <PlanLine
              label="Will not be sent at all"
              value={preview.unresolvableCount}
              note={
                preview.unresolvableCount > 0
                  ? 'No single staff record matches these accounts, so there is nothing to attach papers to.'
                  : null
              }
            />
          </dl>

          <p className="text-xs leading-relaxed text-text-tertiary">
            Scholar papers are added to each person&rsquo;s research record. Nothing already on
            the record is removed, and citation counts are only ever raised.
          </p>
        </div>
      )}

      {!gate.canEnqueue && gate.reason && !pricing && (
        <p className="mt-6 text-xs leading-relaxed text-warning" data-testid="scholar-gate-reason">
          {gate.reason}
        </p>
      )}

      <div className="mt-8 flex items-center gap-6">
        <Button
          variant="primary"
          size="sm"
          shape="square"
          disabled={!gate.canEnqueue}
          onClick={onConfirm}
          data-testid="scholar-bulk-confirm-button"
        >
          {sendLabel(preview, submitting)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          shape="square"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * What the send button says.
 *
 * It carries the figure, because the button is the last thing read before the
 * money goes. It still has a zero branch, but the case that reaches it changed
 * on 2026-09-09: a free run is now one where every target is stopped by the
 * QUOTA — already refreshed inside the window — or has no staff record at all.
 * An all-unlinked batch used to land here and is now the dearest shape a run
 * can have. Getting that branch wrong in either direction is the same failure:
 * a button that threatens a bill nobody will receive teaches an operator to
 * ignore it, and one that promises a free run before billing 9,000 credits
 * teaches them not to trust it at all.
 */
function sendLabel(preview: ScholarBulkPreview | null, submitting: boolean): string {
  if (submitting) return 'Sending…';
  if (!preview) return 'Send';
  if (preview.estimatedCredits === 0) return 'Send — nothing will be spent';
  return `Send — at least ${preview.estimatedCredits} credits`;
}

function PlanLine({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string | null;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-8">
        <dt className="text-text-secondary">{label}</dt>
        <dd className="font-tabular text-text-primary">{value}</dd>
      </div>
      {note && <p className="mt-1 max-w-[34rem] text-xs leading-relaxed text-text-tertiary">{note}</p>}
    </div>
  );
}

// ── The run ledger ─────────────────────────────────────────────────────────

export function RunLedger({
  ledger,
  error,
  watching,
  timedOut,
  lastOutcome,
}: {
  ledger: ScholarLedger | null;
  error: string | null;
  watching: boolean;
  timedOut: boolean;
  lastOutcome: ScholarBulkOutcome | null;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-medium text-text-primary">Run ledger</h2>
        <p className="mt-2 max-w-[52rem] text-xs leading-relaxed text-text-tertiary">
          Every fetch attempt, newest first — self-service and administrator alike. A run that
          completed but found no publications reads as <em>Zero found</em>, not as a success:
          it spent credits and imported nothing.
        </p>
      </div>

      {lastOutcome && (
        <div
          className="rounded-lg border border-default bg-surface-2 p-6 text-xs leading-relaxed text-text-secondary"
          data-testid="scholar-last-outcome"
        >
          <p>
            The last batch queued {lastOutcome.enqueuedCount} of {lastOutcome.targetCount}{' '}
            people.
            {lastOutcome.skippedCount > 0 && (
              <>
                {' '}
                {lastOutcome.skippedCount === 1
                  ? '1 was not sent — no staff record matched them.'
                  : `${lastOutcome.skippedCount} were not sent — no staff record matched them.`}
              </>
            )}
          </p>
          {/* The API's own figure, rendered verbatim. It is the number the
              service priced the run at after de-duplicating and dropping the
              unsendable, and it is what the invoice will reflect. */}
          <p className="mt-2">
            It priced the run at{' '}
            <span className="font-tabular text-text-primary" data-testid="scholar-outcome-credits">
              {lastOutcome.estimatedCredits}
            </span>{' '}
            ScrapingBee credits, at least.
          </p>
        </div>
      )}

      {watching && (
        <div aria-live="polite">
          <p className="text-xs text-text-tertiary">
            Waiting for the queued fetches to land — this panel checks every few seconds.
          </p>
          <Skeleton className="mt-4 h-6 w-full max-w-[26rem]" />
        </div>
      )}

      {timedOut && (
        <p className="text-xs leading-relaxed text-warning" role="status">
          Still running after three minutes, so this panel stopped checking. Nothing was
          cancelled — reload the page later to see where the batch got to.
        </p>
      )}

      {error && (
        <p className="text-xs leading-relaxed text-danger" role="alert">
          The run ledger could not be read, so the outcomes below may be missing or stale.{' '}
          {error}
        </p>
      )}

      <Card padding="none">
        {!ledger || ledger.runs.length === 0 ? (
          <div className="p-12 text-center text-sm text-text-tertiary">
            No Scholar fetch has been run yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="scholar-run-ledger">
              <thead className="border-b border-subtle text-left text-xs text-text-tertiary">
                <tr>
                  <th className="px-6 py-4 font-medium">Person</th>
                  <th className="px-6 py-4 font-medium">Outcome</th>
                  <th className="px-6 py-4 font-medium">What it did</th>
                  <th className="px-6 py-4 font-medium">Started</th>
                  <th className="px-6 py-4 text-right font-medium">Credits</th>
                </tr>
              </thead>
              <tbody>
                {ledger.runs.map((run) => (
                  <LedgerRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

function LedgerRow({ run }: { run: ScholarLedgerRun }) {
  const outcome = describeScholarOutcome(run);
  return (
    <tr className="border-b border-subtle last:border-b-0 align-top">
      <td className="px-6 py-4">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-text-primary">{run.userName ?? '(no name)'}</span>
          {run.userEmail && (
            <span className="truncate text-xs text-text-tertiary">{run.userEmail}</span>
          )}
          <span className="mt-1 text-xs text-text-tertiary">{triggerLabel(run.trigger)}</span>
        </div>
      </td>
      <td className="px-6 py-4">
        <OutcomeBadge outcome={outcome} />
      </td>
      <td className="max-w-[30rem] px-6 py-4 text-xs leading-relaxed text-text-secondary">
        {outcome.detail}
      </td>
      <td className="px-6 py-4 text-xs text-text-tertiary">
        {formatScholarDayTime(run.startedAt) ?? '—'}
      </td>
      <td className="px-6 py-4 text-right font-tabular text-text-secondary">{run.creditsUsed}</td>
    </tr>
  );
}

function triggerLabel(trigger: ScholarLedgerRun['trigger']): string {
  if (trigger === 'SELF') return 'Started by the person themselves';
  if (trigger === 'ADMIN') return 'Started by an administrator';
  return 'Part of a bulk run';
}
