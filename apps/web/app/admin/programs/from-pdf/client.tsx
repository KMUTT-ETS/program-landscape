'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge, Button, Card, Input, Label } from '@kku/ui';
import { FilterSearch } from '@/components/filter-rail';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  FilePlus2,
  FileStack,
  FileUp,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';

interface Faculty {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
}
interface Department {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  facultyId: string;
}

interface CollisionMatch {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  status: string;
  reasons: Array<
    'same_code' | 'same_name_th' | 'same_name_en' | 'same_degree_same_department'
  >;
}

interface CollisionReport {
  hasHard: boolean;
  hasSoft: boolean;
  matches: CollisionMatch[];
}

interface Extraction {
  id: string;
  extractionType: string;
  confidence: number;
  methodVersion: string;
  reviewStatus: string;
  payloadJson: {
    programCode?: string;
    programNameTh?: string;
    programNameEn?: string;
    facultyNameTh?: string;
    departmentNameTh?: string;
    level?: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
    totalCredits?: number;
    durationYears?: number;
    curriculumYear?: number;
    isRevision?: boolean;
    previousCurriculumYearBE?: number;
  };
}

interface PdfAfterUpload {
  pdfDocumentId: string;
  originalFilename: string;
  processingStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  processingError?: string | null;
  extractions: Extraction[];
}

interface TargetProgram {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
}

// The "current" extractor is the Gemini one — any row with this method
// version is considered authoritative. Anything else (the old stub-v1,
// or the heuristic-v1 regex fallback) is treated as "not yet AI-verified"
// and won't be used to pre-fill the form. Bump this string when the
// extractor version bumps.
const CURRENT_METHOD_VERSION = 'gemini-v1';

function usableExtraction(pdf: PdfAfterUpload): Extraction | null {
  const current = pdf.extractions.find(
    (e) =>
      e.extractionType === 'CURRICULUM_SPEC' &&
      e.methodVersion === CURRENT_METHOD_VERSION &&
      e.confidence > 0,
  );
  return current ?? null;
}

// The programme exists at this point (either just created, or already
// existed and just got a new document attached). A failed enqueue is
// recoverable from the detail page, so warn and continue rather than
// surfacing it as a hard failure — that would tell the operator the
// programme/attachment didn't succeed when it did. Shared by FillStep
// (new-programme submit) and ReviseStep (revision attach).
async function firePipeline(programId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin-programs/${programId}/run-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: false }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
    }
    return true;
  } catch (err) {
    toast.warning(
      `Saved, but pipeline enqueue failed: ${(err as Error).message}. Run pipeline from the program page when ready.`,
    );
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Main wizard
// ─────────────────────────────────────────────────────────────────────────

export function FromPdfClient({
  faculties,
  departments,
}: {
  faculties: Faculty[];
  departments: Department[];
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<'mode' | 'upload' | 'fill'>('mode');
  // null = new programme; a programme = revise that one. Chosen before
  // upload, never inferred: checkCollision cannot detect a revision (a
  // revised มคอ.2 carries a different code, and the name rules need a
  // facultyId that comes from a fragile substring match), so inferring it
  // would fail silently toward creating a duplicate.
  const [target, setTarget] = React.useState<TargetProgram | null>(null);
  const [pdf, setPdf] = React.useState<PdfAfterUpload | null>(null);
  const [extractionState, setExtractionState] = React.useState<
    'idle' | 'waiting' | 'ready' | 'timeout' | 'failed'
  >('idle');
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  // Keep an "elapsed" ticker running while we're waiting. Purely cosmetic
  // but removes the illusion that the page is frozen.
  React.useEffect(() => {
    if (extractionState !== 'waiting') return;
    const start = Date.now();
    const t = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(t);
  }, [extractionState]);

  if (step === 'mode') {
    return (
      <ModeStep
        onNew={() => {
          setTarget(null);
          setStep('upload');
        }}
        onRevise={(p) => {
          setTarget(p);
          setStep('upload');
        }}
      />
    );
  }

  if (step === 'upload' || !pdf) {
    return (
      <UploadStep
        onUploaded={async (result) => {
          setPdf(result);
          setStep('fill');
          // Has a Gemini extraction already? If so, we're ready
          // immediately (upload → dedup + cached extraction).
          if (usableExtraction(result)) {
            setExtractionState('ready');
            return;
          }
          if (result.processingStatus === 'FAILED') {
            setExtractionState('failed');
            return;
          }
          // Otherwise poll. The pipeline typically takes 5-20 seconds for
          // a medium PDF — Gemini 3 Flash preview is ~2-4s plus pdfjs
          // parsing + queue overhead.
          setExtractionState('waiting');
          setElapsedSeconds(0);
          const finalDetail = await pollForUsableExtraction(
            result.pdfDocumentId,
          );
          if (finalDetail) setPdf(finalDetail);
          if (finalDetail && usableExtraction(finalDetail)) {
            setExtractionState('ready');
          } else if (finalDetail?.processingStatus === 'FAILED') {
            setExtractionState('failed');
          } else {
            setExtractionState('timeout');
          }
        }}
      />
    );
  }

  if (target) {
    return (
      <ReviseStep
        target={target}
        pdf={pdf}
        extraction={usableExtraction(pdf)}
        onDone={(programId) => router.push(`/admin/programs/${programId}`)}
      />
    );
  }

  return (
    <FillStep
      pdf={pdf}
      target={target}
      extraction={usableExtraction(pdf)}
      extractionState={extractionState}
      elapsedSeconds={elapsedSeconds}
      faculties={faculties}
      departments={departments}
      onCreated={(programId) => router.push(`/admin/programs/${programId}`)}
      onBack={() => {
        setPdf(null);
        setStep('upload');
        setExtractionState('idle');
      }}
      onRetryExtract={async () => {
        setExtractionState('waiting');
        setElapsedSeconds(0);
        // Re-trigger extraction on the existing PDF via the intake re-
        // extract admin route, then poll.
        await fetch(`/api/admin-pdfs-re-extract/${pdf.pdfDocumentId}`, {
          method: 'POST',
        }).catch(() => null);
        const finalDetail = await pollForUsableExtraction(pdf.pdfDocumentId);
        if (finalDetail) setPdf(finalDetail);
        if (finalDetail && usableExtraction(finalDetail)) {
          setExtractionState('ready');
        } else if (finalDetail?.processingStatus === 'FAILED') {
          setExtractionState('failed');
        } else {
          setExtractionState('timeout');
        }
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Step 1: mode — new programme, or revision of an existing one
// ─────────────────────────────────────────────────────────────────────────

function ModeStep({
  onNew,
  onRevise,
}: {
  onNew: () => void;
  onRevise: (p: TargetProgram) => void;
}) {
  const [mode, setMode] = React.useState<'new' | 'revision' | null>(null);
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<TargetProgram[]>([]);

  // Same debounced-search-against-/admin/programs pattern as the working
  // "apply to program" picker in /admin/pdf-review/[id] — see that file's
  // ApplyToProgramPanel for the reference implementation.
  React.useEffect(() => {
    if (mode !== 'revision' || query.trim().length < 2) {
      setOptions([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await fetch(
        `/api/admin-programs?q=${encodeURIComponent(query)}&pageSize=10`,
      );
      if (!res.ok) return;
      const json = await res.json();
      setOptions((json?.data ?? []) as TargetProgram[]);
    }, 250);
    return () => clearTimeout(handle);
  }, [mode, query]);

  return (
    <Card padding="lg">
      <h2 className="text-sm font-semibold text-text-primary">
        Step 1 of 3 · What are you submitting?
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        This decides where the file lands. It is asked rather than guessed —
        a revised มคอ.2 usually carries a new code, so duplicate detection
        cannot tell a revision from a genuinely new programme.
      </p>

      {/* Native radios inside labels: real keyboard semantics (arrow keys
          move between options, space selects) for free, no ARIA to keep in
          sync. The input is sr-only; the label IS the visible control. */}
      <fieldset className="mt-4">
        <legend className="sr-only">Submission type</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <ModeCard
            value="new"
            checked={mode === 'new'}
            onSelect={() => setMode('new')}
            icon={<FilePlus2 className="size-icon-lg" />}
            title="A new programme"
            description="Not yet in the system. Creates the programme record from the file's extracted details."
          />
          <ModeCard
            value="revision"
            checked={mode === 'revision'}
            onSelect={() => setMode('revision')}
            icon={<FileStack className="size-icon-lg" />}
            title="A revised curriculum"
            description="Replaces the current file on a programme that already exists. The old file is kept as a previous version."
          />
        </div>
      </fieldset>

      {mode === 'new' && (
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={onNew}>
            Continue
            <ArrowRight className="size-icon-md" aria-hidden />
          </Button>
        </div>
      )}

      {mode === 'revision' && (
        <div className="mt-5 border-t border-border-subtle pt-5">
          <Label htmlFor="revise-target">Which programme is being revised?</Label>
          <div className="mt-2">
            <FilterSearch
              id="revise-target"
              value={query}
              onChange={setQuery}
              placeholder="Search by code or name (TH or EN)…"
            />
          </div>

          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="mt-2 text-xs text-text-tertiary">
              Keep typing — search starts at two characters.
            </p>
          )}

          {query.trim().length >= 2 && options.length === 0 && (
            <p className="mt-3 text-sm text-text-secondary">
              No programme matches “{query.trim()}”. If it genuinely is not in
              the system yet, choose “A new programme” above.
            </p>
          )}

          {options.length > 0 && (
            <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
              {options.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onRevise(p)}
                    className="group flex w-full items-center gap-8 bg-surface-1 px-3 py-2.5 text-left transition-colors hover:bg-accent-subtle/40 focus-visible:bg-accent-subtle/40 focus-visible:outline-none"
                  >
                    {/* Fixed column, not just a flex gap: the code and the
                        Thai name are both text and read as one run when only
                        whitespace separates them. A column also lets the eye
                        scan the names down a straight edge. */}
                    <span className="font-tabular w-48 shrink-0 text-xs text-text-tertiary">
                      {p.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                      {p.nameTh}
                    </span>
                    <ArrowRight
                      className="size-icon-md shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// A selectable card. The visible control is the <label>; the radio itself is
// sr-only, which keeps native keyboard behaviour (arrows move, space picks)
// without hand-rolled ARIA. The focus ring is a separate overlay span driven
// by `peer-focus-visible` — a parent cannot style itself from a child's focus.
function ModeCard({
  value,
  checked,
  onSelect,
  icon,
  title,
  description,
}: {
  value: string;
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      className={[
        'relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-all duration-200',
        checked
          ? 'border-accent-default bg-accent-subtle/50 shadow-elevation-2'
          : 'border-border-subtle bg-surface-1 hover:border-accent-default/60 hover:bg-surface-2/40 hover:shadow-elevation-1',
      ].join(' ')}
    >
      <input
        type="radio"
        name="submission-mode"
        value={value}
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 ring-2 ring-accent-default transition-opacity peer-focus-visible:opacity-100"
      />

      <span className="flex items-start justify-between gap-3">
        <span
          className={[
            // Border, not just a fill: on a surface-1 card the surface-3
            // tint alone is too close in value to read as a container, and
            // the glyph looks like it is floating. Same idiom as the
            // admin console tiles.
            'flex h-11 w-11 items-center justify-center rounded-xl border transition-colors',
            checked
              ? 'border-accent-default/40 bg-accent-default/15 text-accent-default'
              : 'border-border-default bg-surface-2 text-text-secondary',
          ].join(' ')}
        >
          {icon}
        </span>
        <span
          className={[
            'flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
            checked
              ? 'border-accent-default bg-accent-default text-accent-fg'
              : 'border-border-default bg-surface-1',
          ].join(' ')}
        >
          {checked && <Check className="size-icon-xs" aria-hidden />}
        </span>
      </span>

      <span className="block">
        <span className="block text-sm font-semibold text-text-primary">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-text-secondary">
          {description}
        </span>
      </span>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2: upload
// ─────────────────────────────────────────────────────────────────────────

function UploadStep({
  onUploaded,
}: {
  onUploaded: (result: PdfAfterUpload) => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('files', file);
      form.append('sourceCategoryHint', 'CURRICULUM');
      form.append('language', 'TH');

      const res = await fetch('/api/admin-pdfs/upload', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      const first = json?.data?.uploaded?.[0];
      if (!first?.pdfDocumentId) {
        throw new Error('Upload succeeded but no pdfDocumentId returned');
      }
      const detail = await fetchPdfDetail(first.pdfDocumentId);
      onUploaded(
        detail ?? {
          pdfDocumentId: first.pdfDocumentId,
          originalFilename: file.name,
          processingStatus: 'PENDING',
          extractions: [],
        },
      );
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-text-primary">
          Step 2 of 3 · Upload มคอ.2 PDF
        </h3>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f && (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))) {
              setFile(f);
            }
          }}
          className={`flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed ${
            dragOver ? 'border-accent bg-accent-subtle' : 'border-border-default bg-surface-1'
          } p-8 text-center transition-colors`}
        >
          <FileUp className="h-8 w-8 text-text-tertiary" aria-hidden />
          {file ? (
            <>
              <div className="font-medium text-text-primary">{file.name}</div>
              <div className="text-xs text-text-tertiary">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-text-secondary">
                Drag a PDF here, or{' '}
                <label className="cursor-pointer text-accent underline">
                  browse
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setFile(f);
                    }}
                  />
                </label>
              </div>
              <div className="text-xs text-text-tertiary">Max 50&nbsp;MB</div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={upload} disabled={!file || uploading}>
            <Upload className="size-icon-md" aria-hidden />
            {uploading ? 'Uploading…' : 'Upload & continue'}
          </Button>
          {file && !uploading && (
            <Button variant="ghost" onClick={() => setFile(null)}>
              Choose different file
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Step 3: fill form + collision check + create
// ─────────────────────────────────────────────────────────────────────────

type ExtractionState = 'idle' | 'waiting' | 'ready' | 'timeout' | 'failed';

interface FillStepProps {
  pdf: PdfAfterUpload;
  // Always null in practice: FromPdfClient renders ReviseStep instead of
  // FillStep once `target` is set (the revision submission path — attach
  // document only, no identity form). Kept as a prop (rather than dropped)
  // so the "Revising <code>" display line and the isRevision cross-check
  // warning below stay correct if that routing ever changes.
  target: TargetProgram | null;
  extraction: Extraction | null;
  extractionState: ExtractionState;
  elapsedSeconds: number;
  faculties: Faculty[];
  departments: Department[];
  onCreated: (programId: string) => void;
  onBack: () => void;
  onRetryExtract: () => void | Promise<void>;
}

function FillStep({
  pdf,
  target,
  extraction,
  extractionState,
  elapsedSeconds,
  faculties,
  departments,
  onCreated,
  onBack,
  onRetryExtract,
}: FillStepProps) {
  const payload = extraction?.payloadJson ?? {};

  // The form state is initialised once on mount. When extraction arrives
  // LATE (user was on step 2 during `waiting`), re-seed fields that are
  // still empty — don't overwrite anything the user has already typed.
  const [form, setForm] = React.useState(() => ({
    code: payload.programCode ?? '',
    nameTh: payload.programNameTh ?? '',
    nameEn: payload.programNameEn ?? '',
    facultyId: matchFacultyId(payload.facultyNameTh, faculties) ?? '',
    departmentId: '',
    level: (payload.level ?? 'BACHELOR') as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
    yearEstablished: '',
  }));

  // Re-seed when extraction finally arrives (only empty fields).
  const seededIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!extraction || seededIdRef.current === extraction.id) return;
    seededIdRef.current = extraction.id;
    setForm((prev) => ({
      ...prev,
      code: prev.code || (payload.programCode ?? ''),
      nameTh: prev.nameTh || (payload.programNameTh ?? ''),
      nameEn: prev.nameEn || (payload.programNameEn ?? ''),
      facultyId:
        prev.facultyId || (matchFacultyId(payload.facultyNameTh, faculties) ?? ''),
      level: payload.level ?? prev.level,
    }));
    // Deliberately keyed on the extraction id alone. `seededIdRef` already
    // enforces "seed once per extraction", and `payload` is a fresh object
    // literal on every render (`extraction?.payloadJson ?? {}`) — putting it
    // or `faculties` in the deps would re-run this on every render for no
    // gain. `setForm`'s updater reads `prev`, so nothing here goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraction?.id]);

  const [report, setReport] = React.useState<CollisionReport | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [force, setForce] = React.useState(false);

  const filteredDepts = form.facultyId
    ? departments.filter((d) => d.facultyId === form.facultyId)
    : [];

  React.useEffect(() => {
    if (!form.code && !form.nameTh && !form.nameEn) {
      setReport(null);
      return;
    }
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch('/api/admin-programs/check-collision', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: form.code || undefined,
            nameTh: form.nameTh || undefined,
            nameEn: form.nameEn || undefined,
            facultyId: form.facultyId || undefined,
            departmentId: form.departmentId || null,
            level: form.level,
          }),
        });
        if (!res.ok) return;
        const json = await res.json();
        setReport(json.data as CollisionReport);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form.code, form.nameTh, form.nameEn, form.facultyId, form.departmentId, form.level]);

  const blocking =
    !form.code.trim() ||
    !form.nameTh.trim() ||
    !form.nameEn.trim() ||
    !form.facultyId ||
    (report?.hasHard ?? false) ||
    (report?.hasSoft && !force);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        code: form.code.trim(),
        nameTh: form.nameTh.trim(),
        nameEn: form.nameEn.trim(),
        facultyId: form.facultyId,
        departmentId: form.departmentId || null,
        level: form.level,
        yearEstablished: form.yearEstablished
          ? Number(form.yearEstablished)
          : null,
        attachPdfId: pdf.pdfDocumentId,
        force,
      };
      // Only apply the extraction when it's the current (Gemini) method.
      if (extraction) {
        body.applyExtractionId = extraction.id;
      }
      const res = await fetch('/api/admin-programs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      const created = json.data as { id: string };
      await firePipeline(created.id);
      toast.success('Program created; PDF attached and analysis started.');
      onCreated(created.id);
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card tone="quiet">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wide text-text-tertiary">
              Uploaded PDF
            </div>
            <div className="font-medium text-text-primary">{pdf.originalFilename}</div>
            {target && (
              <div className="text-xs text-text-secondary">
                Revising{' '}
                <span className="font-tabular font-medium text-text-primary">
                  {target.code}
                </span>{' '}
                · {target.nameTh}
              </div>
            )}
            <div className="text-xs text-text-secondary">
              Status:{' '}
              <Badge
                tone={
                  pdf.processingStatus === 'COMPLETED'
                    ? 'success'
                    : pdf.processingStatus === 'FAILED'
                      ? 'danger'
                      : 'info'
                }
              >
                {pdf.processingStatus.toLowerCase()}
              </Badge>
              {' · '}
              <ExtractionStatusBadge
                state={extractionState}
                extraction={extraction}
                elapsedSeconds={elapsedSeconds}
              />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button variant="outline" size="sm" onClick={onBack} disabled={extractionState === 'waiting'}>
              Upload different file
            </Button>
            {(extractionState === 'timeout' || extractionState === 'failed') && (
              <Button variant="ghost" size="sm" onClick={() => void onRetryExtract()}>
                Retry AI extraction
              </Button>
            )}
          </div>
        </div>

        <ExtractionBanner
          state={extractionState}
          extraction={extraction}
          processingError={pdf.processingError ?? null}
          elapsedSeconds={elapsedSeconds}
        />

        {extraction && (
          <div className="mt-3 rounded-md border border-border-subtle bg-surface-0 p-3 text-xs text-text-secondary">
            <div className="mb-1 flex items-center gap-1 font-medium text-text-primary">
              <Sparkles className="size-icon-sm text-accent" aria-hidden />
              Auto-extracted fields pre-filled below
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-3">
              {payload.programCode && <span>Code: <b>{payload.programCode}</b></span>}
              {payload.level && <span>Level: <b>{payload.level}</b></span>}
              {payload.totalCredits != null && (
                <span>Credits: <b>{payload.totalCredits}</b></span>
              )}
              {payload.durationYears != null && (
                <span>Years: <b>{payload.durationYears}</b></span>
              )}
              {payload.curriculumYear != null && (
                <span>Curriculum year: <b>{payload.curriculumYear}</b></span>
              )}
            </div>
          </div>
        )}
      </Card>

      {!target && payload.isRevision === true && (
        <Card padding="sm">
          <p className="text-xs text-text-secondary">
            This document appears to be a revision of an existing curriculum
            {payload.previousCurriculumYearBE
              ? ` (previous year พ.ศ. ${payload.previousCurriculumYearBE})`
              : ''}
            . If this programme already exists, go back and choose
            &ldquo;a revised curriculum&rdquo; instead of creating a duplicate.
          </p>
        </Card>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-text-primary">
            Step 3 of 3 · Review identity + check for duplicates
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Code *">
              <Input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. AG-AGR-BSC-2565"
              />
            </Field>
            <Field label="Level *">
              <select
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value as typeof form.level })}
                className="kku-select"
              >
                <option value="BACHELOR">Bachelor</option>
                <option value="MASTER">Master</option>
                <option value="DOCTORAL">Doctoral</option>
                <option value="HIGHER_GRAD_DIPLOMA">Higher Grad. Diploma</option>
              </select>
            </Field>
            <Field label="Name (Thai) *">
              <Input
                required
                value={form.nameTh}
                onChange={(e) => setForm({ ...form, nameTh: e.target.value })}
              />
            </Field>
            <Field label="Name (English) *">
              <Input
                required
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              />
            </Field>
            <Field label="Faculty *">
              <select
                required
                value={form.facultyId}
                onChange={(e) =>
                  setForm({ ...form, facultyId: e.target.value, departmentId: '' })
                }
                className="kku-select"
              >
                <option value="">— Select faculty —</option>
                {faculties.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nameEn}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <select
                value={form.departmentId}
                disabled={!form.facultyId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className="kku-select disabled:opacity-50"
              >
                <option value="">— None / Faculty-level —</option>
                {filteredDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nameEn}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Year established">
              <Input
                type="number"
                value={form.yearEstablished}
                placeholder="2508"
                onChange={(e) => setForm({ ...form, yearEstablished: e.target.value })}
              />
            </Field>
          </div>

          <CollisionPanel
            report={report}
            checking={checking}
            force={force}
            onToggleForce={setForce}
          />

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" disabled={blocking || creating || extractionState === 'waiting'}>
              {creating
                ? 'Creating…'
                : extraction
                  ? 'Create program + apply extraction'
                  : 'Create program'}
            </Button>
            <Button type="button" variant="outline" onClick={onBack} disabled={extractionState === 'waiting'}>
              Back
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Step 3 (revision path): confirm + attach — no identity form. The
// programme's identity already exists; only the document changes here. The
// programme's header columns (nameTh, nameEn, totalCredits, …) are
// deliberately left untouched — attachDocument() only attaches. Overwriting
// them from the extraction payload belongs to apply-extraction, which this
// path does not call; see the module comment on firePipeline for why a
// failed pipeline enqueue doesn't block success here either.
// ─────────────────────────────────────────────────────────────────────────

function ReviseStep({
  target,
  pdf,
  extraction,
  onDone,
}: {
  target: TargetProgram;
  pdf: PdfAfterUpload;
  extraction: Extraction | null;
  onDone: (programId: string) => void;
}) {
  const payload = extraction?.payloadJson ?? {};
  const [yearBE, setYearBE] = React.useState<string>(
    payload.curriculumYear != null ? String(payload.curriculumYear) : '',
  );
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      // Attach only — deliberately NOT apply-extraction, which would also
      // overwrite the programme's header columns from the payload with no
      // record and no diff. The metadata update happens when the pipeline
      // re-digests, where it IS recorded (metadataProposalJson + an audit
      // row on the revision).
      const res = await fetch(`/api/admin-programs/${target.id}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pdfDocumentId: pdf.pdfDocumentId,
          role: 'CURRENT_CURRICULUM',
          promoteToCurrent: true,
          curriculumYearBE: yearBE ? Number(yearBE) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      await firePipeline(target.id);
      toast.success('Revised curriculum attached; analysis started.');
      onDone(target.id);
    } catch (err) {
      toast.error(`Attach failed: ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <Card padding="md">
      <h2 className="text-sm font-semibold text-text-primary">
        Step 3 of 3 · Confirm the revision
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        <span className="font-tabular text-xs text-text-tertiary">{target.code}</span>{' '}
        {target.nameTh}
      </p>
      <p className="mt-2 text-xs text-text-tertiary">
        The current curriculum file will be kept as a previous version. The
        programme&rsquo;s existing details are not changed here — they update
        when the analysis re-reads the new file.
      </p>
      <div className="mt-4 max-w-xs">
        <Field label="Curriculum year (พ.ศ.)">
          <Input
            type="number"
            value={yearBE}
            onChange={(e) => setYearBE(e.target.value)}
            placeholder="2570"
          />
        </Field>
      </div>
      <div className="mt-4">
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Attaching…' : 'Attach and analyse'}
        </Button>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Extraction status UI
// ─────────────────────────────────────────────────────────────────────────

function ExtractionStatusBadge({
  state,
  extraction,
  elapsedSeconds,
}: {
  state: ExtractionState;
  extraction: Extraction | null;
  elapsedSeconds: number;
}) {
  if (state === 'waiting') {
    return (
      <span className="inline-flex items-center gap-1 text-text-secondary">
        <Loader2 className="size-icon-xs animate-spin" aria-hidden />
        AI extracting · {elapsedSeconds}s
      </span>
    );
  }
  if (state === 'ready' && extraction) {
    return (
      <Badge tone="success">
        ready · {(extraction.confidence * 100).toFixed(0)}%
      </Badge>
    );
  }
  if (state === 'failed') {
    return <Badge tone="danger">failed</Badge>;
  }
  if (state === 'timeout') {
    return <Badge tone="warning">took too long</Badge>;
  }
  return <Badge tone="neutral">pending</Badge>;
}

function ExtractionBanner({
  state,
  extraction,
  processingError,
  elapsedSeconds,
}: {
  state: ExtractionState;
  extraction: Extraction | null;
  processingError: string | null;
  elapsedSeconds: number;
}) {
  if (state === 'waiting') {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md border border-accent/30 bg-accent-subtle p-3 text-sm text-text-primary">
        <Loader2 className="size-icon-md animate-spin text-accent" aria-hidden />
        <span>
          Reading the PDF with Gemini — typically 5–20 seconds.{' '}
          <span className="font-tabular text-text-secondary">{elapsedSeconds}s elapsed.</span>
          <br />
          <span className="text-xs text-text-secondary">
            You can start filling the form below; anything you type will be kept when extraction completes.
          </span>
        </span>
      </div>
    );
  }
  if (state === 'ready' && extraction) {
    return null; // The "Auto-extracted fields" strip below covers this.
  }
  if (state === 'failed') {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-text-primary">
        <AlertTriangle className="mt-0.5 size-icon-md text-danger" aria-hidden />
        <div className="flex-1">
          <div className="font-medium">AI extraction failed.</div>
          {processingError && (
            <div className="mt-0.5 text-xs text-text-secondary">{processingError}</div>
          )}
          <div className="mt-1 text-xs text-text-secondary">
            Fill the form manually below — the PDF will still be attached on save.
          </div>
        </div>
      </div>
    );
  }
  if (state === 'timeout') {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-text-primary">
        <AlertTriangle className="mt-0.5 size-icon-md text-warning" aria-hidden />
        <div className="flex-1">
          <div className="font-medium">Extraction took longer than expected.</div>
          <div className="mt-0.5 text-xs text-text-secondary">
            The job is still in the queue — you can Retry (will poll again) or fill the form manually and proceed now.
          </div>
        </div>
      </div>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function matchFacultyId(
  facultyNameTh: string | undefined,
  faculties: Faculty[],
): string | undefined {
  if (!facultyNameTh) return undefined;
  return faculties.find((f) => f.nameTh.includes(facultyNameTh))?.id;
}

const REASON_LABEL: Record<CollisionMatch['reasons'][number], string> = {
  same_code: 'Same code',
  same_name_th: 'Same Thai name (same faculty & level)',
  same_name_en: 'Same English name (same faculty & level)',
  same_degree_same_department:
    'Same level in the same department',
};

function CollisionPanel({
  report,
  checking,
  force,
  onToggleForce,
}: {
  report: CollisionReport | null;
  checking: boolean;
  force: boolean;
  onToggleForce: (v: boolean) => void;
}) {
  if (!report) {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-1 p-3 text-xs text-text-tertiary">
        {checking ? 'Checking for duplicates…' : 'Start typing to check for duplicates.'}
      </div>
    );
  }
  if (!report.matches.length) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-text-primary">
        <CheckCircle2 className="size-icon-md text-success" aria-hidden />
        No duplicates found — safe to create.
      </div>
    );
  }
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        report.hasHard ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={`mt-0.5 size-icon-md ${report.hasHard ? 'text-danger' : 'text-warning'}`}
          aria-hidden
        />
        <div className="flex-1">
          <div className="font-medium text-text-primary">
            {report.hasHard
              ? `The code is already in use — change it to continue.`
              : `Possible duplicate — review before creating.`}
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {report.matches.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-border-subtle bg-surface-0 px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={`/admin/programs/${m.id}`}
                    className="font-tabular text-xs font-medium text-accent hover:underline"
                  >
                    {m.code}
                  </a>
                  <Badge tone="neutral">{m.status.toLowerCase()}</Badge>
                </div>
                <div className="mt-0.5 truncate text-xs text-text-secondary">
                  {m.nameEn} · {m.nameTh}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-text-tertiary">
                  {m.reasons.map((r) => (
                    <span
                      key={r}
                      className="rounded-sm border border-border-subtle bg-surface-1 px-1.5 py-0.5"
                    >
                      {REASON_LABEL[r]}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {!report.hasHard && report.hasSoft && (
            <label className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => onToggleForce(e.target.checked)}
              />
              I&apos;ve reviewed these and still want to create a new program.
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Polling for Gemini extraction
// ─────────────────────────────────────────────────────────────────────────

// Poll the PDF detail endpoint until a Gemini-v1 CURRICULUM_SPEC extraction
// (confidence > 0) shows up, or the pipeline fails, or ~60 seconds pass.
// Returns the latest PDF detail regardless of outcome.
async function pollForUsableExtraction(
  pdfId: string,
): Promise<PdfAfterUpload | null> {
  const started = Date.now();
  const deadline = 60_000;
  let latest: PdfAfterUpload | null = null;
  while (Date.now() - started < deadline) {
    latest = await fetchPdfDetail(pdfId);
    if (latest) {
      if (latest.processingStatus === 'FAILED') return latest;
      if (usableExtraction(latest)) return latest;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return latest ?? (await fetchPdfDetail(pdfId));
}

async function fetchPdfDetail(pdfId: string): Promise<PdfAfterUpload | null> {
  try {
    const res = await fetch(`/api/admin-pdfs-detail/${pdfId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data as PdfAfterUpload;
  } catch {
    return null;
  }
}
