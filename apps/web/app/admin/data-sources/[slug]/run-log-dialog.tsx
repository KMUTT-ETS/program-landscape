'use client';

import * as React from 'react';
import { toast } from 'sonner';
// CLIENT-SAFE SUBPATH, not the `@kku/shared` root barrel: this file is
// 'use client' and needs `isRunLogFinal` at runtime, and the barrel
// re-exports './pdf' → node:crypto, which webpack cannot bundle
// (UnhandledSchemeError). The module is pure Zod + one predicate.
import { isRunLogFinal, type RunLogLineDto, type RunLogResponse } from '@kku/shared/ingestion/run-log';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kku/ui';
import { fetchRunLogAction } from '@/lib/actions/data-sources';

// "Log" button + modal for one ingestion run. Lines come from
// GET /data-sources/runs/:runId/logs (the runner's per-run log). While the
// run is QUEUED/RUNNING the modal polls every POLL_MS for lines after the
// last seq it holds; it stops once the status is terminal — the runner
// stores every line before it sets that status, so nothing is missed.

const POLL_MS = 3_000;

export type Filter = 'all' | 'warn' | 'error';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'warn', label: 'Warn+' },
  { id: 'error', label: 'Error' },
];

export function keep(line: RunLogLineDto, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'error') return line.level === 'ERROR';
  return line.level !== 'INFO';
}

function levelClass(level: RunLogLineDto['level']): string {
  if (level === 'ERROR') return 'text-danger';
  if (level === 'WARN') return 'text-warning';
  return 'text-text-tertiary';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function lineToText(l: RunLogLineDto): string {
  const meta = l.meta === null ? '' : ` ${JSON.stringify(l.meta)}`;
  return `${l.ts} ${l.level.padEnd(5)} ${l.message}${meta}`;
}

function statusTone(status: RunLogResponse['status']): 'success' | 'danger' | 'neutral' {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED') return 'danger';
  return 'neutral';
}

export function RunLogDialog({ runId, label }: { runId: string; label: string }) {
  const [open, setOpen] = React.useState(false);
  const [lines, setLines] = React.useState<RunLogLineDto[]>([]);
  const [status, setStatus] = React.useState<RunLogResponse['status'] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>('all');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  // Fetch everything after `afterSeq` (following hasMore pages), then poll
  // while the run is still going. Cancelled when the dialog closes.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let afterSeq = 0;
    setLines([]);
    setStatus(null);
    setError(null);
    setLoading(true);

    const tick = async (): Promise<void> => {
      let final = false;
      for (;;) {
        const res = await fetchRunLogAction(runId, afterSeq);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.message);
          break;
        }
        setError(null);
        setStatus(res.data.status);
        const page = res.data.lines;
        if (page.length > 0) {
          afterSeq = page[page.length - 1]!.seq;
          setLines((prev) => prev.concat(page));
        }
        final = isRunLogFinal(res.data.status);
        if (!res.data.hasMore) break;
      }
      setLoading(false);
      if (!final && !cancelled) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, runId]);

  const visible = React.useMemo(() => lines.filter((l) => keep(l, filter)), [lines, filter]);

  // Follow the tail unless the reader has scrolled up.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(visible.map(lineToText).join('\n'));
      toast.success(`Copied ${visible.length} line${visible.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  const running = status !== null && !isRunLogFinal(status);
  const counts = React.useMemo(
    () => ({
      warn: lines.filter((l) => l.level === 'WARN').length,
      error: lines.filter((l) => l.level === 'ERROR').length,
    }),
    [lines],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`View log for run at ${label}`}>
          Log
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(1040px,95vw)]">
        <DialogHeader>
          <DialogTitle>Run log</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              <span>{label}</span>
              {status && <Badge tone={statusTone(status)}>{status}</Badge>}
              {running && (
                <span className="inline-flex items-center gap-1 text-xs text-text-tertiary">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden />
                  running — updating every {POLL_MS / 1000}s
                </span>
              )}
              <span className="font-mono text-xs text-text-tertiary">{runId}</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex gap-1" role="group" aria-label="Filter by level">
            {FILTERS.map((f) => (
              <Button
                key={f.id}
                size="xs"
                variant={filter === f.id ? 'subtle' : 'outline'}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-text-tertiary">
            <span className="font-tabular">
              {lines.length.toLocaleString('en-US')} lines · {counts.warn} warn · {counts.error} error
            </span>
            <Button size="xs" variant="outline" disabled={visible.length === 0} onClick={() => void onCopy()}>
              Copy
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-2 rounded-md border border-subtle bg-danger/10 p-2 text-xs text-danger">
            Could not load the log: {error} — retrying.
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-[60vh] overflow-auto rounded-lg border border-subtle bg-surface-2 p-3 font-mono text-xs leading-relaxed"
        >
          {loading && lines.length === 0 ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-3 animate-pulse rounded bg-surface-1" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="p-6 text-center font-sans text-sm text-text-tertiary">
              {lines.length > 0
                ? 'No lines at this level.'
                : running
                  ? 'Waiting for log lines…'
                  : 'No log captured for this run.'}
            </div>
          ) : (
            <ol>
              {visible.map((l) => (
                <li key={l.seq} className="flex gap-3 whitespace-pre-wrap break-words">
                  <span className="shrink-0 text-text-tertiary" title={l.ts}>
                    {formatTime(l.ts)}
                  </span>
                  <span className={`w-10 shrink-0 font-semibold ${levelClass(l.level)}`}>{l.level}</span>
                  <span className={l.level === 'ERROR' ? 'text-danger' : 'text-text-primary'}>
                    {l.message}
                    {l.meta !== null && (
                      <span className="text-text-tertiary"> {JSON.stringify(l.meta)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
