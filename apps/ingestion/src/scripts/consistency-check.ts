// ─────────────────────────────────────────────────────────────────────────────
// consistency:check — measure cross-scope health-score divergence.
//
// Closes evaluation-pipeline.md §13 gap #7. Health scores at faculty
// scope and program scope are computed independently (each reads its
// own materialised view). The methodology doc says divergence is
// "typically small" — this script measures HOW small, per faculty.
//
// For each faculty:
//   facultyOverall   = computeHealthScores('university')[faculty].overall.score
//   bottomUpWeighted = Σ(programOverall × programEnrolled) / Σ(programEnrolled)
//                      across canonical+active programs in this faculty
//                      whose overall score is non-null.
//   divergence       = |facultyOverall - bottomUpWeighted|
//
// Default threshold for flagging: 10 pts. Writes one CrossScopeDivergence-
// Snapshot row per faculty so trends are visible over time and the
// /admin/data-quality surface can render the worklist without re-running
// the math.
//
// Usage:
//   pnpm consistency:check                # write snapshot + print report
//   pnpm consistency:check --no-write     # dry-run, print only
//   pnpm consistency:check --threshold 15
// ─────────────────────────────────────────────────────────────────────────────

import {
  prisma,
  computeHealthScores,
  realDataWhere,
  LANDSCAPE_METHODOLOGY_BUNDLE,
  Prisma,
} from '@kku/db';

interface CliArgs {
  write: boolean;
  threshold: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { write: true, threshold: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-write') args.write = false;
    else if (a === '--threshold') args.threshold = Number(argv[++i] ?? args.threshold);
  }
  return args;
}

interface ProgramContribution {
  programId: string;
  code: string;
  overall: number | null;
  enrolled: number;
  weighted: number; // overall × enrolled, or 0 if either null/zero
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const computedAt = new Date();

  console.log('═══ Cross-scope divergence check ═══');
  console.log(`Bundle: ${LANDSCAPE_METHODOLOGY_BUNDLE.tag}+${LANDSCAPE_METHODOLOGY_BUNDLE.fingerprint}`);
  console.log(`Threshold: divergence > ${args.threshold} pts flags for review`);
  console.log(`Mode: ${args.write ? 'WRITE snapshot rows' : 'DRY-RUN (no DB writes)'}`);
  console.log('');

  // Faculty-scope rows — one per academic faculty with ≥1 canonical program.
  const facultyRows = await computeHealthScores('university', null);
  console.log(`Faculty-scope rows: ${facultyRows.length}`);

  console.log('');
  console.log(
    'Faculty'.padEnd(36) +
      'Faculty'.padStart(9) +
      'BottomUp'.padStart(10) +
      'Diverge'.padStart(9) +
      'Prog'.padStart(6) +
      'WithScore'.padStart(11) +
      'Enrolled'.padStart(10) +
      '  Status',
  );
  console.log('─'.repeat(102));

  let flagged = 0;
  let written = 0;
  let nullFaculty = 0;
  let nullBottomUp = 0;

  for (const fac of facultyRows) {
    // Program-scope rows for this faculty (resolveChildren collapses dept).
    const programRows = await computeHealthScores('faculty', fac.scopeId);
    const programIds = programRows.map((p) => p.scopeId);

    // Latest-year enrolment per program — used as the weight.
    const enrolmentRows = programIds.length === 0
      ? []
      : await prisma.$queryRawUnsafe<Array<{ program_id: string; enrolled: number }>>(
          `
          WITH latest AS (
            SELECT program_id, MAX(academic_year) AS max_year
            FROM enrollment_metrics em
            WHERE program_id = ANY($1::text[])
              AND (
                em.ingestion_run_id IS NULL OR EXISTS (
                  SELECT 1 FROM ingestion_runs ir JOIN data_sources ds ON ds.id = ir.data_source_id
                  WHERE ir.id = em.ingestion_run_id AND ds.mocked = false
                )
              )
            GROUP BY program_id
          )
          SELECT em.program_id, em.enrolled::int AS enrolled
          FROM enrollment_metrics em
          JOIN latest l ON l.program_id = em.program_id AND em.academic_year = l.max_year;
          `,
          programIds,
        );
    const enrolByProgram = new Map(enrolmentRows.map((r) => [r.program_id, r.enrolled]));

    // Build per-program contributions + roll up the weighted mean.
    const contributions: ProgramContribution[] = programRows.map((p) => {
      const overall = p.overall.score;
      const enrolled = enrolByProgram.get(p.scopeId) ?? 0;
      const weighted = overall !== null && enrolled > 0 ? overall * enrolled : 0;
      return {
        programId: p.scopeId,
        code: p.scopeLabel, // legacy "EN · TH"
        overall,
        enrolled,
        weighted,
      };
    });
    const programsWithScore = contributions.filter((c) => c.overall !== null).length;
    const enrolmentDenominator = contributions
      .filter((c) => c.overall !== null)
      .reduce((s, c) => s + c.enrolled, 0);
    const weightedNumerator = contributions.reduce((s, c) => s + c.weighted, 0);
    const bottomUpWeighted = enrolmentDenominator > 0 ? weightedNumerator / enrolmentDenominator : null;
    const facultyOverall = fac.overall.score;
    const divergence =
      facultyOverall !== null && bottomUpWeighted !== null
        ? Math.abs(facultyOverall - bottomUpWeighted)
        : null;
    const exceedsThreshold = divergence !== null && divergence > args.threshold;
    if (facultyOverall === null) nullFaculty += 1;
    if (bottomUpWeighted === null) nullBottomUp += 1;
    if (exceedsThreshold) flagged += 1;

    const statusLabel = divergence === null
      ? '— (insufficient data)'
      : exceedsThreshold
        ? `⚠ FLAG (${divergence.toFixed(1)} > ${args.threshold})`
        : 'ok';

    console.log(
      fac.scopeLabelTh.padEnd(36) +
        (facultyOverall?.toFixed(1) ?? '—').padStart(9) +
        (bottomUpWeighted?.toFixed(1) ?? '—').padStart(10) +
        (divergence?.toFixed(1) ?? '—').padStart(9) +
        contributions.length.toString().padStart(6) +
        programsWithScore.toString().padStart(11) +
        enrolmentDenominator.toLocaleString().padStart(10) +
        `  ${statusLabel}`,
    );

    if (args.write) {
      await prisma.crossScopeDivergenceSnapshot.create({
        data: {
          computedAt,
          bundleTag: LANDSCAPE_METHODOLOGY_BUNDLE.tag,
          bundleFingerprint: LANDSCAPE_METHODOLOGY_BUNDLE.fingerprint,
          facultyId: fac.scopeId,
          facultyOverall,
          bottomUpWeighted,
          programCount: contributions.length,
          programsWithScore,
          totalEnrolled: enrolmentDenominator,
          divergence,
          exceedsThreshold,
          payloadJson: {
            threshold: args.threshold,
            facultyDimensions: fac.dimensions,
            contributions: contributions.map((c) => ({
              programId: c.programId,
              code: c.code,
              overall: c.overall,
              enrolled: c.enrolled,
              weighted: c.weighted,
            })),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      written += 1;
    }
  }

  console.log('─'.repeat(102));
  console.log(`\nSummary: ${flagged} of ${facultyRows.length} faculties flagged (divergence > ${args.threshold} pts)`);
  console.log(`         ${nullFaculty} faculties had null faculty-overall (insufficient data at faculty scope)`);
  console.log(`         ${nullBottomUp} faculties had null bottom-up weighted (no programs with non-null overall)`);
  if (args.write) {
    console.log(`\nWrote ${written} CrossScopeDivergenceSnapshot rows at ${computedAt.toISOString()}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
