'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@kku/ui';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
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
  facultyId: string;
  level: string;
  status: string;
  reasons: string[];
}

interface CollisionReport {
  hasHard: boolean;
  hasSoft: boolean;
  matches: CollisionMatch[];
}

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uploading' }
  | { kind: 'creating' }
  | { kind: 'firing' }
  | { kind: 'done'; programId: string };

// ─────────────────────────────────────────────────────────────────────────
// New-program wizard (Phase 2d).
//
// PDF-centric flow: operator provides the curriculum PDF + the minimum
// metadata needed for the dup-check (code, faculty, level, names). The
// wizard then:
//   1. Calls /admin/programs/check-collision (silent dry-run)
//   2. On hard collision (same code): blocks with error.
//      On soft collision (same name + faculty + level): shows a
//      confirmation modal so the operator decides "this is a variant,
//      proceed" vs "this is the same thing, cancel".
//   3. Uploads the PDF to /pdfs/upload with sourceCategoryHint='CURRICULUM'.
//   4. Creates the Program with attachPdfId in one shot.
//   5. Auto-fires the full 8-phase pipeline so the digest extracts
//      richer metadata + every downstream surface populates.
//   6. Toast + redirect to /admin/programs/[id].
//
// AI digest extraction populates strategic narrative, peer review,
// AI readiness, etc. after creation — those are pipeline outputs, not
// wizard inputs. The wizard's job is just to bootstrap the row + PDF.
// ─────────────────────────────────────────────────────────────────────────

export function NewProgramClient({
  faculties,
  departments,
}: {
  faculties: Faculty[];
  departments: Department[];
}) {
  const router = useRouter();
  const [status, setStatus] = React.useState<Status>({ kind: 'idle' });

  const [form, setForm] = React.useState({
    code: '',
    nameTh: '',
    nameEn: '',
    facultyId: '',
    departmentId: '',
    level: 'BACHELOR' as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
    yearEstablished: '',
  });

  const [file, setFile] = React.useState<File | null>(null);
  const [pendingCollision, setPendingCollision] = React.useState<CollisionReport | null>(null);

  const filteredDepts = form.facultyId
    ? departments.filter((d) => d.facultyId === form.facultyId)
    : [];

  const busy = status.kind !== 'idle' && status.kind !== 'done';

  // The pipeline-fire happens after the program is created; if it
  // fails, the program is still created (operator can re-fire from
  // the program list). We surface a different toast in that case.
  const firePipeline = async (programId: string) => {
    setStatus({ kind: 'firing' });
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
        `Program created but pipeline enqueue failed: ${(err as Error).message}. Run pipeline from the list when ready.`,
      );
      return false;
    }
  };

  const performCreate = async (force: boolean) => {
    // 1. Upload PDF (if attached).
    let attachPdfId: string | undefined;
    if (file) {
      setStatus({ kind: 'uploading' });
      const fd = new FormData();
      fd.append('files', file);
      fd.append('sourceCategoryHint', 'CURRICULUM');
      const res = await fetch('/api/admin-pdfs/upload', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `PDF upload HTTP ${res.status}`);
      }
      const j = await res.json();
      const uploaded = (j.data as { uploaded?: Array<{ pdfDocument?: { id: string } }> })?.uploaded ?? [];
      attachPdfId = uploaded[0]?.pdfDocument?.id;
      if (!attachPdfId) {
        throw new Error('PDF upload returned no document id.');
      }
    }

    // 2. Create Program.
    setStatus({ kind: 'creating' });
    const body = {
      code: form.code.trim(),
      nameTh: form.nameTh.trim(),
      nameEn: form.nameEn.trim(),
      facultyId: form.facultyId,
      departmentId: form.departmentId || null,
      level: form.level,
      yearEstablished: form.yearEstablished ? Number(form.yearEstablished) : null,
      attachPdfId,
      force,
    };
    const res = await fetch('/api/admin-programs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    }
    const created = json.data as { id: string; code: string };

    // 3. Fire pipeline (only when a PDF was attached — without a PDF
    //    most pipeline phases skip anyway, so we'd be paying for empty
    //    work).
    let pipelineOk = false;
    if (attachPdfId) {
      pipelineOk = await firePipeline(created.id);
    }

    toast.success(
      attachPdfId
        ? pipelineOk
          ? `Created ${created.code} · pipeline enqueued`
          : `Created ${created.code}`
        : `Created ${created.code} · upload a PDF when ready to fire the pipeline`,
    );
    setStatus({ kind: 'done', programId: created.id });
    router.push(`/admin/programs/${created.id}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!file) {
      const ok = confirm(
        'No curriculum PDF attached. The program will be created as a shell row — you can upload the PDF + fire the pipeline later. Proceed without PDF?',
      );
      if (!ok) return;
    }

    // Step 1: dup-check.
    setStatus({ kind: 'checking' });
    try {
      const res = await fetch('/api/admin-programs/check-collision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: form.code.trim(),
          nameTh: form.nameTh.trim(),
          nameEn: form.nameEn.trim(),
          facultyId: form.facultyId,
          departmentId: form.departmentId || undefined,
          level: form.level,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      const report = (await res.json()).data as CollisionReport;

      if (report.hasHard) {
        toast.error(
          `Code "${form.code}" already exists. Use a different code, or open the existing program if it's the one you meant.`,
        );
        setStatus({ kind: 'idle' });
        return;
      }
      if (report.hasSoft) {
        // Pause + show modal; operator confirms.
        setPendingCollision(report);
        setStatus({ kind: 'idle' });
        return;
      }

      // No collisions — proceed.
      await performCreate(false);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
      setStatus({ kind: 'idle' });
    }
  };

  const confirmCollisionAndCreate = async () => {
    setPendingCollision(null);
    try {
      await performCreate(true);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
      setStatus({ kind: 'idle' });
    }
  };

  const StatusBanner = () => {
    if (status.kind === 'idle') return null;
    const labels: Record<Exclude<Status['kind'], 'idle'>, string> = {
      checking: 'Checking for duplicates…',
      uploading: 'Uploading PDF to storage…',
      creating: 'Creating program record…',
      firing: 'Enqueueing pipeline…',
      done: 'Done — redirecting…',
    };
    return (
      <Card padding="sm" tone="quiet" className="flex items-center gap-3">
        {status.kind === 'done' ? (
          <CheckCircle2 className="size-icon-md text-success" aria-hidden />
        ) : (
          <Loader2 className="size-icon-md animate-spin text-accent-default" aria-hidden />
        )}
        <span className="text-sm text-text-secondary">{labels[status.kind]}</span>
      </Card>
    );
  };

  return (
    <>
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* ── Step 1 — PDF upload (lead) ─────────────────────────── */}
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-2">
              <FileText className="size-icon-sm text-accent-default" aria-hidden />
              Curriculum PDF (มคอ.2)
            </Label>
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-sm transition-colors ${
                file
                  ? 'border-accent-default/40 bg-accent-default/[0.04] text-text-primary'
                  : 'border-border-default bg-surface-1 text-text-tertiary hover:border-accent-default/40 hover:bg-accent-default/[0.02]'
              }`}
            >
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <>
                  <CheckCircle2 className="size-icon-xl text-success" aria-hidden />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-xs text-text-tertiary">
                    {(file.size / 1024 / 1024).toFixed(1)} MB · click to replace
                  </span>
                </>
              ) : (
                <>
                  <Upload className="size-icon-xl" aria-hidden />
                  <span className="font-medium">Click to upload</span>
                  <span className="text-xs">PDF only · up to 50 MB</span>
                </>
              )}
            </label>
            <p className="text-xs text-text-tertiary">
              The PDF kicks off the full pipeline (digest → faculty → skills → pedagogy → careers → demand → peers → AI readiness → narrative → risk) on submit. Auto-extracted metadata supersedes the form values you enter below for any field the AI extracts cleanly.
            </p>
          </div>

          {/* ── Step 2 — Required metadata ─────────────────────────── */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label>Code *</Label>
              <Input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. KKU-SEQ-0298"
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Level *</Label>
              <select
                value={form.level}
                onChange={(e) =>
                  setForm({ ...form, level: e.target.value as typeof form.level })
                }
                className="kku-select"
                disabled={busy}
              >
                <option value="BACHELOR">Bachelor</option>
                <option value="MASTER">Master</option>
                <option value="DOCTORAL">Doctoral</option>
                <option value="HIGHER_GRAD_DIPLOMA">Higher Grad. Diploma</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label>Program name (Thai) *</Label>
              <Input
                required
                value={form.nameTh}
                onChange={(e) => setForm({ ...form, nameTh: e.target.value })}
                placeholder="หลักสูตรวิทยาศาสตรบัณฑิต สาขาวิชาเกษตรศาสตร์"
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label>Program name (English) *</Label>
              <Input
                required
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                placeholder="Bachelor of Science Program in Agriculture"
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Faculty *</Label>
              <select
                required
                value={form.facultyId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    facultyId: e.target.value,
                    departmentId: '',
                  })
                }
                className="kku-select"
                disabled={busy}
              >
                <option value="">— Select faculty —</option>
                {faculties.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Year established (BE or CE)</Label>
              <Input
                type="number"
                value={form.yearEstablished}
                onChange={(e) => setForm({ ...form, yearEstablished: e.target.value })}
                placeholder="e.g. 2508"
                disabled={busy}
              />
            </div>
            {filteredDepts.length > 0 && (
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label>Department (optional)</Label>
                <select
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  className="kku-select"
                  disabled={busy}
                >
                  <option value="">— None / Faculty-level —</option>
                  {filteredDepts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nameEn}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <StatusBanner />

          <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-4">
            <p className="text-xs text-text-tertiary">
              On submit we check for duplicates (same code, or same name + faculty + level). If anything matches you'll see a confirmation prompt before the create commits.
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push('/admin/programs')}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                ) : (
                  <ArrowRight className="size-icon-sm" aria-hidden />
                )}
                {file ? 'Create + fire pipeline' : 'Create program (no PDF)'}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <SoftCollisionDialog
        report={pendingCollision}
        onConfirm={confirmCollisionAndCreate}
        onCancel={() => setPendingCollision(null)}
      />
    </>
  );
}

// ── Soft-collision confirmation dialog ────────────────────────────────
// Fires when the dup-check finds same-name-same-faculty-same-level
// without a hard code collision. Operator confirms "yes this is a
// variant" or cancels.
function SoftCollisionDialog({
  report,
  onConfirm,
  onCancel,
}: {
  report: CollisionReport | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = report !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-icon-md text-warning" aria-hidden />
            Possible duplicate — confirm before creating
          </DialogTitle>
          <DialogDescription>
            {report?.matches.length === 1 ? '1 existing program' : `${report?.matches.length} existing programs`} have similar metadata. Review below — if your new program is genuinely different (a revised edition, a sibling track, etc.), proceed. Otherwise cancel and open the existing record instead.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {report?.matches.map((m) => (
            <Card key={m.id} padding="sm" tone="quiet">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col leading-tight">
                  <span className="font-tabular text-sm font-medium">{m.code}</span>
                  <span className="text-sm text-text-primary">{m.nameEn}</span>
                  <span className="text-xs text-text-secondary">{m.nameTh}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.reasons.map((r) => (
                      <Badge key={r} tone="warning" size="sm">
                        {r.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                    <Badge tone="neutral" size="sm">
                      {m.level.toLowerCase()} · {m.status.toLowerCase()}
                    </Badge>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/programs/${m.id}`} target="_blank">
                    Open
                  </Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" variant="danger" onClick={onConfirm}>
            Yes, create as a separate program
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
