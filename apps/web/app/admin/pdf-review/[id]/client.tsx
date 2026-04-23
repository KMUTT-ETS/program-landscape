'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  Input,
  Label,
} from '@kku/ui';
import {
  approveExtractionAction,
  rejectExtractionAction,
  reExtractAction,
} from '@/lib/actions/pdf-review';
import type { PdfDetail } from './page';

// Point react-pdf at the worker file served from /public. `scripts/
// copy-pdf-worker.mjs` copies it there during `pnpm dev`/`pnpm build`,
// versioned so cache-bust happens when pdfjs-dist bumps. Referencing
// via `new URL(..., import.meta.url)` would trigger Next's asset
// bundling + Terser minification, which chokes on the already-minified
// ES-module worker.
pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.${pdfjs.version}.mjs`;

export function ReviewClient({ pdf, fileUrl }: { pdf: PdfDetail; fileUrl: string }) {
  const router = useRouter();
  const [page, setPage] = React.useState(1);
  const [numPages, setNumPages] = React.useState<number | null>(null);
  const [selectedExtractionId, setSelectedExtractionId] = React.useState<string | null>(
    pdf.extractions[0]?.id ?? null,
  );
  const selected = pdf.extractions.find((e) => e.id === selectedExtractionId);

  const onApprove = async (notes?: string) => {
    if (!selected) return;
    const res = await approveExtractionAction(selected.id, notes, undefined);
    if (res.ok) {
      toast.success('Extraction approved');
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  const onReject = async () => {
    if (!selected) return;
    const notes = window.prompt('Why is this extraction being rejected?');
    if (!notes) return;
    const res = await rejectExtractionAction(selected.id, notes);
    if (res.ok) {
      toast.success('Extraction rejected');
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  const onReExtract = async () => {
    const res = await reExtractAction(pdf.id);
    if (res.ok) {
      toast.success('Re-extraction queued');
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      {/* Left: PDF viewer */}
      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-default bg-surface-2 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Prev
            </Button>
            <span className="font-tabular text-text-secondary">
              Page {page}
              {numPages ? ` / ${numPages}` : ''}
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setPage((p) => (numPages ? Math.min(numPages, p + 1) : p + 1))}
              disabled={numPages !== null && page >= numPages}
            >
              Next →
            </Button>
          </div>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent underline"
          >
            Open raw
          </a>
        </div>
        <div className="flex max-h-[78vh] justify-center overflow-auto bg-surface-0 p-4">
          <Document
            file={fileUrl}
            onLoadSuccess={(info) => setNumPages(info.numPages)}
            loading={<div className="p-6 text-text-tertiary">Loading PDF…</div>}
            error={<div className="p-6 text-danger">Failed to load PDF</div>}
          >
            <Page pageNumber={page} width={720} renderAnnotationLayer renderTextLayer />
          </Document>
        </div>
      </Card>

      {/* Right: extractions + actions */}
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Classification</h3>
              <p className="text-xs text-text-tertiary">
                {pdf.sourceCategoryHint
                  ? `Uploader hint: ${pdf.sourceCategoryHint}`
                  : 'No uploader hint'}
              </p>
            </div>
            <Badge tone="neutral">{pdf.sourceCategory}</Badge>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-text-secondary">
            <span>Language: {pdf.language}</span>
            <span>·</span>
            <span>
              {pdf.ocrApplied
                ? `OCR ${pdf.ocrConfidence !== null ? `(${Math.round(pdf.ocrConfidence * 100)}%)` : ''}`
                : 'native text'}
            </span>
            {pdf.classificationConfidence !== null && (
              <>
                <span>·</span>
                <span>cls conf {Math.round(pdf.classificationConfidence * 100)}%</span>
              </>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Extractions ({pdf.extractions.length})</h3>
            <Button size="xs" variant="outline" onClick={() => void onReExtract()}>
              Re-extract
            </Button>
          </div>
          {pdf.extractions.length === 0 ? (
            <p className="text-sm text-text-tertiary">
              No extractions yet. Upload produced a PdfDocument; the worker will pick it up shortly.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {pdf.extractions.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedExtractionId(e.id)}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                    e.id === selectedExtractionId
                      ? 'border-accent bg-accent-subtle'
                      : 'border-border-default hover:bg-surface-2'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{e.extractionType}</div>
                    <div className="truncate text-xs text-text-tertiary">
                      {e.methodVersion} · {e.reviewStatus}
                    </div>
                  </div>
                  <ConfidenceBadge value={e.confidence} />
                </button>
              ))}
            </div>
          )}
        </Card>

        {selected && (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Extracted payload</h3>
              <Badge tone={reviewTone(selected.reviewStatus)}>{selected.reviewStatus}</Badge>
            </div>
            {selected.reasoning && (
              <div className="mb-3 rounded-md bg-surface-2 p-3 text-xs text-text-secondary">
                <div className="font-medium">Reasoning</div>
                <div>{selected.reasoning}</div>
              </div>
            )}
            <pre className="max-h-64 overflow-auto rounded-md border border-border-default bg-surface-0 p-3 text-xs">
              {JSON.stringify(selected.payloadJson, null, 2)}
            </pre>
            {selected.reviewStatus === 'PENDING_REVIEW' && (
              <ApprovalPanel
                onApprove={(notes) => void onApprove(notes)}
                onReject={() => void onReject()}
              />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function ApprovalPanel({
  onApprove,
  onReject,
}: {
  onApprove: (notes?: string) => void;
  onReject: () => void;
}) {
  const [notes, setNotes] = React.useState('');
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <Label>Approval notes (optional)</Label>
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Short note — e.g., verified titleTh against cover page"
      />
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => onApprove(notes || undefined)}>
          Approve
        </Button>
        <Button variant="danger" size="sm" onClick={() => onReject()}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function reviewTone(
  status: 'PENDING_REVIEW' | 'AUTO_APPROVED' | 'APPROVED' | 'REJECTED',
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'APPROVED' || status === 'AUTO_APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING_REVIEW') return 'warning';
  return 'neutral';
}
