'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
import type { AiExtractionRow, PdfDetail } from './page';

// Lazy-load react-pdf + pdfjs (~110 kB) on the client only. Drops the
// initial-load cost of every other page that imports from this file's
// neighbours — react-pdf no longer ships in the route's first chunk.
const PdfViewer = dynamic(() => import('./pdf-viewer').then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => (
    <Card padding="none" className="overflow-hidden">
      <div className="flex h-[78vh] items-center justify-center text-text-tertiary">
        Loading PDF viewer…
      </div>
    </Card>
  ),
});

export function ReviewClient({
  pdf,
  fileUrl,
  aiExtractions,
}: {
  pdf: PdfDetail;
  fileUrl: string;
  aiExtractions: AiExtractionRow[];
}) {
  const router = useRouter();
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
      {/* Left: PDF viewer (lazy chunk — react-pdf + pdfjs) */}
      <PdfViewer fileUrl={fileUrl} />

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

        {aiExtractions.length > 0 && (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                AI analyses ({aiExtractions.length})
              </h3>
              <span className="text-[11px] text-text-tertiary">
                from chained AI jobs · /admin/extraction-review
              </span>
            </div>
            <p className="mb-3 text-xs text-text-tertiary">
              Real LLM-backed analyses (policy-doc.v1) produced by chained
              AI jobs. These are separate from the intake-pipeline
              extractions above and carry the meaningful Thai + English
              summaries, key directives, and sector tags.
            </p>
            <div className="flex flex-col gap-3">
              {aiExtractions.map((a) => (
                <div
                  key={a.id}
                  className="rounded-md border border-border-default bg-surface-0 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                    <span className="font-mono">{a.extractionKind}</span>
                    <span>·</span>
                    <span>{a.methodVersion}</span>
                    <span>·</span>
                    <span>{new Date(a.createdAt).toLocaleString()}</span>
                    <Badge tone={reviewTone(a.reviewStatus)} className="ml-auto">
                      {a.reviewStatus}
                    </Badge>
                    <ConfidenceBadge value={a.confidence} />
                  </div>
                  {a.reasoning && (
                    <div className="mb-2 rounded bg-surface-2 p-2 text-xs text-text-secondary">
                      {a.reasoning}
                    </div>
                  )}
                  <pre className="max-h-72 overflow-auto rounded border border-border-subtle bg-surface-1 p-2 text-xs">
                    {JSON.stringify(a.payloadJson, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </Card>
        )}

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
            {selected.extractionType === 'CURRICULUM_SPEC' && (
              <ApplyToProgramPanel
                extractionId={selected.id}
                pdfId={pdf.id}
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

// Apply-to-program — lets the admin pick a target Program (by code search)
// and materialize the CURRICULUM_SPEC payload onto the Program row. The
// PDF is then attached with role=CURRENT_CURRICULUM.
//
// Keeps the picker minimal on purpose — auto-complete is a nice-to-have
// but a code textbox is enough for the "one PDF at a time" admin flow.
function ApplyToProgramPanel({
  extractionId,
  pdfId: _pdfId,
}: {
  extractionId: string;
  pdfId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<
    Array<{ id: string; code: string; nameEn: string; nameTh: string }>
  >([]);
  const [target, setTarget] = React.useState<{
    id: string;
    code: string;
    nameEn: string;
  } | null>(null);
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    // Short-debounce lookup against /admin/programs.
    if (!query || query.length < 2) {
      setOptions([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await fetch(
        `/api/admin-programs?q=${encodeURIComponent(query)}&pageSize=10`,
      );
      if (!res.ok) return;
      const json = await res.json();
      const rows = (json?.data ?? []) as Array<{
        id: string;
        code: string;
        nameEn: string;
        nameTh: string;
      }>;
      setOptions(rows);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const apply = async () => {
    if (!target) return;
    setApplying(true);
    try {
      const res = await fetch(
        `/api/admin-programs/${target.id}/apply-extraction/${extractionId}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ attachAsCurrent: true }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success(`Applied to ${target.code}. Program fields updated.`);
      router.push(`/admin/programs/${target.id}`);
    } catch (err) {
      toast.error(`Apply failed: ${(err as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <Label>Apply to program</Label>
      <p className="text-xs text-text-tertiary">
        Pick a program — this extraction&apos;s fields will be written onto it, and the
        PDF attached as the current curriculum.
      </p>
      {target ? (
        <div className="flex items-center justify-between rounded-md border border-border-default bg-surface-1 px-3 py-2 text-sm">
          <div>
            <span className="font-tabular font-medium">{target.code}</span>
            {' · '}
            <span>{target.nameEn}</span>
          </div>
          <Button variant="ghost" size="xs" onClick={() => setTarget(null)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code or name"
          />
          {options.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-md border border-border-default bg-surface-0 shadow-lg">
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setTarget(o)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-1"
                >
                  <span className="font-tabular text-xs text-text-tertiary">
                    {o.code}
                  </span>
                  <span className="flex-1 truncate">{o.nameEn}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={apply} disabled={!target || applying}>
          {applying ? 'Applying…' : 'Apply extraction to program'}
        </Button>
      </div>
    </div>
  );
}
