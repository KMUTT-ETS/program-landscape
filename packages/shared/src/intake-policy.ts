/**
 * Minimum viable intake — a university council's policy, not a property of
 * this software.
 *
 * These were two constants named `KKU_INTAKE_FLOOR_BACHELOR` and
 * `KKU_INTAKE_FLOOR_POSTGRAD`, written in `health-score.ts` and copied into
 * `risk-scoring.ts`. An institution whose floor is 20 rather than 30 had
 * every programme judged against another university's rule, and could only
 * change it by editing two files that were free to drift apart. They now
 * live on the organisation profile beside the branding settings, and this
 * module is the one place that reads them.
 */

import { getInstitution, isOrganizationLoaded } from './institution';

/** Where an intake sits against its level's floor. */
export type IntakeCompliance = 'compliant' | 'watch' | 'breach' | 'unknown';

export interface IntakeFloors {
  /** Below this, a bachelor programme is closure-track. */
  bachelor: number;
  /** Below this, a postgraduate programme goes on the watch list. */
  postgrad: number;
}

/**
 * What a new organisation profile starts with — the values this product
 * shipped with, so an existing installation's scores do not move.
 *
 * An adopter is expected to change them at /admin/organization. They are a
 * starting point, never a silent fallback: a profile that has not been
 * configured yields no floors at all (see `intakeFloors`).
 */
export const DEFAULT_INTAKE_FLOORS: IntakeFloors = { bachelor: 30, postgrad: 8 };

/**
 * This installation's floors, or null when they cannot be known.
 *
 * Deliberately non-throwing, unlike every identity reader in
 * `institution.ts`. Those throw so a white-label install can never call
 * itself the wrong university; here a throw would blank every health score
 * in the process. The honest answer for a threshold we do not have is the
 * same as for any other missing number: null, which the scorers carry
 * through as `unknown` rather than guessing.
 */
export function intakeFloors(): IntakeFloors | null {
  if (!isOrganizationLoaded()) return null;
  try {
    const inst = getInstitution();
    return { bachelor: inst.intakeFloorBachelor, postgrad: inst.intakeFloorPostgrad };
  } catch {
    // Loaded, but no profile row exists yet.
    return null;
  }
}

/**
 * Where one programme's latest intake sits against its level's floor.
 *
 * The curves are unchanged from the original constants, so an installation
 * whose floors are still 30 and 8 scores exactly as it did before:
 *   - bachelor is strict — at the floor 50, at twice the floor 100, and
 *     below it the score falls away linearly to 0;
 *   - postgraduate is a watch list — at the floor 60, below it 30 and up.
 */
export function intakeComplianceFor(
  level: string,
  intake: number | null,
  floors: IntakeFloors | null,
): { state: IntakeCompliance; floor: number; score: number | null } {
  if (intake === null || floors === null) {
    return { state: 'unknown', floor: 0, score: null };
  }

  if (level === 'BACHELOR') {
    const floor = floors.bachelor;
    if (intake < floor) {
      return { state: 'breach', floor, score: clamp((intake / floor) * 50) };
    }
    return { state: 'compliant', floor, score: clamp(50 + ((intake - floor) / floor) * 50) };
  }

  // MASTER / DOCTORAL / HIGHER_GRAD_DIPLOMA — watch-list, not closure-track.
  const floor = floors.postgrad;
  if (intake < floor) {
    return { state: 'watch', floor, score: clamp(30 + (intake / floor) * 30) };
  }
  return { state: 'compliant', floor, score: clamp(60 + ((intake - floor) / floor) * 40) };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
