'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Card } from '@kku/ui';
import { Upload, Link2, FileText, ArrowRight, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

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

function unwrap<T>(json: unknown): T {
  const j = json as { data?: T };
  return (j?.data ?? json) as T;
}

export function TrendDocumentsClient({ initial }: { initial: TrendDocumentRow[] }) {
  const [mode, setMode] = React.useState<'file' | 'url'>('file');
  const [hint, setHint] = React.useState<Hint>('');
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [rows, setRows] = React.useState<TrendDocumentRow[]>(initial);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  // Poll while any document is still being processed, so statuses + the
  // published-signal links fill in without a manual refresh.
  const anyPending = rows.some((r) => r.status === 'PENDING' || r.status === 'PROCESSING');
  React.useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/admin-trend-documents?limit=30', { cache: 'no-store' });
        if (res.ok) setRows(unwrap<TrendDocumentRow[]>(await res.json()));
      } catch {
        /* transient — keep polling */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [anyPending]);

  const refresh = async () => {
    try {
      const res = await fetch('/api/admin-trend-documents?limit=30', { cache: 'no-store' });
      if (res.ok) setRows(unwrap<TrendDocumentRow[]>(await res.json()));
    } catch {
      /* ignore */
    }
  };

  const submitFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', files[0]!);
      if (hint) form.append('signalTypeHint', hint);
      const res = await fetch('/api/admin-trend-documents/upload', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? `Upload failed (HTTP ${res.status})`);
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
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin-trend-documents/from-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: trimmed, signalTypeHint: hint || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: { message?: string } })?.error?.message ?? `Failed (HTTP ${res.status})`);
      toast.success('Link queued — fetching & analysing…');
      setUrl('');
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card padding="md">
        {/* mode toggle */}
        <div className="mb-4 inline-flex rounded-md border border-border-default p-0.5">
          <button
            type="button"
            onClick={() => setMode('file')}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'file' ? 'bg-surface-2 text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            <Upload className="h-4 w-4" /> Upload file
          </button>
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'url' ? 'bg-surface-2 text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            <Link2 className="h-4 w-4" /> From URL
          </button>
        </div>

        {/* optional signal-type hint */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-tertiary">Signal type (optional — AI decides if left as Auto):</span>
          <div className="inline-flex flex-wrap gap-1">
            <HintChip label="Auto" active={hint === ''} onClick={() => setHint('')} />
            {SIGNAL_TYPES.map((t) => (
              <HintChip key={t} label={t} active={hint === t} onClick={() => setHint(t)} />
            ))}
          </div>
        </div>

        {mode === 'file' ? (
          <div className="flex items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,.xlsx,.pptx,.html,.htm,.csv,.txt,.md"
              disabled={busy}
              onChange={(e) => submitFile(e.target.files)}
              className="hidden"
              id="trend-doc-file"
            />
            <Button variant="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" />
              {busy ? 'Uploading…' : 'Pick a file'}
            </Button>
            <p className="text-xs text-text-tertiary">A job-posting / manpower-demand report, policy brief, industry report, etc. (PDF, Word, Excel, PowerPoint, HTML — ≤50 MB).</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="url"
              value={url}
              disabled={busy}
              placeholder="https://example.com/manpower-report"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
              className="w-full rounded-md border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-default sm:max-w-xl"
            />
            <Button variant="primary" disabled={busy || !url.trim()} onClick={submitUrl}>
              <Link2 className="h-4 w-4" />
              {busy ? 'Submitting…' : 'Analyse link'}
            </Button>
          </div>
        )}
      </Card>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Recent documents</h3>
        {rows.length === 0 ? (
          <Card padding="md">
            <p className="text-sm text-text-tertiary">
              No documents yet. Upload a document or paste a URL above — the resulting signal appears on the{' '}
              <Link href="/trends" className="text-accent-default hover:underline">Trends Radar</Link> once analysis finishes.
            </p>
          </Card>
        ) : (
          <Card padding="none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary [&_th]:whitespace-nowrap [&_th]:px-4 [&_th]:py-2.5">
                  <th>Source</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody className="[&_td]:px-4 [&_td]:py-3 [&_td]:align-top">
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border-subtle/60 last:border-0">
                    <td className="max-w-[24rem]">
                      <div className="flex items-start gap-2">
                        {r.sourceType === 'FILE' ? (
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
                        ) : (
                          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
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
                          View on radar <ArrowRight className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        <CheckCircle2 className="h-3.5 w-3.5" /> Published
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
        <AlertTriangle className="h-3.5 w-3.5" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status === 'PENDING' ? 'Queued' : 'Analysing'}
    </span>
  );
}
