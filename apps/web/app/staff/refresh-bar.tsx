'use client';

import * as React from 'react';
import { Button, Card, Badge } from '@kku/ui';
import { RefreshCw, CheckCircle2, AlertTriangle, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import type { RefreshStatus } from './types';

// Mirror of EducationRefreshBar — POSTs to /api/admin-staff-dashboard/refresh
// which enqueues the five staff-relevant connectors (DS2001, DS2003,
// DS2004, processed-HR, research services). Per-source refresh icon on each
// row sends a scoped slug so individual feeds can be re-pulled without
// firing the others.

interface Props {
  initialStatus: RefreshStatus | null;
}

const SOURCES = [
  'unicon-ds2001',
  'unicon-ds2003',
  'unicon-ds2004',
  'kku-hr-processed',
  'kku-research-services',
] as const;
type Slug = (typeof SOURCES)[number];

function sourceLabel(slug: string): string {
  return (
    ({
      'unicon-ds2001': 'Staff records',
      'unicon-ds2003': 'Education history',
      'unicon-ds2004': 'Teaching assignments',
      'kku-hr-processed': 'Salary & lifecycle dates',
      'kku-research-services': 'Grants & academic service',
    } as Record<string, string>)[slug] ?? slug
  );
}

export function StaffRefreshBar({ initialStatus }: Props) {
  const [status, setStatus] = React.useState<RefreshStatus | null>(initialStatus);
  const [busy, setBusy] = React.useState(false);
  const [busySlug, setBusySlug] = React.useState<Slug | null>(null);

  const reloadStatus = async () => {
    const r = await fetch('/api/admin-staff-dashboard/refresh/status');
    const env = await r.json();
    setStatus((env.data ?? env) as RefreshStatus);
  };

  const refresh = async (slugs?: Slug[]) => {
    setBusy(true);
    if (slugs && slugs.length === 1) setBusySlug(slugs[0]!);
    try {
      const res = await fetch('/api/admin-staff-dashboard/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(slugs ? { slugs } : {}),
      });
      const env = await res.json();
      if (!res.ok || env.error) {
        throw new Error(env.error?.message ?? `refresh failed (${res.status})`);
      }
      const queued = env.data?.queued ?? env.queued ?? [];
      toast.success(
        queued.length === 1
          ? 'Refresh started — running in the background'
          : `Refreshing ${queued.length} datasets in the background`,
      );
      // Poll once after a delay so the latest IngestionRun is visible.
      setTimeout(reloadStatus, 2500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setBusy(false);
      setBusySlug(null);
    }
  };

  const fmtAgo = (iso: string | null): string => {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h ago`;
    const days = Math.round(h / 24);
    return `${days} d ago`;
  };

  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => refresh()}
          disabled={busy}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw className={`size-icon-lg ${busy && busySlug === null ? 'animate-spin' : ''}`} />
          <span>{busy && busySlug === null ? 'Refreshing…' : 'Refresh all'}</span>
        </Button>
        <span className="text-xs text-text-tertiary">
          Refreshes automatically each morning. Click to pull the latest snapshot now.
        </span>
      </div>
      {status && status.sources.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          {status.sources.map((s) => {
            const slug = s.slug as Slug;
            const slugBusy = busy && busySlug === slug;
            return (
              <div
                key={s.slug}
                className="flex items-baseline justify-between rounded border border-border-subtle bg-surface-1 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{sourceLabel(s.slug)}</div>
                  <div className="text-[0.65rem] text-text-tertiary">
                    {s.recordsLoaded !== null
                      ? `${s.recordsLoaded.toLocaleString('en-US')} rows · ${
                          s.durationMs ? Math.round(s.durationMs / 1000) : '—'
                        } s`
                      : '—'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {s.status === 'SUCCEEDED' && <CheckCircle2 className="size-icon-sm text-success" />}
                  {s.status === 'FAILED' && <AlertTriangle className="size-icon-sm text-warning" />}
                  <Badge
                    tone={
                      s.status === 'SUCCEEDED'
                        ? 'success'
                        : s.status === 'FAILED'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {fmtAgo(s.completedAt ?? s.startedAt)}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => refresh([slug])}
                    disabled={busy}
                    title={`Refresh ${sourceLabel(s.slug)}`}
                    aria-label={`Refresh ${sourceLabel(s.slug)}`}
                    className="rounded p-1 text-text-tertiary hover:bg-surface-2 hover:text-text-primary disabled:opacity-50"
                  >
                    <RotateCw className={`size-icon-md ${slugBusy ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
