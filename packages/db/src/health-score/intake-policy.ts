import { intakeComplianceFor, intakeFloors } from '@kku/shared';
import type { IntakeCompliance } from '@kku/shared';

// ── Intake-floor policy ─────────────────────────────────────────────
// Council policy: every programme must hit a minimum new-intake floor each
// academic year. Failing the floor is a structural risk signal — strict for
// undergraduate (closure-track), watch-list for postgraduate (where a small
// cohort is structurally normal).
//
// The floors themselves are NOT here any more. They were `30` and `8`,
// written in this file and copied into risk-scoring.ts, which judged every
// adopting institution by one university's rule and gave two constants the
// freedom to drift apart. They now sit on the organisation profile and are
// read through @kku/shared's intake-policy module, which is also where the
// curves live. An installation with no profile configured yields no floors,
// and the driver below reads null rather than guessing.
//
// Compliance state surfaces in the attractiveness driver's `raw.compliance`
// field and feeds the lifecycle verdict.
export type { IntakeCompliance } from '@kku/shared';

/** Standalone helper for surface-layer code (deep-dive header, dashboard,
 *  cockpit). Returns the canonical compliance state for any program given
 *  its level + latest intake. Wraps `intakeComplianceFor` so callers
 *  don't need to import the internal scoring math. */
export function getKkuIntakePolicyVerdict(
  level: string,
  latestIntake: number | null,
): { state: IntakeCompliance; floor: number } {
  const v = intakeComplianceFor(level, latestIntake, intakeFloors());
  return { state: v.state, floor: v.floor };
}
