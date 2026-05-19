'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw, CheckCircle2, Clock, GraduationCap } from 'lucide-react';
import { Button, Card } from '@kku/ui';
import { refreshClassOfferingsAction } from '@/lib/actions/class-offerings';

// Manual refresh bar for class_offerings + class_offering_teachers —
// the source of the class-GPA section on /education/performance.
// Mounted on /admin/dashboard-data-fetch.
//
// Click "Refresh now" → enqueues a RUN_CLASS_OFFERINGS_LINK BullMQ job;
// the ingestion worker spawns the bundled link-class-offerings script
// with --apply. Full delete-and-replace from POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER
// — including the per-letter grade-distribution columns and the
// precomputed class_gpa. The job is ~2-5 minutes; the button disables
// while one is in flight.

export interface ClassOfferingsRefreshProps {
  initial: {
    isRunning: boolean;
    rowCount: number;
    withGpaCount: number;
    lastRefreshedAt: string | null; // ISO
  } | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'never';
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return `${days} d ago`;
}

export function ClassOfferingsRefreshBar({ initial }: ClassOfferingsRefreshProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const inflight = initial?.isRunning ?? false;

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await refreshClassOfferingsAction();
      if (res.ok) {
        toast.success(
          'Queued class-offerings refresh — runs ~2-5 minutes; page updates on the next visit.',
        );
        router.refresh();
      } else {
        toast.error(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!initial) {
    return (
      <Card className="p-3">
        <p className="text-sm text-text-tertiary">
          Couldn’t read class-offering status — the API may be unavailable.
        </p>
      </Card>
    );
  }

  const gpaPct =
    initial.rowCount > 0
      ? Math.round((initial.withGpaCount / initial.rowCount) * 100)
      : 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void refresh()}
          disabled={busy || inflight}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw className={`h-5 w-5 ${busy || inflight ? 'animate-spin' : ''}`} />
          <span>{busy || inflight ? 'Refreshing…' : 'Refresh now'}</span>
        </Button>
        <span className="text-xs text-text-tertiary">
          Full delete-and-replace from <code>POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER</code> —
          re-loads every class section plus the per-letter grade distribution and the
          precomputed <code>class_gpa</code>. Run after the registrar posts a semester’s
          grades so the Education → Student performance class-GPA view reflects them.
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="flex items-center gap-2">
          {inflight ? (
            <Clock className="h-4 w-4 text-text-tertiary" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success-default" />
          )}
          <div>
            <div className="text-text-tertiary">Last refresh</div>
            <div className="text-text-primary">{timeAgo(initial.lastRefreshedAt)}</div>
          </div>
        </div>
        <div>
          <div className="text-text-tertiary">Class offerings on file</div>
          <div className="font-tabular text-text-primary">
            {initial.rowCount.toLocaleString('en-US')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-text-tertiary" />
          <div>
            <div className="text-text-tertiary">With class GPA</div>
            <div className="font-tabular text-text-primary">
              {initial.withGpaCount.toLocaleString('en-US')}{' '}
              <span className="text-text-tertiary">({gpaPct}%)</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
