'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Segmented,
  SegmentedContent,
  SegmentedList,
  SegmentedTrigger,
} from '@kku/ui';
import {
  AlertTriangle,
  Brush,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileSearch,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';

// ─── Types (mirror apps/api/src/admin/queues.service.ts) ───────────────────

type JobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'paused';

interface QueueSummary {
  name: string;
  label: string;
  description: string;
  paused: boolean;
  counts: Record<JobState, number>;
}

interface QueueJob {
  id: string;
  name: string;
  state: JobState | 'unknown';
  createdAt: number | null;
  processedAt: number | null;
  finishedAt: number | null;
  attempts: { made: number; max: number };
  data: unknown;
  returnvalue: unknown;
  failedReason: string | null;
  stacktraceTail: string | null;
}

// Phase 6 additions
interface ReviewCounts {
  aiExtractions: number;
  pdfExtractions: number;
}

interface ActivityEntry {
  queueName: string;
  queueLabel: string;
  id: string;
  jobName: string;
  state: 'completed' | 'failed';
  finishedAt: number | null;
  durationMs: number | null;
  failedReason: string | null;
}

interface ThroughputEntry {
  last5min: number;
  last15min: number;
  last60min: number;
  avgDurationMs: number | null;
}
type ThroughputMap = Record<string, ThroughputEntry>;

const STATE_TABS: Array<{ id: JobState; label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = [
  { id: 'active', label: 'Active', tone: 'warning' },
  { id: 'waiting', label: 'Waiting', tone: 'neutral' },
  { id: 'delayed', label: 'Delayed', tone: 'neutral' },
  { id: 'failed', label: 'Failed', tone: 'danger' },
  { id: 'completed', label: 'Completed', tone: 'success' },
];

// ─── Top-level client ──────────────────────────────────────────────────────

export function QueuesClient({ canManage }: { canManage: boolean }) {
  const [summaries, setSummaries] = React.useState<QueueSummary[] | null>(null);
  const [activeQueue, setActiveQueue] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  // Phase 6 — realtime side-channels. All three poll alongside the
  // summaries tick; failures don't kill the main view (just stay stale).
  const [reviewCounts, setReviewCounts] = React.useState<ReviewCounts | null>(null);
  const [activity, setActivity] = React.useState<ActivityEntry[]>([]);
  const [throughput, setThroughput] = React.useState<ThroughputMap>({});

  const loadRealtime = React.useCallback(async () => {
    // Fetch the three side-channel endpoints in parallel. Each is
    // best-effort: a failure leaves the previous state visible.
    const [rcRes, acRes, tpRes] = await Promise.allSettled([
      fetch('/api/admin-queues/review-counts').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/admin-queues/activity?limit=30').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/admin-queues/throughput').then((r) => (r.ok ? r.json() : null)),
    ]);
    if (rcRes.status === 'fulfilled' && rcRes.value?.data) {
      setReviewCounts(rcRes.value.data as ReviewCounts);
    }
    if (acRes.status === 'fulfilled' && acRes.value?.data) {
      setActivity(acRes.value.data as ActivityEntry[]);
    }
    if (tpRes.status === 'fulfilled' && tpRes.value?.data) {
      setThroughput(tpRes.value.data as ThroughputMap);
    }
  }, []);

  const loadSummaries = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin-queues');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const data = j.data as QueueSummary[];
      setSummaries(data);
      setActiveQueue((cur) => cur ?? data[0]?.name ?? null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
    void loadRealtime();
  }, [loadRealtime]);

  React.useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  // Live refresh every 5s while the page is mounted.
  React.useEffect(() => {
    const id = setInterval(() => void loadSummaries(), 5000);
    return () => clearInterval(id);
  }, [loadSummaries]);

  if (error && !summaries) {
    return (
      <div className="p-8">
        <EmptyState
          title="Couldn't load queues"
          description={error}
          action={
            <Button variant="outline" onClick={() => void loadSummaries()}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (!summaries || !activeQueue) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading queues…
      </div>
    );
  }

  const current = summaries.find((s) => s.name === activeQueue) ?? summaries[0];
  if (!current) {
    // summaries was non-empty when we checked above (activeQueue is set
    // only after summaries[0] exists); kept here for type narrowing.
    return null;
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-5">
      {/* Top KPI row — one tile per queue + the human-review pseudo-tile */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaries.map((s) => (
          <QueueTile
            key={s.name}
            summary={s}
            active={s.name === activeQueue}
            onClick={() => setActiveQueue(s.name)}
            throughput={throughput[s.name]}
          />
        ))}
      </div>

      {reviewCounts ? <ReviewQueueRow counts={reviewCounts} /> : null}

      {/* Toolbar above the bucket tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-text-primary">{current.label}</span>
          {current.paused && (
            <Badge tone="warning">
              <Pause className="h-3 w-3" aria-hidden />
              Paused
            </Badge>
          )}
          <span className="text-text-tertiary">— {current.description}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadSummaries()}
            disabled={refreshing}
            aria-label="Refresh now"
          >
            <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
            Refresh
          </Button>
          {canManage && (
            <QueueAdminMenu
              queue={current}
              onChanged={() => void loadSummaries()}
            />
          )}
        </div>
      </div>

      <QueueDetail
        key={current.name}
        queue={current}
        canManage={canManage}
        onChanged={() => void loadSummaries()}
      />

      <ActivityStream entries={activity} />
    </div>
  );
}

// ─── Review-queue row (Phase 6) ────────────────────────────────────────────
// Surfaces the AI-extraction + PDF-extraction PENDING_REVIEW counts here
// per the IA-restructure decision (Phase 1, 2026-05-12) that folded the
// human-review queues into the BullMQ console rather than keeping them
// as separate admin tiles.

function ReviewQueueRow({ counts }: { counts: ReviewCounts }) {
  const total = counts.aiExtractions + counts.pdfExtractions;
  if (total === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-1 p-3 text-xs text-text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
          No human review pending — every AI extraction is above the auto-approve threshold.
        </span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <ReviewTile
        href="/admin/extraction-review"
        icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}
        label="AI extractions awaiting review"
        count={counts.aiExtractions}
      />
      <ReviewTile
        href="/admin/pdf-review"
        icon={<FileSearch className="h-4 w-4" aria-hidden />}
        label="PDF extractions awaiting review"
        count={counts.pdfExtractions}
      />
    </div>
  );
}

function ReviewTile({
  href,
  icon,
  label,
  count,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  const tone =
    count === 0
      ? 'neutral'
      : count > 50
        ? 'warning'
        : count > 0
          ? 'info'
          : 'neutral';
  return (
    <Link
      href={href}
      className="group flex items-center justify-between rounded-xl border border-border-subtle bg-surface-1 px-4 py-3 transition-colors hover:border-accent/30 hover:bg-accent-subtle/30"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-text-secondary group-hover:bg-accent-subtle group-hover:text-accent">
          {icon}
        </span>
        <div>
          <div className="text-sm font-medium text-text-primary">{label}</div>
          <div className="text-[11px] text-text-tertiary">
            click to open the review surface
          </div>
        </div>
      </div>
      <Badge tone={tone}>{count.toLocaleString()} pending</Badge>
    </Link>
  );
}

// ─── Activity stream (Phase 6) ─────────────────────────────────────────────
// Last ~30 completed + failed jobs across every queue, merged by
// finishedAt desc. Drives the operator's "what just happened?" view —
// the existing per-state tabs require picking a queue first; this one
// is read at-a-glance.

function ActivityStream({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <Card padding="sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <span className="text-[11px] text-text-tertiary">
          last 30 completed + failed jobs · refreshes every 5s
        </span>
      </div>
      <div className="-mx-3 max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-1">
            <tr className="text-left uppercase tracking-wide text-text-tertiary">
              <th className="px-3 py-1.5 font-medium">When</th>
              <th className="px-3 py-1.5 font-medium">Queue</th>
              <th className="px-3 py-1.5 font-medium">Job</th>
              <th className="px-3 py-1.5 text-right font-medium">Duration</th>
              <th className="px-3 py-1.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.queueName}:${e.id}`} className="border-t border-border-default">
                <td className="px-3 py-2 text-text-tertiary">
                  {e.finishedAt ? <RelativeTime ms={e.finishedAt} /> : '—'}
                </td>
                <td className="px-3 py-2 text-text-secondary">{e.queueLabel}</td>
                <td className="px-3 py-2 font-mono text-[11px]">{e.jobName}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {e.durationMs != null ? formatDuration(e.durationMs) : '—'}
                </td>
                <td className="px-3 py-2">
                  {e.state === 'completed' ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> ok
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-danger"
                      title={e.failedReason ?? undefined}
                    >
                      <XCircle className="h-3 w-3" aria-hidden /> failed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RelativeTime({ ms }: { ms: number }) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return <>{Math.max(0, Math.floor(diff / 1000))}s ago</>;
  if (diff < 60 * 60_000) return <>{Math.floor(diff / 60_000)}m ago</>;
  if (diff < 24 * 60 * 60_000) return <>{Math.floor(diff / (60 * 60_000))}h ago</>;
  return <>{new Date(ms).toLocaleDateString()}</>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60 * 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / (60 * 60_000)).toFixed(1)}h`;
}

// ─── KPI tile per queue ────────────────────────────────────────────────────

function QueueTile({
  summary,
  active,
  onClick,
  throughput,
}: {
  summary: QueueSummary;
  active: boolean;
  onClick: () => void;
  throughput?: ThroughputEntry;
}) {
  const danger = summary.counts.failed > 0;
  const live = summary.counts.active > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'group relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ' +
        (active
          ? 'border-accent/60 bg-accent-subtle/40 shadow-sm'
          : 'border-border-subtle bg-surface-1 hover:border-accent/30 hover:bg-accent-subtle/20')
      }
    >
      {/* Live pulse — fires only when a worker is currently processing
          a job in this queue. The 5s polling cadence keeps it accurate
          enough for human-eye feedback. */}
      {live ? (
        <span
          aria-hidden
          className="absolute right-3 top-3 flex h-2.5 w-2.5"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
        </span>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-text-primary">{summary.label}</span>
        <span className="font-tabular text-[11px] uppercase tracking-wide text-text-tertiary">
          {summary.name}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="active" value={summary.counts.active} tone="warning" />
        <Stat label="waiting" value={summary.counts.waiting + summary.counts.delayed} tone="neutral" />
        <Stat label="failed" value={summary.counts.failed} tone={danger ? 'danger' : 'neutral'} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-tertiary">
        <span>{summary.counts.completed.toLocaleString()} completed</span>
        {summary.paused && (
          <Badge tone="warning" size="sm">
            <Pause className="h-3 w-3" aria-hidden />
            paused
          </Badge>
        )}
      </div>
      {throughput ? (
        <div className="-mb-1 flex items-center justify-between border-t border-border-subtle pt-2 text-[10px] text-text-tertiary">
          <span className="uppercase tracking-wider">throughput</span>
          <span className="font-tabular">
            <span className="text-text-secondary">{throughput.last5min}</span>
            <span className="text-text-tertiary/70">/5m · </span>
            <span className="text-text-secondary">{throughput.last15min}</span>
            <span className="text-text-tertiary/70">/15m · </span>
            <span className="text-text-secondary">{throughput.last60min}</span>
            <span className="text-text-tertiary/70">/1h</span>
            {throughput.avgDurationMs != null ? (
              <>
                <span className="text-text-tertiary/70"> · avg </span>
                <span className="text-text-secondary">{formatDuration(throughput.avgDurationMs)}</span>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'warning' | 'danger';
}) {
  const cls =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-text-primary';
  return (
    <div className="flex flex-col items-center justify-center gap-0.5">
      <span className={`font-tabular text-lg font-semibold ${cls}`}>{value.toLocaleString()}</span>
      <span className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</span>
    </div>
  );
}

// ─── Per-queue detail (state tabs + jobs table) ────────────────────────────

function QueueDetail({
  queue,
  canManage,
  onChanged,
}: {
  queue: QueueSummary;
  canManage: boolean;
  onChanged: () => void;
}) {
  // Pick the most informative tab to land on. Priority:
  //   1. active (job running RIGHT NOW — most operationally relevant;
  //      the operator likely just clicked Run-now and wants to see it)
  //   2. failed (triage queue — but historical, can wait a click)
  //   3. waiting/delayed (about to run)
  //   4. completed (recently finished — covers sub-second jobs that
  //      vanished before the page loaded)
  const [state, setState] = React.useState<JobState>(
    queue.counts.active > 0
      ? 'active'
      : queue.counts.failed > 0
        ? 'failed'
        : queue.counts.waiting + queue.counts.delayed > 0
          ? 'waiting'
          : queue.counts.completed > 0
            ? 'completed'
            : 'waiting',
  );

  return (
    <Segmented value={state} onValueChange={(v) => setState(v as JobState)}>
      <SegmentedList>
        {STATE_TABS.map((tab) => (
          <SegmentedTrigger key={tab.id} value={tab.id}>
            {tab.label}
            {queue.counts[tab.id] > 0 && (
              <Badge tone={tab.tone} className="ml-1.5">
                {queue.counts[tab.id]}
              </Badge>
            )}
          </SegmentedTrigger>
        ))}
      </SegmentedList>

      {STATE_TABS.map((tab) => (
        <SegmentedContent key={tab.id} value={tab.id}>
          <JobsTable
            queueName={queue.name}
            state={tab.id}
            canManage={canManage}
            onChanged={onChanged}
          />
        </SegmentedContent>
      ))}
    </Segmented>
  );
}

// ─── Jobs table ────────────────────────────────────────────────────────────

function JobsTable({
  queueName,
  state,
  canManage,
  onChanged,
}: {
  queueName: string;
  state: JobState;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [items, setItems] = React.useState<QueueJob[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin-queues/${encodeURIComponent(queueName)}/jobs?state=${state}&limit=50`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const data = j.data as { items: QueueJob[]; total: number };
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [queueName, state]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh active + waiting every 5s — those churn quickly.
  // Failed/completed every 15s. Pause when nothing's happening.
  React.useEffect(() => {
    const period = state === 'active' || state === 'waiting' ? 5000 : 15000;
    const id = setInterval(() => void load(), period);
    return () => clearInterval(id);
  }, [load, state]);

  if (loading && items.length === 0) {
    return (
      <div className="mt-4 flex items-center justify-center gap-2 p-8 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading jobs…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState title={`Nothing ${state}.`} description={emptyHintFor(state)} />
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="text-xs text-text-tertiary">
        Showing <span className="font-tabular text-text-primary">{items.length}</span> of{' '}
        <span className="font-tabular text-text-primary">{total.toLocaleString()}</span> {state}
        {state === 'active' || state === 'waiting' ? ' · live (5s)' : ' · live (15s)'}
      </div>
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Job</th>
                <th className="px-3 py-2 text-left">Payload</th>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Attempts</th>
                {canManage && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((job) => (
                <JobRow
                  key={job.id}
                  queueName={queueName}
                  job={job}
                  canManage={canManage}
                  onChanged={() => {
                    void load();
                    onChanged();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function JobRow({
  queueName,
  job,
  canManage,
  onChanged,
}: {
  queueName: string;
  job: QueueJob;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  const summary = summariseData(job.data);
  const time = primaryTimestamp(job);
  const tone =
    job.state === 'failed'
      ? 'danger'
      : job.state === 'active'
        ? 'warning'
        : job.state === 'completed'
          ? 'success'
          : 'neutral';

  const retry = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin-queues/${encodeURIComponent(queueName)}/jobs/${job.id}/retry`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success(`Retrying ${job.id}`);
      onChanged();
    } catch (err) {
      toast.error(`Retry failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove job ${job.id}? This is permanent.`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin-queues/${encodeURIComponent(queueName)}/jobs/${job.id}/remove`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success(`Removed ${job.id}`);
      onChanged();
    } catch (err) {
      toast.error(`Remove failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr className="hover:bg-surface-1">
        <td className="px-3 py-2 align-top">
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-left font-medium text-text-primary hover:text-accent-default"
            >
              {job.name}
            </button>
            <span className="font-tabular text-[11px] text-text-tertiary">{job.id}</span>
            <Badge tone={tone} size="sm" className="mt-1 self-start">
              {job.state}
            </Badge>
          </div>
        </td>
        <td className="px-3 py-2 align-top">
          <span className="line-clamp-2 text-xs text-text-secondary">{summary}</span>
          {job.failedReason && (
            <div className="mt-1 flex items-start gap-1 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="line-clamp-2">{job.failedReason}</span>
            </div>
          )}
        </td>
        <td className="px-3 py-2 align-top text-xs text-text-secondary">
          <Clock className="mr-1 inline-block h-3 w-3" aria-hidden />
          {time}
        </td>
        <td className="px-3 py-2 align-top">
          <span
            className={
              'font-tabular text-xs ' +
              (job.attempts.made >= job.attempts.max ? 'text-danger' : 'text-text-secondary')
            }
          >
            {job.attempts.made} / {job.attempts.max}
          </span>
        </td>
        {canManage && (
          <td className="px-3 py-2 align-top text-right">
            <div className="flex items-center justify-end gap-1">
              {job.state === 'failed' && (
                <Button variant="ghost" size="sm" onClick={retry} disabled={busy}>
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Retry
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={remove}
                disabled={busy || job.state === 'active'}
                title={job.state === 'active' ? "Can't remove an active job — wait for it to finish or fail" : undefined}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove
              </Button>
            </div>
          </td>
        )}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={canManage ? 5 : 4} className="bg-surface-2/40 px-3 py-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Section title="Payload">
                <pre className="max-h-48 overflow-auto rounded bg-surface-0 p-2 font-tabular text-[11px] leading-tight text-text-secondary">
                  {JSON.stringify(job.data, null, 2)}
                </pre>
              </Section>
              {job.returnvalue !== null && job.returnvalue !== undefined && (
                <Section title="Return value">
                  <pre className="max-h-48 overflow-auto rounded bg-surface-0 p-2 font-tabular text-[11px] leading-tight text-text-secondary">
                    {JSON.stringify(job.returnvalue, null, 2)}
                  </pre>
                </Section>
              )}
              {job.stacktraceTail && (
                <Section title="Stacktrace (last 4 lines)">
                  <pre className="max-h-48 overflow-auto rounded bg-surface-0 p-2 font-tabular text-[11px] leading-tight text-danger">
                    {job.stacktraceTail}
                  </pre>
                </Section>
              )}
              <Section title="Timestamps">
                <ul className="text-xs text-text-secondary">
                  <li>created: {fmt(job.createdAt)}</li>
                  <li>started: {fmt(job.processedAt)}</li>
                  <li>finished: {fmt(job.finishedAt)}</li>
                </ul>
              </Section>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-text-tertiary">{title}</span>
      {children}
    </div>
  );
}

// ─── Per-queue admin menu (clean / pause / resume) ─────────────────────────

function QueueAdminMenu({
  queue,
  onChanged,
}: {
  queue: QueueSummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  const post = async (subPath: string, body?: unknown, label?: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin-queues/${encodeURIComponent(queue.name)}/${subPath}`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success(`${label ?? subPath} on ${queue.label}`);
      onChanged();
    } catch (err) {
      toast.error(`${subPath} failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const cleanCompleted = () => {
    if (!confirm(`Remove completed jobs older than 24h from ${queue.label}?`)) return;
    void post('clean', { state: 'completed' }, 'Clean completed');
  };
  const cleanFailed = () => {
    if (!confirm(`Remove failed jobs older than 7d from ${queue.label}? Inspect first.`)) return;
    void post('clean', { state: 'failed' }, 'Clean failed');
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={cleanCompleted} disabled={busy}>
        <Brush className="h-4 w-4" aria-hidden />
        Clean completed
      </Button>
      {queue.counts.failed > 0 && (
        <Button variant="ghost" size="sm" onClick={cleanFailed} disabled={busy}>
          <Trash2 className="h-4 w-4" aria-hidden />
          Clean failed
        </Button>
      )}
      {queue.paused ? (
        <Button variant="ghost" size="sm" onClick={() => void post('resume', undefined, 'Resume')} disabled={busy}>
          <Play className="h-4 w-4" aria-hidden />
          Resume
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => void post('pause', undefined, 'Pause')} disabled={busy}>
          <Pause className="h-4 w-4" aria-hidden />
          Pause
        </Button>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function summariseData(data: unknown): string {
  if (data === null || data === undefined) return '—';
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return String(data);
  // Pull out the most-useful fields if they exist; fall back to JSON.
  const obj = data as Record<string, unknown>;
  const bits: string[] = [];
  if (obj.kind) bits.push(String(obj.kind));
  if (obj.entityId) bits.push(`entity=${String(obj.entityId).slice(0, 24)}`);
  if (obj.trigger) bits.push(`trigger=${String(obj.trigger)}`);
  if (obj.pipelinePhases) {
    const phases = obj.pipelinePhases as unknown[];
    bits.push(`phases=${phases.join(',')}`);
  }
  if (obj.dataSourceSlug) bits.push(String(obj.dataSourceSlug));
  if (obj.programId) bits.push(`program=${String(obj.programId).slice(0, 8)}`);
  if (bits.length === 0) {
    return JSON.stringify(data).slice(0, 120);
  }
  return bits.join(' · ');
}

function primaryTimestamp(job: QueueJob): string {
  if (job.state === 'failed' || job.state === 'completed') {
    return relative(job.finishedAt) + ' (finished)';
  }
  if (job.state === 'active') {
    return relative(job.processedAt) + ' (started)';
  }
  return relative(job.createdAt) + ' (queued)';
}

function relative(ms: number | null): string {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 5_000) return 'just now';
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 60 * 60_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 24 * 60 * 60_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

function fmt(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function emptyHintFor(state: JobState): string {
  switch (state) {
    case 'active':
      return 'No worker is processing anything right now. If you just enqueued, give it a couple seconds.';
    case 'waiting':
      return 'Nothing waiting to be picked up.';
    case 'delayed':
      return 'No deferred jobs.';
    case 'failed':
      return 'No failed jobs in the retention window.';
    case 'completed':
      return "No completed jobs retained — they're cleaned out after 24h by default.";
    case 'paused':
      return 'Queue is not paused.';
  }
}
