'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Segmented,
  SegmentedList,
  SegmentedTrigger,
  SegmentedContent,
} from '@kku/ui';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Types — the /admin/programs/:id endpoint returns this shape (see
// programs.service.ts getOne()).
// ─────────────────────────────────────────────────────────────────────────

type Level = 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
type Status = 'ACTIVE' | 'PAUSED' | 'SUNSET';
type DocRole =
  | 'CURRENT_CURRICULUM'
  | 'PREVIOUS_CURRICULUM'
  | 'COMMITTEE_ORDER'
  | 'EVALUATION_REPORT'
  | 'SUPPLEMENTARY';

interface ApprovalEntry {
  body:
    | 'FACULTY_COMMITTEE'
    | 'UNIVERSITY_SCREENING'
    | 'ACADEMIC_COUNCIL'
    | 'UNIVERSITY_COUNCIL'
    | 'GRADUATE_SCHOOL'
    | 'OTHER';
  meetingNo?: string;
  meetingDate?: string;
  decisionTh?: string;
  note?: string;
}

interface Extraction {
  id: string;
  reviewStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
  confidence: number;
  methodVersion: string;
  createdAt: string;
  reviewedAt: string | null;
}

interface ProgramDocument {
  id: string;
  role: DocRole;
  curriculumYearBE: number | null;
  isCurrent: boolean;
  notes: string | null;
  attachedAt: string;
  pdfDocument: {
    id: string;
    originalFilename: string;
    pageCount: number;
    fileSize: number;
    sourceCategory: string;
    processingStatus: string;
    extractions: Extraction[];
  };
  attachedBy: { id: string; name: string | null; email: string } | null;
}

export interface ProgramDetail {
  id: string;
  code: string;
  /** UNICON / MHESI 14-digit curriculum ID. Nullable. */
  mhesiCode: string | null;
  nameTh: string;
  nameEn: string;
  facultyId: string;
  departmentId: string | null;
  level: Level;
  status: Status;
  yearEstablished: number | null;
  degreeNameTh: string | null;
  degreeNameEn: string | null;
  degreeAbbrTh: string | null;
  degreeAbbrEn: string | null;
  majors: string[];
  totalCredits: number | null;
  durationYears: number | null;
  programPlans: string[];
  language: 'TH' | 'EN' | 'MIXED' | null;
  admissionScope: 'TH_ONLY' | 'TH_AND_INTL' | 'INTL_ONLY' | null;
  careersThJson: string[] | null;
  openingYear: number | null;
  openingSemester: number | null;
  curriculumYearBE: number | null;
  isRevision: boolean;
  previousCurriculumYearBE: number | null;
  approvalHistoryJson: ApprovalEntry[] | null;
  faculty: { id: string; code: string; nameEn: string; nameTh: string } | null;
  department: { id: string; code: string; nameEn: string; nameTh: string } | null;
  documents: ProgramDocument[];
  /** Whether this programme's AI analyses predate its current curriculum
   *  file. Optional so an older cached response still renders the page.
   *  `pendingAttachedAt` is a string — it crossed JSON to get here. */
  staleness?: {
    stale: boolean;
    reason: 'none' | 'unanalysed-revision' | 'superseded-document';
    pendingRevisionId: string | null;
    pendingCurriculumYearBE: number | null;
    pendingAttachedAt: string | null;
    /** True when no revision for this programme has ever completed
     *  analysis — i.e. this is the programme's first. Optional so an older
     *  cached response (from before this field existed) still renders. */
    isFirstAnalysis?: boolean;
  };
  updatedAt: string;
}

// Enqueue a full pipeline run for one programme. Module-level so the
// staleness banner and the Pipeline-history tab's "Run pipeline" button
// share one implementation rather than drifting into two.
async function enqueueProgramPipeline(programId: string): Promise<void> {
  const res = await fetch(`/api/admin-programs/${programId}/run-pipeline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
  }
}

interface Props {
  program: ProgramDetail;
  faculties: Array<{ id: string; code: string; nameEn: string; nameTh: string }>;
  departments: Array<{ id: string; code: string; nameEn: string; nameTh: string; facultyId: string }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Main tabs shell
// ─────────────────────────────────────────────────────────────────────────

export function ProgramEditClient({ program, faculties, departments }: Props) {
  // Honour `?tab=...` so deep-links from the queues UI land on the right
  // tab. SSR-safe: defaults to 'overview' until the client hydrates.
  const [tab, setTab] = React.useState('overview');
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && ['overview', 'approvals', 'careers', 'files', 'pipeline'].includes(t)) {
      setTab(t);
    }
  }, []);
  const changeTab = React.useCallback((v: string) => {
    setTab(v);
    if (typeof window !== 'undefined') {
      const u = new URLSearchParams(window.location.search);
      u.set('tab', v);
      window.history.replaceState(null, '', `?${u.toString()}`);
    }
  }, []);
  return (
    <>
      <StalenessBanner program={program} />
      <Segmented value={tab} onValueChange={changeTab} className="w-full">
        <SegmentedList className="mb-4">
          <SegmentedTrigger value="overview">Overview</SegmentedTrigger>
          <SegmentedTrigger value="approvals">Approvals</SegmentedTrigger>
          <SegmentedTrigger value="careers">Careers</SegmentedTrigger>
          <SegmentedTrigger value="files">
            Files ({program.documents.length})
          </SegmentedTrigger>
          <SegmentedTrigger value="pipeline">Pipeline history</SegmentedTrigger>
        </SegmentedList>
        <SegmentedContent value="overview">
          <OverviewTab program={program} faculties={faculties} departments={departments} />
        </SegmentedContent>
        <SegmentedContent value="approvals">
          <ApprovalsTab program={program} />
        </SegmentedContent>
        <SegmentedContent value="careers">
          <CareersTab program={program} />
        </SegmentedContent>
        <SegmentedContent value="files">
          <FilesTab program={program} />
        </SegmentedContent>
        <SegmentedContent value="pipeline">
          <PipelineHistoryTab program={program} />
        </SegmentedContent>
      </Segmented>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Staleness banner — operator-facing, so it names the consequence and
// offers the one action that clears it. The Council-facing deep-dive says
// the same thing far more quietly.
// ─────────────────────────────────────────────────────────────────────────

function StalenessBanner({ program }: { program: ProgramDetail }) {
  const staleness = program.staleness;
  const [running, setRunning] = React.useState(false);

  if (!staleness?.stale) return null;

  const runPipeline = async () => {
    setRunning(true);
    try {
      await enqueueProgramPipeline(program.id);
      toast.success('Pipeline enqueued — re-analysis will start shortly');
    } catch (err) {
      toast.error(`Pipeline enqueue failed: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card padding="sm" className="mb-4 border-warning/40 bg-warning-subtle">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-primary">
          {staleness.reason === 'unanalysed-revision' ? (
            staleness.isFirstAnalysis ? (
              <>
                This programme&apos;s curriculum file has not been analysed yet. Run the
                pipeline to generate its analysis.
              </>
            ) : (
              <>
                A revised curriculum file was attached
                {staleness.pendingAttachedAt
                  ? ` on ${new Date(staleness.pendingAttachedAt).toLocaleDateString()}`
                  : ''}{' '}
                and has not been analysed. Every AI section still reflects the previous file.
              </>
            )
          ) : (
            <>
              The AI sections were generated from a curriculum file that is no longer
              the current one. Re-run the pipeline to analyse the current file.
            </>
          )}
        </p>
        <Button size="sm" onClick={() => void runPipeline()} disabled={running}>
          {running ? (
            <Loader2 className="size-icon-sm animate-spin" />
          ) : (
            <Play className="size-icon-sm" />
          )}
          Run pipeline
        </Button>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Overview tab — มคอ.2 header fields
// ─────────────────────────────────────────────────────────────────────────

function OverviewTab({
  program,
  faculties,
  departments,
}: {
  program: ProgramDetail;
  faculties: Props['faculties'];
  departments: Props['departments'];
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    code: program.code,
    mhesiCode: program.mhesiCode ?? '',
    nameTh: program.nameTh,
    nameEn: program.nameEn,
    facultyId: program.facultyId,
    departmentId: program.departmentId ?? '',
    level: program.level,
    status: program.status,
    degreeNameTh: program.degreeNameTh ?? '',
    degreeNameEn: program.degreeNameEn ?? '',
    degreeAbbrTh: program.degreeAbbrTh ?? '',
    degreeAbbrEn: program.degreeAbbrEn ?? '',
    majorsText: program.majors.join('\n'),
    totalCredits: program.totalCredits?.toString() ?? '',
    durationYears: program.durationYears?.toString() ?? '',
    programPlansText: program.programPlans.join('\n'),
    language: program.language ?? '',
    admissionScope: program.admissionScope ?? '',
    openingYear: program.openingYear?.toString() ?? '',
    openingSemester: program.openingSemester?.toString() ?? '',
    curriculumYearBE: program.curriculumYearBE?.toString() ?? '',
    isRevision: program.isRevision,
    previousCurriculumYearBE: program.previousCurriculumYearBE?.toString() ?? '',
  });

  const filteredDepts = form.facultyId
    ? departments.filter((d) => d.facultyId === form.facultyId)
    : [];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        code: form.code.trim(),
        mhesiCode: form.mhesiCode.trim() || null,
        nameTh: form.nameTh.trim(),
        nameEn: form.nameEn.trim(),
        facultyId: form.facultyId,
        departmentId: form.departmentId || null,
        level: form.level,
        status: form.status,
        degreeNameTh: form.degreeNameTh || null,
        degreeNameEn: form.degreeNameEn || null,
        degreeAbbrTh: form.degreeAbbrTh || null,
        degreeAbbrEn: form.degreeAbbrEn || null,
        majors: form.majorsText.split('\n').map((s) => s.trim()).filter(Boolean),
        totalCredits: form.totalCredits ? Number(form.totalCredits) : null,
        durationYears: form.durationYears ? Number(form.durationYears) : null,
        programPlans: form.programPlansText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        language: form.language || null,
        admissionScope: form.admissionScope || null,
        openingYear: form.openingYear ? Number(form.openingYear) : null,
        openingSemester: form.openingSemester ? Number(form.openingSemester) : null,
        curriculumYearBE: form.curriculumYearBE ? Number(form.curriculumYearBE) : null,
        isRevision: form.isRevision,
        previousCurriculumYearBE: form.previousCurriculumYearBE
          ? Number(form.previousCurriculumYearBE)
          : null,
      };
      const res = await fetch(`/api/admin-programs/${program.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success('Program saved');
      router.refresh();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-text-primary">Identity</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Code">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="UNICON CURR_ID (MHESI)">
            <Input
              value={form.mhesiCode}
              onChange={(e) => setForm({ ...form, mhesiCode: e.target.value })}
              placeholder="e.g. 25430031100056"
              className="font-tabular"
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Status })}
              className="kku-select"
            >
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="SUNSET">Sunset</option>
            </select>
          </Field>
          <Field label="Name (Thai)">
            <Input value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} />
          </Field>
          <Field label="Name (English)">
            <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          </Field>
          <Field label="Faculty">
            <select
              value={form.facultyId}
              onChange={(e) => setForm({ ...form, facultyId: e.target.value, departmentId: '' })}
              className="kku-select"
            >
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
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              className="kku-select"
            >
              <option value="">— None / Faculty-level —</option>
              {filteredDepts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameEn}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <h3 className="mt-2 text-sm font-semibold text-text-primary">Degree</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Level">
            <select
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value as Level })}
              className="kku-select"
            >
              <option value="BACHELOR">Bachelor</option>
              <option value="MASTER">Master</option>
              <option value="DOCTORAL">Doctoral</option>
            </select>
          </Field>
          <Field label="Total credits">
            <Input
              type="number"
              value={form.totalCredits}
              onChange={(e) => setForm({ ...form, totalCredits: e.target.value })}
            />
          </Field>
          <Field label="Full degree name (Thai)">
            <Input
              value={form.degreeNameTh}
              placeholder="วิทยาศาสตรบัณฑิต (เกษตรศาสตร์)"
              onChange={(e) => setForm({ ...form, degreeNameTh: e.target.value })}
            />
          </Field>
          <Field label="Full degree name (English)">
            <Input
              value={form.degreeNameEn}
              placeholder="Bachelor of Science (Agriculture)"
              onChange={(e) => setForm({ ...form, degreeNameEn: e.target.value })}
            />
          </Field>
          <Field label="Abbreviation (Thai)">
            <Input
              value={form.degreeAbbrTh}
              placeholder="วท.บ."
              onChange={(e) => setForm({ ...form, degreeAbbrTh: e.target.value })}
            />
          </Field>
          <Field label="Abbreviation (English)">
            <Input
              value={form.degreeAbbrEn}
              placeholder="B.Sc."
              onChange={(e) => setForm({ ...form, degreeAbbrEn: e.target.value })}
            />
          </Field>
          <Field label="Duration (years)" hint="Undergrad only; postgrad uses plans below">
            <Input
              type="number"
              value={form.durationYears}
              onChange={(e) => setForm({ ...form, durationYears: e.target.value })}
            />
          </Field>
          <Field label="Language of instruction">
            <select
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              className="kku-select"
            >
              <option value="">— Unspecified —</option>
              <option value="TH">Thai</option>
              <option value="EN">English</option>
              <option value="MIXED">Mixed</option>
            </select>
          </Field>
          <Field label="Majors (tracks)" hint="One per line — e.g. กีฏวิทยา / โรคพืชวิทยา / พืชสวน">
            <textarea
              value={form.majorsText}
              onChange={(e) => setForm({ ...form, majorsText: e.target.value })}
              rows={4}
              className="kku-select"
            />
          </Field>
          <Field label="Program plans" hint="One per line — e.g. แผน ก แบบ ก1 / แบบ 2.2">
            <textarea
              value={form.programPlansText}
              onChange={(e) => setForm({ ...form, programPlansText: e.target.value })}
              rows={4}
              className="kku-select"
            />
          </Field>
        </div>

        <h3 className="mt-2 text-sm font-semibold text-text-primary">Admission & launch</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Admission scope">
            <select
              value={form.admissionScope}
              onChange={(e) => setForm({ ...form, admissionScope: e.target.value })}
              className="kku-select"
            >
              <option value="">— Unspecified —</option>
              <option value="TH_ONLY">Thai only</option>
              <option value="TH_AND_INTL">Thai + international</option>
              <option value="INTL_ONLY">International only</option>
            </select>
          </Field>
          <Field label="Opening year (BE)">
            <Input
              type="number"
              value={form.openingYear}
              onChange={(e) => setForm({ ...form, openingYear: e.target.value })}
              placeholder="2565"
            />
          </Field>
          <Field label="Opening semester">
            <select
              value={form.openingSemester}
              onChange={(e) => setForm({ ...form, openingSemester: e.target.value })}
              className="kku-select"
            >
              <option value="">—</option>
              <option value="1">Semester 1</option>
              <option value="2">Semester 2</option>
              <option value="3">Summer / 3</option>
            </select>
          </Field>
          <Field label="Curriculum year (BE)">
            <Input
              type="number"
              value={form.curriculumYearBE}
              onChange={(e) => setForm({ ...form, curriculumYearBE: e.target.value })}
              placeholder="2565"
            />
          </Field>
          <Field label="Previous curriculum year (BE)">
            <Input
              type="number"
              value={form.previousCurriculumYearBE}
              onChange={(e) =>
                setForm({ ...form, previousCurriculumYearBE: e.target.value })
              }
              placeholder="2560"
            />
          </Field>
          <Field label="Is revision?">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isRevision}
                onChange={(e) => setForm({ ...form, isRevision: e.target.checked })}
              />
              หลักสูตรปรับปรุง
            </label>
          </Field>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <SunsetButton programId={program.id} currentStatus={program.status} />
        </div>
      </form>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
      {hint && <span className="text-xs text-text-tertiary">{hint}</span>}
    </div>
  );
}

function SunsetButton({
  programId,
  currentStatus,
}: {
  programId: string;
  currentStatus: Status;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  if (currentStatus === 'SUNSET') return null;
  const onClick = async () => {
    if (!confirm('Sunset this program? It will be marked SUNSET (soft delete). The row + documents are retained.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin-programs/${programId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Program sunsetted');
      router.refresh();
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={busy}>
      <Archive className="size-icon-md" aria-hidden />
      Sunset program
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Approvals tab
// ─────────────────────────────────────────────────────────────────────────

const APPROVAL_BODY_LABEL: Record<ApprovalEntry['body'], string> = {
  FACULTY_COMMITTEE: 'Faculty Committee (คณะกรรมการประจำคณะ)',
  UNIVERSITY_SCREENING: 'University Curriculum Screening (กลั่นกรองหลักสูตร)',
  ACADEMIC_COUNCIL: 'Academic Council (สภาวิชาการ)',
  UNIVERSITY_COUNCIL: 'University Council (สภามหาวิทยาลัย)',
  GRADUATE_SCHOOL: 'Graduate School (บัณฑิตวิทยาลัย)',
  OTHER: 'Other',
};

function ApprovalsTab({ program }: { program: ProgramDetail }) {
  const router = useRouter();
  const [entries, setEntries] = React.useState<ApprovalEntry[]>(
    program.approvalHistoryJson ?? defaultApprovalChain(program.level),
  );
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin-programs/${program.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalHistory: entries }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Approvals saved');
      router.refresh();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          The 4-body approval chain from Section 1.6 of the มคอ.2 document. Postgrad programs
          also go through the Graduate School before University Council.
        </p>
        {entries.map((entry, idx) => (
          <div
            key={idx}
            className="grid grid-cols-1 gap-2 rounded-md border border-border-subtle bg-surface-1 p-3 md:grid-cols-4"
          >
            <div className="flex flex-col gap-1">
              <Label>Body</Label>
              <select
                value={entry.body}
                onChange={(e) =>
                  setEntries(
                    entries.map((x, i) =>
                      i === idx ? { ...x, body: e.target.value as ApprovalEntry['body'] } : x,
                    ),
                  )
                }
                className="rounded-md border border-border-default bg-surface-0 px-2 py-1.5 text-sm"
              >
                {Object.entries(APPROVAL_BODY_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Meeting no.</Label>
              <Input
                value={entry.meetingNo ?? ''}
                placeholder="2/2565"
                onChange={(e) =>
                  setEntries(
                    entries.map((x, i) => (i === idx ? { ...x, meetingNo: e.target.value } : x)),
                  )
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Meeting date</Label>
              <Input
                type="date"
                value={entry.meetingDate ?? ''}
                onChange={(e) =>
                  setEntries(
                    entries.map((x, i) => (i === idx ? { ...x, meetingDate: e.target.value } : x)),
                  )
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Decision (Thai)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={entry.decisionTh ?? ''}
                  placeholder="เห็นชอบ / อนุมัติ"
                  onChange={(e) =>
                    setEntries(
                      entries.map((x, i) => (i === idx ? { ...x, decisionTh: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEntries(entries.filter((_, i) => i !== idx))}
                  aria-label="Remove row"
                >
                  <Trash2 className="size-icon-md" aria-hidden />
                </Button>
              </div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setEntries([...entries, { body: 'OTHER' }])}
          >
            <Plus className="size-icon-md" aria-hidden />
            Add row
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save approvals'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function defaultApprovalChain(level: Level): ApprovalEntry[] {
  const base: ApprovalEntry[] = [
    { body: 'FACULTY_COMMITTEE' },
    { body: 'UNIVERSITY_SCREENING' },
    { body: 'ACADEMIC_COUNCIL' },
    { body: 'UNIVERSITY_COUNCIL' },
  ];
  if (level !== 'BACHELOR') {
    base.splice(1, 0, { body: 'GRADUATE_SCHOOL' });
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────
// Careers tab
// ─────────────────────────────────────────────────────────────────────────

function CareersTab({ program }: { program: ProgramDetail }) {
  const router = useRouter();
  const initial = Array.isArray(program.careersThJson) ? program.careersThJson : [];
  const [careers, setCareers] = React.useState<string[]>(initial);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin-programs/${program.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ careersTh: careers }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Careers saved');
      router.refresh();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          Career paths for graduates (Thai). From Section 1.8 of the มคอ.2 document.
        </p>
        <ul className="flex flex-col gap-1">
          {careers.map((c, idx) => (
            <li
              key={idx}
              className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-1 px-3 py-1.5 text-sm"
            >
              <span>{c}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCareers(careers.filter((_, i) => i !== idx))}
              >
                <Trash2 className="size-icon-md" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            placeholder="นักวิจัย / นักวิทยาศาสตร์เกษตร / ผู้จัดการฟาร์ม"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                e.preventDefault();
                setCareers([...careers, draft.trim()]);
                setDraft('');
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!draft.trim()) return;
              setCareers([...careers, draft.trim()]);
              setDraft('');
            }}
          >
            <Plus className="size-icon-md" aria-hidden />
            Add
          </Button>
        </div>
        <div>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save careers'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Files tab — upload / attach / promote / detach / apply-extraction
// ─────────────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<DocRole, string> = {
  CURRENT_CURRICULUM: 'Current curriculum',
  PREVIOUS_CURRICULUM: 'Previous curriculum',
  COMMITTEE_ORDER: 'Committee order',
  EVALUATION_REPORT: 'Evaluation report',
  SUPPLEMENTARY: 'Supplementary',
};

function FilesTab({ program }: { program: ProgramDetail }) {
  const router = useRouter();
  const [uploading, setUploading] = React.useState(false);
  const [selectedRole, setSelectedRole] = React.useState<DocRole>('CURRENT_CURRICULUM');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('files', file);
      form.append('sourceCategoryHint', 'CURRICULUM');
      form.append('language', 'TH');
      // 1) Upload PDF through existing intake path.
      const upRes = await fetch('/api/admin-pdfs/upload', {
        method: 'POST',
        body: form,
      });
      const upJson = await upRes.json();
      if (!upRes.ok) {
        throw new Error(upJson?.error?.message ?? `Upload HTTP ${upRes.status}`);
      }
      const first = upJson?.data?.uploaded?.[0];
      if (!first?.pdfDocumentId) throw new Error('No pdfDocumentId in response');
      // 2) Attach to program (auto-promotes when role is CURRENT_CURRICULUM).
      const attachRes = await fetch(`/api/admin-programs/${program.id}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pdfDocumentId: first.pdfDocumentId,
          role: selectedRole,
          promoteToCurrent: selectedRole === 'CURRENT_CURRICULUM',
        }),
      });
      if (!attachRes.ok) {
        const j = await attachRes.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Attach HTTP ${attachRes.status}`);
      }
      toast.success('PDF uploaded + attached. Extraction is running in the background.');
      router.refresh();
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const promote = async (docId: string) => {
    const res = await fetch(`/api/admin-programs/${program.id}/documents/${docId}/promote`, {
      method: 'POST',
    });
    if (!res.ok) {
      toast.error(`Promote failed: HTTP ${res.status}`);
      return;
    }
    toast.success('Promoted to current');
    router.refresh();
  };

  const detach = async (docId: string) => {
    if (!confirm('Detach this document? The PDF itself will be kept in the PDF library.')) return;
    const res = await fetch(`/api/admin-programs/${program.id}/documents/${docId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      toast.error(`Detach failed: HTTP ${res.status}`);
      return;
    }
    toast.success('Detached');
    router.refresh();
  };

  const applyExtraction = async (docId: string, extractionId: string) => {
    const res = await fetch(
      `/api/admin-programs/${program.id}/apply-extraction/${extractionId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attachAsCurrent: true }),
      },
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(`Apply failed: ${j?.error?.message ?? res.status}`);
      return;
    }
    toast.success('Extraction applied to program fields.');
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-text-primary">Upload curriculum PDF</h3>
          <p className="text-sm text-text-secondary">
            Drop a มคอ.2 PDF here. It is uploaded, classified, and an extraction is queued. When the
            extraction is ready you can click <em>Apply extraction</em> below to auto-fill the
            header fields on this program.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label>Attach as</Label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as DocRole)}
                className="kku-select"
              >
                {Object.entries(ROLE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-icon-md" aria-hidden />
              {uploading ? 'Uploading…' : 'Choose PDF'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
          </div>
        </div>
      </Card>

      {program.documents.length === 0 ? (
        <Card tone="quiet">
          <div className="py-6 text-center text-sm text-text-secondary">
            No documents attached yet.
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-4 py-2 text-left">File</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Year</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Extraction</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {program.documents.map((d) => {
                const latestExtraction = d.pdfDocument.extractions[0];
                return (
                  <tr key={d.id} className="hover:bg-surface-1">
                    <td className="px-4 py-2">
                      <div className="flex flex-col">
                        <a
                          href={`/admin/pdf-review/${d.pdfDocument.id}`}
                          className="flex items-center gap-1 font-medium text-text-primary hover:underline"
                        >
                          <FileText className="size-icon-sm" aria-hidden />
                          {d.pdfDocument.originalFilename}
                        </a>
                        <span className="text-xs text-text-tertiary">
                          {d.pdfDocument.pageCount} pages ·
                          {' '}
                          {(d.pdfDocument.fileSize / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {d.isCurrent && (
                        <Badge tone="success" className="mr-1">
                          <CheckCircle2 className="size-icon-xs" aria-hidden />
                          current
                        </Badge>
                      )}
                      <span className="text-sm">{ROLE_LABEL[d.role]}</span>
                    </td>
                    <td className="px-4 py-2 font-tabular">
                      {d.curriculumYearBE ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={
                          d.pdfDocument.processingStatus === 'COMPLETED'
                            ? 'success'
                            : d.pdfDocument.processingStatus === 'FAILED'
                              ? 'danger'
                              : 'info'
                        }
                      >
                        {d.pdfDocument.processingStatus.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {latestExtraction ? (
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              latestExtraction.reviewStatus === 'APPROVED' ||
                              latestExtraction.reviewStatus === 'AUTO_APPROVED'
                                ? 'success'
                                : latestExtraction.reviewStatus === 'PENDING_REVIEW'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {latestExtraction.reviewStatus.toLowerCase().replace('_', ' ')}
                          </Badge>
                          <span className="font-tabular text-xs text-text-tertiary">
                            {(latestExtraction.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {latestExtraction && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => applyExtraction(d.id, latestExtraction.id)}
                          >
                            Apply
                          </Button>
                        )}
                        {!d.isCurrent && (
                          <Button variant="ghost" size="sm" onClick={() => promote(d.id)}>
                            Promote
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => detach(d.id)}
                          aria-label="Detach"
                        >
                          <Trash2 className="size-icon-md" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline history tab
//
// Per-program job history from the `ai-jobs` BullMQ queue, filtered
// server-side by `data.entityId === program.id`. Mirrors the global
// /admin/queues all-jobs view at a finer scope so an operator can see
// "what's run on THIS program lately" without grepping the queue.
//
// "Run pipeline" is reachable from the bulk page (/admin/programs)
// already; this tab is intentionally read-only so it stays a clear
// observability surface (verdict, duration, attempts, failure reason).
// ─────────────────────────────────────────────────────────────────────────

interface PipelineHistoryEntry {
  queueName: string;
  queueLabel: string;
  id: string;
  jobName: string;
  state:
    | 'active'
    | 'waiting'
    | 'delayed'
    | 'completed'
    | 'failed'
    | 'paused'
    | 'unknown';
  verdict: 'OK' | 'SKIPPED' | 'FAILED' | null;
  verdictReason: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  failedReason: string | null;
  attempts: { made: number; max: number };
  target: {
    kind: 'program';
    id: string;
    label: string;
    description: string | null;
    pipelinePhases?: string[];
    pipelineForce?: boolean;
  } | null;
}

function PipelineHistoryTab({ program }: { program: ProgramDetail }) {
  const [entries, setEntries] = React.useState<PipelineHistoryEntry[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin-queues/program-history/${program.id}?limit=100`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setEntries((j.data ?? []) as PipelineHistoryEntry[]);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [program.id]);

  React.useEffect(() => {
    void load();
    // Poll every 5s while the tab is mounted — same cadence the global
    // queues page uses, so per-program and global views stay in sync.
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const runPipeline = async () => {
    setRunning(true);
    try {
      await enqueueProgramPipeline(program.id);
      toast.success('Pipeline enqueued');
      await load();
    } catch (err) {
      toast.error(`Pipeline enqueue failed: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  // Tally: last-30 runs broken down by verdict so the operator gets a
  // one-line "is this program healthy" read above the table.
  const tally = React.useMemo(() => {
    if (!entries) return null;
    const last30 = entries.slice(0, 30);
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    let active = 0;
    for (const e of last30) {
      if (e.state === 'active' || e.state === 'waiting' || e.state === 'delayed') {
        active += 1;
        continue;
      }
      if (e.verdict === 'FAILED') failed += 1;
      else if (e.verdict === 'SKIPPED') skipped += 1;
      else if (e.verdict === 'OK') ok += 1;
    }
    return { ok, skipped, failed, active, total: last30.length };
  }, [entries]);

  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Recent pipeline runs</h3>
            <p className="text-xs text-text-tertiary">
              Last 100 jobs in the <code className="font-mono">ai-jobs</code>{' '}
              queue targeting this program. Polls every 5s.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw
                className={`size-icon-sm ${loading ? 'animate-spin' : ''}`}
                aria-hidden
              />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={runPipeline}
              disabled={running}
            >
              <Play className="size-icon-sm" aria-hidden />
              {running ? 'Enqueuing…' : 'Run full pipeline'}
            </Button>
          </div>
        </div>
        {tally && tally.total > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-text-tertiary">Last {tally.total} jobs:</span>
            {tally.active > 0 && (
              <Badge tone="warning" className="font-tabular">
                {tally.active} in flight
              </Badge>
            )}
            <Badge tone="success" className="font-tabular">
              {tally.ok} ok
            </Badge>
            {tally.skipped > 0 && (
              <Badge tone="warning" className="font-tabular">
                {tally.skipped} skipped
              </Badge>
            )}
            {tally.failed > 0 && (
              <Badge tone="danger" className="font-tabular">
                {tally.failed} failed
              </Badge>
            )}
          </div>
        )}
      </Card>

      {error && (
        <Card padding="sm" className="border-danger/40 bg-danger/5">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertTriangle className="size-icon-md" aria-hidden />
            {error}
          </div>
        </Card>
      )}

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead className="bg-surface-2 text-text-tertiary">
              <tr className="text-left uppercase tracking-wide">
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Phases</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {entries && entries.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-10 text-center text-text-tertiary"
                  >
                    No pipeline jobs in the recent window. Click{' '}
                    <strong>Run full pipeline</strong> to enqueue one, or use
                    the bulk picker at{' '}
                    <a
                      href="/admin/programs"
                      className="text-accent-default hover:underline"
                    >
                      /admin/programs
                    </a>
                    .
                  </td>
                </tr>
              )}
              {entries === null && loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-10 text-center text-text-tertiary"
                  >
                    <Loader2 className="mx-auto size-icon-md animate-spin" aria-hidden />
                  </td>
                </tr>
              )}
              {entries?.map((e) => (
                <tr
                  key={`${e.queueName}:${e.id}`}
                  className="border-t border-border-default align-top"
                >
                  <td className="px-3 py-2 text-text-tertiary">
                    {e.startedAt ? <RelativeTime ms={e.startedAt} /> : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {e.jobName}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {e.target?.pipelinePhases && e.target.pipelinePhases.length > 0 ? (
                      <span className="font-mono text-[10px]">
                        {e.target.pipelinePhases.join(', ')}
                      </span>
                    ) : e.jobName === 'RUN_PROGRAM_PIPELINE' ? (
                      <span className="text-text-tertiary">all</span>
                    ) : (
                      <span className="text-text-tertiary">—</span>
                    )}
                    {e.target?.pipelineForce && (
                      <span className="ml-1 text-[10px] text-warning">force</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PipelineRunStateBadge entry={e} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.durationMs != null ? formatPipelineDuration(e.durationMs) : '—'}
                  </td>
                  <td className="px-3 py-2 text-text-tertiary">
                    {e.attempts.made}/{e.attempts.max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[11px] text-text-tertiary">
        Need the full job payload, retry, or removal?{' '}
        <a
          href="/admin/queues"
          className="text-accent-default hover:underline inline-flex items-center gap-1"
        >
          Open the queues console <ExternalLink className="size-icon-xs" />
        </a>
      </p>
    </div>
  );
}

function PipelineRunStateBadge({ entry }: { entry: PipelineHistoryEntry }) {
  // Handler-reported FAILED ({ status: 'FAILED' }) is a "completed"
  // BullMQ job — surface it as a failure here so script-not-found and
  // similar no-ops don't show green ok. Mirror of the global queues UI
  // fix (2026-05-13).
  if (entry.state === 'failed' || entry.verdict === 'FAILED') {
    return (
      <span
        className="inline-flex items-center gap-1 text-danger"
        title={entry.failedReason ?? entry.verdictReason ?? undefined}
      >
        <XCircle className="size-icon-xs" aria-hidden /> failed
      </span>
    );
  }
  if (entry.state === 'completed') {
    if (entry.verdict === 'SKIPPED') {
      return (
        <span
          className="inline-flex items-center gap-1 text-warning"
          title={entry.verdictReason ?? 'completed without producing useful output'}
        >
          <AlertTriangle className="size-icon-xs" aria-hidden /> skipped
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 text-success"
        title={entry.verdictReason ?? undefined}
      >
        <CheckCircle2 className="size-icon-xs" aria-hidden /> ok
      </span>
    );
  }
  if (entry.state === 'active') {
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <Loader2 className="size-icon-xs animate-spin" aria-hidden /> running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-text-secondary">
      {entry.state}
    </span>
  );
}

function RelativeTime({ ms }: { ms: number }) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return <span title={new Date(ms).toLocaleString()}>just now</span>;
  if (sec < 60) return <span title={new Date(ms).toLocaleString()}>{sec}s ago</span>;
  const min = Math.floor(sec / 60);
  if (min < 60) return <span title={new Date(ms).toLocaleString()}>{min}m ago</span>;
  const hr = Math.floor(min / 60);
  if (hr < 24) return <span title={new Date(ms).toLocaleString()}>{hr}h ago</span>;
  const d = Math.floor(hr / 24);
  return <span title={new Date(ms).toLocaleString()}>{d}d ago</span>;
}

function formatPipelineDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}
