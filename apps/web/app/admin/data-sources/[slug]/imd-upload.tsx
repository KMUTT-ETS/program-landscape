'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Section } from '@kku/ui';
import { Upload, FileText, ArrowRight } from 'lucide-react';

interface UploadResult {
  uploaded: Array<{ id: string; originalFilename: string; processingStatus: string }>;
}

interface ExtractResult {
  jobId: string;
  pdfId: string;
}

// Two-step widget: upload PDF → enqueue extract → toast + extraction-review
// link. Shown on /admin/data-sources/imd-rankings only.

export function ImdUploadWidget() {
  const [uploading, setUploading] = React.useState(false);
  const [recent, setRecent] = React.useState<Array<{
    pdfId: string;
    filename: string;
    jobId: string;
    extractionPath: string;
  }>>([]);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      // 1. Upload PDF(s) via the standard route — pre-tagged with
      //    sourceCategoryHint=REPORT and sourceOrg=IMD so the row
      //    is identifiable in /admin/pdf-review.
      const form = new FormData();
      for (const f of Array.from(files)) form.append('files', f);
      form.append('sourceCategoryHint', 'REPORT');
      form.append('sourceOrg', 'IMD World Competitiveness Center, Lausanne');
      form.append('language', 'EN');

      const upRes = await fetch('/api/admin-pdfs/upload', {
        method: 'POST',
        body: form,
      });
      if (!upRes.ok) {
        const j = await upRes.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Upload failed (HTTP ${upRes.status})`);
      }
      const upJson = await upRes.json();
      const upResult = (upJson.data ?? upJson) as UploadResult;
      const uploadedItems = upResult.uploaded ?? [];

      // 2. For each uploaded PDF, enqueue the IMD extract job.
      const newRows: typeof recent = [];
      for (const item of uploadedItems) {
        const exRes = await fetch(
          `/api/admin-imd/extract/${encodeURIComponent(item.id)}`,
          { method: 'POST' },
        );
        if (!exRes.ok) {
          const j = await exRes.json().catch(() => ({}));
          toast.error(`${item.originalFilename}: ${j?.error?.message ?? `enqueue failed (HTTP ${exRes.status})`}`);
          continue;
        }
        const exJson = await exRes.json();
        const exData = (exJson.data ?? exJson) as ExtractResult;
        toast.success(`${item.originalFilename} uploaded — extraction job ${exData.jobId.slice(0, 8)} queued`);
        newRows.push({
          pdfId: item.id,
          filename: item.originalFilename,
          jobId: exData.jobId,
          extractionPath: '/admin/extraction-review',
        });
      }
      setRecent((prev) => [...newRows, ...prev]);
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Section title="Upload IMD ranking PDF">
      <div className="rounded-lg border border-border-default bg-surface-1 p-4">
        <p className="mb-3 text-sm text-text-secondary">
          Drop the annual <span className="font-semibold">WCY</span>,{' '}
          <span className="font-semibold">WTR</span>, or{' '}
          <span className="font-semibold">WDCR</span> public summary PDF from{' '}
          <a
            href="https://imd.org/wcc"
            target="_blank"
            rel="noopener"
            className="text-accent-default hover:underline"
          >
            imd.org/wcc
          </a>{' '}
          here. The file uploads, then the imd-rankings.v1 AI extractor runs
          and produces a row at{' '}
          <Link href="/admin/extraction-review" className="text-accent-default hover:underline">
            /admin/extraction-review
          </Link>{' '}
          for analyst sign-off. Approving the extraction upserts the rankings
          into the IMD tables automatically.
        </p>

        <div className="flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            multiple
            disabled={uploading}
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
            id="imd-upload"
          />
          <Button
            variant="primary"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading…' : 'Pick PDF(s)'}
          </Button>
          <p className="text-xs text-text-tertiary">
            Filename hints — the extractor pulls dataset (WCY / WTR / WDCR) and
            year from the filename. Use names like{' '}
            <code className="font-mono">IMD-WCY-2024.pdf</code> when possible.
          </p>
        </div>

        {recent.length > 0 && (
          <div className="mt-4 border-t border-border-subtle pt-3">
            <h4 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
              Just uploaded
            </h4>
            <ul className="space-y-1 text-sm">
              {recent.map((r) => (
                <li key={r.pdfId} className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-text-tertiary" />
                  <span className="truncate">{r.filename}</span>
                  <span className="font-mono text-xs text-text-tertiary">
                    job {r.jobId.slice(0, 8)}
                  </span>
                  <Link
                    href={r.extractionPath}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-accent-default hover:underline"
                  >
                    Review when ready <ArrowRight className="h-3 w-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
