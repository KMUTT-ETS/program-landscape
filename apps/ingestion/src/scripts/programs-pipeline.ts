#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Unified per-program processing pipeline.
//
// Replaces 9 separate bulk scripts that previously had to be run by hand in
// the right order. Composes:
//
//   Phase 1 — PDF AI extraction (PARALLEL: digest + faculty + skills + pedagogy)
//      - programs:digest                    (gemini-3.1-pro-preview)
//      - programs:extract-faculty           (gemini-3.1-pro-preview)
//      - programs:extract-skills            (gemini-3.1-pro-preview)
//      - programs:pedagogy                  (gemini-3.1-pro-preview)
//
//   Phase 2 — Approve + materialise (DB only, fast)
//      - approve-pending PROGRAM_DIGEST → ProgramSkill rows
//   Phase 2b — Focused course-code extraction (replaces digest's
//      truncated 8-course list with the exhaustive 40-90 of an actual
//      curriculum). Distinct AI call (program-courses-extract.v1);
//      runs AFTER phase 2 so its materialise overwrites the digest's
//      truncated program_courses write. Cheap (~$0.18/program).
//
//   Phase 3 — Dependent AI extraction (SEQUENTIAL)
//      - programs:map-careers               (gemini-3-flash-preview)
//      - programs:match-demand              (gemini-3.1-pro-preview)
//
//   Phase 4 — Oracle / MSSQL data linkage (PARALLEL: 3 sources)
//      - programs:link-cohorts              (Oracle)
//      - programs:link-alumni               (Oracle)
//      - programs:link-financials           (Oracle + MSSQL)
//
//   Phase 6 — AI readiness (Pro)   [EXECUTES BEFORE phase 5 — see below]
//      - programs:ai-readiness              (gemini-3.1-pro-preview)
//      Runs before BOTH the peer review (phase 5) and the narrative
//      (phase 7) because both consume the AI-readiness score. Phase IDs
//      kept stable for --only/--skip; only the run order is swapped.
//
//   Phase 5 — Peer comparison (SEQUENTIAL: select → review; both pro)
//      - peers:select                       (gemini-3.1-pro-preview)
//      - peers:review                       (gemini-3.1-pro-preview, thinking)
//      Consumes the phase-6 AI-readiness assessment so the comparative
//      narrative cites the same score the Deep-Dive shows.
//
//   Phase RE — Research expertise (Pro)
//      - expertise:generate                  (gemini-3.1-pro-preview)
//      Runs after Phase 1's faculty extraction has populated the curated
//      ProgramFaculty roster and before Phase 7 (narrative). UNLIKE every
//      other AI phase here, generateProgramResearchExpertise() is
//      INSERT-ONLY — every successful run adds a new program_research_
//      expertise row rather than upserting (history accretes by design,
//      see program-research-expertise-run.ts). The pipeline therefore
//      enforces its own skip-if-exists check: a program that already has
//      a row is never regenerated here, no --force override. Re-running
//      is an explicit operator action via `pnpm expertise:generate`.
//
//   Phase CR — Curriculum revision (Pro)
//      - curriculum:revise                   (gemini-3.1-pro-preview)
//      Turns Phase RE's research themes into course-level advice:
//      which existing courses to enhance, which new courses to propose,
//      which electives to promote. Runs immediately AFTER Phase RE
//      because it READS the program_research_expertise row that phase
//      produces — source order in processProgram() is the only ordering
//      mechanism here, so the placement is load-bearing.
//      Like Phase RE, generateProgramCurriculumRevision() is INSERT-ONLY
//      (history accretes; see program-curriculum-revision-run.ts), so the
//      pipeline enforces its own skip-if-exists check and there is no
//      --force override. When Phase RE has not produced a row the runner
//      degrades to a $0 SKIPPED with reason `no-research` — no AI call,
//      no crash — rather than failing the program's run.
//
//   Phase 7 — Strategic narrative (Pro thinking)
//      - programs:narrative                 (gemini-3.1-pro-preview)
//      Runs LAST among the narrative chain — consumes every prior phase.
//
//   Phase 8 — Risk analysis (deterministic + Pro narrative)
//      - risks:assess <code>                (math + gemini-3.1-pro-preview)
//      Subprocess. Consumes Phase 4 (financials, enrolment) + Phase 5
//      (peer subject + white-spaces) — independent of narrative, so it
//      could run in parallel with Phase 7, but kept sequential for
//      simpler operator-visible progress.
//
// Cost optimization landed:
//   - Per-method model routing — extraction tasks stay on flash; peer
//     selection + peer review use pro (reasoning)
//   - Phase 1's three PDF tasks run in parallel (was 3× sequential)
//   - Phase 4's three Oracle tasks run in parallel
//
// Deferred (Phase 2 of optimization):
//   - Single-upload via Gemini File API. Mechanism is in place
//     (`AiService.uploadFile` + `ExtractionRequest.fileAttachment`)
//     but the digest/faculty/skills prompt builders still embed the
//     full PDF text. Refactoring those builders to send a thin
//     instruction + file URI would cut the PDF-related input tokens
//     ~30-50× per program (roughly $0.20 → $0.005 across the three
//     PDF tasks for a typical curriculum PDF).
//
// Usage:
//   pnpm programs:pipeline <code|seq|id>           # one program
//   pnpm programs:pipeline --all [--limit=N]       # bulk
//   pnpm programs:pipeline <code> --skip=phase4    # skip Oracle phase
//   pnpm programs:pipeline <code> --only=phase5    # peers only
// ─────────────────────────────────────────────────────────────────────────────

import { kkuLinkageConfigured } from '../lib/kku-linkage-config';
import { organizationErrorForExitCode, scriptExitCode } from '../lib/organization-exit';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { spawn } from 'node:child_process';
import { loadOrganization,
  prisma,
  generateProgramResearchExpertise,
  generateProgramCurriculumRevision,
  adoptPendingRevision,
  markRevisionAnalysed,
  activeRevisionIdFor,
  IS_CANONICAL_PROGRAM,
} from '@kku/db';
import {
  getInstitution,
  isProgramPipelinePhase,
  PROGRAM_PIPELINE_PHASES,
  S3Storage,
  type AiService,
  type ProgramPipelinePhase,
} from '@kku/shared';
import { createIngestionAiService } from '../lib/ai-service';
import { runProgramDigest } from '../program-digest/run';
import { runProgramCoursesExtract } from '../program-courses-extract/run';
import { runProgramFacultyExtraction } from '../program-faculty/run';
import { runProgramSkillsDetailed } from '../program-skills/run';
import { runProgramPedagogy } from '../program-pedagogy/run';
import { mapProgramCareers } from '../program-careers/map';
import { runDemandMatch } from '../program-demand-match/run';
import { selectProgramPeers } from '../program-peers/select';
import { generateProgramPeerReview } from '../program-peers/review';
import { generateProgramStrategicNarrative } from '../program-narrative/run';
import { runProgramAiReadiness } from '../program-ai-readiness/run';
import { runOverlapPhase } from '../program-overlap/phase';
import { ensureProgramSkills } from '../program-skills/ensure-skill-taxonomy';
import { realEnsureSkillsDeps } from '../program-skills/ensure-skill-taxonomy-deps';

// Phase list + display metadata live in @kku/shared — see the header comment
// in packages/shared/src/pipeline/program-phases.ts for why (five hand-kept
// copies; phaseRE went missing from four of them for its whole lifetime).
type Phase = ProgramPipelinePhase;
const ALL_PHASES: readonly Phase[] = PROGRAM_PIPELINE_PHASES;

interface CliArgs {
  programArg: string | null;
  all: boolean;
  limit: number | null;
  only: readonly Phase[];
  skip: Set<Phase>;
  resume: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.find((a) => !a.startsWith('--')) ?? null;
  const all = argv.includes('--all');
  const resume = argv.includes('--resume');
  const force = argv.includes('--force');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '0', 10) : null;
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  // Unknown ids are dropped silently — unchanged behaviour, but note that this
  // is exactly what hid the missing `phaseRE` for so long.
  const only = onlyArg
    ? (onlyArg.split('=')[1] ?? '').split(',').filter(isProgramPipelinePhase)
    : ALL_PHASES;
  const skipArg = argv.find((a) => a.startsWith('--skip='));
  const skip = new Set<Phase>(
    skipArg
      ? (skipArg.split('=')[1] ?? '').split(',').filter(isProgramPipelinePhase)
      : [],
  );
  if (!positional && !all) {
    console.error(
      'Usage: pnpm programs:pipeline <code|mhesi|seq|id> | --all [--resume] [--limit=N] [--only=phaseN,...] [--skip=phaseN,...] [--force]',
    );
    process.exit(1);
  }
  return { programArg: positional, all, limit, only, skip, resume, force };
}

interface ProgramSummary {
  id: string;
  code: string;
  nameEn: string;
}

async function resolveProgramIds(args: CliArgs): Promise<ProgramSummary[]> {
  if (args.all) {
    // Pipeline operates on the canonical 297 active programs only
    // (those seeded from the master Google Sheet, sequenceNoFromSheet
    // IS NOT NULL). Legacy mock-seed rows + side-effect rows from
    // staff/student ingestion are excluded.
    let programs = await prisma.program.findMany({
      where: { sequenceNoFromSheet: { not: null } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true },
    });
    if (args.resume) {
      // Skip programs that have BOTH a strategic narrative AND a risk
      // assessment persisted. Phase 7 (narrative) and Phase 8 (risks)
      // are the two terminal AI surfaces — a program is "done" only
      // when both exist. A program with narrative but no risk row
      // (e.g. risks-assess failed mid-batch on a prior run) gets
      // re-piped so the missing risk surface gets filled.
      const [narrativeIds, riskIds] = await Promise.all([
        prisma.programStrategicNarrative.findMany({ select: { programId: true } }),
        prisma.riskAssessment
          .findMany({ select: { programId: true }, distinct: ['programId'] })
          .catch(() => [] as Array<{ programId: string }>),
      ]);
      const narrativeSet = new Set(narrativeIds.map((r) => r.programId));
      const riskSet = new Set(riskIds.map((r) => r.programId));
      const before = programs.length;
      programs = programs.filter((p) => !(narrativeSet.has(p.id) && riskSet.has(p.id)));
      console.log(
        `--resume: skipped ${before - programs.length} program(s) with Phase 7 + Phase 8 already complete\n`,
      );
    }
    if (args.limit) programs = programs.slice(0, args.limit);
    return programs;
  }
  const arg = args.programArg!;
  const seqNo = Number(arg);
  const program = await prisma.program.findFirst({
    where: {
      OR: [
        { id: arg },
        { code: arg },
        { mhesiCode: arg },
        ...(Number.isInteger(seqNo) ? [{ sequenceNoFromSheet: seqNo }] : []),
      ],
    },
    select: { id: true, code: true, nameEn: true },
  });
  if (!program) throw new Error(`Program not found for "${arg}"`);
  return [program];
}

interface PhaseResult {
  name: string;
  durationMs: number;
  costUsd: number;
  ok: boolean;
  notes: string;
}

interface ProgramReport {
  programId: string;
  code: string;
  totalDurationMs: number;
  totalCostUsd: number;
  phases: PhaseResult[];
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

async function runApprovePending(programId: string): Promise<{ ms: number; ok: boolean; notes: string }> {
  // Spawn the existing CLI (it knows the materialise path) and pipe
  // output. Faster than re-implementing the bulk approval here, and
  // cheap since approve-pending is a DB-only step.
  const t0 = Date.now();
  const located = resolveSiblingScript('approve-pending-digests');
  if (!located) {
    return { ms: Date.now() - t0, ok: false, notes: 'approve-pending-digests script not found' };
  }
  const child = spawn(
    'node',
    located.kind === 'js'
      ? [located.path, '--program-id=' + programId]
      : [require.resolve('tsx/cli'), located.path, '--program-id=' + programId],
    { stdio: 'pipe', env: process.env },
  );
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  const exitCode: number = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
  const orgError = organizationErrorForExitCode(exitCode);
  if (orgError) throw orgError;
  const ms = Date.now() - t0;
  return { ms, ok: exitCode === 0, notes: exitCode === 0 ? 'approved + materialised' : `exit=${exitCode}` };
}

async function processProgram(
  program: ProgramSummary,
  args: CliArgs,
  ai: AiService,
  storage: S3Storage,
  opts: { deferOverlap: boolean } = { deferOverlap: false },
): Promise<ProgramReport> {
  const phases: PhaseResult[] = [];
  const shouldRun = (p: Phase) => args.only.includes(p) && !args.skip.has(p);
  const t0 = Date.now();

  // ── Adopt the revision this run is analysing ─────────────────────
  // FIRST, before any phase: the ten generated tables read
  // activeRevisionIdFor(programId) inside each writer, so the programme's
  // active revision must already be set or the run writes NULL stamps.
  //
  // Returns null for a programme with no pending revision — including every
  // pre-feature programme — and in that case changes nothing at all, so
  // those runs behave exactly as they did before this existed.
  const adoptedRevisionId = await adoptPendingRevision(program.id);
  if (adoptedRevisionId) {
    console.log(`    · adopted revision ${adoptedRevisionId} — rows written by this run carry it`);
  }

  // The revision every row written by this run will carry. Resolved AFTER
  // adoption on purpose — adoptPendingRevision() returns null when nothing
  // was pending, but the programme may still have an activeRevisionId from
  // an earlier run, and the guards below must compare against THAT.
  //
  // For the 299 programmes that have never been revised this is null, which
  // Prisma renders as `IS NULL` and which matches their existing
  // null-provenance rows — so they skip exactly as they did before.
  const runRevisionId = await activeRevisionIdFor(program.id);

  // ── Shared phase-1/2b inputs — prepare ONCE per program ──────────
  // Previously each of {digest, faculty, skills, pedagogy} + {2b
  // courses-extract} independently fetched the same PDF from MinIO,
  // ran pdfjs on it, and loaded the same system-context joins. That's
  // 5× fetch + 5× extract + 2× system-context per program. Below we
  // do it once and thread the prepared inputs into every consumer.
  //
  // `sharedPdfPrep` is undefined when phase 1 + 2b are both skipped
  // (e.g. --only=phase3) — the run*() functions still fall back to
  // their own fetch path on solo invocations.
  const wantsPdf = shouldRun('phase1') || shouldRun('phase2b');
  const wantsSystemContext = shouldRun('phase1');
  let sharedPdfPrep:
    | Awaited<ReturnType<typeof import('../program-pdf-prep/load').loadProgramPdfPrep>>
    | undefined;
  let sharedSystemContext:
    | Awaited<ReturnType<typeof import('../program-system-context/load').loadProgramSystemContext>>
    | undefined;
  if (wantsPdf) {
    const { loadProgramPdfPrep } = await import('../program-pdf-prep/load');
    sharedPdfPrep = await loadProgramPdfPrep({ programId: program.id, storage });
  }
  if (wantsSystemContext) {
    const { loadProgramSystemContext } = await import('../program-system-context/load');
    sharedSystemContext = await loadProgramSystemContext(program.id);
  }
  const pdfPrep =
    sharedPdfPrep?.status === 'SUCCEEDED' ? sharedPdfPrep.prep : undefined;
  // NO_TEXT is final for the whole run: log once and skip all five PDF
  // phases, rather than letting each extractor re-fetch the same PDF.
  const noTextReason = sharedPdfPrep?.status === 'NO_TEXT' ? sharedPdfPrep.reason : null;
  if (noTextReason && (shouldRun('phase1') || shouldRun('phase2b'))) {
    console.log(`  ⚠ ${noTextReason}`);
  }

  // ── Phase 1 + Phase 2b — PDF AI extraction (parallel) ────────────
  // Five extractors hit the same prepared PDF in parallel: digest,
  // faculty, skills, pedagogy, courses-extract. All five reuse the
  // shared `pdfPrep`. Digest + faculty also reuse `systemContext`
  // (DS2004 + DS2003 + DS1001 + kku-hr joins) which both would
  // otherwise call independently.
  //
  // Phase 2b runs in parallel with phase 1 because it has no real
  // dependency on phase 1's digest output — verified 2026-05-19:
  // `materialiseProgramDigest` in @kku/db does NOT write program_courses
  // (course materialisation was DEFERRED for digest v1 per the comment
  // there). Only `program-courses-extract` writes program_courses, so
  // no race. Saves ~1.5m wall-clock per program — phase 2b previously
  // ran AFTER phase 1+2 sequentially.
  //
  // Phase 2 (approve+materialise) still runs SEQUENTIALLY after phase
  // 1 because it consumes the digest's AiExtraction row. Cheap step
  // (~700ms) so the serial cost is negligible.
  const phase1Enabled = shouldRun('phase1');
  const phase2bEnabled = shouldRun('phase2b');
  if (phase1Enabled || phase2bEnabled) {
    const t = Date.now();
    const [digest, faculty, skills, pedagogy, coursesExtract] = await Promise.all([
      phase1Enabled && !noTextReason
        ? runProgramDigest({ programId: program.id, ai, storage, force: args.force, pdfPrep, systemContext: sharedSystemContext }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: noTextReason ?? 'phase1 disabled' }),
      phase1Enabled && !noTextReason
        ? runProgramFacultyExtraction({ programId: program.id, ai, storage, force: args.force, pdfPrep, systemContext: sharedSystemContext }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: noTextReason ?? 'phase1 disabled' }),
      phase1Enabled && !noTextReason
        ? runProgramSkillsDetailed({ programId: program.id, ai, storage, force: args.force, pdfPrep }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: noTextReason ?? 'phase1 disabled' }),
      phase1Enabled && !noTextReason
        ? runProgramPedagogy({ programId: program.id, ai, storage, force: args.force, pdfPrep }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: noTextReason ?? 'phase1 disabled' }),
      phase2bEnabled && !noTextReason
        ? runProgramCoursesExtract({ programId: program.id, ai, storage, pdfPrep }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: noTextReason ?? 'phase2b disabled' }),
    ]);
    const phaseDuration = Date.now() - t;
    if (phase1Enabled) {
      const cost =
        (digest.status === 'SUCCEEDED' ? digest.costUsd : 0) +
        (faculty.status === 'SUCCEEDED' ? faculty.costUsd : 0) +
        (skills.status === 'SUCCEEDED' ? skills.costUsd : 0) +
        (pedagogy.status === 'SUCCEEDED' ? pedagogy.costUsd : 0);
      const summarise = (r: { status: string; reason?: string }, name: string) =>
        r.status === 'SUCCEEDED' ? `${name}✓` : r.status === 'SKIPPED' ? `${name}=skip` : `${name}✗`;
      phases.push({
        name: 'phase1 PDF extraction (parallel)',
        durationMs: phaseDuration,
        costUsd: cost,
        ok:
          digest.status !== 'FAILED' &&
          faculty.status !== 'FAILED' &&
          !(faculty.status === 'SUCCEEDED' && faculty.degraded) &&
          skills.status !== 'FAILED' &&
          pedagogy.status !== 'FAILED',
        notes: [
          summarise(digest, 'digest'),
          summarise(faculty, 'faculty'),
          summarise(skills, 'skills'),
          summarise(pedagogy, 'pedagogy'),
          faculty.status === 'SUCCEEDED' && faculty.degraded ? `DEGRADED — faculty: ${faculty.notes ?? ''}` : null,
          noTextReason ? `NO_TEXT — ${noTextReason}` : null,
        ]
          .filter((x): x is string => x !== null)
          .join(' '),
      });
    }
    if (phase2bEnabled) {
      const ok = coursesExtract.status === 'SUCCEEDED';
      // GUARD 2. A SUCCEEDED that came from the regex fallback alone, or whose
      // write the materialisation guard refused, is NOT a clean pass and must
      // not print as one. Until 2026-09-07 `ok` was `status !== 'FAILED'`, so
      // a run that deleted 56 courses and wrote none rendered as a green tick
      // at zero cost — indistinguishable in the summary from one that
      // extracted 56. See program-courses-extract/materialisation-guard.ts.
      const degraded =
        coursesExtract.status === 'SUCCEEDED' &&
        (coursesExtract.llmFailureReason !== null ||
          coursesExtract.materialisationRefusedReason !== null);
      phases.push({
        name: 'phase2b courses-extract (parallel with phase1)',
        durationMs: phaseDuration,
        costUsd: ok ? coursesExtract.costUsd : 0,
        ok: coursesExtract.status !== 'FAILED' && !degraded,
        notes:
          coursesExtract.status === 'SUCCEEDED'
            ? [
                `${coursesExtract.previousCount} → ${coursesExtract.materialisedCount} courses · confidence ${coursesExtract.confidence.toFixed(2)}`,
                coursesExtract.llmFailureReason
                  ? `DEGRADED — regex fallback only: ${coursesExtract.llmFailureReason.slice(0, 160)}`
                  : null,
                coursesExtract.materialisationRefusedReason
                  ? `WRITE REFUSED — ${coursesExtract.materialisationRefusedReason}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : coursesExtract.status === 'SKIPPED'
              ? `skipped: ${coursesExtract.reason}`
              : `failed: ${coursesExtract.reason}`,
      });
    }
  }

  // ── Phase 2 — Approve + materialise ──────────────────────────────
  // Sequentially after phase 1 because it consumes the digest's
  // AiExtraction row. Doesn't touch program_courses (materialise
  // helper deferred course materialisation per the v1 comment) — so
  // it's safe to run AFTER phase 2b's already-finished course writes.
  if (shouldRun('phase2')) {
    const r = await runApprovePending(program.id);
    // Build the skill taxonomy from the digest's own vocabulary when its
    // names do not match, and re-apply the stored digest (no new AI digest),
    // so phases 3, 6 and 7 below see the skills.
    const tTax = Date.now();
    const tax = await ensureProgramSkills(program.id, realEnsureSkillsDeps(ai));
    phases.push({
      name: 'phase2 approve+materialise',
      durationMs: r.ms + (Date.now() - tTax),
      costUsd: tax.costUsd,
      ok: r.ok,
      notes: `${r.notes}; skills: ${tax.notes}`,
    });
  }

  // ── Phase 3 — Dependent AI extraction (sequential) ──────────────
  if (shouldRun('phase3')) {
    const t = Date.now();
    let cost = 0;
    const careersOutcome = await mapProgramCareers({ programId: program.id, ai }).catch((e) => ({
      status: 'FAILED' as const, reason: String(e?.message ?? e),
    }));
    if (careersOutcome.status === 'SUCCEEDED') cost += careersOutcome.costUsd;

    const demandOutcome = await runDemandMatch({ programId: program.id, ai }).catch((e) => ({
      status: 'FAILED' as const, reason: String(e?.message ?? e),
    }));
    if (demandOutcome.status === 'SUCCEEDED') cost += demandOutcome.costUsd;

    phases.push({
      name: 'phase3 careers+demand (sequential)',
      durationMs: Date.now() - t,
      costUsd: cost,
      ok: careersOutcome.status !== 'FAILED' && demandOutcome.status !== 'FAILED',
      notes: `careers=${careersOutcome.status} demand=${demandOutcome.status}`,
    });
  }

  // ── Phase 4 — Oracle / MSSQL data linkage (parallel via subprocess) ─
  const linkage = kkuLinkageConfigured();
  if (shouldRun('phase4') && !linkage.ok) {
    phases.push({
      name: 'phase4 Oracle/MSSQL (parallel)',
      durationMs: 0,
      costUsd: 0,
      ok: true,
      notes:
        'skipped — KKU registry/HR databases not configured; load student cohorts, alumni cohorts and finance from the spreadsheet datasets',
    });
  } else if (shouldRun('phase4')) {
    const t = Date.now();
    const subs: Array<Promise<{ name: string; ok: boolean; ms: number }>> = [];
    for (const script of [
      'link-program-cohorts.ts',
      'link-program-alumni.ts',
      'link-program-financials.ts',
    ]) {
      subs.push(runChildScript(script, [program.code]));
    }
    const subResults = await Promise.all(subs);
    phases.push({
      name: 'phase4 Oracle/MSSQL (parallel)',
      durationMs: Date.now() - t,
      costUsd: 0,
      ok: subResults.every((s) => s.ok),
      notes: subResults.map((s) => `${s.name.split('-').pop()?.replace('.ts', '')}=${s.ok ? '✓' : '✗'}`).join(' '),
    });
  }

  // ── Phase 6 — AI readiness (Pro) ─────────────────────────────────
  // EXECUTION-ORDER NOTE: phase 6 deliberately runs BEFORE phase 5
  // (peer comparison). The AI-readiness OVERALL SCORE has TWO downstream
  // consumers that bake it into cached LLM prose — the peer review
  // (phase 5) and the strategic narrative (phase 7). `programAiReadiness()`
  // only returns the discipline-aware LLM score once THIS
  // ProgramAiReadinessAssessment row exists; without it the function
  // falls back to the deterministic keyword score. Generating the
  // assessment first keeps the peer-review narrative, the Deep-Dive
  // AI-readiness panel, and the Benchmarking panel all citing the SAME
  // number. (Previously phase 5 ran first, so the peer review captured
  // the deterministic score while the Deep-Dive later showed the LLM
  // score — they diverged.) Phase IDs are unchanged so --only/--skip
  // and operator muscle-memory keep working. Force=true so a --force
  // rerun always refreshes the assessment.
  if (shouldRun('phase6')) {
    const t = Date.now();
    const r = await runProgramAiReadiness({ programId: program.id, ai, force: true }).catch(
      (e) => ({ status: 'FAILED' as const, reason: String(e?.message ?? e) }),
    );
    phases.push({
      name: 'phase6 AI readiness (Pro)',
      durationMs: Date.now() - t,
      costUsd: r.status === 'SUCCEEDED' ? r.costUsd : 0,
      ok: r.status !== 'FAILED',
      notes:
        r.status === 'SUCCEEDED'
          ? `score ${r.relevanceScore.toFixed(0)} · ${r.gapCount} gaps · ${r.recommendationCount} recs · conf ${r.confidence.toFixed(2)}`
          : `${r.status}${'reason' in r ? ': ' + r.reason : ''}`,
    });
  }

  // ── Phase 5 — Peer comparison (sequential; both Pro) ────────────
  // Runs AFTER phase 6 (see the execution-order note above) so that
  // generateProgramPeerReview() reads the freshly-persisted
  // ProgramAiReadinessAssessment via programAiReadiness() and cites the
  // SAME AI-readiness score the Deep-Dive renders.
  if (shouldRun('phase5')) {
    const t = Date.now();
    let cost = 0;
    const select = await selectProgramPeers({ programId: program.id, ai }).catch((e) => ({
      status: 'FAILED' as const, reason: String(e?.message ?? e),
    }));
    if (select.status === 'SUCCEEDED') cost += select.costUsd;

    let reviewStatus = 'SKIPPED';
    let reviewReason: string | undefined;
    if (select.status !== 'FAILED') {
      const review = await generateProgramPeerReview({ programId: program.id, ai }).catch((e) => ({
        status: 'FAILED' as const, reason: String(e?.message ?? e),
      }));
      reviewStatus = review.status;
      reviewReason = 'reason' in review ? review.reason : undefined;
      if (review.status === 'SUCCEEDED') cost += review.costUsd;
    }

    // Show the captured reason on the FAILED side(s) so the per-job
    // log records WHY each step failed — otherwise an operator has to
    // reproduce the failure manually to see the error.
    const annotate = (label: string, status: string, reason?: string) =>
      status === 'FAILED' && reason
        ? `${label}=FAILED: ${reason.slice(0, 160)}`
        : `${label}=${status}`;
    phases.push({
      name: 'phase5 peers select+review (Pro)',
      durationMs: Date.now() - t,
      costUsd: cost,
      ok: select.status !== 'FAILED' && reviewStatus !== 'FAILED',
      notes: [
        annotate('select', select.status, 'reason' in select ? select.reason : undefined),
        annotate('review', reviewStatus, reviewReason),
      ].join(' '),
    });
  }

  // ── Phase RE — Research expertise (Pro) ──────────────────────────
  // Depends only on Phase 1's faculty extraction (the curated
  // ProgramFaculty roster) — no dependency on phase3/4/5/6's outputs.
  // Placed here (after phase5, before phase7) purely to keep it ahead of
  // the narrative chain; it does not currently feed phase7's prompt.
  //
  // INSERT-ONLY runner (see the phase-list header comment above): the
  // pipeline enforces skip-if-exists itself so an unattended --all rerun
  // never accretes duplicate rows for a program that's already been
  // analysed at its CURRENT revision. Still no --force override — but the
  // skip is scoped to runRevisionId, so a programme whose มคอ.2 was just
  // revised regenerates automatically instead of staying skipped forever;
  // manual re-analysis of an unchanged programme is still an explicit
  // `pnpm expertise:generate --only <code>` operator action.
  if (shouldRun('phaseRE')) {
    const t = Date.now();
    const existing = await prisma.programResearchExpertise.findFirst({
      // Scoped to THIS run's revision, not merely "a row exists". A revised
      // curriculum leaves the previous row stamped with the superseded
      // revision (or null, pre-feature), so it no longer matches and the
      // analysis regenerates against the new มคอ.2. Unrevised programmes
      // resolve runRevisionId to null, which matches their existing null
      // rows and skips at $0 exactly as before.
      where: { programId: program.id, programRevisionId: runRevisionId },
      select: { id: true },
    });
    if (existing) {
      phases.push({
        name: 'phaseRE research expertise (Pro)',
        durationMs: Date.now() - t,
        costUsd: 0,
        ok: true,
        notes: 'skipped: row already exists',
      });
    } else {
      const r = await generateProgramResearchExpertise({ programId: program.id, ai }).catch((e) => ({
        status: 'FAILED' as const, reason: String(e?.message ?? e),
      }));
      phases.push({
        name: 'phaseRE research expertise (Pro)',
        durationMs: Date.now() - t,
        costUsd: r.status === 'SUCCEEDED' ? r.costUsd : 0,
        ok: r.status !== 'FAILED',
        notes:
          r.status === 'SUCCEEDED'
            ? `readiness=${r.readiness} · ${r.themeCount} themes · ${r.totalDistinct} papers · conf ${r.confidence.toFixed(2)}`
            : r.status === 'SKIPPED'
              ? `skipped: ${r.reason}`
              : `failed: ${r.reason}`,
      });
    }
  }

  // ── Phase CR — Curriculum revision (Pro) ─────────────────────────
  // MUST stay immediately after phaseRE: it reads the
  // program_research_expertise row that phase writes, and source order in
  // this function IS the execution order (there is no dependency graph).
  //
  // INSERT-ONLY runner, same posture as phaseRE — including the
  // revision-scoped skip (see phaseRE's comment above for the full
  // rationale). Still no --force override for an unchanged programme.
  //
  // When phaseRE has not run (or produced no themes) the runner returns a
  // $0 SKIPPED with reason `no-research` before making any AI call, so a
  // phaseCR-only run against an unprepared program degrades gracefully.
  if (shouldRun('phaseCR')) {
    const t = Date.now();
    const existing = await prisma.programCurriculumRevision.findFirst({
      // Scoped to THIS run's revision — see phaseRE's guard comment above.
      where: { programId: program.id, programRevisionId: runRevisionId },
      select: { id: true },
    });
    if (existing) {
      phases.push({
        name: 'phaseCR curriculum revision',
        durationMs: Date.now() - t,
        costUsd: 0,
        ok: true,
        notes: 'skipped: row already exists',
      });
    } else {
      const r = await generateProgramCurriculumRevision({ programId: program.id, ai }).catch((e) => ({
        status: 'FAILED' as const, reason: String(e?.message ?? e),
      }));
      phases.push({
        name: 'phaseCR curriculum revision',
        durationMs: Date.now() - t,
        costUsd: r.status === 'SUCCEEDED' ? r.costUsd : 0,
        // A SKIPPED reads green: `no-research` is a missing-input state, not
        // a failure of this phase.
        ok: r.status !== 'FAILED',
        notes:
          r.status === 'SUCCEEDED'
            ? `readiness=${r.readiness} · ${r.enhanceCount} enhance / ${r.newCourseCount} new / ${r.promotionCount} promote · conf ${r.confidence.toFixed(2)}`
            : r.status === 'SKIPPED'
              ? `skipped: ${r.reason}`
              : `failed: ${r.reason}`,
      });
    }
  }

  // ── Phase 7 — Strategic narrative (Pro thinking) ─────────────────
  // Runs after every other AI phase because it consumes their persisted
  // signals (health, AI readiness, lifecycle, TCAS, financials, demand,
  // demographic, peer review). Pre-computes the official Council
  // brief so the Deep-Dive UI shows it on first load.
  if (shouldRun('phase7')) {
    const t = Date.now();
    const r = await generateProgramStrategicNarrative({ programId: program.id, ai }).catch((e) => ({
      status: 'FAILED' as const, reason: String(e?.message ?? e),
    }));
    phases.push({
      name: 'phase7 strategic narrative (Pro)',
      durationMs: Date.now() - t,
      costUsd: r.status === 'SUCCEEDED' ? r.costUsd : 0,
      ok: r.status !== 'FAILED',
      notes:
        r.status === 'SUCCEEDED'
          ? `${r.contentLength} chars · conf ${r.confidence.toFixed(2)}`
          : `${r.status}${'reason' in r ? ': ' + r.reason : ''}`,
    });
  }

  // ── Phase OV — Programme overlap (program-overlap.v1) ────────────
  // Re-scores every same-level pair that involves THIS programme and writes
  // a scoped ProgramOverlapRun; readers merge it over the latest full run.
  // Deterministic, in-process; the AI only words flagged pairs. Runs before
  // phase 8 because the self-competition KRIs read the latest run. Prep
  // (descriptions + embeddings) runs first inside the phase, because phase 2b
  // replaces program_courses rows and drops their descriptions and vectors.
  // With more than one programme selected, main() runs phase OV ONCE after
  // the loop (a full run, or one scoped run over the whole selection) instead
  // of writing one scoped run per programme.
  if (shouldRun('phaseOV')) {
    if (opts.deferOverlap) {
      phases.push({ name: 'phaseOV programme overlap', durationMs: 0, costUsd: 0, ok: true, notes: 'deferred to batch overlap run' });
    } else {
      const t = Date.now();
      const r = await runOverlapPhase(ai, [program.id]);
      phases.push({ name: 'phaseOV programme overlap', durationMs: Date.now() - t, ...r });
    }
  }

  // ── Phase 8 — Risk analysis (deterministic + Pro narrative) ──────
  // Subprocess: risks-assess.ts owns its own dotenv, prisma, ai service.
  // Treated the same as the Oracle/MSSQL phase 4 scripts. Consumes
  // financial + enrolment (phase 4) and peer subject (phase 5). Runs
  // last so any of its inputs are already persisted.
  if (shouldRun('phase8')) {
    const t = Date.now();
    const r = await runChildScript('risks-assess.ts', [program.code]);
    phases.push({
      name: 'phase8 risk analysis (Pro)',
      durationMs: Date.now() - t,
      costUsd: 0, // cost recorded on AiInference, not extractable from subprocess stdout
      ok: r.ok,
      notes: r.ok ? 'risk assessment + narrative + measures persisted' : 'risks-assess subprocess failed',
    });
  }

  // ── Close out the adopted revision ───────────────────────────────
  // LAST, after every phase: APPROVED means "live", set by the act of
  // analysis rather than by a human review step — this project has no
  // approval gate, so running the pipeline IS the operator's acceptance.
  // Project 2 will insert IN_REVIEW between ANALYSING and this, and the
  // transition becomes a reviewer's action. Do not read this as "someone
  // approved something": approvedById is null precisely because nobody did.
  //
  // Deliberately NOT gated on `phases.every(p => p.ok)`. Individual phases
  // fail or skip for reasons that have nothing to do with the curriculum
  // document (Oracle unreachable, no research row yet, a --only subset), and
  // a revision stuck pending on an unrelated phase-4 blip would leave the
  // staleness banner permanently lit — the exact fatigue this feature exists
  // to avoid. A run that DIES (throws out of a phase) never reaches here, so
  // the crash case still leaves the revision pending and the programme stale.
  if (adoptedRevisionId) {
    await markRevisionAnalysed(adoptedRevisionId);
  }

  return {
    programId: program.id,
    code: program.code,
    totalDurationMs: Date.now() - t0,
    totalCostUsd: phases.reduce((s, p) => s + p.costUsd, 0),
    phases,
  };
}

async function runChildScript(
  scriptFile: string,
  argv: string[],
): Promise<{ name: string; ok: boolean; ms: number }> {
  const t0 = Date.now();
  // scriptFile carries a `.ts` extension from the call sites — historical
  // dev-only assumption. Strip it and resolve to whatever's actually
  // on disk (prod ships `.js`, dev keeps `.ts`).
  const base = scriptFile.replace(/\.(ts|js)$/i, '');
  const located = resolveSiblingScript(base);
  if (!located) {
    return { name: scriptFile, ok: false, ms: Date.now() - t0 };
  }
  const child = spawn(
    'node',
    located.kind === 'js'
      ? [located.path, ...argv]
      : [require.resolve('tsx/cli'), located.path, ...argv],
    { stdio: 'pipe', env: process.env },
  );
  child.stdout.on('data', () => { /* swallow — we summarise at the end */ });
  child.stderr.on('data', () => { /* same */ });
  const exitCode: number = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
  const orgError = organizationErrorForExitCode(exitCode);
  if (orgError) throw orgError;
  return { name: scriptFile, ok: exitCode === 0, ms: Date.now() - t0 };
}

// Resolve a sibling CLI script (in scripts/) — prefers .ts in dev so
// editor saves always reach the runner; prefers .js in prod since the
// .ts isn't bundled into the prod image. Mirrors the BullMQ handler's
// probe in apps/ingestion/src/ai-jobs/handlers.ts.
function resolveSiblingScript(baseName: string): { path: string; kind: 'ts' | 'js' } | null {
  const isDev = process.env.NODE_ENV !== 'production';
  const tsPath = path.resolve(__dirname, `${baseName}.ts`);
  const jsPath = path.resolve(__dirname, `${baseName}.js`);
  const order: Array<{ path: string; kind: 'ts' | 'js' }> = isDev
    ? [
        { path: tsPath, kind: 'ts' },
        { path: jsPath, kind: 'js' },
      ]
    : [
        { path: jsPath, kind: 'js' },
        { path: tsPath, kind: 'ts' },
      ];
  for (const c of order) {
    if (existsSync(c.path)) return c;
  }
  return null;
}

async function main(): Promise<void> {
  await loadOrganization();
  // Fail once, up front: every AI phase names the institution, and each phase
  // swallows its own errors, so without this an unconfigured install would
  // run the whole pipeline and fail phase by phase. Throws
  // OrganizationNotConfiguredError → exit 78 → the spawning ai-jobs handler
  // marks the job unrecoverable instead of reporting a generic failure.
  getInstitution();
  const args = parseArgs(process.argv.slice(2));
  const programs = await resolveProgramIds(args);

  const phases = ALL_PHASES.filter((p) => args.only.includes(p) && !args.skip.has(p));
  const ai = createIngestionAiService();
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Programs to process: ${programs.length}`);
  console.log(`Phases enabled: ${phases.join(', ')}`);
  console.log(`AI provider: ${ai.providerId}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? '',
    region: process.env.MINIO_REGION ?? 'us-east-1',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
    publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT || undefined,
  });

  const reports: ProgramReport[] = [];
  let totalCost = 0;
  let totalMs = 0;

  // Phase OV compares programmes with each other, so a multi-programme run
  // scores it once after the loop rather than once per programme.
  const batchOverlap = programs.length > 1 && phases.includes('phaseOV');

  for (const p of programs) {
    console.log(`▶ ${p.code} · ${p.nameEn}`);
    const r = await processProgram(p, args, ai, storage, { deferOverlap: batchOverlap });
    reports.push(r);
    for (const phase of r.phases) {
      const cost = phase.costUsd > 0 ? `$${phase.costUsd.toFixed(3)}` : '—';
      const flag = phase.ok ? '✓' : '✗';
      console.log(`    ${flag} ${phase.name.padEnd(40)} ${fmtMs(phase.durationMs).padStart(7)} ${cost.padStart(8)}  ${phase.notes}`);
    }
    console.log(`    Total: ${fmtMs(r.totalDurationMs)} · $${r.totalCostUsd.toFixed(3)}\n`);
    totalCost += r.totalCostUsd;
    totalMs += r.totalDurationMs;
  }

  if (batchOverlap) {
    // The whole canonical portfolio selected (plain --all) → a full run;
    // otherwise (--resume / --limit) one scoped run over the selection.
    const canonical = await prisma.program.count({ where: IS_CANONICAL_PROGRAM });
    const full = programs.length >= canonical;
    console.log(`▶ Batch overlap run (${full ? 'full portfolio' : `scoped to ${programs.length} programme(s)`})`);
    const t = Date.now();
    const r = await runOverlapPhase(ai, full ? undefined : programs.map((p) => p.id));
    const ms = Date.now() - t;
    const cost = r.costUsd > 0 ? `$${r.costUsd.toFixed(3)}` : '—';
    console.log(`    ${r.ok ? '✓' : '✗'} ${'phaseOV programme overlap (batch)'.padEnd(40)} ${fmtMs(ms).padStart(7)} ${cost.padStart(8)}  ${r.notes}\n`);
    totalCost += r.costUsd;
    totalMs += ms;
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Programs processed: ${reports.length}`);
  console.log(`Total wall-clock:   ${fmtMs(totalMs)}`);
  console.log(`Total AI cost:      $${totalCost.toFixed(3)}`);
  if (reports.length > 0) {
    console.log(`Avg per program:    ${fmtMs(totalMs / reports.length)} · $${(totalCost / reports.length).toFixed(3)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(scriptExitCode(e));
  })
  .finally(() => prisma.$disconnect());
