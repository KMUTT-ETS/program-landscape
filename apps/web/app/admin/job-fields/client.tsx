'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@kku/ui';
import { AlertTriangle, Check, CheckSquare, GitMerge, Pencil, X } from 'lucide-react';

// @kku/ui has no text-input primitive; the /usage search box uses a plain
// <input> with token classes, and so does this page — classes copied from
// apps/web/app/usage/client.tsx's search input.
const INPUT = 'rounded-md border border-default bg-surface-1 px-3 py-1.5 text-xs text-text-primary';

export interface JobFieldRowDto {
  id: string;
  slug: string;
  nameTh: string;
  nameEn: string;
  synonyms: string[];
  mentionCount: number;
  reviewStatus: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  methodVersion: string;
  programmeCount: number;
  updatedAt: string;
}

export interface ProgramJobFieldRowDto {
  id: string;
  programId: string;
  programCode: string;
  programNameTh: string;
  programNameEn: string;
  programLevel: string;
  fieldId: string;
  fieldSlug: string;
  source: string;
  confidence: number | null;
  reviewStatus: 'PROPOSED' | 'APPROVED' | 'REJECTED';
}

// Which demand source(s) contributed a synonym — derived from the postings
// (packages/db/src/job-fields.ts: synonymSourcesForField / …ForAllFields),
// not stored, so it can never drift from what is actually on file.
export interface FieldSynonymSourceDto {
  fieldId: string;
  synonym: string;
  sources: string[];
}

const STATUS_LABEL: Record<JobFieldRowDto['reviewStatus'], { label: string; tone: 'warning' | 'success' | 'outline' }> = {
  PROPOSED: { label: 'Proposed', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'outline' },
};

// Plain-text labels — deliberately NOT the shared <DataSourceMark> component
// (apps/web/src/components/data-source-mark.tsx). A concurrent task is
// adding a job-108 slug + text variant to that component; importing it here
// would collide with that work. Swap these for <DataSourceMark> once both
// land — a deliberate deferral, not an oversight.
const SOURCE_LABEL: Record<string, string> = { jobthai: 'JobThai', 'job-108': 'Job-108' };

/**
 * True only when every synonym the field carries has attribution data AND
 * every one of those is job-108 (government announcements) alone. A field
 * with a synonym that has no attribution at all (never seen on a posting
 * under the current filters) is NOT asserted government-only — there is no
 * evidence either way for that synonym, so silence must not read as "safe".
 */
export function isGovernmentOnlyField(synonyms: string[], sources: FieldSynonymSourceDto[]): boolean {
  if (synonyms.length === 0) return false;
  const bySynonym = new Map(sources.map((r) => [r.synonym, r.sources]));
  return synonyms.every((s) => {
    const src = bySynonym.get(s);
    return src != null && src.length === 1 && src[0] === 'job-108';
  });
}

/**
 * Fields whose Thai/English name, slug, or any synonym contains `query`
 * (case-insensitive, trimmed). An empty query returns every field unfiltered
 * — this is what "currently visible" means for the select-all checkbox
 * below: when there is no filter, everything is visible.
 */
export function filterJobFields(fields: JobFieldRowDto[], query: string): JobFieldRowDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return fields;
  return fields.filter(
    (f) =>
      f.nameTh.toLowerCase().includes(q) ||
      f.nameEn.toLowerCase().includes(q) ||
      f.slug.toLowerCase().includes(q) ||
      f.synonyms.some((s) => s.toLowerCase().includes(q)),
  );
}

/**
 * Programme ids each field would claim if approved: every `program_job_fields`
 * row for the field EXCEPT one the reviewer has already rejected — the same
 * rule jobthai-bridge.v3's `loadReviewedFieldVocabulary` uses to decide which
 * assignments an approved field brings with it (packages/db/src/job-fields.ts).
 * A PROPOSED assignment still counts: approving the field is what makes its
 * cluster trustworthy, and the assignments under it become the reviewer's
 * working set from that point on.
 */
export function claimableProgramIdsByField(assignments: ProgramJobFieldRowDto[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (a.reviewStatus === 'REJECTED') continue;
    const set = map.get(a.fieldId) ?? new Set<string>();
    set.add(a.programId);
    map.set(a.fieldId, set);
  }
  return map;
}

export interface SelectionSummary {
  /** Selected ids narrowed to what is CURRENTLY VISIBLE and selectable — a
   *  stale id left behind by a filter change, a since-approved field, or a
   *  merge/reject elsewhere is dropped here, never silently carried into
   *  the bulk action. */
  ids: string[];
  fieldCount: number;
  /** Distinct programmes the selected fields would claim BETWEEN THEM — a
   *  union, not a sum, since two fields can already share a programme. */
  programmeCount: number;
  overCapFieldCount: number;
  governmentOnlyFieldCount: number;
}

const EMPTY_SELECTION: SelectionSummary = {
  ids: [],
  fieldCount: 0,
  programmeCount: 0,
  overCapFieldCount: 0,
  governmentOnlyFieldCount: 0,
};

/**
 * Summarises a bulk-approve selection against what is on screen right now.
 * `visibleSelectableFields` must already be the filtered + not-yet-approved
 * list the page is rendering — a selected id that fell out of that list
 * (filter narrowed, or the field was approved/rejected by someone else since)
 * contributes nothing here, which is what keeps the aggregate honest.
 */
export function summarizeSelection(
  selectedIds: ReadonlySet<string>,
  visibleSelectableFields: JobFieldRowDto[],
  claimable: Map<string, Set<string>>,
  sourcesByField: Map<string, FieldSynonymSourceDto[]>,
  maxProgrammesPerField: number | undefined,
): SelectionSummary {
  const chosen = visibleSelectableFields.filter((f) => selectedIds.has(f.id));
  if (chosen.length === 0) return EMPTY_SELECTION;
  const programIds = new Set<string>();
  let overCapFieldCount = 0;
  let governmentOnlyFieldCount = 0;
  for (const f of chosen) {
    const fieldProgrammes = claimable.get(f.id) ?? new Set<string>();
    for (const pid of fieldProgrammes) programIds.add(pid);
    if (maxProgrammesPerField != null && fieldProgrammes.size > maxProgrammesPerField) overCapFieldCount += 1;
    if (isGovernmentOnlyField(f.synonyms, sourcesByField.get(f.id) ?? [])) governmentOnlyFieldCount += 1;
  }
  return {
    ids: chosen.map((f) => f.id),
    fieldCount: chosen.length,
    programmeCount: programIds.size,
    overCapFieldCount,
    governmentOnlyFieldCount,
  };
}

/**
 * The bulk-approve confirmation text — named numbers, not "are you sure?".
 * Ends with the repository's own standing guidance on this page (see
 * CLAUDE.md's "Approve NARROW fields first" note): Task 14 found that
 * guidance existed in the plan and in CLAUDE.md but nowhere on the page
 * where approving actually happens, so it is restated here, at the moment
 * that matters.
 */
export function buildBulkApproveConfirmation(selection: SelectionSummary, maxProgrammesPerField: number | undefined): string {
  const lines = [
    `Approve ${selection.fieldCount} field${selection.fieldCount === 1 ? '' : 's'}?`,
    `Together they will claim ${selection.programmeCount} distinct programme${selection.programmeCount === 1 ? '' : 's'} once approved.`,
  ];
  if (selection.overCapFieldCount > 0) {
    lines.push(
      `${selection.overCapFieldCount} of the selected fields claim${selection.overCapFieldCount === 1 ? 's' : ''} more than ${maxProgrammesPerField ?? 'the cap of'} programmes${selection.overCapFieldCount === 1 ? '' : ' each'} and will be excluded from the JobThai bridge, falling back to name matching instead.`,
    );
  }
  if (selection.governmentOnlyFieldCount > 0) {
    lines.push(
      `${selection.governmentOnlyFieldCount} of the selected fields rest${selection.governmentOnlyFieldCount === 1 ? 's' : ''} entirely on government announcement text, with no JobThai posting evidence.`,
    );
  }
  lines.push('');
  lines.push('Approve narrow fields first. A broad field concentrates thousands of unrelated adverts onto a handful of programmes.');
  return lines.join('\n');
}

/** True when every currently-visible selectable field is in `selectedIds` —
 *  drives both the select-all checkbox's checked state and what it does next. */
export function isAllVisibleSelected(selectedIds: ReadonlySet<string>, visibleSelectableFields: JobFieldRowDto[]): boolean {
  return visibleSelectableFields.length > 0 && visibleSelectableFields.every((f) => selectedIds.has(f.id));
}

/**
 * The next selected-id set after toggling "select all shown". Touches ONLY
 * `visibleSelectableFields` — an id already selected from before a filter
 * narrowed the list is left alone either way, and this function never adds
 * or removes anything the caller cannot currently see.
 */
export function nextSelectionAfterSelectAllToggle(
  selectedIds: ReadonlySet<string>,
  visibleSelectableFields: JobFieldRowDto[],
): Set<string> {
  const next = new Set(selectedIds);
  if (isAllVisibleSelected(selectedIds, visibleSelectableFields)) {
    for (const f of visibleSelectableFields) next.delete(f.id);
  } else {
    for (const f of visibleSelectableFields) next.add(f.id);
  }
  return next;
}

export interface BulkApproveDeps {
  confirm: (message: string) => boolean;
  post: (ids: string[]) => Promise<boolean>;
}

/**
 * The bulk-approve action's logic, extracted out of the component so it can
 * be tested without a DOM (this package's vitest environment is `node` — see
 * apps/web/vitest.config.ts). Confirms with exactly the message
 * buildBulkApproveConfirmation produces, then calls `post` ONCE with the
 * full deduplicated id list — never once per field, and never at all if the
 * confirmation is declined or nothing is selected.
 */
export async function runBulkApprove(
  selection: SelectionSummary,
  maxProgrammesPerField: number | undefined,
  deps: BulkApproveDeps,
): Promise<boolean> {
  if (selection.ids.length === 0) return false;
  if (!deps.confirm(buildBulkApproveConfirmation(selection, maxProgrammesPerField))) return false;
  return deps.post(selection.ids);
}

async function call(path: string, method: 'POST' | 'PATCH', body?: unknown): Promise<boolean> {
  const res = await fetch(`/api/admin-job-fields/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    toast.error(j.error?.message ?? `${method} ${path} failed`);
    return false;
  }
  return true;
}

export function JobFieldsReview({
  fields: initialFields,
  assignments: initialAssignments,
  synonymSources = [],
  maxProgrammesPerField,
}: {
  fields: JobFieldRowDto[];
  assignments: ProgramJobFieldRowDto[];
  synonymSources?: FieldSynonymSourceDto[];
  /** MAX_PROGRAMMES_PER_FIELD (packages/db/src/jobthai-bridge.ts), passed
   *  down from the server page rather than duplicated here — see
   *  apps/web/app/admin/job-fields/page.tsx. Optional so existing callers
   *  (and existing tests) that don't pass it still render; without it the
   *  over-cap flag simply never fires, rather than falling back to a
   *  second hardcoded "15" that could drift from the real constant. */
  maxProgrammesPerField?: number;
}): React.JSX.Element {
  // Hook order is pinned by apps/web/test/job-fields-admin-render.test.tsx,
  // which mocks useState by call index to force the rename/merge forms open
  // (indices 5 and 6) without a real DOM to click through. New state below
  // is APPENDED after mergeTarget (index 7) so those indices never move —
  // see that test's own comment before adding another useState here.
  const [fields, setFields] = React.useState(initialFields);
  const [assignments, setAssignments] = React.useState(initialAssignments);
  const [selected, setSelected] = React.useState<string | null>(initialFields[0]?.id ?? null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; nameTh: string; nameEn: string } | null>(null);
  const [merging, setMerging] = React.useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // Not a useState: synonym-source attribution doesn't change when a field
  // or assignment is approved/rejected/renamed/merged, so it doesn't need to
  // participate in the refresh() round trip — recomputing it from the prop
  // on every render is enough. (Also keeps this component's useState call
  // order stable, which the render test below pins to fixed indices.)
  const sourcesByField = React.useMemo(() => {
    const map = new Map<string, FieldSynonymSourceDto[]>();
    for (const row of synonymSources) {
      const list = map.get(row.fieldId);
      if (list) list.push(row);
      else map.set(row.fieldId, [row]);
    }
    return map;
  }, [synonymSources]);

  // Same reasoning as sourcesByField above: derived from assignments on
  // every render rather than kept in its own useState, so it never needs a
  // manual refresh step and adds no hook-order risk.
  const claimable = React.useMemo(() => claimableProgramIdsByField(assignments), [assignments]);

  const filteredFields = React.useMemo(() => filterJobFields(fields, query), [fields, query]);
  // Only fields with something left to approve can be selected — same
  // condition the per-row Approve button already uses below.
  const selectableFilteredFields = React.useMemo(
    () => filteredFields.filter((f) => f.reviewStatus !== 'APPROVED'),
    [filteredFields],
  );
  const selection = React.useMemo(
    () => summarizeSelection(selectedIds, selectableFilteredFields, claimable, sourcesByField, maxProgrammesPerField),
    [selectedIds, selectableFilteredFields, claimable, sourcesByField, maxProgrammesPerField],
  );
  const allVisibleSelected = isAllVisibleSelected(selectedIds, selectableFilteredFields);

  function toggleField(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible(): void {
    setSelectedIds((prev) => nextSelectionAfterSelectAllToggle(prev, selectableFilteredFields));
  }

  const clearSelection = (): void => setSelectedIds(new Set());

  const refresh = React.useCallback(async () => {
    const res = await fetch('/api/admin-job-fields');
    if (!res.ok) {
      toast.error('Saved, but the list could not be refreshed — reload the page.');
      return;
    }
    const body = (await res.json()) as { data: { fields: JobFieldRowDto[]; assignments: ProgramJobFieldRowDto[] } };
    setFields(body.data.fields);
    setAssignments(body.data.assignments);
  }, []);

  async function act(key: string, path: string, method: 'POST' | 'PATCH', body?: unknown, done?: string): Promise<boolean> {
    setBusy(key);
    try {
      const ok = await call(path, method, body);
      if (ok) {
        if (done) toast.success(done);
        await refresh();
      }
      return ok;
    } finally {
      setBusy(null);
    }
  }

  async function bulkApprove(): Promise<void> {
    const ok = await runBulkApprove(selection, maxProgrammesPerField, {
      confirm: (message) => window.confirm(message),
      post: (ids) =>
        act('bulk-approve', 'bulk-approve', 'POST', { ids }, `Approved ${ids.length} field${ids.length === 1 ? '' : 's'}`),
    });
    if (ok) clearSelection();
  }

  const approved = fields.filter((f) => f.reviewStatus === 'APPROVED').length;
  const proposed = fields.filter((f) => f.reviewStatus === 'PROPOSED').length;
  const selectedField = fields.find((f) => f.id === selected) ?? null;
  const selectedAssignments = assignments.filter((a) => a.fieldId === selected);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-default px-4 py-3">
          <div className="text-sm font-medium">Fields · {fields.length}</div>
          <div className="text-xs text-text-tertiary">{approved} approved · {proposed} proposed · {fields.length - approved - proposed} rejected</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              className={`${INPUT} w-[200px]`}
              placeholder="Search fields…"
              aria-label="Search fields"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                aria-label={allVisibleSelected ? 'Deselect all shown fields' : 'Select all shown fields'}
                data-action="select-all-fields"
                checked={allVisibleSelected}
                disabled={selectableFilteredFields.length === 0 || busy !== null}
                onChange={toggleSelectAllVisible}
              />
              Select all shown{filteredFields.length !== fields.length ? ` (${selectableFilteredFields.length})` : ''}
            </label>
          </div>
          {selection.fieldCount > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent" data-testid="selection-summary">
                <CheckSquare className="h-[14px] w-[14px]" aria-hidden="true" />
                {selection.fieldCount} field{selection.fieldCount === 1 ? '' : 's'} selected · {selection.programmeCount} programme{selection.programmeCount === 1 ? '' : 's'}
                {selection.overCapFieldCount > 0 && (
                  <span className="text-warning"> · {selection.overCapFieldCount} over cap</span>
                )}
              </Badge>
              <Button size="sm" variant="ghost" type="button" onClick={clearSelection} disabled={busy !== null}>
                Clear
              </Button>
              <Button size="sm" type="button" data-action="bulk-approve-fields" disabled={busy !== null} onClick={() => void bulkApprove()}>
                <Check className="h-[14px] w-[14px]" />
                Approve {selection.fieldCount} field{selection.fieldCount === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </div>
        <ul className="divide-y divide-default">
          {filteredFields.map((f) => {
            const fieldClaimable = claimable.get(f.id) ?? new Set<string>();
            const fieldSources = sourcesByField.get(f.id) ?? [];
            const governmentOnly = isGovernmentOnlyField(f.synonyms, fieldSources);
            return (
            <li key={f.id} className={`px-4 py-3 ${selected === f.id ? 'bg-surface-2' : ''}`}>
              {governmentOnly && f.reviewStatus !== 'APPROVED' && (
                <div
                  data-testid="government-only-warning"
                  className="mb-2 flex items-start gap-2 rounded-md border border-[oklch(var(--color-warning-default)/0.3)] bg-warning-subtle px-3 py-2 text-xs leading-relaxed text-text-primary"
                >
                  <AlertTriangle className="mt-0.5 h-[14px] w-[14px] shrink-0 text-warning" aria-hidden="true" />
                  <span>
                    Every synonym of this field comes from government announcements. Approving it will also change which programmes JobThai adverts are matched to, because an approved field&rsquo;s assignments decide that match — and those links feed the JobThai demand-alignment health driver.
                  </span>
                </div>
              )}
              {maxProgrammesPerField != null && fieldClaimable.size > maxProgrammesPerField && (
                <div
                  data-testid="over-cap-warning"
                  className="mb-2 flex items-start gap-2 rounded-md border border-[oklch(var(--color-warning-default)/0.3)] bg-warning-subtle px-3 py-2 text-xs leading-relaxed text-text-primary"
                >
                  <AlertTriangle className="mt-0.5 h-[14px] w-[14px] shrink-0 text-warning" aria-hidden="true" />
                  <span>
                    This field would claim {fieldClaimable.size} programmes, over the {maxProgrammesPerField}-programme cap — approving it excludes it from the JobThai bridge, falling back to name matching instead.
                  </span>
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                {f.reviewStatus !== 'APPROVED' && (
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    aria-label={selectedIds.has(f.id) ? `Deselect ${f.nameEn}` : `Select ${f.nameEn}`}
                    data-action="select-field"
                    checked={selectedIds.has(f.id)}
                    disabled={busy !== null}
                    onChange={() => toggleField(f.id)}
                  />
                )}
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(f.id)}>
                  <div className="truncate text-sm font-medium">{f.nameTh} <span className="text-text-secondary">· {f.nameEn}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.synonyms.map((s) => {
                      const rowSources = fieldSources.find((r) => r.synonym === s)?.sources ?? [];
                      const label = rowSources.map((src) => SOURCE_LABEL[src] ?? src).join(', ');
                      return (
                        <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary">
                          {s}
                          {label && <span className="text-text-tertiary"> · {label}</span>}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">{f.mentionCount.toLocaleString()} postings · {f.programmeCount} programmes</div>
                  {f.reviewStatus !== 'APPROVED' && (
                    <div className="mt-1 text-xs text-text-tertiary" data-testid="claimable-count">
                      Would claim {fieldClaimable.size} programme{fieldClaimable.size === 1 ? '' : 's'} if approved
                    </div>
                  )}
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={STATUS_LABEL[f.reviewStatus].tone}>{STATUS_LABEL[f.reviewStatus].label}</Badge>
                  <div className="flex gap-1">
                    {f.reviewStatus !== 'APPROVED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-action="approve-field"
                        aria-label="Approve field"
                        title="Approve field"
                        disabled={busy !== null}
                        onClick={() => act(f.id, `${f.id}/approve`, 'POST', undefined, `Approved ${f.nameEn}`)}
                      >
                        <Check className="h-[14px] w-[14px]" />
                      </Button>
                    )}
                    {f.reviewStatus !== 'REJECTED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-action="reject-field"
                        aria-label="Reject field"
                        title="Reject field"
                        disabled={busy !== null}
                        onClick={() => act(f.id, `${f.id}/reject`, 'POST', undefined, `Rejected ${f.nameEn}`)}
                      >
                        <X className="h-[14px] w-[14px]" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="rename-field"
                      aria-label="Rename field"
                      title="Rename field"
                      disabled={busy !== null}
                      onClick={() => setRenaming({ id: f.id, nameTh: f.nameTh, nameEn: f.nameEn })}
                    >
                      <Pencil className="h-[14px] w-[14px]" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="merge-field"
                      aria-label="Merge field"
                      title="Merge field"
                      disabled={busy !== null}
                      onClick={() => {
                        setMerging(f.id);
                        setMergeTarget('');
                      }}
                    >
                      <GitMerge className="h-[14px] w-[14px]" />
                    </Button>
                  </div>
                </div>
              </div>
              {renaming?.id === f.id && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(f.id, f.id, 'PATCH', { nameTh: renaming.nameTh, nameEn: renaming.nameEn }, 'Renamed').then((ok) => {
                      if (ok) setRenaming(null);
                    });
                  }}
                >
                  <input
                    className={`${INPUT} w-[224px]`}
                    value={renaming.nameTh}
                    onChange={(e) => setRenaming({ ...renaming, nameTh: e.target.value })}
                    placeholder="Thai name"
                    aria-label="Thai name"
                    required
                    minLength={1}
                  />
                  <input
                    className={`${INPUT} w-[224px]`}
                    value={renaming.nameEn}
                    onChange={(e) => setRenaming({ ...renaming, nameEn: e.target.value })}
                    placeholder="English name"
                    aria-label="English name"
                    required
                    minLength={1}
                  />
                  <Button size="sm" type="submit">Save</Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
                </form>
              )}
              {merging === f.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-2 whitespace-nowrap">
                    Merge into
                    <select
                      className={`${INPUT} min-w-0 flex-1`}
                      title="Rejected fields are not offered — a merge keeps the stronger status and would revive them."
                      value={mergeTarget}
                      onChange={(e) => setMergeTarget(e.target.value)}
                    >
                      <option value="">Choose a field…</option>
                      {fields.filter((g) => g.id !== f.id && g.reviewStatus !== 'REJECTED').map((g) => (
                        <option key={g.id} value={g.id}>{g.nameEn} · {g.nameTh}</option>
                      ))}
                    </select>
                  </label>
                  <Button
                    size="sm"
                    type="button"
                    data-action="merge-confirm"
                    disabled={busy !== null || !mergeTarget}
                    onClick={() => {
                      const into = fields.find((g) => g.id === mergeTarget);
                      if (!into) return;
                      if (!window.confirm(`Merge "${f.nameEn}" into "${into.nameEn}"? Its synonyms and programmes move; the field itself is deleted. This cannot be undone.`)) return;
                      void act(f.id, `${f.id}/merge`, 'POST', { intoId: mergeTarget }, `Merged ${f.nameEn}`).then((ok) => {
                        if (ok) {
                          setSelected(mergeTarget);
                          setMerging(null);
                          setMergeTarget('');
                        }
                      });
                    }}
                  >
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setMerging(null);
                      setMergeTarget('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </li>
            );
          })}
          {fields.length === 0 && <li className="px-4 py-6 text-sm text-text-tertiary">No fields yet. Run pnpm jobthai:fields --apply after a JobThai upload.</li>}
          {fields.length > 0 && filteredFields.length === 0 && (
            <li className="px-4 py-6 text-sm text-text-tertiary">No fields match &ldquo;{query}&rdquo;.</li>
          )}
        </ul>
      </Card>

      <Card className="p-0">
        <div className="border-b border-default px-4 py-3 text-sm font-medium">
          Programmes{selectedField ? ` · ${selectedField.nameEn}` : ''} · {selectedAssignments.length}
        </div>
        <ul className="divide-y divide-default">
          {selectedAssignments.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm">{a.programNameTh} <span className="text-text-secondary">· {a.programNameEn}</span></div>
                <div className="text-xs text-text-tertiary">{a.programCode} · {a.programLevel} · {a.source}{a.confidence != null ? ` · ${(a.confidence * 100).toFixed(0)} %` : ''}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={STATUS_LABEL[a.reviewStatus].tone}>{STATUS_LABEL[a.reviewStatus].label}</Badge>
                <div className="flex gap-1">
                  {a.reviewStatus !== 'APPROVED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="approve-assignment"
                      aria-label="Approve assignment"
                      title="Approve assignment"
                      disabled={busy !== null}
                      onClick={() => act(a.id, `assignments/${a.id}/approve`, 'POST', undefined, 'Assignment approved')}
                    >
                      <Check className="h-[14px] w-[14px]" />
                    </Button>
                  )}
                  {a.reviewStatus !== 'REJECTED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="reject-assignment"
                      aria-label="Reject assignment"
                      title="Reject assignment"
                      disabled={busy !== null}
                      onClick={() => act(a.id, `assignments/${a.id}/reject`, 'POST', undefined, 'Assignment rejected')}
                    >
                      <X className="h-[14px] w-[14px]" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
          {selectedField && selectedAssignments.length === 0 && (
            <li className="px-4 py-6 text-sm text-text-tertiary">No programme assigned. This field is a white space on the map.</li>
          )}
        </ul>
        {selectedField && (
          <form
            className="flex flex-wrap items-center gap-2 border-t border-default px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem('programId') as HTMLInputElement | null);
              const programId = input?.value.trim();
              if (!programId) return;
              void act('add', 'assignments', 'POST', { programId, fieldId: selectedField.id }, 'Programme added').then((ok) => {
                if (ok && input) input.value = '';
              });
            }}
          >
            <input
              name="programId"
              className={`${INPUT} w-[288px]`}
              placeholder="Programme id (from /admin/programs)"
              aria-label="Programme id"
            />
            <Button size="sm" type="submit" disabled={busy !== null}>Add programme</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
