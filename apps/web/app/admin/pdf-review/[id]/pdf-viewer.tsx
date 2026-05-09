'use client';

// PDF viewer split out from review-client into a separate dynamic
// chunk so react-pdf + pdfjs-dist (~110 kB minified) only land in the
// browser when this admin route actually renders. The parent imports
// it via `next/dynamic({ ssr: false })`. See:
//   docs/hardening/16-frontend.report.md §code-splitting.

import * as React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Button, Card } from '@kku/ui';

// Point react-pdf at the worker file served from /public. `scripts/
// copy-pdf-worker.mjs` copies it there during `pnpm dev`/`pnpm build`,
// versioned so cache-bust happens when pdfjs-dist bumps. Referencing
// via `new URL(..., import.meta.url)` would trigger Next's asset
// bundling + Terser minification, which chokes on the already-minified
// ES-module worker.
pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.${pdfjs.version}.mjs`;

interface Props {
  fileUrl: string;
}

export function PdfViewer({ fileUrl }: Props) {
  const [page, setPage] = React.useState(1);
  const [numPages, setNumPages] = React.useState<number | null>(null);

  return (
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
  );
}
