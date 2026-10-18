'use client';

import * as React from 'react';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@kku/ui';
import {
  canStartOver,
  describeUploadOutcome,
  isOverridableShrinkRefusal,
} from '@/lib/import-panel-state';

// The import affordances for a dataset the framework knows about: download a
// template, upload a filled one, see what has been uploaded, and clear the
// dataset.
//
// Posts straight to /api/v1 with the session cookie, as /admin/jobthai does.
// No Next proxy route is involved.

export interface ImportValidationErrorRow {
  sheet: string;
  row: number;
  column: string | null;
  message: string;
}

export interface ImportBatchRow {
  id: string;
  filename: string;
  rowCount: number;
  fileSize: number;
  status: string;
  createdAt: string;
  clearedAt: string | null;
  uploadedBy: string | null;
  errorMessage: string | null;
}

export interface ImportPanelDataset {
  slug: string;
  title: string;
  description: string;
  sheetName: string;
  keyColumns: string[];
  rowCount: number;
  batches: ImportBatchRow[];
}

interface UploadOutcome {
  rowCount: number;
  inserted: number;
  updated: number;
  deleted: number;
  deduplicated: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ImportPanel({ dataset }: { dataset: ImportPanelDataset }): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<ImportValidationErrorRow[] | null>(null);
  const [errorSummary, setErrorSummary] = React.useState<string | null>(null);
  const [shrinkFile, setShrinkFile] = React.useState<File | null>(null);
  const [confirmName, setConfirmName] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const liveBatches = dataset.batches.filter((b) => b.status !== 'CLEARED');

  async function send(file: File, allowShrink: boolean): Promise<void> {
    setBusy(true);
    setErrors(null);
    setErrorSummary(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(
        `/api/v1/admin/imports/${dataset.slug}?allowShrink=${allowShrink ? 'true' : 'false'}`,
        { method: 'POST', body },
      );
      const json = (await res.json()) as {
        data?: UploadOutcome;
        error?: { message?: string; details?: { errors?: ImportValidationErrorRow[]; totalErrors?: number } };
      };

      if (!res.ok) {
        const detail = json.error?.details;
        const message = json.error?.message ?? 'Upload failed.';
        if (detail?.errors?.length) {
          setErrors(detail.errors);
          setErrorSummary(message);
          // A shrink refusal is the one failure the operator can override.
          if (isOverridableShrinkRefusal({ message, errors: detail.errors })) {
            setShrinkFile(file);
          }
        } else {
          toast.error(message);
        }
        return;
      }

      const outcome = json.data;
      const sentence = describeUploadOutcome({
        deduplicated: outcome?.deduplicated ?? false,
        rowCount: outcome?.rowCount ?? 0,
        inserted: outcome?.inserted ?? 0,
        updated: outcome?.updated ?? 0,
      });
      if (outcome?.deduplicated) toast.info(sentence);
      else toast.success(sentence);
      setShrinkFile(null);
      window.location.reload();
    } catch {
      toast.error('Upload failed — the server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  async function startOver(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/imports/${dataset.slug}/start-over`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmName }),
      });
      const json = (await res.json()) as {
        data?: { rowsDeleted: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Could not clear this dataset.');
        return;
      }
      toast.success(`Cleared ${json.data?.rowsDeleted ?? 0} rows. The uploaded files are kept.`);
      window.location.reload();
    } catch {
      toast.error('Could not clear this dataset — the server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-text-primary">Import from a spreadsheet</h2>
            <p className="mt-1 text-xs text-text-secondary">
              {dataset.description} Rows are matched on {dataset.keyColumns.join(' + ')}; uploading
              again updates matching rows and leaves everything else alone.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/v1/admin/imports/${dataset.slug}/template`} download>
                <Download className="size-icon-sm" aria-hidden /> Download template
              </a>
            </Button>
            <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Upload className="size-icon-sm" aria-hidden /> {busy ? 'Working…' : 'Upload filled template'}
            </Button>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void send(file, false);
          }}
        />

        {errorSummary ? (
          <div className="rounded-md border border-default bg-surface-2 p-3">
            <p className="text-xs font-medium text-text-primary">{errorSummary}</p>
            {errors && errors.length > 0 ? (
              <table className="mt-2 w-full text-left text-xs">
                <thead className="text-text-secondary">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Row</th>
                    <th className="py-1 pr-3 font-medium">Column</th>
                    <th className="py-1 font-medium">What is wrong</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e, i) => (
                    <tr key={`${e.row}-${e.column ?? ''}-${i}`} className="border-t border-subtle">
                      <td className="py-1 pr-3 tabular-nums text-text-secondary">
                        {e.row === 0 ? '—' : e.row}
                      </td>
                      <td className="py-1 pr-3 text-text-secondary">{e.column ?? '—'}</td>
                      <td className="py-1 text-text-primary">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {shrinkFile ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={busy}
                onClick={() => void send(shrinkFile, true)}
              >
                Upload anyway — this file is correct
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card padding="md" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-primary">Uploads</h2>
        {dataset.batches.length === 0 ? (
          <p className="text-xs text-text-secondary">
            Nothing uploaded yet. Download the template, fill in the {dataset.sheetName} sheet, and
            upload it.
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-text-secondary">
              <tr>
                <th className="py-1 pr-3 font-medium">File</th>
                <th className="py-1 pr-3 font-medium">Uploaded</th>
                <th className="py-1 pr-3 font-medium">By</th>
                <th className="py-1 pr-3 text-right font-medium">Rows</th>
                <th className="py-1 pr-3 text-right font-medium">Size</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {dataset.batches.map((b) => (
                <tr key={b.id} className="border-t border-subtle">
                  <td className={`py-1 pr-3 ${b.clearedAt ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>
                    {b.filename}
                  </td>
                  <td className="py-1 pr-3 text-text-secondary">
                    {new Date(b.createdAt).toLocaleDateString('en-GB')}
                  </td>
                  <td className="py-1 pr-3 text-text-secondary">{b.uploadedBy ?? '—'}</td>
                  <td className="py-1 pr-3 text-right tabular-nums text-text-secondary">{b.rowCount}</td>
                  <td className="py-1 pr-3 text-right tabular-nums text-text-secondary">
                    {formatBytes(b.fileSize)}
                  </td>
                  <td className="py-1">
                    <Badge tone={b.status === 'FAILED' ? 'danger' : b.status === 'CLEARED' ? 'neutral' : 'success'}>
                      {b.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card padding="md" tone="quiet" className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Start over</h2>
          <p className="mt-1 max-w-2xl text-xs text-text-secondary">
            Deletes the rows these uploads created. Anything from a connector or the original
            setup is left alone — including a row an upload only edited. It refuses if other data
            would be destroyed along with them, and names what is in the way. The uploaded files
            above are kept, so you can rebuild by uploading them again — but if those files are
            gone, this cannot be undone.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={`Type "${dataset.title}" to confirm`}
            aria-label={`Type ${dataset.title} to confirm clearing this dataset`}
            className="w-72 rounded-md border border-default bg-surface-1 px-3 py-1.5 text-sm text-text-primary"
          />
          <Button
            size="sm"
            variant="danger"
            disabled={
              !canStartOver({
                confirmName,
                title: dataset.title,
                liveBatchCount: liveBatches.length,
                busy,
              })
            }
            onClick={() => void startOver()}
          >
            Clear this dataset
          </Button>
        </div>
      </Card>
    </div>
  );
}
