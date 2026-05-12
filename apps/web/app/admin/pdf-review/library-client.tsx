'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@kku/ui';
import {
  Archive,
  ArchiveRestore,
  Ban,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  deletePdfAction,
  reExtractPdfAction,
  setPdfLifecycleAction,
  type PdfLifecycleStatus,
} from '@/lib/actions/pdf-library';
import {
  FilterField,
  FilterRail,
  FilterSearch,
  FilterSelect,
} from '@/components/filter-rail';

// ─────────────────────────────────────────────────────────────────────────
// PDF library — filter rail + paginated table + per-row lifecycle menu.
// Server page reads /pdfs/library and hands the response here; the
// client component drives filters via URL query params so the result
// is shareable + bookmarkable.
// ─────────────────────────────────────────────────────────────────────────

export interface LibraryRow {
  id: string;
  originalFilename: string;
  sourceCategory: string;
  sourceOrg: string | null;
  pageCount: number;
  fileSize: number;
  uploadedAt: string;
  processingStatus: string;
  processingError: string | null;
  classificationConfidence: number | null;
  lifecycleStatus: PdfLifecycleStatus;
  lifecycleNote: string | null;
  lifecycleChangedAt: string | null;
  extractionCount: number;
  pendingReviewCount: number;
}

export interface LibraryResponse {
  rows: LibraryRow[];
  total: number;
}

interface SearchParams {
  category?: string;
  status?: string;
  lifecycle?: string;
  q?: string;
  page?: string;
}

const PAGE_SIZE = 25;

const CATEGORIES = [
  'POLICY',
  'REPORT',
  'PEER_PROGRAM',
  'SURVEY',
  'COMMITTEE_MINUTES',
  'JOB_POSTINGS_BATCH',
  'OTHER',
];

const PROCESSING_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];
const LIFECYCLES: PdfLifecycleStatus[] = ['ACTIVE', 'ARCHIVED', 'DEPRECATED'];

export function LibraryClient({
  initial,
  searchParams,
  canDelete,
}: {
  initial: LibraryResponse;
  searchParams: SearchParams;
  canDelete: boolean;
}) {
  const router = useRouter();
  const qp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'archive' | 'deprecate' | 'restore' | 'delete'; row: LibraryRow }
  >(null);
  const [confirmNote, setConfirmNote] = useState('');
  // Local search box state — only commits to URL on form submit (Enter),
  // matching the /admin/programs filter contract.
  const [q, setQ] = useState(searchParams.q ?? '');

  const page = parseInt(searchParams.page ?? '1', 10);
  const totalPages = Math.max(1, Math.ceil(initial.total / PAGE_SIZE));

  function pushFilter(updates: Record<string, string | null>) {
    const next = new URLSearchParams(qp?.toString() ?? '');
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (Object.keys(updates).some((k) => k !== 'page')) {
      next.delete('page');
    }
    router.push(`/admin/pdf-review?${next.toString()}`);
  }

  function actLifecycle(row: LibraryRow, status: PdfLifecycleStatus, note: string) {
    setError(null);
    startTransition(async () => {
      const res = await setPdfLifecycleAction(row.id, status, note || undefined);
      if (!res.ok) setError(res.message);
      else router.refresh();
      setConfirm(null);
      setConfirmNote('');
    });
  }

  function actDelete(row: LibraryRow) {
    setError(null);
    startTransition(async () => {
      const res = await deletePdfAction(row.id);
      if (!res.ok) setError(res.message);
      else router.refresh();
      setConfirm(null);
    });
  }

  function actReExtract(row: LibraryRow) {
    setError(null);
    startTransition(async () => {
      const res = await reExtractPdfAction(row.id);
      if (!res.ok) setError(res.message);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div className="rounded-lg border border-danger-default/30 bg-danger-default/5 p-3 text-sm text-danger-default">
          {error}
        </div>
      ) : null}

      <FilterRail onSubmit={() => pushFilter({ q: q || null })}>
        <FilterField label="Search" span={2}>
          <FilterSearch
            value={q}
            onChange={setQ}
            placeholder="Filename / source org…"
          />
        </FilterField>
        <FilterField label="Category">
          <FilterSelect
            value={searchParams.category ?? ''}
            onChange={(e) => pushFilter({ category: e.target.value || null })}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
        <FilterField label="Status">
          <FilterSelect
            value={searchParams.status ?? ''}
            onChange={(e) => pushFilter({ status: e.target.value || null })}
          >
            <option value="">All statuses</option>
            {PROCESSING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
        <FilterField label="Lifecycle">
          <FilterSelect
            value={searchParams.lifecycle ?? 'ACTIVE'}
            onChange={(e) => pushFilter({ lifecycle: e.target.value || null })}
          >
            {LIFECYCLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
      </FilterRail>
      {(q ||
        searchParams.q ||
        searchParams.category ||
        searchParams.status ||
        searchParams.lifecycle) && (
        <div className="flex">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQ('');
              pushFilter({ q: null, category: null, status: null, lifecycle: null });
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
          </Button>
        </div>
      )}

      {initial.rows.length === 0 ? (
        <Card>
          <div className="p-8 text-center text-sm text-text-secondary">
            No PDFs match the current filters.
          </div>
        </Card>
      ) : (
        <Card padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-text-tertiary">
                  <th className="px-3 py-2 font-medium">Filename</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Lifecycle</th>
                  <th className="px-3 py-2 text-right font-medium">Pages</th>
                  <th className="px-3 py-2 text-right font-medium">Extr.</th>
                  <th className="px-3 py-2 font-medium">Uploaded</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {initial.rows.map((row) => (
                  <tr key={row.id} className="border-t border-border-default align-top">
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        <Link
                          href={`/admin/pdf-review/${row.id}`}
                          className="font-medium text-text-primary hover:underline"
                        >
                          {row.originalFilename}
                        </Link>
                        {row.sourceOrg ? (
                          <span className="text-xs text-text-tertiary">{row.sourceOrg}</span>
                        ) : null}
                        {row.processingError ? (
                          <span className="text-xs text-warning-default">{row.processingError}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone="neutral">{row.sourceCategory.replace(/_/g, ' ')}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={processingTone(row.processingStatus)}>
                        {row.processingStatus}
                      </Badge>
                      {row.pendingReviewCount > 0 ? (
                        <div className="mt-0.5 text-[11px] text-warning-default">
                          {row.pendingReviewCount} pending review
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={lifecycleTone(row.lifecycleStatus)}>
                        {row.lifecycleStatus}
                      </Badge>
                      {row.lifecycleNote ? (
                        <div className="mt-0.5 max-w-[180px] truncate text-[11px] text-text-tertiary" title={row.lifecycleNote}>
                          {row.lifecycleNote}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.pageCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.extractionCount}</td>
                    <td className="px-3 py-3 text-xs text-text-tertiary">
                      {new Date(row.uploadedAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" asChild title="Open detail">
                          <Link href={`/admin/pdf-review/${row.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </Link>
                        </Button>
                        {row.processingStatus === 'FAILED' || row.processingStatus === 'PENDING' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => actReExtract(row)}
                            title="Re-extract"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        ) : null}
                        {row.lifecycleStatus === 'ACTIVE' ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => setConfirm({ kind: 'archive', row })}
                              title="Archive"
                            >
                              <Archive className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => setConfirm({ kind: 'deprecate', row })}
                              title="Deprecate"
                            >
                              <Ban className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => setConfirm({ kind: 'restore', row })}
                            title="Restore to active"
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => setConfirm({ kind: 'delete', row })}
                            title="Delete permanently"
                            className="text-danger-default hover:text-danger-default"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between text-xs text-text-tertiary">
        <span>
          Page {page} of {totalPages} · {initial.total.toLocaleString()} total
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => pushFilter({ page: String(page - 1) })}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => pushFilter({ page: String(page + 1) })}
          >
            Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <Dialog
        open={confirm != null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            setConfirmNote('');
          }
        }}
      >
        <DialogContent className="max-w-lg">
          {confirm ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {confirm.kind === 'delete'
                    ? 'Delete permanently?'
                    : confirm.kind === 'archive'
                      ? 'Archive PDF?'
                      : confirm.kind === 'deprecate'
                        ? 'Deprecate PDF?'
                        : 'Restore to active?'}
                </DialogTitle>
                <DialogDescription>
                  <span className="block font-medium text-text-primary">
                    {confirm.row.originalFilename}
                  </span>
                  <span className="mt-1 block text-text-tertiary">
                    {confirm.kind === 'delete'
                      ? 'Permanently removes the PDF, its MinIO object, and every extraction row. The audit log preserves the action.'
                      : confirm.kind === 'archive'
                        ? 'Hides the PDF from default library views. Extractions remain readable.'
                        : confirm.kind === 'deprecate'
                          ? 'Marks the PDF as superseded. Downstream analytics should skip it; extractions remain for audit.'
                          : 'Returns the PDF to the active set so it surfaces in default views again.'}
                  </span>
                </DialogDescription>
              </DialogHeader>
              {confirm.kind !== 'delete' && confirm.kind !== 'restore' ? (
                <div className="mt-3">
                  <label className="text-xs text-text-tertiary">Reason (optional)</label>
                  <textarea
                    rows={3}
                    value={confirmNote}
                    onChange={(e) => setConfirmNote(e.target.value)}
                    placeholder={
                      confirm.kind === 'archive'
                        ? 'e.g. superseded by 2026 edition'
                        : 'e.g. policy retracted by MHESI 2026-03-01'
                    }
                    className="mt-1 w-full rounded-md border border-border-default bg-surface-0 p-2 text-sm"
                  />
                </div>
              ) : null}
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => { setConfirm(null); setConfirmNote(''); }}>
                  Cancel
                </Button>
                {confirm.kind === 'delete' ? (
                  <Button
                    onClick={() => actDelete(confirm.row)}
                    disabled={pending}
                    className="bg-danger-default text-text-on-danger hover:bg-danger-default/90"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete permanently
                  </Button>
                ) : confirm.kind === 'restore' ? (
                  <Button onClick={() => actLifecycle(confirm.row, 'ACTIVE', '')} disabled={pending}>
                    <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> Restore
                  </Button>
                ) : confirm.kind === 'archive' ? (
                  <Button onClick={() => actLifecycle(confirm.row, 'ARCHIVED', confirmNote)} disabled={pending}>
                    <Archive className="h-3.5 w-3.5" aria-hidden /> Archive
                  </Button>
                ) : (
                  <Button onClick={() => actLifecycle(confirm.row, 'DEPRECATED', confirmNote)} disabled={pending}>
                    <Ban className="h-3.5 w-3.5" aria-hidden /> Deprecate
                  </Button>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}


function processingTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PROCESSING') return 'info';
  return 'neutral';
}

function lifecycleTone(status: PdfLifecycleStatus): 'success' | 'warning' | 'neutral' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'ARCHIVED') return 'neutral';
  return 'warning';
}
