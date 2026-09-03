// ─────────────────────────────────────────────────────────────────────────
// Program pipeline phases — THE SINGLE SOURCE OF TRUTH.
//
// WHY THIS FILE EXISTS
// --------------------
// The per-program pipeline's phase list used to be hand-maintained in FIVE
// separate places with no shared owner:
//
//   1. apps/ingestion/src/scripts/programs-pipeline.ts   (type Phase + ALL_PHASES)
//   2. apps/ingestion/src/ai-jobs/queue.ts               (ProgramPipelinePhase)
//   3. apps/api/src/ai-jobs/ai-jobs-queue.service.ts     (ProgramPipelinePhase, duplicate)
//   4. apps/web/app/admin/programs/list-client.tsx       (Phase + ALL_PHASES + labels + hints)
//   5. apps/web/app/admin/data-setup/programs-pipeline-launcher.tsx (PHASES[])
//
// That is not a hypothetical risk. `phaseRE` (research expertise) was added to
// (1) only and was silently absent from the other four for its ENTIRE lifetime,
// so it never ran from any preset or custom run in the admin UI — only from a
// full run. Nobody noticed, because the pipeline's `--only` parser SILENTLY
// DROPS ids it does not recognise (no error, no warning). It was re-synced by
// hand in 2026-09; nothing structural changed, so the next phase added would
// have drifted exactly the same way.
//
// Everything below is deliberately pure data + types. It must NEVER import
// anything with a runtime dependency: the two web consumers are `'use client'`
// React components, and the `@kku/shared` root barrel re-exports subpaths that
// reach node:crypto / aws-sdk. Those clients import this module through the
// `@kku/shared/pipeline/program-phases` subpath export (declared in the
// package's `exports` map) precisely so the barrel is never pulled into a
// browser bundle.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every phase the per-program pipeline knows about, in PHASE-NUMBER order.
 *
 * This is the order `programs-pipeline.ts` uses for the `--only` filter and the
 * "Phases enabled" banner, and the order the admin checkbox lists render in.
 * It is NOT the pipeline's execution order: `phase6` (AI readiness) actually
 * runs BEFORE `phase5` (AI benchmarking) inside `runProgram()`, because the
 * readiness scorer feeds the peer review. Reordering this array changes what
 * operators see, not what runs — the execution order lives in the sequence of
 * `shouldRun(...)` blocks in the pipeline script.
 */
export const PROGRAM_PIPELINE_PHASES = [
  'phase1',
  'phase2',
  'phase2b',
  'phase3',
  'phase4',
  'phase5',
  'phase6',
  'phaseRE',
  'phaseCR',
  'phase7',
  'phase8',
] as const;

/** Derived from the array above — never hand-write this union again. */
export type ProgramPipelinePhase = (typeof PROGRAM_PIPELINE_PHASES)[number];

/**
 * Per-phase display metadata.
 *
 * Two web surfaces render phases and they need DIFFERENT shapes, which is part
 * of why the copies drifted. Both shapes are carried here so neither file has
 * to keep its own table:
 *
 *  - `label` / `dependencyHint` — the /admin/programs run-pipeline dialog.
 *  - `shortLabel` / `detail` / `approxCostUsd` — the /admin/data-setup launcher.
 *
 * Note `dependencyHint` and `detail` are NOT the same field even though both
 * files called theirs "hint": `dependencyHint` warns that a phase will no-op
 * without its upstream phase; `detail` describes what the phase does.
 */
export interface ProgramPhaseMeta {
  /** Long label, with the "Phase N ·" prefix. */
  label: string;
  /** Compact label for surfaces that render the phase id separately. */
  shortLabel: string;
  /** What this phase actually does. */
  detail: string;
  /**
   * Set only for phases whose input comes from another phase. Neither picker
   * has a dependency engine on purpose — this renders as an inline note so an
   * operator ticking the phase alone understands why it may skip.
   */
  dependencyHint?: string;
  /** Approximate LLM spend per program. 0 = no AI call (DB / SQL only). */
  approxCostUsd: number;
}

export const PROGRAM_PHASE_META: Record<ProgramPipelinePhase, ProgramPhaseMeta> = {
  phase1: {
    label: 'Phase 1 · PDF extraction (digest / faculty / skills / pedagogy)',
    shortLabel: 'PDF extraction',
    detail: 'digest + faculty + skills + pedagogy (parallel)',
    approxCostUsd: 0.04,
  },
  phase2: {
    label: 'Phase 2 · Approve + materialise',
    shortLabel: 'Approve + materialise',
    detail: 'DB-only — writes ProgramSkill rows',
    approxCostUsd: 0,
  },
  phase2b: {
    label: 'Phase 2b · Courses-extract (focused course-code list)',
    shortLabel: 'Course-code extraction',
    detail: 'focused รายวิชา slice (parallel with phase 1)',
    approxCostUsd: 0.02,
  },
  phase3: {
    label: 'Phase 3 · Careers + demand match',
    shortLabel: 'Careers + demand match',
    detail: 'sequential, Flash',
    approxCostUsd: 0.02,
  },
  phase4: {
    label: 'Phase 4 · Oracle / MSSQL data linkage',
    shortLabel: 'Oracle / MSSQL linkage',
    detail: 'cohorts + alumni + financials (parallel)',
    approxCostUsd: 0,
  },
  phase5: {
    label: 'Phase 5 · AI benchmarking (peer select + review)',
    shortLabel: 'AI benchmarking (peer comparison)',
    detail: 'peer select + peer review (Pro reasoning)',
    approxCostUsd: 0.2,
  },
  phase6: {
    label: 'Phase 6 · AI readiness',
    shortLabel: 'AI readiness',
    detail: 'AI-readiness scorer (Pro) — runs before narrative',
    approxCostUsd: 0.05,
  },
  phaseRE: {
    label: 'Research expertise · themes from staff publications',
    shortLabel: 'Research expertise',
    detail: 'themes from staff publications (Pro) — insert-only, skipped if a row exists',
    approxCostUsd: 0.02,
  },
  phaseCR: {
    label: 'Curriculum revision · course-level advice from research',
    shortLabel: 'Curriculum revision',
    detail: 'course-level advice (Pro) — runs after research expertise; skips without it',
    dependencyHint: 'Needs research expertise to have run first — skips without it.',
    approxCostUsd: 0.02,
  },
  phase7: {
    label: 'Phase 7 · Strategic narrative',
    shortLabel: 'Strategic narrative',
    detail: 'Pro thinking — runs LAST, depends on 1-6',
    approxCostUsd: 0.3,
  },
  phase8: {
    label: 'Phase 8 · Risk analysis',
    shortLabel: 'Risk analysis',
    detail: 'deterministic + Pro narrative — depends on 4-5',
    approxCostUsd: 0.1,
  },
};

/**
 * Narrowing guard for operator-supplied strings (`--only=`, `--skip=`, the
 * queue's `pipelinePhases[]`). Callers that drop unknown ids should say so —
 * the silent drop in `parseArgs()` is what kept the `phaseRE` gap invisible.
 */
export function isProgramPipelinePhase(x: string): x is ProgramPipelinePhase {
  return (PROGRAM_PIPELINE_PHASES as readonly string[]).includes(x);
}

/** Cost string as the launcher has always rendered it: `free` or `~$0.04`. */
export function formatPhaseCost(approxCostUsd: number): string {
  return approxCostUsd === 0 ? 'free' : `~$${approxCostUsd.toFixed(2)}`;
}
