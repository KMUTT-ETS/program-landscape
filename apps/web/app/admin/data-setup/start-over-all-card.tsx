'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Card } from '@kku/ui';
import { startOverAllBlockedReason } from '@/lib/import-panel-state';

// "Back to an empty installation" for spreadsheet imports: every dataset's
// rows, everything built on them, the upload history and the stored files.
// The per-dataset Start over lives on each dataset's raw page; this is the
// one-shot version for an operator who has been testing uploads.
//
// Rendered only for users holding imports:destroy; the api enforces it too.

export interface StartOverAllCardProps {
  /** The organization's short English name, typed to confirm. */
  confirmAs: string;
  uploadCount: number;
  datasetCount: number;
}

export function StartOverAllCard({ confirmAs, uploadCount, datasetCount }: StartOverAllCardProps) {
  const router = useRouter();
  const [confirmName, setConfirmName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const blocked = startOverAllBlockedReason({ confirmName, confirmAs, uploadCount, busy });

  async function startOverAll(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch('/api/admin-imports/start-over-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmName }),
      });
      const json = (await res.json()) as {
        data?: { rowsDeleted: number; batchesDeleted: number; filesFailed: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Could not delete the uploaded data.');
        return;
      }
      const d = json.data;
      toast.success(
        `Deleted ${d?.rowsDeleted ?? 0} rows and ${d?.batchesDeleted ?? 0} uploads.` +
          (d && d.filesFailed > 0 ? ` ${d.filesFailed} stored files could not be removed — see the api log.` : ''),
      );
      setConfirmName('');
      router.refresh();
    } catch {
      toast.error('Could not delete the uploaded data — the server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="md" tone="quiet" className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Start over: all data</h2>
        <p className="mt-1 max-w-2xl text-xs text-text-secondary">
          Deletes everything loaded from spreadsheets — {uploadCount} uploads across {datasetCount}{' '}
          datasets — together with everything built on those rows: curriculum PDFs and their
          extracted courses, AI analysis, risk assessments, demand matches and programme mappings.
          The upload history and the stored files are deleted too. Kept: the organization
          profile, users, system settings and data fetched by the public connectors. This cannot
          be undone.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={`Type "${confirmAs}" to confirm`}
          aria-label={`Type ${confirmAs} to confirm deleting all uploaded data`}
          disabled={uploadCount === 0 || busy}
          className="w-72 rounded-md border border-default bg-surface-1 px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
        />
        <Button size="sm" variant="danger" disabled={blocked !== null} onClick={() => void startOverAll()}>
          Delete all uploaded data
        </Button>
      </div>
      {blocked && uploadCount === 0 ? (
        <p className="max-w-2xl text-xs text-text-tertiary" role="status">
          {blocked}
        </p>
      ) : null}
    </Card>
  );
}
