'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@kku/ui';
import { AlertTriangle, Check, CheckSquare, CircleDollarSign, GitMerge, Loader2, Pencil, RefreshCw, X } from 'lucide-react';

// @kku/ui has no text-input primitive; the /usage search box uses a plain
// <input> with token classes, and so does this page — classes copied from
// apps/web/app/usage/client.tsx's search input.
const INPUT = 'rounded-md border border-default bg-surface-1 px-3 py-1.5 text-xs text-text-primary';

// Border colour utilities mostly emit no CSS (only border-subtle / -default
// / -strong / -transparent exist — see CLAUDE.md's "807 border-colour
// utilities" note); an arbitrary value wrapping the token var is the
// working pattern, same as the government-only / over-cap warnings below.
const OUTCOME_TONE_CLASSES: Record<'success' | 'warning' | 'danger', string> = {
  success: 'border-[oklch(var(--color-success-default)/0.3)] bg-success-subtle',
  warning: 'border-[oklch(var(--color-warning-default)/0.3)] bg-warning-subtle',
  danger: 'border-[oklch(var(--color-danger-default)/0.3)] bg-danger-subtle',
};

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

// ── Assignment-level bulk approve (within one field) ────────────────────────
//
// A ProgramJobField row says "this programme's graduates hold this field of
// study". Unlike field-level approval (global, one list across all 71
// fields), an assignment selection is SCOPED to whichever field's programme
// list is currently on screen — the right-hand panel shows exactly one
// field's assignments at a time. `summarizeAssignmentSelection` below
// enforces that scoping the same way `summarizeSelection` enforces "visible
// only" above: it intersects the selected-id set against
// `visibleSelectableAssignments`, which the caller must already have
// filtered to the CURRENT field's PROPOSED rows. An id left over from a
// different field the reviewer looked at earlier sits harmlessly in the
// underlying Set — it can never reach `selection.ids` (and therefore never
// reach the POST body) until that field is the one on screen again.

export interface AssignmentSelectionSummary {
  /** Selected ids narrowed to what is CURRENTLY VISIBLE for the field on
   *  screen — the same "visible-only" contract as SelectionSummary.ids. */
  ids: string[];
  count: number;
  ruleCount: number;
  aiCount: number;
}

const EMPTY_ASSIGNMENT_SELECTION: AssignmentSelectionSummary = { ids: [], count: 0, ruleCount: 0, aiCount: 0 };

/**
 * Summarises an assignment bulk-approve selection against one field's
 * currently-visible PROPOSED rows. `visibleSelectableAssignments` must
 * already be that field's PROPOSED-only list — an assignment that is
 * APPROVED, REJECTED, or belongs to a different field contributes nothing
 * here, which is both the "already-approved can never be selected" rule and
 * the cross-field-leakage guard in one mechanism.
 */
export function summarizeAssignmentSelection(
  selectedIds: ReadonlySet<string>,
  visibleSelectableAssignments: ProgramJobFieldRowDto[],
): AssignmentSelectionSummary {
  const chosen = visibleSelectableAssignments.filter((a) => selectedIds.has(a.id));
  if (chosen.length === 0) return EMPTY_ASSIGNMENT_SELECTION;
  let ruleCount = 0;
  let aiCount = 0;
  for (const a of chosen) {
    if (a.source === 'rule') ruleCount += 1;
    else if (a.source === 'ai') aiCount += 1;
  }
  return { ids: chosen.map((a) => a.id), count: chosen.length, ruleCount, aiCount };
}

/** True when every currently-visible selectable assignment is in `selectedIds`. */
export function isAllVisibleAssignmentsSelected(
  selectedIds: ReadonlySet<string>,
  visibleSelectableAssignments: ProgramJobFieldRowDto[],
): boolean {
  return visibleSelectableAssignments.length > 0 && visibleSelectableAssignments.every((a) => selectedIds.has(a.id));
}

/**
 * The next selected-id set after toggling "select all shown" for the field
 * currently on screen. Touches ONLY `visibleSelectableAssignments` — an id
 * selected earlier for a different field is left exactly as it was, so this
 * can never add or remove anything belonging to another field.
 */
export function nextAssignmentSelectionAfterSelectAllToggle(
  selectedIds: ReadonlySet<string>,
  visibleSelectableAssignments: ProgramJobFieldRowDto[],
): Set<string> {
  const next = new Set(selectedIds);
  if (isAllVisibleAssignmentsSelected(selectedIds, visibleSelectableAssignments)) {
    for (const a of visibleSelectableAssignments) next.delete(a.id);
  } else {
    for (const a of visibleSelectableAssignments) next.add(a.id);
  }
  return next;
}

/**
 * The assignment bulk-approve confirmation text. Names the rule/AI split
 * whenever both are present, and calls out the AI count explicitly when any
 * AI-sourced row is in the batch — an AI assignment is a model's guess, not
 * a name match, and a reviewer approving 88 of them in one click should see
 * that is what they are doing (see the module banner in
 * packages/db/src/job-fields.ts on why source matters here).
 */
export function buildBulkApproveAssignmentsConfirmation(selection: AssignmentSelectionSummary): string {
  const lines = [`Approve ${selection.count} assignment${selection.count === 1 ? '' : 's'}?`];
  const parts: string[] = [];
  if (selection.ruleCount > 0) parts.push(`${selection.ruleCount} rule-matched`);
  if (selection.aiCount > 0) parts.push(`${selection.aiCount} AI-suggested`);
  if (parts.length > 0) lines.push(`${parts.join(', ')}.`);
  if (selection.aiCount > 0) {
    lines.push(
      `${selection.aiCount} of these came from the AI field-matching model, not a name match — review before approving in bulk.`,
    );
  }
  return lines.join('\n');
}

export interface BulkApproveDeps {
  confirm: (message: string) => boolean;
  post: (ids: string[]) => Promise<boolean>;
}

/**
 * The assignment bulk-approve action's logic — same shape and same testing
 * rationale as runBulkApprove above (no DOM in this package's vitest env).
 * Confirms with exactly the message buildBulkApproveAssignmentsConfirmation
 * produces, posts ONCE with the full id list, and never posts at all if the
 * confirmation is declined or nothing is selected.
 */
export async function runBulkApproveAssignments(
  selection: AssignmentSelectionSummary,
  deps: BulkApproveDeps,
): Promise<boolean> {
  if (selection.ids.length === 0) return false;
  if (!deps.confirm(buildBulkApproveAssignmentsConfirmation(selection))) return false;
  return deps.post(selection.ids);
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

// ── Derived-layer rebuild triggers ──────────────────────────────────────────
//
// Approving a field or an assignment changes nothing an operator can SEE
// until the JobThai programme-link bridge is rebuilt from it — today that
// only happens via a CLI script (pnpm jobthai:link-programs / jobthai:fields)
// or the next JobThai upload. These two triggers let an operator run the
// same rebuild from this page.
//
//   - Rebuild programme links: planJobThaiLinks() + writeJobThaiLinks() —
//     deterministic, no model calls, free.
//   - Full derived refresh: refreshJobThaiDerived() — occupations, skills,
//     links, AND the field-of-study taxonomy build, which calls the AI
//     model and spends real money.
//
// Server-side: apps/api/src/job-fields/job-fields.controller.ts's
// rebuildLinks / refreshAll / refreshStatus. Handlers:
// apps/ingestion/src/ai-jobs/handlers.ts's RUN_JOBTHAI_LINK_REBUILD /
// RUN_JOBTHAI_FULL_REFRESH.

/** Live count of ProgramJobThaiLink rows — read fresh on every refresh-status
 *  poll, never hardcoded (the CLAUDE.md-documented "1,716 links across 82
 *  programmes" figure is a point-in-time snapshot, not a constant). */
export interface JobThaiLinkStateDto {
  totalLinks: number;
  linkedProgrammes: number;
  methodologyVersion: string;
}

/**
 * The last FINISHED job of one kind. `status: 'JOB_FAILED'` means the
 * handler threw rather than returning a result of its own (a BullMQ-level
 * failure); `partial: true` means the handler explicitly said a SUCCEEDED
 * run did not finish everything — see RUN_JOBTHAI_FULL_REFRESH's doc
 * comment in apps/ingestion/src/ai-jobs/handlers.ts. `message` is built
 * server-side from counts only, never a raw id — see the "no raw cuid on
 * screen" test in this page's test suite.
 */
export interface RefreshOutcomeDto {
  status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED' | 'JOB_FAILED';
  message: string | null;
  partial: boolean;
  finishedAt: string | null;
}

export interface RefreshStatusDto {
  linkRebuildRunning: boolean;
  fullRefreshRunning: boolean;
  linkState: JobThaiLinkStateDto | null;
  lastLinkRebuild: RefreshOutcomeDto | null;
  lastFullRefresh: RefreshOutcomeDto | null;
}

// Documented estimate, not a live computation — see CLAUDE.md's gap-map.v1
// notes ("roughly USD 0.26-0.33 ... plus a known recurring waste of about
// $0.17 a run"). There is no formula in this codebase that derives this
// number from current data; it is the operator's known-cost figure for the
// taxonomy step, restated here so the button names it before the click.
export const JOBTHAI_FULL_REFRESH_COST_MIN_USD = 0.26;
export const JOBTHAI_FULL_REFRESH_COST_MAX_USD = 0.33;

/** Deliberately does NOT mention money — button 1 is free and deterministic,
 *  and must never look like it costs something. */
export const LINK_REBUILD_HELP_TEXT = 'Free · deterministic, no model calls.';

export function fullRefreshCostLabel(): string {
  return `~USD ${JOBTHAI_FULL_REFRESH_COST_MIN_USD.toFixed(2)}–${JOBTHAI_FULL_REFRESH_COST_MAX_USD.toFixed(2)} per run`;
}

/**
 * The full-refresh confirmation text — names the cost figure and what it
 * pays for, the same "named numbers, not are-you-sure" style as
 * buildBulkApproveConfirmation above. Must be shown, and confirmed, before
 * RUN_JOBTHAI_FULL_REFRESH is ever enqueued.
 */
export function buildFullRefreshConfirmation(): string {
  return [
    'Run the full JobThai derived-layer refresh?',
    'This rebuilds occupations, skills, and programme links, AND the field-of-study taxonomy — the same rebuild the JobThai connector runs at the end of every upload.',
    `The taxonomy step calls the AI model and will spend roughly ${fullRefreshCostLabel()}.`,
    'Programme links feed jobthai_demand_alignment, a Council-facing health driver — this also changes which programmes JobThai adverts are matched to.',
  ].join('\n');
}

export interface TriggerDeps {
  post: () => Promise<boolean>;
}

/** No confirmation — button 1 is free and deterministic. */
export async function runLinkRebuild(deps: TriggerDeps): Promise<boolean> {
  return deps.post();
}

export interface TriggerWithConfirmDeps extends TriggerDeps {
  confirm: (message: string) => boolean;
}

/** Confirms with exactly buildFullRefreshConfirmation()'s text before
 *  posting — never posts if the confirmation is declined. */
export async function runFullRefresh(deps: TriggerWithConfirmDeps): Promise<boolean> {
  if (!deps.confirm(buildFullRefreshConfirmation())) return false;
  return deps.post();
}

/** Which job(s), if any, are keeping both buttons disabled — named so the
 *  reason is visible on screen, not a silently dead button. */
export function describeJobsInFlight(status: RefreshStatusDto | null): string | null {
  if (!status) return null;
  if (status.linkRebuildRunning && status.fullRefreshRunning) {
    return 'A link rebuild and a full refresh are both running — both buttons are disabled until they finish.';
  }
  if (status.fullRefreshRunning) {
    return 'A full derived refresh is running — both buttons are disabled until it finishes.';
  }
  if (status.linkRebuildRunning) {
    return 'A programme-link rebuild is running — both buttons are disabled until it finishes.';
  }
  return null;
}

export interface RefreshOutcomeDisplay {
  tone: 'success' | 'warning' | 'danger';
  text: string;
}

/**
 * Turns the last-run outcome into what the operator sees — and, critically,
 * gives a PARTIAL full refresh (the field-taxonomy step failed but links and
 * occupations still landed) a visibly different tone and wording than an
 * ordinary full success. Reporting "Done." either way would be the flat
 * "done" this feature exists to avoid.
 */
export function describeRefreshOutcome(
  outcome: RefreshOutcomeDto | null | undefined,
  label: string,
): RefreshOutcomeDisplay | null {
  if (!outcome) return null;
  if (outcome.status === 'FAILED' || outcome.status === 'JOB_FAILED') {
    return { tone: 'danger', text: `${label} failed: ${outcome.message ?? 'no details available — check the ingestion log.'}` };
  }
  if (outcome.status === 'SKIPPED') {
    return { tone: 'warning', text: `${label} skipped: ${outcome.message ?? 'no details available.'}` };
  }
  if (outcome.partial) {
    return {
      tone: 'warning',
      text:
        `${label}: partial — links and occupations refreshed, but the field-taxonomy step did not complete.` +
        (outcome.message ? ` ${outcome.message}` : ''),
    };
  }
  return { tone: 'success', text: `${label}: done.${outcome.message ? ` ${outcome.message}` : ''}` };
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
  initialRefreshStatus = null,
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
  /** GET /admin/job-fields/refresh-status, fetched server-side in page.tsx.
   *  Optional (and defaults to null) so existing callers/tests render
   *  unchanged; null renders the rebuild controls with "unknown" in-flight
   *  state rather than blocking the rest of the page. */
  initialRefreshStatus?: RefreshStatusDto | null;
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
  // Appended AFTER selectedIds (index 9) so the hook-order test's pinned
  // indices never shift — see apps/web/test/job-fields-admin-bulk-approve.test.tsx.
  const [assignmentSelectedIds, setAssignmentSelectedIds] = React.useState<Set<string>>(new Set());
  // Appended AFTER assignmentSelectedIds (index 10) — see
  // apps/web/test/job-fields-admin-assignment-bulk-approve.test.tsx's own
  // pinned-index comment. Index 11; do not insert anything before this.
  const [refreshStatus, setRefreshStatus] = React.useState<RefreshStatusDto | null>(initialRefreshStatus);

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

  function toggleAssignment(id: string): void {
    setAssignmentSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisibleAssignments(): void {
    setAssignmentSelectedIds((prev) => nextAssignmentSelectionAfterSelectAllToggle(prev, selectableSelectedAssignments));
  }

  const clearAssignmentSelection = (): void => setAssignmentSelectedIds(new Set());

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
  // Only PROPOSED rows are bulk-selectable — an APPROVED assignment can never
  // be selected (it is simply absent from this list), and REJECTED rows stay
  // out of bulk-approve too even though the per-row button still allows
  // re-approving one individually.
  const selectableSelectedAssignments = selectedAssignments.filter((a) => a.reviewStatus === 'PROPOSED');
  const assignmentSelection = summarizeAssignmentSelection(assignmentSelectedIds, selectableSelectedAssignments);
  const allVisibleAssignmentsSelected = isAllVisibleAssignmentsSelected(assignmentSelectedIds, selectableSelectedAssignments);

  async function bulkApproveAssignments(): Promise<void> {
    const ok = await runBulkApproveAssignments(assignmentSelection, {
      confirm: (message) => window.confirm(message),
      post: (ids) =>
        act(
          'bulk-approve-assignments',
          'assignments/bulk-approve',
          'POST',
          { ids },
          `Approved ${ids.length} assignment${ids.length === 1 ? '' : 's'}`,
        ),
    });
    if (ok) clearAssignmentSelection();
  }

  const fetchRefreshStatus = React.useCallback(async () => {
    const res = await fetch('/api/admin-job-fields/refresh-status');
    if (!res.ok) return;
    const body = (await res.json().catch(() => null)) as { data: RefreshStatusDto } | null;
    if (body?.data) setRefreshStatus(body.data);
  }, []);

  // Polls while either derived-layer job might be running so the buttons
  // re-enable and the outcome banner appears without a manual reload — a
  // full refresh can run for minutes. Not exercised by this package's tests
  // (no jsdom, no timers to drive); the polling itself is not business
  // logic, only fetchRefreshStatus and the pure functions above are.
  React.useEffect(() => {
    if (!refreshStatus?.linkRebuildRunning && !refreshStatus?.fullRefreshRunning) return;
    const id = window.setInterval(() => void fetchRefreshStatus(), 5000);
    return () => window.clearInterval(id);
  }, [refreshStatus?.linkRebuildRunning, refreshStatus?.fullRefreshRunning, fetchRefreshStatus]);

  const jobsInFlightReason = describeJobsInFlight(refreshStatus);
  const jobsInFlight = jobsInFlightReason !== null;
  const linkRebuildOutcome = describeRefreshOutcome(refreshStatus?.lastLinkRebuild, 'Rebuild programme links');
  const fullRefreshOutcome = describeRefreshOutcome(refreshStatus?.lastFullRefresh, 'Full derived refresh');

  async function triggerLinkRebuild(): Promise<void> {
    const ok = await runLinkRebuild({
      post: () =>
        act('rebuild-links', 'rebuild-links', 'POST', undefined, 'Programme-link rebuild queued'),
    });
    if (ok) await fetchRefreshStatus();
  }

  async function triggerFullRefresh(): Promise<void> {
    const ok = await runFullRefresh({
      confirm: (message) => window.confirm(message),
      post: () => act('refresh-all', 'refresh-all', 'POST', undefined, 'Full derived refresh queued'),
    });
    if (ok) await fetchRefreshStatus();
  }

  return (
    <div className="grid gap-4">
      <Card className="p-4" data-testid="derived-layer-rebuilds">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Derived-layer rebuilds</div>
            <div className="mt-1 text-xs text-text-tertiary" data-testid="link-state">
              {refreshStatus?.linkState
                ? `${refreshStatus.linkState.totalLinks.toLocaleString()} program_jobthai_links across ${refreshStatus.linkState.linkedProgrammes} programme${refreshStatus.linkState.linkedProgrammes === 1 ? '' : 's'} · ${refreshStatus.linkState.methodologyVersion}`
                : 'Link state unavailable — reload to try again.'}
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                variant="outline"
                type="button"
                data-action="rebuild-links"
                disabled={jobsInFlight || busy !== null}
                onClick={() => void triggerLinkRebuild()}
              >
                <RefreshCw className="h-[14px] w-[14px]" />
                Rebuild programme links
              </Button>
              <span className="text-[11px] text-text-tertiary" data-testid="rebuild-links-help">
                {LINK_REBUILD_HELP_TEXT}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                variant="outline"
                type="button"
                data-action="refresh-all"
                disabled={jobsInFlight || busy !== null}
                onClick={() => void triggerFullRefresh()}
              >
                <CircleDollarSign className="h-[14px] w-[14px]" />
                Full derived refresh
              </Button>
              <span className="text-[11px] text-text-tertiary" data-testid="refresh-all-help">
                Spends real money — {fullRefreshCostLabel()}
              </span>
            </div>
          </div>
        </div>
        {jobsInFlight && (
          <div
            data-testid="jobs-in-flight"
            className="mt-3 flex items-center gap-2 rounded-md border border-[oklch(var(--color-accent-default)/0.3)] bg-surface-2 px-3 py-2 text-xs text-text-secondary"
          >
            <Loader2 className="h-[14px] w-[14px] animate-spin" aria-hidden="true" />
            {jobsInFlightReason}
          </div>
        )}
        {linkRebuildOutcome && (
          <div
            data-testid="link-rebuild-outcome"
            className={`mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed text-text-primary ${OUTCOME_TONE_CLASSES[linkRebuildOutcome.tone]}`}
          >
            {linkRebuildOutcome.text}
          </div>
        )}
        {fullRefreshOutcome && (
          <div
            data-testid="full-refresh-outcome"
            className={`mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed text-text-primary ${OUTCOME_TONE_CLASSES[fullRefreshOutcome.tone]}`}
          >
            {fullRefreshOutcome.text}
          </div>
        )}
      </Card>
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
        {selectableSelectedAssignments.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-3">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                aria-label={allVisibleAssignmentsSelected ? 'Deselect all shown assignments' : 'Select all shown assignments'}
                data-action="select-all-assignments"
                checked={allVisibleAssignmentsSelected}
                disabled={busy !== null}
                onChange={toggleSelectAllVisibleAssignments}
              />
              Select all proposed ({selectableSelectedAssignments.length})
            </label>
            {assignmentSelection.count > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent" data-testid="assignment-selection-summary">
                  <CheckSquare className="h-[14px] w-[14px]" aria-hidden="true" />
                  {assignmentSelection.count} assignment{assignmentSelection.count === 1 ? '' : 's'} selected ({assignmentSelection.ruleCount} rule, {assignmentSelection.aiCount} AI)
                </Badge>
                <Button size="sm" variant="ghost" type="button" onClick={clearAssignmentSelection} disabled={busy !== null}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  type="button"
                  data-action="bulk-approve-assignments"
                  disabled={busy !== null}
                  onClick={() => void bulkApproveAssignments()}
                >
                  <Check className="h-[14px] w-[14px]" />
                  Approve {assignmentSelection.count} assignment{assignmentSelection.count === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </div>
        )}
        <ul className="divide-y divide-default">
          {selectedAssignments.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
              {a.reviewStatus === 'PROPOSED' && (
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  aria-label={assignmentSelectedIds.has(a.id) ? `Deselect ${a.programNameEn}` : `Select ${a.programNameEn}`}
                  data-action="select-assignment"
                  checked={assignmentSelectedIds.has(a.id)}
                  disabled={busy !== null}
                  onChange={() => toggleAssignment(a.id)}
                />
              )}
              <div className="min-w-0 flex-1">
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
    </div>
  );
}
