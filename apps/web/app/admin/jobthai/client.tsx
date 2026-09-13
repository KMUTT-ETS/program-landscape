'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button, Card } from '@kku/ui';
import { Upload, Loader2, AlertTriangle, CheckCircle2, Trash2, RefreshCw, Clock } from 'lucide-react';

export interface JobThaiBatchRow {
  id: string;
  filename: string;
  rowCount: number;
  fileSize: number;
  receivedDate: string;
  status: 'PENDING' | 'PARSING' | 'PARSED' | 'FAILED';
  parseError: string | null;
  createdAt: string;
  uploadedBy: string | null;
  postingsLoaded: number;
}

function formatBytes(n: number): string {
  const mb = n / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: JobThaiBatchRow['status'] }): React.JSX.Element {
  const map: Record<JobThaiBatchRow['status'], { label: string; className: string; Icon: typeof Clock }> = {
    PENDING: { label: 'Pending', className: 'text-fg-muted', Icon: Clock },
    PARSING: { label: 'Parsing', className: 'text-accent-default', Icon: Loader2 },
    PARSED: { label: 'Parsed', className: 'text-success-default', Icon: CheckCircle2 },
    FAILED: { label: 'Failed', className: 'text-danger-default', Icon: AlertTriangle },
  };
  const { label, className, Icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-[6px] text-[13px] ${className}`}>
      <Icon className={`h-[14px] w-[14px] ${status === 'PARSING' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}

export function JobThaiClient({ initial }: { initial: JobThaiBatchRow[] }): React.JSX.Element {
  const [rows, setRows] = React.useState<JobThaiBatchRow[]>(initial);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(async () => {
    const res = await fetch('/api/v1/admin/jobthai/batches?limit=100');
    if (!res.ok) return;
    const body = (await res.json()) as { data: JobThaiBatchRow[] };
    setRows(body.data);
  }, []);

  async function upload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/v1/admin/jobthai/batches', { method: 'POST', body: form });
        const body = (await res.json()) as {
          data?: { deduplicated: boolean; rowCount: number };
          error?: { message?: string };
        };
        if (!res.ok) {
          toast.error(body.error?.message ?? `Upload of ${file.name} failed.`);
        } else if (body.data?.deduplicated) {
          toast.info(`${file.name} was already uploaded — no changes made.`);
        } else {
          toast.success(`${file.name} accepted: ${body.data?.rowCount.toLocaleString()} rows queued for parsing.`);
        }
      } catch {
        toast.error(`Upload of ${file.name} failed.`);
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
    await refresh();
  }

  async function remove(row: JobThaiBatchRow): Promise<void> {
    if (!window.confirm(`Delete ${row.filename}? Its ${row.postingsLoaded.toLocaleString()} postings are deleted too.`)) return;
    const res = await fetch(`/api/v1/admin/jobthai/batches/${row.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(`${row.filename} removed.`);
      await refresh();
    } else {
      toast.error(`Could not remove ${row.filename}.`);
    }
  }

  const totalPostings = rows.reduce((s, r) => s + r.postingsLoaded, 0);

  return (
    <div className="flex flex-col gap-[18px]">
      {/* The caveats travel as numbers, not adjectives, so nobody reads a
          Bangkok-weighted national dataset as a picture of the Isan market. */}
      <Card className="border-l-[3px] border-l-[oklch(var(--color-warning-default))] p-[14px]">
        <p className="text-[13px] leading-[1.6] text-fg-secondary">
          What this source can and cannot tell you. Of the 2026-09 drop,{' '}
          <strong className="text-fg-primary">37.0 percent</strong> of postings are in Bangkok and only{' '}
          <strong className="text-fg-primary">3.3 percent</strong> across the 20 Northeast provinces, Khon Kaen{' '}
          <strong className="text-fg-primary">304 postings</strong> — so it describes the national labour market
          rather than KKU&rsquo;s region. Only <strong className="text-fg-primary">0.8 percent</strong> mention a
          postgraduate qualification, leaving it near-blind to 179 of KKU&rsquo;s 297 programmes. The source carries
          no salary, no employer name and no posting date.
        </p>
      </Card>

      <Card className="p-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          <div>
            <h2 className="text-[15px] font-semibold text-fg-primary">Upload a drop</h2>
            <p className="mt-[4px] text-[13px] text-fg-muted">
              .xlsx only, up to 25 MB. The seven expected columns are checked before the file is stored.
            </p>
          </div>
          <div className="flex items-center gap-[10px]">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              multiple
              className="hidden"
              onChange={(e) => void upload(e.target.files)}
            />
            <Button variant="outline" onClick={() => void refresh()} disabled={busy}>
              <RefreshCw className="mr-[6px] h-[14px] w-[14px]" />
              Refresh
            </Button>
            <Button onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-[6px] h-[14px] w-[14px] animate-spin" />
              ) : (
                <Upload className="mr-[6px] h-[14px] w-[14px]" />
              )}
              Choose files
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between px-[18px] py-[14px]">
          <h2 className="text-[15px] font-semibold text-fg-primary">Batches</h2>
          <span className="text-[13px] text-fg-muted">
            {rows.length} {rows.length === 1 ? 'batch' : 'batches'}
            <span className="mx-[8px] text-fg-subtle">·</span>
            {totalPostings.toLocaleString()} postings loaded
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="px-[18px] pb-[18px] text-[13px] text-fg-muted">
            No drops uploaded yet. Upload the XLSX files JobThai sent to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-t border-t-subtle text-[12px] uppercase tracking-[0.04em] text-fg-muted">
                  <th className="px-[18px] py-[10px] font-medium">File</th>
                  <th className="px-[18px] py-[10px] font-medium">Received</th>
                  <th className="px-[18px] py-[10px] text-right font-medium">Rows</th>
                  <th className="px-[18px] py-[10px] text-right font-medium">Postings loaded</th>
                  <th className="px-[18px] py-[10px] font-medium">Status</th>
                  <th className="px-[18px] py-[10px]" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-t-subtle align-top">
                    <td className="px-[18px] py-[12px]">
                      <div className="font-medium text-fg-primary">{r.filename}</div>
                      <div className="mt-[2px] text-[12px] text-fg-muted">
                        {formatBytes(r.fileSize)}
                        {r.uploadedBy === null ? null : (
                          <>
                            <span className="mx-[6px] text-fg-subtle">·</span>
                            {r.uploadedBy}
                          </>
                        )}
                      </div>
                      {r.parseError === null ? null : (
                        <div className="mt-[6px] text-[12px] leading-[1.5] text-danger-default">{r.parseError}</div>
                      )}
                    </td>
                    <td className="px-[18px] py-[12px] text-fg-secondary">
                      {new Date(r.receivedDate).toLocaleDateString()}
                    </td>
                    <td className="px-[18px] py-[12px] text-right tabular-nums text-fg-secondary">
                      {r.rowCount.toLocaleString()}
                    </td>
                    <td className="px-[18px] py-[12px] text-right tabular-nums text-fg-secondary">
                      {r.postingsLoaded.toLocaleString()}
                    </td>
                    <td className="px-[18px] py-[12px]">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-[18px] py-[12px] text-right">
                      <Button variant="ghost" onClick={() => void remove(r)} aria-label={`Delete ${r.filename}`}>
                        <Trash2 className="h-[14px] w-[14px]" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
