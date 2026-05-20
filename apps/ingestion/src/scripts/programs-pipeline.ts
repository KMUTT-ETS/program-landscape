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
//   Phase 5 — Peer comparison (SEQUENTIAL: select → review; both pro)
//      - peers:select                       (gemini-3.1-pro-preview)
//      - peers:review                       (gemini-3.1-pro-preview, thinking)
//
//   Phase 6 — AI readiness (Pro)
//      - programs:ai-readiness              (gemini-3.1-pro-preview)
//      Runs before narrative because narrative consumes the assessment.
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
import { prisma, PrismaAiInferenceRecorder, getAiModelOverrideStore } from '@kku/db';
import { createAiService, S3Storage, type AiProviderId } from '@kku/shared';
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

type Phase =
  | 'phase1'
  | 'phase2'
  | 'phase2b'
  | 'phase3'
  | 'phase4'
  | 'phase5'
  | 'phase6'
  | 'phase7'
  | 'phase8';
const ALL_PHASES: Phase[] = [
  'phase1',
  'phase2',
  'phase2b',
  'phase3',
  'phase4',
  'phase5',
  'phase6',
  'phase7',
  'phase8',
];

interface CliArgs {
  programArg: string | null;
  all: boolean;
  limit: number | null;
  only: Phase[];
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
  const only = onlyArg
    ? (onlyArg.split('=')[1] ?? '').split(',').filter((p): p is Phase => ALL_PHASES.includes(p as Phase))
    : ALL_PHASES;
  const skipArg = argv.find((a) => a.startsWith('--skip='));
  const skip = new Set<Phase>(
    skipArg
      ? (skipArg.split('=')[1] ?? '').split(',').filter((p): p is Phase => ALL_PHASES.includes(p as Phase))
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
  const ms = Date.now() - t0;
  return { ms, ok: exitCode === 0, notes: exitCode === 0 ? 'approved + materialised' : `exit=${exitCode}` };
}

async function processProgram(
  program: ProgramSummary,
  args: CliArgs,
  ai: ReturnType<typeof createAiService>,
  storage: S3Storage,
): Promise<ProgramReport> {
  const phases: PhaseResult[] = [];
  const shouldRun = (p: Phase) => args.only.includes(p) && !args.skip.has(p);
  const t0 = Date.now();

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
      phase1Enabled
        ? runProgramDigest({ programId: program.id, ai, storage, force: args.force, pdfPrep, systemContext: sharedSystemContext }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: 'phase1 disabled' }),
      phase1Enabled
        ? runProgramFacultyExtraction({ programId: program.id, ai, storage, force: args.force, pdfPrep, systemContext: sharedSystemContext }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: 'phase1 disabled' }),
      phase1Enabled
        ? runProgramSkillsDetailed({ programId: program.id, ai, storage, force: args.force, pdfPrep }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: 'phase1 disabled' }),
      phase1Enabled
        ? runProgramPedagogy({ programId: program.id, ai, storage, force: args.force, pdfPrep }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: 'phase1 disabled' }),
      phase2bEnabled
        ? runProgramCoursesExtract({ programId: program.id, ai, storage, pdfPrep }).catch((e) => ({
            status: 'FAILED' as const, reason: String(e?.message ?? e),
          }))
        : Promise.resolve({ status: 'SKIPPED' as const, reason: 'phase2b disabled' }),
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
          skills.status !== 'FAILED' &&
          pedagogy.status !== 'FAILED',
        notes: [
          summarise(digest, 'digest'),
          summarise(faculty, 'faculty'),
          summarise(skills, 'skills'),
          summarise(pedagogy, 'pedagogy'),
        ].join(' '),
      });
    }
    if (phase2bEnabled) {
      const ok = coursesExtract.status === 'SUCCEEDED';
      phases.push({
        name: 'phase2b courses-extract (parallel with phase1)',
        durationMs: phaseDuration,
        costUsd: ok ? coursesExtract.costUsd : 0,
        ok: coursesExtract.status !== 'FAILED',
        notes:
          coursesExtract.status === 'SUCCEEDED'
            ? `${coursesExtract.previousCount} → ${coursesExtract.materialisedCount} courses · confidence ${coursesExtract.confidence.toFixed(2)}`
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
    phases.push({
      name: 'phase2 approve+materialise',
      durationMs: r.ms,
      costUsd: 0,
      ok: r.ok,
      notes: r.notes,
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
  if (shouldRun('phase4')) {
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

  // ── Phase 5 — Peer comparison (sequential; both Pro) ────────────
  if (shouldRun('phase5')) {
    const t = Date.now();
    let cost = 0;
    const select = await selectProgramPeers({ programId: program.id, ai }).catch((e) => ({
      status: 'FAILED' as const, reason: String(e?.message ?? e),
    }));
    if (select.status === 'SUCCEEDED') cost += select.costUsd;

    let reviewStatus = 'SKIPPED';
    if (select.status !== 'FAILED') {
      const review = await generateProgramPeerReview({ programId: program.id, ai }).catch((e) => ({
        status: 'FAILED' as const, reason: String(e?.message ?? e),
      }));
      reviewStatus = review.status;
      if (review.status === 'SUCCEEDED') cost += review.costUsd;
    }

    phases.push({
      name: 'phase5 peers select+review (Pro)',
      durationMs: Date.now() - t,
      costUsd: cost,
      ok: select.status !== 'FAILED' && reviewStatus !== 'FAILED',
      notes: `select=${select.status} review=${reviewStatus}`,
    });
  }

  // ── Phase 6 — AI readiness (Pro) ─────────────────────────────────
  // Runs BEFORE the narrative because the narrative reads the freshly-
  // persisted ProgramAiReadinessAssessment row to fold AI-disruption
  // signals into the Council brief. Force=true so a --force pipeline
  // rerun gets a fresh assessment even when a prior one exists.
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
  const args = parseArgs(process.argv.slice(2));
  const programs = await resolveProgramIds(args);

  const phases = ALL_PHASES.filter((p) => args.only.includes(p) && !args.skip.has(p));
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Programs to process: ${programs.length}`);
  console.log(`Phases enabled: ${phases.join(', ')}`);
  console.log(`AI provider: ${process.env.AI_PROVIDER ?? 'google'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const recorder = new PrismaAiInferenceRecorder();
  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const ai = createAiService({
    recorder,
    providerId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
    // Honour per-method model overrides set on the admin AI-settings
    // page. Without this the spawned pipeline ignores overrides and
    // every phase runs on DEFAULT_COMPLETION_MODEL only.
    modelOverrideResolver: getAiModelOverrideStore(),
  });
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

  for (const p of programs) {
    console.log(`▶ ${p.code} · ${p.nameEn}`);
    const r = await processProgram(p, args, ai, storage);
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
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
