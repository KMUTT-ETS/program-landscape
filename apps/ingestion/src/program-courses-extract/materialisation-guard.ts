/**
 * Guard for phase2b's delete-and-replace of `program_courses`.
 *
 * WHY THIS EXISTS (2026-09-07). The materialiser in ./run.ts ran an
 * unconditional
 *
 *     $transaction([ deleteMany({ programId }), createMany(rows) ])
 *
 * whose comment claimed "idempotent on re-runs". It is idempotent only when
 * extraction succeeds. On an LLM failure the runner deliberately does NOT
 * fail: it records confidence 0 plus the failure reason and continues with
 * whatever the regex fallback found — possibly nothing. The wipe then ran
 * anyway. Production logs:
 *
 *     ✓ phase2b ...  56 → 0 courses · confidence 0.00
 *     ✓ phase2b ...  14 → 0 courses · confidence 0.00
 *
 * Green ticks, zero cost, 70 extracted courses destroyed. Downstream phaseCR
 * then skipped with `no-courses` — also green — so the whole chain reported
 * success while deleting the input it depended on, and the programme's
 * Curriculum revision section went blank with no failure anywhere to explain
 * it. 280 programmes had a curriculum PDF; only 229 still had courses.
 *
 * The asymmetry that decides the rule: stale courses can be re-extracted from
 * the PDF at any time, deleted ones cannot be recovered from anything the
 * pipeline holds.
 *
 * Pure on purpose — the decision is the part worth testing, and testing it
 * must not require a database.
 */

export type CourseMaterialisationDecision =
  | { action: 'replace' }
  | { action: 'refuse'; reason: string };

export function decideCourseMaterialisation(input: {
  /** Rows this run would write. */
  nextCount: number;
  /** Rows already in `program_courses` for the programme. */
  previousCount: number;
}): CourseMaterialisationDecision {
  const { nextCount, previousCount } = input;

  if (nextCount === 0 && previousCount > 0) {
    return {
      action: 'refuse',
      reason:
        `refusing to replace ${previousCount} existing course${previousCount === 1 ? '' : 's'} ` +
        `with 0 — stale courses are recoverable from the PDF, deleted ones are not`,
    };
  }

  // A shrink that still leaves courses behind is allowed. A legitimate
  // re-extraction can genuinely find fewer (the v2.3 รายวิชา scope clamp
  // dropped appendix codes on purpose), and a ratio threshold would need
  // calibration evidence we do not have. Only total loss is unambiguous.
  return { action: 'replace' };
}
