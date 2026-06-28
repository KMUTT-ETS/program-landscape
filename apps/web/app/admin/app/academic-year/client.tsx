'use client';

import { useState } from 'react';
import { Button, Badge } from '@kku/ui';
import { CalendarClock, AlertTriangle } from 'lucide-react';

export interface AcademicYearResponse {
  nextStartDate: string;
  currentAcademicYearBE: number;
  latestCompleteEntryYearBE: number;
  inProgressEntryYearBE: number;
  isStale: boolean;
  suggestedNextDate: string;
}

export function AcademicYearClient({
  initial,
  loadError,
}: {
  initial: AcademicYearResponse | null;
  loadError: string | null;
}) {
  const [data, setData] = useState<AcademicYearResponse | null>(initial);
  const [date, setDate] = useState(initial?.nextStartDate ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(loadError);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin-academic-year', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nextStartDate: date }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const next = (await res.json()).data as AcademicYearResponse;
      setData(next);
      setDate(next.nextStartDate);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-accent-default" aria-hidden />
        <h1 className="text-lg font-semibold">Academic year</h1>
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {data && (
        <>
          {data.isStale && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden />
              <span>
                Academic year BE {data.currentAcademicYearBE} has started — set the next
                start date to <strong>{data.suggestedNextDate}</strong>.
              </span>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-text-secondary">Current academic year</dt>
            <dd>
              <Badge tone="info">BE {data.currentAcademicYearBE}</Badge>
            </dd>
            <dt className="text-text-secondary">Latest complete entry year</dt>
            <dd>BE {data.latestCompleteEntryYearBE}</dd>
            <dt className="text-text-secondary">In-progress (recruiting) year</dt>
            <dd>BE {data.inProgressEntryYearBE}</dd>
          </dl>

          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-secondary">Next academic-year start date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-border-default bg-surface-1 px-2 py-1"
              />
            </label>
            <Button onClick={() => void save()} disabled={saving || date === data.nextStartDate}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {saved && <p className="text-xs text-text-tertiary">Saved.</p>}
        </>
      )}
    </div>
  );
}
