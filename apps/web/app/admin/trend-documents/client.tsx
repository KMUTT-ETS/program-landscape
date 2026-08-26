'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Card } from '@kku/ui';
import {
  Upload,
  Link2,
  FileText,
  ArrowRight,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  X,
  RefreshCw,
} from 'lucide-react';

export interface TrendDocumentRow {
  id: string;
  sourceType: 'FILE' | 'URL';
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  originalFilename: string | null;
  sourceUrl: string | null;
  signalTypeHint: string | null;
  trendSignalId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const SIGNAL_TYPES = ['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS'] as const;
type Hint = (typeof SIGNAL_TYPES)[number] | '';

const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.html,.htm,.csv,.txt,.md';

function unwrap<T>(json: unknown): T {
  const j = json as { data?: T };
  return (j?.data ?? json) as T;
}

export function TrendDocumentsClient({ initial }: { initial: TrendDocumentRow[] }) {
  const [mode, setMode] = React.useState<'file' | 'url'>('file');
  const [hint, setHint] = React.useState<Hint>('');
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [rows, setRows] = React.useState<TrendDocumentRow[]>(initial);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  // Poll while any document is still being processed, so statuses + the
  // published-signal links fill in without a manual refresh.
  const anyPending = rows.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING');
  React.useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [anyPending]);

  const refresh = async () => {
    try {
      const res = await fetch('/api/admin-trend-documents?limit=100', { cache: 'no-store' });
      if (res.ok) setRows(unwrap<TrendDocumentRow[]>(await res.json()));
    } catch {
      /* transient — ignore */
    }
  };

  const submitFile = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', files[0]!);
      if (hint) form.append('signalTypeHint', hint);
      const res = await fetch('/api/admin-trend-documents/upload', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (json as { error?: { message?: string } })?.error?.message ?? `Upload failed (HTTP ${res.status})`,
        );
      const r = unwrap<{ deduplicated?: boolean }>(json);
      toast.success(r?.deduplicated ? 'Already analysed — showing the existing signal.' : 'Uploaded — analysing…');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submitUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin-trend-documents/from-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: trimmed, signalTypeHint: hint || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (json as { error?: { message?: string } })?.error?.message ?? `Failed (HTTP ${res.status})`,
        );
      toast.success('Link queued — fetching & analysing…');
      setUrl('');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/admin-trend-documents/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          (json as { error?: { message?: string } })?.error?.message ?? `Remove failed (HTTP ${res.status})`,
        );
      const r = unwrap<{ deletedSignal?: boolean }>(json);
      toast.success(r?.deletedSignal ? 'Removed — source and its signal are off the radar.' : 'Source removed.');
      setRows((prev) => prev.filter((x) => x.id !== id));
      setConfirmId(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (mode !== 'file') setMode('file');
    void submitFile(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Upload / link panel ───────────────────────────────────────── */}
      <Card padding="md">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/* mode toggle */}
          <div className="inline-flex rounded-lg border border-border-default bg-surface-1 p-0.5">
            <button
              type="button"
              onClick={() => setMode('file')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'file'
                  ? 'bg-surface-3 text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <Upload className="size-icon-md" /> Upload file
            </button>
            <button
              type="button"
              onClick={() => setMode('url')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'url'
                  ? 'bg-surface-3 text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <Link2 className="size-icon-md" /> From URL
            </button>
          </div>

          {/* optional signal-type hint */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-tertiary">Signal type:</span>
            <div className="inline-flex flex-wrap gap-1">
              <HintChip label="Auto" active={hint === ''} onClick={() => setHint('')} />
              {SIGNAL_TYPES.map((t) => (
                <HintChip key={t} label={t} active={hint === t} onClick={() => setHint(t)} />
              ))}
            </div>
          </div>
        </div>

        {mode === 'file' ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => submitFile(e.target.files)}
              className="hidden"
              id="trend-doc-file"
            />
            <div
              role="button"
              tabIndex={0}
              aria-disabled={busy}
              onClick={() => !busy && fileInput.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !busy) {
                  e.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-default ${
                busy
                  ? 'cursor-wait border-border-default bg-surface-2/50'
                  : dragging
                    ? 'cursor-copy border-accent-default bg-accent-subtle/50'
                    : 'cursor-pointer border-border-default bg-surface-1 hover:border-accent-default/60 hover:bg-surface-2/40'
              }`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                  dragging ? 'bg-accent-default/15 text-accent-default' : 'bg-surface-3 text-text-tertiary group-hover:text-accent-default'
                }`}
              >
                {busy ? <Loader2 className="size-icon-xl animate-spin" /> : <Upload className="size-icon-xl" />}
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  {busy ? 'Uploading & analysing…' : dragging ? 'Drop to upload' : 'Drag & drop a document, or click to browse'}
                </p>
                <p className="text-xs text-text-tertiary">
                  Job-posting / manpower-demand report, policy brief, industry report…
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {['PDF', 'Word', 'Excel', 'PowerPoint', 'HTML', 'CSV'].map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary"
                  >
                    {f}
                  </span>
                ))}
                <span className="text-[10px] text-text-tertiary">≤ 50 MB</span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 size-icon-md -translate-y-1/2 text-text-tertiary" />
              <input
                type="url"
                value={url}
                disabled={busy}
                placeholder="https://example.com/manpower-report"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
                // pl-16 = 32px on this project's half-scale spacing
                // (see filter-rail.tsx FilterSearch for the arithmetic):
                // the icon's right edge is at left-3 (6px) + 16px = 22px,
                // so the text starts 10px clear of it. The previous pl-9
                // emitted no CSS at all — 9 is not a step on this scale —
                // leaving the text at zero inset under the icon.
                className="w-full rounded-md border border-border-default bg-surface-1 py-2 pl-16 pr-3 text-sm text-text-primary outline-none transition-colors focus:border-accent-default"
              />
            </div>
            <Button variant="primary" disabled={busy || !url.trim()} onClick={submitUrl}>
              {busy ? <Loader2 className="size-icon-md animate-spin" /> : <Link2 className="size-icon-md" />}
              {busy ? 'Submitting…' : 'Analyse link'}
            </Button>
          </div>
        )}
        <p className="mt-3 text-xs text-text-tertiary">
          The AI reads the source, drafts a trend signal, and publishes it to the{' '}
          <Link href="/trends" className="text-accent-default hover:underline">
            Trends Radar
          </Link>{' '}
          — then tags the KKU programs and skills it affects.
        </p>
      </Card>

      {/* ── Source documents & links (management) ─────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary">
            Source documents &amp; links{rows.length > 0 && <span className="ml-1.5 font-normal text-text-tertiary">({rows.length})</span>}
          </h3>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 text-xs text-text-tertiary transition-colors hover:text-text-secondary"
          >
            <RefreshCw className="size-icon-sm" /> Refresh
          </button>
        </div>
        <p className="text-xs text-text-tertiary">
          Every source that has fed the Trends Radar. Removing one deletes its published signal from the radar analysis.
        </p>

        {rows.length === 0 ? (
          <Card padding="md">
            <p className="text-sm text-text-tertiary">
              No sources yet. Upload a document or paste a URL above — the resulting signal appears on the{' '}
              <Link href="/trends" className="text-accent-default hover:underline">
                Trends Radar
              </Link>{' '}
              once analysis finishes.
            </p>
          </Card>
        ) : (
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary [&_th]:whitespace-nowrap [&_th]:px-4 [&_th]:py-2.5">
                    <th>Source</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Signal</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:px-4 [&_td]:py-3 [&_td]:align-top">
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border-subtle/60 last:border-0 hover:bg-surface-2/30">
                      <td className="max-w-[24rem]">
                        <div className="flex items-start gap-2">
                          {r.sourceType === 'FILE' ? (
                            <FileText className="mt-0.5 size-icon-md shrink-0 text-text-tertiary" />
                          ) : (
                            <Link2 className="mt-0.5 size-icon-md shrink-0 text-text-tertiary" />
                          )}
                          <span className="truncate text-text-secondary" title={r.originalFilename ?? r.sourceUrl ?? ''}>
                            {r.sourceType === 'URL' && r.sourceUrl ? (
                              <a href={r.sourceUrl} target="_blank" rel="noopener" className="text-accent-default hover:underline">
                                {r.sourceUrl}
                              </a>
                            ) : (
                              r.originalFilename ?? '—'
                            )}
                          </span>
                        </div>
                        {r.error && <div className="mt-1 text-xs text-warning">{r.error}</div>}
                      </td>
                      <td className="text-text-tertiary">{r.signalTypeHint ?? 'Auto'}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td>
                        {r.trendSignalId ? (
                          <Link
                            href={`/trends/${r.trendSignalId}`}
                            className="inline-flex items-center gap-1 text-accent-default hover:underline"
                          >
                            View on radar <ArrowRight className="size-icon-xs" />
                          </Link>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        {confirmId === r.id ? (
                          <span className="inline-flex items-center justify-end gap-2">
                            <span className="text-xs text-text-secondary">Remove from radar?</span>
                            <button
                              type="button"
                              disabled={removingId === r.id}
                              onClick={() => remove(r.id)}
                              className="inline-flex items-center gap-1 rounded-md bg-danger-subtle px-2 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger/15 disabled:opacity-60"
                            >
                              {removingId === r.id ? (
                                <Loader2 className="size-icon-sm animate-spin" />
                              ) : (
                                <Trash2 className="size-icon-sm" />
                              )}
                              Confirm
                            </button>
                            <button
                              type="button"
                              disabled={removingId === r.id}
                              onClick={() => setConfirmId(null)}
                              className="inline-flex items-center rounded-md p-1 text-text-tertiary transition-colors hover:text-text-secondary"
                              aria-label="Cancel"
                            >
                              <X className="size-icon-sm" />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmId(r.id)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-tertiary transition-colors hover:bg-danger-subtle hover:text-danger"
                          >
                            <Trash2 className="size-icon-sm" /> Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

function HintChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-accent-default bg-accent-default/10 text-accent-default'
          : 'border-border-default text-text-tertiary hover:text-text-secondary'
      }`}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: TrendDocumentRow['status'] }) {
  if (status === 'SUCCEEDED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <CheckCircle2 className="size-icon-sm" /> Published
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
        <AlertTriangle className="size-icon-sm" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary">
      <Loader2 className="size-icon-sm animate-spin" /> {status === 'PENDING' ? 'Queued' : 'Analysing'}
    </span>
  );
}
