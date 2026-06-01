'use client';

import * as React from 'react';
import { Button, Card, Badge } from '@kku/ui';
import { RefreshCw, CheckCircle2, AlertTriangle, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import type { RefreshStatus } from './types';

// Refresh bar — manual all-cube fetch button + last-refresh badge per
// cube + an icon-only "refresh just this cube" button on each.

interface Props {
  initialStatus: RefreshStatus | null;
}

const REFRESHABLE_CUBES = [
  'student',
  'location',
  'tuition',
  'performance',
  'entryScores',
  'recruitment',
] as const;
type Cube = (typeof REFRESHABLE_CUBES)[number];

function cubeLabel(n: string): string {
  return (
    ({
      fetch: 'Registry fetch',
      student: 'Student snapshot',
      location: 'School / province / region',
      tuition: 'Tuition revenue',
      performance: 'Performance (GPA)',
      entryScores: 'Entry test scores',
      recruitment: 'Recruitment (ADMISSION_STAT)',
    } as Record<string, string>)[n] ?? n
  );
}

export function EducationRefreshBar({ initialStatus }: Props) {
  const [status, setStatus] = React.useState<RefreshStatus | null>(initialStatus);
  const [busy, setBusy] = React.useState(false);
  // Track per-cube spinner state independently so the user knows which
  // cube is in flight when they click an individual refresh icon.
  const [busyCube, setBusyCube] = React.useState<Cube | null>(null);

  const reloadStatus = async () => {
    const statusRes = await fetch('/api/admin-education/refresh/status');
    const statusEnv = await statusRes.json();
    setStatus((statusEnv.data ?? statusEnv) as RefreshStatus);
  };

  const refresh = async (cubes?: Cube[]) => {
    setBusy(true);
    if (cubes && cubes.length === 1) setBusyCube(cubes[0]!);
    try {
      const res = await fetch('/api/admin-education/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cubes ? { cubes } : {}),
      });
      const env = await res.json();
      if (!res.ok || env.error) {
        throw new Error(env.error?.message ?? `refresh failed (${res.status})`);
      }
      const body = env.data ?? env;
      const counts = body.recordsByCube ?? {};
      const summary =
        cubes && cubes.length === 1
          ? cubes[0] === 'recruitment'
            ? // Recruitment is enqueued, not loaded synchronously —
              // the value-counts come in via the status poll.
              `Recruitment fetch queued — connector will run in the background`
            : `${cubeLabel(cubes[0]!)} — ${counts[cubes[0]!] ?? 0} rows`
          : `student ${counts.student ?? 0} · location ${counts.location ?? 0} · tuition ${counts.tuition ?? 0} · performance ${counts.performance ?? 0} · entry scores ${counts.entryScores ?? 0} · recruitment ${counts.recruitment === 1 ? 'queued' : 'skipped'}`;
      toast.success(`Refresh complete — ${summary}`);
      await reloadStatus();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Refresh failed — see api logs',
      );
    } finally {
      setBusy(false);
      setBusyCube(null);
    }
  };

  const fmtAgo = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h ago`;
    const days = Math.round(h / 24);
    return `${days} d ago`;
  };

  // Module-level helper hoisted up so the refresh handler can reuse
  // the same labels for toast summaries.

  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* The big button only spins when a FULL refresh is in flight
            (busyCube === null). Per-cube refreshes spin only their own
            row icon, leaving this button untouched. */}
        <Button
          onClick={() => refresh()}
          disabled={busy}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw
            className={`h-5 w-5 ${busy && busyCube === null ? 'animate-spin' : ''}`}
          />
          <span>
            {busy && busyCube === null ? 'Refreshing…' : 'Refresh all'}
          </span>
        </Button>
        <span className="text-xs text-text-tertiary">
          Manual fetch only — pulls a fresh snapshot from the registrar.
          Use the small refresh icon on a single dataset to pull just
          that one; runs sequentially per dataset.
        </span>
      </div>
      {status && status.cubes.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          {status.cubes
            .filter((c) =>
              (REFRESHABLE_CUBES as readonly string[]).includes(c.cubeName),
            )
            .map((c) => {
              const cube = c.cubeName as Cube;
              const cubeBusy = busy && busyCube === cube;
              return (
                <div
                  key={c.cubeName}
                  className="flex items-baseline justify-between rounded border border-border-subtle bg-surface-1 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">
                      {cubeLabel(c.cubeName)}
                    </div>
                    <div className="text-[0.65rem] text-text-tertiary">
                      {c.recordsLoaded !== null
                        ? `${c.recordsLoaded.toLocaleString('en-US')} rows · ${
                            c.durationMs
                              ? Math.round(c.durationMs / 1000)
                              : '—'
                          } s`
                        : '—'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.status === 'SUCCEEDED' && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    )}
                    {c.status === 'FAILED' && (
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    )}
                    <Badge
                      tone={
                        c.status === 'SUCCEEDED'
                          ? 'success'
                          : c.status === 'FAILED'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {fmtAgo(c.completedAt ?? c.startedAt)}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => refresh([cube])}
                      disabled={busy}
                      title={`Refresh ${cubeLabel(c.cubeName)}`}
                      aria-label={`Refresh ${cubeLabel(c.cubeName)}`}
                      className="rounded p-1 text-text-tertiary hover:bg-surface-2 hover:text-text-primary disabled:opacity-50"
                    >
                      <RotateCw
                        className={`h-4 w-4 ${cubeBusy ? 'animate-spin' : ''}`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
      {status && status.cubes.length === 0 && (
        <p className="mt-2 text-xs text-text-tertiary">
          No cube data yet — click <strong>Refresh from registry</strong> to
          pull the first snapshot.
        </p>
      )}
    </Card>
  );
}
