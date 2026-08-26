import { describe, it, expect } from 'vitest';
import { allEvidenceBindings, type EvidenceBinding } from '@kku/shared';
import { prisma } from '../src/index';
import {
  aunqaAvailabilityKey,
  aunqaCompletenessForPrograms,
  aunqaOverviewAvailability,
  aunqaReadinessForProgram,
  type CriterionCompleteness,
  type CriterionReadiness,
} from '../src/aunqa-readiness';

/**
 * The faculty overview and the programme page must never disagree.
 *
 * They reach the same answer down two different code paths: the page
 * resolves every binding through `resolveEvidenceForProgram`, while the
 * overview asks a cheaper availability-only question through the batched
 * mirrors in `aunqaOverviewAvailability`. Nothing in the type system
 * couples the two — a binding kind added to the registry and given a
 * resolver silently reports as unevidenced on the overview until someone
 * remembers the mirror.
 *
 * That is not hypothetical. It happened on 2026-08-26, within hours of
 * both files being written: `enrollment-metric:dropouts` landed for
 * sub-criterion 8.1 and the overview understated criterion 8 until the
 * mirror followed. It was caught by a hand-run comparison nobody would
 * think to repeat. This test is that comparison, made permanent.
 *
 * It needs the database, deliberately. A fixture version would mock away
 * the very thing that diverges.
 */

// Skip when Postgres isn't reachable — `pnpm db:up && pnpm db:seed` is
// the precondition. Same posture as apps/api's e2e probe: a cheap
// existence check beats a noisy failure on an unprovisioned CI run.
const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

/**
 * A FIXED sample, chosen by programme code so a failure is reproducible.
 * A random sample would make drift show up intermittently and leave the
 * next reader unable to reproduce it.
 *
 * Between them these five put every mirror the estate can currently show
 * both ways on BOTH branches — available and unavailable (measured
 * 2026-08-26). Four kinds are available on every programme in the estate
 * (`peer-review:*`, `staff-metric:rankMix|research|studentFacultyRatio`,
 * `enrollment-metric:*`), so no sample can exercise their unavailable
 * branch; the binding-level assertion still pins their available one.
 */
const SAMPLE: Array<{ code: string; why: string }> = [
  {
    code: 'KKU-SEQ-0060',
    // The most complete programme in the estate: 112 extracted courses,
    // evaluations on all six themes (one of only two with english-skills),
    // a pedagogy assessment, graduate outcomes, cohorts, staff. Nearly
    // every mirror's AVAILABLE branch.
    why: 'well-evidenced bachelor — most mirrors on their available branch',
  },
  {
    code: 'KKU-SEQ-0090',
    // The DQ instrument is bachelor-only and floor-gated, and 0060 sits
    // below the floor. Without a DQ-bearing programme the dq-* mirrors
    // would only ever be tested unavailable — which they are for nine
    // programmes in ten, so the test would pass with them deleted.
    why: 'bachelor above the DQ floor — the only available branch for dq-*',
  },
  {
    code: 'KKU-SEQ-0142',
    // Five courses, no pedagogy assessment, no graduate outcomes, no
    // evaluation coverage: the partly-populated middle, where a mirror
    // that is right about presence but wrong about a threshold shows up.
    why: "thin master's — mixed available/unavailable within one programme",
  },
  {
    code: 'KKU-SEQ-0184',
    // No `program_courses` rows at all, so every figure that joins
    // through the course list — the six evaluation themes, class GPA,
    // teaching workload — must come back unavailable on both paths. This
    // is the shape the dropout-binding divergence first showed up on.
    why: 'no program_courses, non-bachelor — the course-join mirrors unavailable',
  },
  {
    code: 'KKU-SEQ-0018',
    // Has outcomes, evaluations and a pedagogy assessment but NO cohort
    // rows — the only unavailable branch of the cohort-progression
    // mirror in this sample.
    why: 'no cohort rows — cohort-progression on its unavailable branch',
  },
];

/** Every distinct question the registry asks, deduped the way both paths
 *  dedupe it. */
function registryKeys(): Array<{ key: string; binding: EvidenceBinding }> {
  const seen = new Map<string, EvidenceBinding>();
  for (const binding of allEvidenceBindings()) {
    const key = aunqaAvailabilityKey(binding);
    if (!seen.has(key)) seen.set(key, binding);
  }
  return [...seen.entries()].map(([key, binding]) => ({ key, binding }));
}

const FIX =
  'The faculty overview does NOT call the resolvers — it mirrors their availability ' +
  'condition in aunqaOverviewAvailability() in packages/db/src/aunqa-readiness.ts. ' +
  'Every binding kind resolved in aunqa-evidence.ts needs a mirror there.';

function signature(criterion: CriterionCompleteness | CriterionReadiness): string {
  return `${criterion.subCriteriaWithEvidence}/${criterion.subCriteriaTotal} ${criterion.band}`;
}

const describeIfDb = postgresUp ? describe : describe.skip;

describeIfDb('the faculty overview agrees with the full resolver', () => {
  it(
    'mirrors every binding kind the resolvers answer, on real programmes',
    async () => {
      const programs = await prisma.program.findMany({
        where: { code: { in: SAMPLE.map((s) => s.code) } },
        select: { id: true, code: true },
      });
      // A database without the KKU master sheet loaded has none of these
      // — skip rather than fail, as the e2e probe does for the same reason.
      if (programs.length === 0) return;

      const availability = await aunqaOverviewAvailability(programs.map((p) => p.id));
      const keys = registryKeys();

      const problems: string[] = [];
      for (const program of programs) {
        const full = await aunqaReadinessForProgram(program.id);
        // The resolver's verdict per key. Every entry sharing a key comes
        // from one resolver call, so the first is the whole answer.
        const resolved = new Map<string, boolean>();
        for (const criterion of full.criteria) {
          for (const entry of criterion.evidence) {
            resolved.set(aunqaAvailabilityKey(entry.binding), entry.available);
          }
        }
        const mirrored = availability.get(program.id) ?? new Set<string>();

        for (const { key } of keys) {
          const byResolver = resolved.get(key);
          if (byResolver === undefined) continue; // not asked for this programme
          const byMirror = mirrored.has(key);
          if (byMirror === byResolver) continue;
          problems.push(
            byResolver
              ? `${program.code}: binding kind "${key}" — the resolver finds evidence, the overview's ` +
                  `batched mirror does not. Its mirror is MISSING, or stricter than the resolver. ${FIX}`
              : `${program.code}: binding kind "${key}" — the overview's batched mirror reports evidence, ` +
                  `the resolver does not. Its mirror is LOOSER than the resolver. ${FIX}`,
          );
        }
      }

      expect(problems).toEqual([]);
    },
    60_000,
  );

  it(
    'reaches the same band on every criterion of every sampled programme',
    async () => {
      // The end-to-end form of the same invariant: it also covers the
      // key function itself, which the binding-level test uses on both
      // sides and so cannot check.
      const programs = await prisma.program.findMany({
        where: { code: { in: SAMPLE.map((s) => s.code) } },
        select: { id: true, code: true },
      });
      if (programs.length === 0) return;

      const overview = await aunqaCompletenessForPrograms(programs.map((p) => p.id));
      const overviewById = new Map(overview.map((row) => [row.programId, row]));

      const problems: string[] = [];
      for (const program of programs) {
        const full = await aunqaReadinessForProgram(program.id);
        const cheap = overviewById.get(program.id);
        if (!cheap) {
          problems.push(
            `${program.code}: aunqaCompletenessForPrograms returned no row for a programme it was asked about.`,
          );
          continue;
        }
        for (const fullCriterion of full.criteria) {
          const cheapCriterion = cheap.criteria.find(
            (c) => c.criterionId === fullCriterion.criterionId,
          );
          if (!cheapCriterion) {
            problems.push(
              `${program.code} criterion ${fullCriterion.criterionId}: missing from the overview entirely.`,
            );
            continue;
          }
          if (signature(cheapCriterion) === signature(fullCriterion)) continue;
          problems.push(
            `${program.code} criterion ${fullCriterion.criterionId}: the overview says ` +
              `${signature(cheapCriterion)}, the full resolver says ${signature(fullCriterion)}. ` +
              `The sibling test above names the binding kind when a mirror is the cause; if it passed, ` +
              `suspect aunqaAvailabilityKey() instead — both paths call it, so a key that collapses two ` +
              `kinds into one shows up here and nowhere else. ${FIX}`,
          );
        }
      }

      expect(problems).toEqual([]);
    },
    60_000,
  );
});
