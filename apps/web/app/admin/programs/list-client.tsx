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
  EmptyState,
  Input,
  Label,
} from '@kku/ui';
import {
  CheckSquare,
  FilePlus2,
  FileText,
  Layers,
  Loader2,
  Pencil,
  Play,
  X,
} from 'lucide-react';
import {
  FilterField,
  FilterRail,
  FilterSearch,
  FilterSelect,
} from '@/components/filter-rail';
// Deep subpath, NOT the `@kku/shared` barrel: this is a client component and
// the barrel re-exports modules that reach node:crypto / aws-sdk, which breaks
// the browser bundle. The subpath is pure data + types.
import {
  PROGRAM_PHASE_META,
  PROGRAM_PIPELINE_PHASES,
  type ProgramPipelinePhase,
} from '@kku/shared/pipeline/program-phases';

export interface ProgramListRow {
  id: string;
  code: string;
  /** UNICON / MHESI curriculum ID — primary CURR_ID per the registry
   *  (`Program.mhesiCode`). Surfaced under the canonical code so analysts
   *  can cross-reference the row in `staff_program_assignment` /
   *  `student_program_record`. */
  mhesiCode: string | null;
  nameTh: string;
  nameEn: string;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  status: 'ACTIVE' | 'PAUSED' | 'SUNSET';
  curriculumYearBE: number | null;
  totalCredits: number | null;
  isRevision: boolean;
  faculty: { id: string; code: string; nameEn: string; nameTh: string } | null;
  department: { id: string; code: string; nameEn: string; nameTh: string } | null;
  documents: Array<{
    id: string;
    role: string;
    curriculumYearBE: number | null;
    pdfDocument: { id: string; originalFilename: string; processingStatus: string };
  }>;
  pendingExtractions: Array<{ id: string; reviewStatus: string }>;
  updatedAt: string;
}

interface Props {
  rows: ProgramListRow[];
  total: number;
  faculties: Array<{ id: string; code: string; nameEn: string; nameTh: string }>;
  initialFilters: {
    q?: string;
    facultyId?: string;
    level?: string;
    status?: string;
  };
}

const LEVEL_LABEL: Record<ProgramListRow['level'], string> = {
  BACHELOR: 'Bachelor',
  MASTER: 'Master',
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Grad. Diploma',
};

const STATUS_TONE: Record<
  ProgramListRow['status'],
  'success' | 'warning' | 'neutral'
> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  SUNSET: 'neutral',
};

// ── Pipeline-picker presets ───────────────────────────────────────────
// Pre-defined phase sets surfaced as radio options in the picker. The
// operator can always switch to "Custom" and tick individual phases.
//
// The phase list itself, its ordering and its labels/hints are NOT declared
// here any more — they come from @kku/shared. This file used to keep its own
// copy, which is how `phaseRE` ended up missing from every preset and custom
// run for its entire lifetime. Presets stay local: which phases an operator
// commonly runs together is a UI policy call, not a property of a phase.

type Phase = ProgramPipelinePhase;
const ALL_PHASES: readonly Phase[] = PROGRAM_PIPELINE_PHASES;

interface PipelinePreset {
  key: string;
  label: string;
  description: string;
  phases: Phase[] | null; // null = all phases (full run)
}

const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    key: 'full',
    label: 'Full pipeline',
    description: 'All 11 phases · ~5–10 min · ~$0.64 per program in LLM cost',
    phases: null,
  },
  {
    key: 'ai-only',
    label: 'AI-only refresh',
    description:
      'Re-run every LLM phase: PDF extraction · courses-extract · careers + demand · AI benchmarking · AI readiness · research expertise · curriculum revision · narrative · risk. Skips Oracle/MSSQL.',
    phases: [
      'phase1',
      'phase2',
      'phase2b',
      'phase3',
      'phase5',
      'phase6',
      'phaseRE',
      'phaseCR',
      'phase7',
      'phase8',
    ],
  },
  {
    key: 'oracle-only',
    label: 'Oracle / MSSQL only',
    description:
      'Re-link cohorts + alumni + financials only. No AI cost. Useful after a registrar / finance refresh.',
    phases: ['phase4'],
  },
  {
    key: 'quick-refresh',
    label: 'Quick narrative refresh',
    description:
      'AI readiness · narrative · risk only. Use after metadata edits when the underlying skills + cohort data are still valid.',
    phases: ['phase6', 'phase7', 'phase8'],
  },
  {
    key: 'custom',
    label: 'Custom',
    description: 'Pick phases individually.',
    phases: [], // sentinel — actual phases come from the checkbox state
  },
];

export function ProgramsListClient({
  rows,
  total,
  faculties,
  initialFilters,
}: Props) {
  const router = useRouter();
  const [q, setQ] = React.useState(initialFilters.q ?? '');
  const [facultyId, setFacultyId] = React.useState(initialFilters.facultyId ?? '');
  const [level, setLevel] = React.useState(initialFilters.level ?? '');
  const [status, setStatus] = React.useState(initialFilters.status ?? '');

  // Row-selection state. Keyed by Program.id (stable across re-renders).
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [batchBusy, setBatchBusy] = React.useState(false);
  // Edit-drawer state — null when closed.
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const applyFilters = (next: Partial<typeof initialFilters>) => {
    const params = new URLSearchParams();
    const merged = { q, facultyId, level, status, ...next };
    if (merged.q) params.set('q', merged.q);
    if (merged.facultyId) params.set('facultyId', merged.facultyId);
    if (merged.level) params.set('level', merged.level);
    if (merged.status) params.set('status', merged.status);
    router.push(`/admin/programs?${params.toString()}`);
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected =
    rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0;

  const toggleAllOnPage = () => {
    if (allOnPageSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of rows) next.delete(r.id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of rows) next.add(r.id);
        return next;
      });
    }
  };

  const clearSelection = () => setSelected(new Set());

  // ── Batch actions ──────────────────────────────────────────────────
  const setStatusBatch = async (
    newStatus: ProgramListRow['status'],
    actionLabel: string,
  ) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const confirmMsg =
      newStatus === 'SUNSET'
        ? `Mark ${ids.length} program(s) as SUNSET? They will stop appearing in analysis + statistics. This is reversible.`
        : `Set ${ids.length} program(s) to ${newStatus.toLowerCase()}?`;
    if (!confirm(confirmMsg)) return;
    setBatchBusy(true);
    try {
      // No bulk-status endpoint server-side; loop client-side. At ~300
      // programs the round-trips are fine; if this ever needs to scale
      // we'll add a single PATCH /admin/programs/status-batch endpoint.
      let ok = 0;
      let failed = 0;
      for (const id of ids) {
        const res = await fetch(`/api/admin-programs/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (res.ok) ok += 1;
        else failed += 1;
      }
      if (failed === 0) toast.success(`${actionLabel} · ${ok} program(s)`);
      else toast.warning(`${actionLabel} · ${ok} ok · ${failed} failed`);
      clearSelection();
      router.refresh();
    } catch (err) {
      toast.error(`${actionLabel} failed: ${(err as Error).message}`);
    } finally {
      setBatchBusy(false);
    }
  };

  const runPipelineBatch = async (phases: Phase[] | null, force: boolean) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBatchBusy(true);
    setPickerOpen(false);
    try {
      const res = await fetch(`/api/admin-programs/pipeline/run-pipeline-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          programIds: ids,
          phases: phases ?? undefined, // omit = all phases
          force,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      const queued = (j.data as { jobs?: unknown[] })?.jobs?.length ?? ids.length;
      toast.success(
        `Pipeline enqueued · ${queued} program(s) · ${
          phases ? `${phases.length} phase(s)` : 'full run'
        }${force ? ' · force' : ''}`,
      );
      clearSelection();
      router.refresh();
    } catch (err) {
      toast.error(`Pipeline enqueue failed: ${(err as Error).message}`);
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FilterRail onSubmit={() => applyFilters({})}>
        <FilterField label="Search" span={2}>
          <FilterSearch
            value={q}
            onChange={setQ}
            placeholder="Code, name (TH or EN)"
          />
        </FilterField>
        <FilterField label="Faculty">
          <FilterSelect
            value={facultyId}
            onChange={(e) => {
              setFacultyId(e.target.value);
              applyFilters({ facultyId: e.target.value });
            }}
          >
            <option value="">All faculties</option>
            {faculties.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nameEn}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
        <FilterField label="Level">
          <FilterSelect
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              applyFilters({ level: e.target.value });
            }}
          >
            <option value="">All levels</option>
            <option value="BACHELOR">Bachelor</option>
            <option value="MASTER">Master</option>
            <option value="DOCTORAL">Doctoral</option>
            <option value="HIGHER_GRAD_DIPLOMA">Higher Grad. Diploma</option>
          </FilterSelect>
        </FilterField>
        <FilterField label="Status">
          <FilterSelect
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              applyFilters({ status: e.target.value });
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="SUNSET">Sunset</option>
          </FilterSelect>
        </FilterField>
      </FilterRail>

      {/* Toolbar — swaps between "showing N of M + Add new program" and
        * the batch-action strip depending on whether any rows are
        * selected. Single height + flow stays consistent. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {someSelected ? (
          <>
            <div className="flex items-center gap-3">
              <Badge tone="accent">
                <CheckSquare className="size-icon-xs" aria-hidden />
                {selected.size} selected
              </Badge>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="size-icon-sm" aria-hidden /> Clear
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={batchBusy}
                onClick={() => setPickerOpen(true)}
              >
                {batchBusy ? (
                  <Loader2 className="size-icon-sm animate-spin" aria-hidden />
                ) : (
                  <Play className="size-icon-sm" aria-hidden />
                )}
                Run pipeline
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={batchBusy}
                onClick={() => setStatusBatch('ACTIVE', 'Set Active')}
              >
                Set Active
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={batchBusy}
                onClick={() => setStatusBatch('PAUSED', 'Set Inactive')}
              >
                Set Inactive
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={batchBusy}
                onClick={() => setStatusBatch('SUNSET', 'Mark Sunset')}
              >
                Mark Sunset
              </Button>
            </div>
          </>
        ) : (
          <span className="text-text-secondary">
            <span className="font-tabular text-text-primary">{rows.length}</span>
            {' '}
            showing of{' '}
            <span className="font-tabular text-text-primary">{total}</span> programs
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No programs match these filters"
          description="Try clearing filters, or submit a curriculum file."
          action={
            <Button asChild>
              <Link href="/admin/programs/from-pdf">
                <FilePlus2 className="size-icon-md" aria-hidden />
                Submit curriculum file
              </Link>
            </Button>
          }
        />
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* Header style matches the shared DataTable (used by
                  /admin/data-sources): sticky bg-surface-2 row, 11px
                  uppercase tracking-wide text-text-tertiary cells with
                  font-medium. Keeps the admin tables visually consistent. */}
              <thead className="sticky top-0 z-10 bg-surface-2">
                <tr className="border-b border-border-default text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                  <th className="px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      aria-label={
                        allOnPageSelected
                          ? 'Deselect all on this page'
                          : 'Select all on this page'
                      }
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                    />
                  </th>
                  <th className="px-4 py-2 text-left">Code · CURR_ID</th>
                  <th className="px-4 py-2 text-left">Program</th>
                  <th className="px-4 py-2 text-left">Faculty</th>
                  <th className="px-4 py-2 text-left">Level</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Curric. year</th>
                  <th className="px-4 py-2 text-left">PDF</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map((r) => {
                  const current = r.documents.find((d) => d.role === 'CURRENT_CURRICULUM');
                  const pending = r.pendingExtractions.length;
                  const isSelected = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-surface-1 ${isSelected ? 'bg-accent-default/[0.04]' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={isSelected ? 'Deselect row' : 'Select row'}
                          checked={isSelected}
                          onChange={() => toggleRow(r.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-2 font-tabular font-medium text-text-primary">
                        <div className="flex flex-col leading-tight">
                          <span>{r.code}</span>
                          <span
                            className="text-[10.5px] font-normal text-text-tertiary"
                            title="UNICON / MHESI curriculum ID — Program.mhesiCode"
                          >
                            {r.mhesiCode ?? '— no CURR_ID —'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col">
                          <Link
                            href={`/admin/programs/${r.id}`}
                            className="font-medium text-text-primary hover:underline"
                          >
                            {r.nameEn}
                          </Link>
                          <span className="text-xs text-text-secondary">{r.nameTh}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        {r.faculty?.nameEn ?? '—'}
                      </td>
                      <td className="px-4 py-2">{LEVEL_LABEL[r.level]}</td>
                      <td className="px-4 py-2">
                        <Badge tone={STATUS_TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                      </td>
                      <td className="px-4 py-2 font-tabular text-text-secondary">
                        {r.curriculumYearBE ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        {current ? (
                          <Badge tone="info">
                            <FileText className="size-icon-xs" aria-hidden /> current
                          </Badge>
                        ) : (
                          <Badge tone="neutral">none</Badge>
                        )}
                        {pending > 0 && (
                          <Badge tone="warning" className="ml-1">
                            {pending} to review
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingId(r.id)}
                            title="Edit metadata"
                          >
                            <Pencil className="size-icon-sm" aria-hidden />
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/programs/${r.id}`}>Open</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <PipelinePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedCount={selected.size}
        onSubmit={runPipelineBatch}
      />

      <EditProgramDrawer
        programId={editingId}
        faculties={faculties}
        onClose={() => setEditingId(null)}
        onSaved={() => {
          setEditingId(null);
          router.refresh();
        }}
      />
    </div>
  );
}

// ── Pipeline picker ───────────────────────────────────────────────────
// Pre-defined preset (radio) → fills the per-phase checkboxes. "Custom"
// lets the operator pick phases individually. "Force" re-runs even if
// existing results would be reused.
function PipelinePickerDialog({
  open,
  onOpenChange,
  selectedCount,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSubmit: (phases: Phase[] | null, force: boolean) => void;
}) {
  const [presetKey, setPresetKey] = React.useState<string>('full');
  const [customPhases, setCustomPhases] = React.useState<Set<Phase>>(
    new Set(ALL_PHASES),
  );
  const [force, setForce] = React.useState(false);

  const preset = PIPELINE_PRESETS.find((p) => p.key === presetKey) ?? PIPELINE_PRESETS[0]!;
  const isCustom = presetKey === 'custom';
  // Effective phase set the operator will submit. Null = full run
  // (passed to API as `phases: undefined`).
  const effectivePhases: Phase[] | null = (() => {
    if (preset.phases === null) return null; // Full
    if (isCustom) return [...customPhases].sort();
    return preset.phases;
  })();

  const togglePhase = (p: Phase) => {
    setCustomPhases((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const handleSubmit = () => {
    if (effectivePhases !== null && effectivePhases.length === 0) {
      toast.error('Pick at least one phase to run.');
      return;
    }
    onSubmit(effectivePhases, force);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-icon-md text-accent-default" aria-hidden />
            Run pipeline · {selectedCount} program(s)
          </DialogTitle>
          <DialogDescription>
            Pipeline jobs run in the background. Check the Job queues page (or refresh this list) for progress.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* Preset radio */}
          <div className="flex flex-col gap-2">
            <Label>Preset</Label>
            <div className="flex flex-col gap-1.5">
              {PIPELINE_PRESETS.map((p) => (
                <label
                  key={p.key}
                  className={`flex cursor-pointer gap-3 rounded-md border p-2.5 transition-colors ${
                    presetKey === p.key
                      ? 'border-accent-default/40 bg-accent-default/[0.04]'
                      : 'border-border-subtle hover:bg-surface-1'
                  }`}
                >
                  <input
                    type="radio"
                    name="preset"
                    checked={presetKey === p.key}
                    onChange={() => setPresetKey(p.key)}
                    className="mt-1"
                  />
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm font-medium">{p.label}</span>
                    <span className="text-xs text-text-tertiary">{p.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Per-phase picker — enabled when Custom is selected; read-only
            * preview otherwise so the operator sees what will run. */}
          <div className="flex flex-col gap-2">
            <Label>
              Phases ({effectivePhases === null ? `all ${ALL_PHASES.length}` : effectivePhases.length})
              {!isCustom && <span className="ml-2 text-xs text-text-tertiary">(preview — pick Custom to edit)</span>}
            </Label>
            <div className="grid grid-cols-1 gap-1 rounded-md border border-border-subtle bg-surface-1 p-2 sm:grid-cols-2">
              {ALL_PHASES.map((p) => {
                const checked =
                  effectivePhases === null || effectivePhases.includes(p);
                return (
                  <label
                    key={p}
                    className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                      isCustom ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default opacity-80'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!isCustom}
                      onChange={() => togglePhase(p)}
                      className="mt-0.5"
                    />
                    <span className="flex flex-col leading-tight">
                      <span className={checked ? 'text-text-primary' : 'text-text-tertiary'}>
                        {PROGRAM_PHASE_META[p].label}
                      </span>
                      {PROGRAM_PHASE_META[p].dependencyHint ? (
                        <span className="text-text-tertiary">
                          {PROGRAM_PHASE_META[p].dependencyHint}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Force toggle */}
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border-subtle p-2.5 hover:bg-surface-1">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="mt-1"
            />
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-medium">Force re-run</span>
              <span className="text-xs text-text-tertiary">
                Re-run even if a phase already has up-to-date results. Costs LLM credits.
              </span>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={handleSubmit}>
            <Play className="size-icon-sm" aria-hidden />
            Enqueue {selectedCount} program(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit-program drawer ───────────────────────────────────────────────
// Opens with the program ID, fetches full detail on open, lets the
// operator patch the editable subset (per Q3): nameTh / nameEn / level /
// faculty / language / mhesiCode / yearEstablished / durationYears /
// totalCredits + status (Active ↔ Inactive 2-state toggle). Mark Sunset
// is a separate destructive action so terminal lifecycle changes need
// explicit intent (per Q4). AI-generated + read-only fields stay
// read-only; kmitlCareerIds shown as informational chips.

interface ProgramDetail {
  id: string;
  code: string;
  mhesiCode: string | null;
  nameTh: string;
  nameEn: string;
  level: ProgramListRow['level'];
  status: ProgramListRow['status'];
  yearEstablished: number | null;
  totalCredits: number | null;
  durationYears: number | null;
  language: 'TH' | 'EN' | 'MIXED' | null;
  facultyId: string | null;
  kmitlCareerIds: number[];
}

function EditProgramDrawer({
  programId,
  faculties,
  onClose,
  onSaved,
}: {
  programId: string | null;
  faculties: Array<{ id: string; code: string; nameEn: string; nameTh: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = programId !== null;
  const [detail, setDetail] = React.useState<ProgramDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Form state (separate from `detail` so cancel discards cleanly).
  const [nameTh, setNameTh] = React.useState('');
  const [nameEn, setNameEn] = React.useState('');
  const [level, setLevel] = React.useState<ProgramListRow['level']>('BACHELOR');
  const [facultyId, setFacultyId] = React.useState<string>('');
  const [language, setLanguage] = React.useState<'TH' | 'EN' | 'MIXED' | ''>('');
  const [mhesiCode, setMhesiCode] = React.useState('');
  const [yearEstablished, setYearEstablished] = React.useState<string>('');
  const [durationYears, setDurationYears] = React.useState<string>('');
  const [totalCredits, setTotalCredits] = React.useState<string>('');
  const [statusValue, setStatusValue] = React.useState<ProgramListRow['status']>('ACTIVE');

  React.useEffect(() => {
    if (!programId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetch(`/api/admin-programs/${programId}`)
      .then((r) => r.json())
      .then((j) => {
        const p = j.data as ProgramDetail;
        setDetail(p);
        setNameTh(p.nameTh);
        setNameEn(p.nameEn);
        setLevel(p.level);
        setFacultyId(p.facultyId ?? '');
        setLanguage(p.language ?? '');
        setMhesiCode(p.mhesiCode ?? '');
        setYearEstablished(p.yearEstablished?.toString() ?? '');
        setDurationYears(p.durationYears?.toString() ?? '');
        setTotalCredits(p.totalCredits?.toString() ?? '');
        setStatusValue(p.status);
      })
      .catch((err) => {
        toast.error(`Failed to load program: ${err.message}`);
        onClose();
      })
      .finally(() => setLoading(false));
  }, [programId, onClose]);

  const handleSave = async () => {
    if (!programId) return;
    // Build the patch payload — only send fields the operator can edit.
    // Empty strings → null on optional fields; integers parsed safely.
    const payload: Record<string, unknown> = {
      nameTh,
      nameEn,
      level,
      status: statusValue,
      mhesiCode: mhesiCode.trim() || null,
      yearEstablished: yearEstablished.trim() === '' ? null : Number(yearEstablished),
      durationYears: durationYears.trim() === '' ? null : Number(durationYears),
      totalCredits: totalCredits.trim() === '' ? null : Number(totalCredits),
      language: language === '' ? null : language,
    };
    if (facultyId) payload.facultyId = facultyId;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin-programs/${programId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success(`Saved ${detail?.code ?? 'program'}`);
      onSaved();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSunset = async () => {
    if (!programId || !detail) return;
    if (
      !confirm(
        `Mark ${detail.code} as SUNSET? It will stop appearing in analysis + statistics. This is reversible (you can flip back to Active later).`,
      )
    )
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin-programs/${programId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'SUNSET' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${detail.code} marked SUNSET`);
      onSaved();
    } catch (err) {
      toast.error(`Mark Sunset failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-icon-md text-accent-default" aria-hidden />
            Edit program {detail?.code ?? ''}
          </DialogTitle>
          <DialogDescription>
            Editable metadata only — AI-generated fields (narrative, peer review, AI readiness, …) refresh via pipeline.
          </DialogDescription>
        </DialogHeader>

        {loading || !detail ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="size-icon-md animate-spin" aria-hidden />
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {/* Two-column form */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label>Name (Thai)</Label>
                <Input value={nameTh} onChange={(e) => setNameTh(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label>Name (English)</Label>
                <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Level</Label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as ProgramListRow['level'])}
                  className="kku-select"
                >
                  <option value="BACHELOR">Bachelor</option>
                  <option value="MASTER">Master</option>
                  <option value="DOCTORAL">Doctoral</option>
                  <option value="HIGHER_GRAD_DIPLOMA">Higher Grad. Diploma</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Faculty</Label>
                <select
                  value={facultyId}
                  onChange={(e) => setFacultyId(e.target.value)}
                  className="kku-select"
                >
                  <option value="">(unassigned)</option>
                  {faculties.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Language</Label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as typeof language)}
                  className="kku-select"
                >
                  <option value="">(not set)</option>
                  <option value="TH">TH · Thai</option>
                  <option value="EN">EN · English</option>
                  <option value="MIXED">MIXED · Bilingual</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>UNICON / MHESI code (CURR_ID)</Label>
                <Input
                  value={mhesiCode}
                  onChange={(e) => setMhesiCode(e.target.value)}
                  placeholder="14-digit curriculum ID"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Year established (CE)</Label>
                <Input
                  type="number"
                  value={yearEstablished}
                  onChange={(e) => setYearEstablished(e.target.value)}
                  min={1900}
                  max={3000}
                  placeholder="e.g. 2002"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Duration (years)</Label>
                <Input
                  type="number"
                  value={durationYears}
                  onChange={(e) => setDurationYears(e.target.value)}
                  min={1}
                  max={10}
                  placeholder="e.g. 4"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Total credits</Label>
                <Input
                  type="number"
                  value={totalCredits}
                  onChange={(e) => setTotalCredits(e.target.value)}
                  min={0}
                  max={500}
                  placeholder="e.g. 140"
                />
              </div>
            </div>

            {/* Status — 2-state toggle. Active = ACTIVE; Inactive = PAUSED.
              * SUNSET is the separate destructive action below. */}
            <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
              <Label>Status</Label>
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <span>
                  Inactive (PAUSED) and Sunset both exclude the program from analysis + statistics, but Sunset signals permanent retirement.
                </span>
              </div>
              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  variant={statusValue === 'ACTIVE' ? 'primary' : 'outline'}
                  onClick={() => setStatusValue('ACTIVE')}
                >
                  Active
                </Button>
                <Button
                  size="sm"
                  variant={statusValue === 'PAUSED' ? 'primary' : 'outline'}
                  onClick={() => setStatusValue('PAUSED')}
                >
                  Inactive (PAUSED)
                </Button>
                {statusValue === 'SUNSET' && (
                  <Badge tone="neutral">Currently SUNSET</Badge>
                )}
              </div>
            </div>

            {/* Read-only chips for kmitlCareerIds — informational; the AI
              * pipeline owns this field via the career-mapping phase. */}
            {detail.kmitlCareerIds.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-2">
                  KMITL career IDs
                  <Badge tone="neutral" size="sm">read-only</Badge>
                </Label>
                <div className="flex flex-wrap gap-1">
                  {detail.kmitlCareerIds.map((id) => (
                    <Badge key={id} tone="info" size="sm" className="font-tabular">
                      {id}
                    </Badge>
                  ))}
                </div>
                <p className="text-[11px] text-text-tertiary">
                  Managed by the AI pipeline's career-mapping phase. Re-run "AI-only refresh" or "Quick narrative refresh" to update.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
          <Button
            size="sm"
            variant="danger"
            disabled={saving || loading || !detail}
            onClick={handleMarkSunset}
          >
            Mark Sunset
          </Button>
          <div className="flex items-center gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" disabled={saving}>
                Cancel
              </Button>
            </DialogClose>
            <Button size="sm" disabled={saving || loading || !detail} onClick={handleSave}>
              {saving && <Loader2 className="size-icon-sm animate-spin" aria-hidden />}
              Save changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
