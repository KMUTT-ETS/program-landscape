'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  EdgeGlow,
  EmptyState,
  Segmented,
  SegmentedContent,
  SegmentedList,
  SegmentedTrigger,
} from '@kku/ui';
import {
  Brain,
  CheckCircle2,
  ExternalLink,
  FileText,
  Layers,
  Play,
  RefreshCw,
  Upload,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PipelineStats {
  programsTotal: number;
  withPdf: number;
  missingPdf: number;
  digested: number;
  needDigest: number;
  pendingReview: number;
  approved: number;
}

interface ProgramRow {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  faculty: { id: string; nameEn: string; nameTh: string };
  documents?: Array<{
    pdfDocument: { id: string; originalFilename: string; pageCount: number };
  }>;
  extraction?: {
    id: string;
    confidence: number;
    createdAt: string;
    reviewStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
    reviewedAt: string | null;
    methodVersion: string;
  };
}

type Bucket = 'missing-pdf' | 'need-digest' | 'pending-review' | 'approved';

const LEVEL_LABEL: Record<ProgramRow['level'], string> = {
  BACHELOR: 'Bachelor',
  MASTER: 'Master',
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Grad. Diploma',
};

// ─── Main page ──────────────────────────────────────────────────────────────

export function PipelineClient({ initialStats }: { initialStats: PipelineStats }) {
  const [stats, setStats] = React.useState<PipelineStats>(initialStats);
  const [tab, setTab] = React.useState<Bucket>(
    initialStats.pendingReview > 0
      ? 'pending-review'
      : initialStats.needDigest > 0
        ? 'need-digest'
        : initialStats.missingPdf > 0
          ? 'missing-pdf'
          : 'approved',
  );
  const [refreshing, setRefreshing] = React.useState(false);

  const refreshStats = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin-programs/pipeline/stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setStats(j.data as PipelineStats);
    } catch (err) {
      toast.error(`Stats refresh failed: ${(err as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* KPI strip is owned by the parent page (apps/web/app/admin/
          programs/page.tsx) since it applies to both the list and
          pipeline views. PipelineClient only renders the bucket
          control here. */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          {stats.approved.toLocaleString()} of {stats.programsTotal.toLocaleString()} programs have an
          approved digest ({stats.programsTotal > 0
            ? Math.round((stats.approved / stats.programsTotal) * 100)
            : 0}
          %).
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={refreshStats}
          disabled={refreshing}
          aria-label="Refresh stats"
        >
          <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
          Refresh
        </Button>
      </div>

      <Segmented value={tab} onValueChange={(v) => setTab(v as Bucket)} className="w-full">
        <SegmentedList>
          <SegmentedTrigger value="missing-pdf">
            Missing PDF
            {stats.missingPdf > 0 && (
              <Badge tone="neutral" className="ml-1.5">
                {stats.missingPdf}
              </Badge>
            )}
          </SegmentedTrigger>
          <SegmentedTrigger value="need-digest">
            Need digest
            {stats.needDigest > 0 && (
              <Badge tone="warning" className="ml-1.5">
                {stats.needDigest}
              </Badge>
            )}
          </SegmentedTrigger>
          <SegmentedTrigger value="pending-review">
            Pending review
            {stats.pendingReview > 0 && (
              <Badge tone="warning" className="ml-1.5">
                {stats.pendingReview}
              </Badge>
            )}
          </SegmentedTrigger>
          <SegmentedTrigger value="approved">
            Approved
            <Badge tone="success" className="ml-1.5">
              {stats.approved}
            </Badge>
          </SegmentedTrigger>
        </SegmentedList>

        <SegmentedContent value="missing-pdf">
          <BucketList bucket="missing-pdf" onChange={refreshStats} />
        </SegmentedContent>
        <SegmentedContent value="need-digest">
          <BucketList bucket="need-digest" onChange={refreshStats} />
        </SegmentedContent>
        <SegmentedContent value="pending-review">
          <BucketList bucket="pending-review" onChange={refreshStats} />
        </SegmentedContent>
        <SegmentedContent value="approved">
          <BucketList bucket="approved" onChange={refreshStats} />
        </SegmentedContent>
      </Segmented>
    </div>
  );
}

// ─── Bucket list ────────────────────────────────────────────────────────────

function BucketList({ bucket, onChange }: { bucket: Bucket; onChange: () => void }) {
  const [items, setItems] = React.useState<ProgramRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState({ done: 0, total: 0, failed: 0 });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin-programs/pipeline/bucket/${bucket}?limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const data = j.data as { items: ProgramRow[]; total: number };
      setItems(data.items);
      setTotal(data.total);
      setSelected(new Set());
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [bucket]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh the bucket while a bulk-digest run is in progress.
  // Lives in a useEffect (not inside the click handler) so its cleanup
  // runs on unmount or when bulkRunning flips back to false — preventing
  // the runaway-interval class of bug that previously kept hammering the
  // API after the user navigated away or re-triggered bulk.
  React.useEffect(() => {
    if (!bulkRunning) return;
    const start = Date.now();
    const intervalId = setInterval(() => {
      if (Date.now() - start > 5 * 60 * 1000) {
        setBulkRunning(false);
        return;
      }
      void load();
      onChange();
    }, 10_000);
    return () => clearInterval(intervalId);
  }, [bulkRunning, load, onChange]);

  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(items.map((i) => (i.extraction ? i.extraction.id : i.id))));
    else setSelected(new Set());
  };
  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  if (loading) {
    return (
      <Card padding="sm" tone="quiet" className="mt-4">
        <div className="py-8 text-center text-sm text-text-tertiary">Loading…</div>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card padding="sm" tone="quiet" className="mt-4">
        <EmptyState
          title={emptyTitleFor(bucket)}
          description={emptyHintFor(bucket)}
        />
      </Card>
    );
  }

  // ── Bulk action handlers ──────────────────────────────────────────────────

  const runBulkDigest = async () => {
    if (!confirm(`Enqueue digest for ${total} eligible programs? Each takes ~30-60s and ~$0.04 in LLM cost.`)) return;
    try {
      const res = await fetch('/api/admin-programs/pipeline/run-digest-bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      const enqueued = (j.data as { enqueued: number }).enqueued;
      toast.success(`Enqueued ${enqueued} digest jobs. Watch the pending-review bucket — programs land there as workers complete.`);
      onChange();
      // Trigger the polling effect below (bulkRunning=true). The interval
      // lives in a useEffect with a proper cleanup, so navigating away
      // OR re-triggering bulk doesn't leak parallel intervals.
      setBulkRunning(true);
    } catch (err) {
      toast.error(`Bulk digest enqueue failed: ${(err as Error).message}`);
      setBulkRunning(false);
    }
  };

  const runSingleDigest = async (programId: string) => {
    try {
      const res = await fetch(`/api/admin-programs/${programId}/run-digest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success('Digest enqueued. Worker will pick it up in seconds; check back in ~1 min.');
      onChange();
    } catch (err) {
      toast.error(`Digest enqueue failed: ${(err as Error).message}`);
    }
  };

  // Single-program full-pipeline run — all 6 phases on one program.
  // Useful when retrying a single program after fixing its PDF or
  // peer set without re-paying the bulk run for the other 296.
  const runSinglePipeline = async (programId: string, programCode: string) => {
    if (
      !confirm(
        `Run the full 6-phase pipeline on ${programCode}?\n\n` +
          'Takes ~5-10 min and ~$0.50 in LLM cost. Phases run in the background; ' +
          'check back on this page in 10 minutes.',
      )
    )
      return;
    try {
      const res = await fetch(`/api/admin-programs/${programId}/run-pipeline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      const { jobId } = j.data as { jobId: string };
      toast.success(`Pipeline enqueued for ${programCode} (job ${jobId.slice(0, 8)})`);
      onChange();
    } catch (err) {
      toast.error(`Pipeline enqueue failed: ${(err as Error).message}`);
    }
  };

  const approveSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      toast.warning('Select at least one digest to approve.');
      return;
    }
    if (!confirm(`Approve + materialise ${ids.length} digest${ids.length === 1 ? '' : 's'}? This writes ProgramSkill rows and stages PROPOSED_SKILL extractions.`)) return;

    setBulkRunning(true);
    setBulkProgress({ done: 0, total: ids.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/ai/extractions/${id}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reviewNotes: 'Approved via /admin/programs/pipeline.' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        done++;
      } catch (err) {
        failed++;
        // Continue — don't abort the loop on one failure.
      }
      setBulkProgress({ done: done + failed, total: ids.length, failed });
    }
    if (failed === 0) toast.success(`Approved ${done} digest${done === 1 ? '' : 's'}.`);
    else toast.warning(`Approved ${done} of ${ids.length}; ${failed} failed.`);
    setBulkRunning(false);
    await load();
    onChange();
  };

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.extraction ? i.extraction.id : i.id));

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-text-secondary">
          Showing <span className="font-tabular text-text-primary">{items.length}</span> of{' '}
          <span className="font-tabular text-text-primary">{total}</span>{' '}
          {total === 1 ? 'program' : 'programs'}
        </div>
        <div className="flex items-center gap-2">
          {bucket === 'need-digest' && (
            <EdgeGlow inline>
              <Button
                variant="primary"
                onClick={runBulkDigest}
                disabled={bulkRunning || total === 0}
              >
                <Play className="h-4 w-4" aria-hidden />
                Run digest on all {total} ({(total * 0.04).toFixed(2)} USD est.)
              </Button>
            </EdgeGlow>
          )}
          {bucket === 'pending-review' && (
            <EdgeGlow inline>
              <Button
                variant="primary"
                onClick={approveSelected}
                disabled={bulkRunning || selected.size === 0}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Approve selected ({selected.size})
              </Button>
            </EdgeGlow>
          )}
        </div>
      </div>

      {bulkRunning && bulkProgress.total > 0 && (
        <Card padding="sm" tone="quiet">
          <div className="flex items-center gap-3">
            <div className="font-tabular text-sm text-text-secondary">
              {bulkProgress.done} / {bulkProgress.total}
              {bulkProgress.failed > 0 && (
                <span className="ml-2 text-data-negative">({bulkProgress.failed} failed)</span>
              )}
            </div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-accent-default transition-[width]"
                style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </Card>
      )}

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
              <tr>
                {bucket === 'pending-review' && (
                  <th className="px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                      aria-label="Select all"
                    />
                  </th>
                )}
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Program</th>
                <th className="px-3 py-2 text-left">Faculty</th>
                <th className="px-3 py-2 text-left">Level</th>
                <th className="px-3 py-2 text-left">{columnRightLabelFor(bucket)}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {items.map((p) => {
                const rowKey = p.extraction ? p.extraction.id : p.id;
                const isSelected = selected.has(rowKey);
                return (
                  <tr key={p.id} className="hover:bg-surface-1">
                    {bucket === 'pending-review' && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleOne(rowKey, e.target.checked)}
                          aria-label={`Select ${p.code}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 font-tabular font-medium text-text-primary">{p.code}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <Link
                          href={`/admin/programs/${p.id}`}
                          className="font-medium text-text-primary hover:underline"
                        >
                          {p.nameEn || p.nameTh}
                        </Link>
                        {p.nameEn && p.nameTh && (
                          <span className="text-xs text-text-secondary">{p.nameTh}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{p.faculty.nameEn}</td>
                    <td className="px-3 py-2">{LEVEL_LABEL[p.level]}</td>
                    <td className="px-3 py-2">
                      {bucket === 'need-digest' && p.documents?.[0] && (
                        <span className="inline-flex items-center gap-1 text-xs text-text-tertiary">
                          <FileText className="h-3 w-3" aria-hidden />
                          {p.documents[0].pdfDocument.pageCount} pages
                        </span>
                      )}
                      {p.extraction && (
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              p.extraction.reviewStatus === 'APPROVED' ||
                              p.extraction.reviewStatus === 'AUTO_APPROVED'
                                ? 'success'
                                : p.extraction.reviewStatus === 'PENDING_REVIEW'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {p.extraction.reviewStatus.toLowerCase().replace('_', ' ')}
                          </Badge>
                          <span className="font-tabular text-xs text-text-tertiary">
                            {(p.extraction.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {bucket === 'missing-pdf' && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/programs/${p.id}?tab=files`}>
                              <Upload className="h-4 w-4" aria-hidden />
                              Upload
                            </Link>
                          </Button>
                        )}
                        {bucket === 'need-digest' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => runSingleDigest(p.id)}
                            disabled={bulkRunning}
                          >
                            <Brain className="h-4 w-4" aria-hidden />
                            Run digest
                          </Button>
                        )}
                        {/* Full 6-phase pipeline run for this single program.
                            Available on every bucket — even already-approved
                            programs may need a re-run after a peer-set
                            update or methodology bump. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => runSinglePipeline(p.id, p.code)}
                          disabled={bulkRunning}
                          title="Run all 6 pipeline phases on this program"
                        >
                          <Layers className="h-4 w-4" aria-hidden />
                          Run pipeline
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/programs/${p.id}`}>
                            <ExternalLink className="h-4 w-4" aria-hidden />
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function columnRightLabelFor(bucket: Bucket): string {
  switch (bucket) {
    case 'missing-pdf':
      return '';
    case 'need-digest':
      return 'PDF';
    case 'pending-review':
    case 'approved':
      return 'Digest';
  }
}

function emptyTitleFor(bucket: Bucket): string {
  switch (bucket) {
    case 'missing-pdf':
      return 'All programs have a curriculum PDF.';
    case 'need-digest':
      return 'Nothing to digest.';
    case 'pending-review':
      return 'Inbox is clear.';
    case 'approved':
      return 'No approved digests yet.';
  }
}

function emptyHintFor(bucket: Bucket): string {
  switch (bucket) {
    case 'missing-pdf':
      return '69 missing slots can be filled by uploading PDFs on the program detail page.';
    case 'need-digest':
      return 'Every program with a CURRENT_CURRICULUM PDF has been queued or processed.';
    case 'pending-review':
      return 'Every PROGRAM_DIGEST extraction has been approved (or rejected).';
    case 'approved':
      return 'Run digest + approve to populate this bucket.';
  }
}
