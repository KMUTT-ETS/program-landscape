import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';
import {
  COURSE_SKILL_EXTRACTION_VERSION,
  CourseSkillExtractionSchema,
  JOB_POSTING_SKILL_EXTRACTION_VERSION,
  JobPostingSkillExtractionSchema,
  POLICY_DOC_ANALYSIS_VERSION,
  PolicyDocAnalysisSchema,
  buildCourseSkillExtractionMessages,
  buildJobPostingSkillExtractionMessages,
  buildPolicyDocAnalysisMessages,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { runProgramDigest } from '../program-digest/run';
import { runImdRankingsExtract } from '../imd-rankings-extract/run';
import type { AiJobKind, ProgramPipelinePhase } from './queue';

// Each handler consumes one job, calls the AI service, writes an
// AiExtraction row. Approval (in the review UI) materialises the
// payload into the real domain tables.

export interface AiJobContext {
  entityId: string;
  trigger: 'MANUAL' | 'SCHEDULED' | 'CHAINED';
  triggeredByUserId: string | null;
  /** RUN_PROGRAM_PIPELINE only — phases to run; absent = all phases. */
  pipelinePhases?: ProgramPipelinePhase[];
  /** RUN_PROGRAM_PIPELINE only — pass --force to the pipeline. */
  pipelineForce?: boolean;
}

export interface AiJobOutcome {
  status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
  aiExtractionId?: string;
  aiInferenceId?: string;
  message?: string;
}

export type AiJobHandler = (ctx: AiJobContext) => Promise<AiJobOutcome>;

export interface AiJobHandlersDeps {
  ai: AiService;
  // When true (default), low-confidence extractions land in PENDING_REVIEW.
  // Tests can flip to false to exercise the materialisation path.
  autoApproveThreshold: number;
  // RUN_PROGRAM_DIGEST handler reads the linked curriculum PDF from
  // MinIO. Optional so unit tests of the other kinds don't need it
  // wired; the program-digest handler asserts presence at run time.
  storage?: S3Storage;
}

export function buildHandlers(deps: AiJobHandlersDeps): Record<AiJobKind, AiJobHandler> {
  const logger = new Logger('AiJobs');

  return {
    EMBED_SKILL: async ({ entityId }) => {
      const skill = await prisma.skill.findUnique({ where: { id: entityId } });
      if (!skill) return { status: 'SKIPPED', message: 'skill not found' };
      const text = `${skill.nameEn} | ${skill.nameTh} | ${skill.category ?? ''}`;
      const resp = await deps.ai.embed({
        ctx: { module: 'skills', kind: 'skill-embedding' },
        texts: [text],
      });
      const vector = resp.vectors[0];
      if (!vector) return { status: 'FAILED', message: 'no vector returned' };
      // pgvector Unsupported — write via $queryRaw with the literal
      // vector syntax '[x,y,z]'.
      const vectorLit = '[' + vector.join(',') + ']';
      await prisma.$executeRaw`
        UPDATE skills SET embedding = ${vectorLit}::vector WHERE id = ${skill.id}
      `;
      return { status: 'SUCCEEDED', aiInferenceId: resp.aiInferenceId };
    },

    EXTRACT_COURSE_SKILLS: async ({ entityId, triggeredByUserId }) => {
      const course = await prisma.course.findUnique({ where: { id: entityId } });
      if (!course) return { status: 'SKIPPED', message: 'course not found' };

      // Candidate shortlist — simple approach for now: random 30 skills.
      // Real impl (once embeddings populated) uses vector similarity
      // over (course.descriptionEn + nameEn) as the query, top-K by
      // cosine distance.
      const candidates = await pickCandidateSkills(30);

      const resp = await deps.ai.extractStructured(
        {
          ctx: { module: 'curriculum', kind: 'course-skills.extract', userId: triggeredByUserId },
          methodVersion: COURSE_SKILL_EXTRACTION_VERSION,
          messages: buildCourseSkillExtractionMessages({
            course: {
              code: course.code,
              nameTh: course.nameTh,
              nameEn: course.nameEn,
              descriptionTh: course.descriptionTh ?? undefined,
              descriptionEn: course.descriptionEn ?? undefined,
              credits: course.credits,
            },
            candidateSkills: candidates,
          }),
        },
        CourseSkillExtractionSchema,
      );

      const autoApprove = resp.confidence >= deps.autoApproveThreshold;
      const row = await prisma.aiExtraction.create({
        data: {
          sourceEntityType: 'course',
          sourceEntityId: course.id,
          extractionKind: 'COURSE_SKILLS',
          payloadJson: resp.parsed as unknown as Prisma.InputJsonValue,
          confidence: resp.confidence,
          methodVersion: COURSE_SKILL_EXTRACTION_VERSION,
          aiInferenceId: resp.aiInferenceId,
          reviewStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
          reasoning: resp.reasoning,
        },
      });

      logger.log(
        `course-skills for ${course.code}: ${resp.parsed.skills.length} skills, ` +
          `${resp.parsed.proposedSkills.length} proposed, conf=${resp.confidence.toFixed(2)} ` +
          `→ ${autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW'}`,
      );

      return {
        status: 'SUCCEEDED',
        aiExtractionId: row.id,
        aiInferenceId: resp.aiInferenceId,
      };
    },

    EXTRACT_JOB_POSTING_SKILLS: async ({ entityId, triggeredByUserId }) => {
      const posting = await prisma.jobPosting.findUnique({ where: { id: entityId } });
      if (!posting) return { status: 'SKIPPED', message: 'job posting not found' };

      const candidates = await pickCandidateSkills(30);

      const resp = await deps.ai.extractStructured(
        {
          ctx: { module: 'jobs', kind: 'job-posting-skills.extract', userId: triggeredByUserId },
          methodVersion: JOB_POSTING_SKILL_EXTRACTION_VERSION,
          messages: buildJobPostingSkillExtractionMessages({
            posting: {
              id: posting.id,
              title: posting.title,
              descriptionTh: posting.descriptionRaw ?? undefined,
              skillsRaw: [],
            },
            candidateSkills: candidates,
          }),
        },
        JobPostingSkillExtractionSchema,
      );

      const autoApprove = resp.confidence >= deps.autoApproveThreshold;
      const row = await prisma.aiExtraction.create({
        data: {
          sourceEntityType: 'job_posting',
          sourceEntityId: posting.id,
          extractionKind: 'JOB_POSTING_SKILLS',
          payloadJson: resp.parsed as unknown as Prisma.InputJsonValue,
          confidence: resp.confidence,
          methodVersion: JOB_POSTING_SKILL_EXTRACTION_VERSION,
          aiInferenceId: resp.aiInferenceId,
          reviewStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
          reasoning: resp.reasoning,
        },
      });

      return {
        status: 'SUCCEEDED',
        aiExtractionId: row.id,
        aiInferenceId: resp.aiInferenceId,
      };
    },

    ANALYZE_POLICY_DOC: async ({ entityId, triggeredByUserId }) => {
      const pdf = await prisma.pdfDocument.findUnique({
        where: { id: entityId },
        include: { pages: { orderBy: { pageNumber: 'asc' } } },
      });
      if (!pdf) return { status: 'SKIPPED', message: 'pdf not found' };

      const fullText = pdf.pages
        .map((p) => p.textContent ?? '')
        .filter((t) => t.length > 0)
        .join('\n\n');
      if (!fullText) {
        return { status: 'SKIPPED', message: 'no extractable text (likely scanned — awaiting OCR)' };
      }

      const candidates = await pickCandidateSkills(50);

      const resp = await deps.ai.extractStructured(
        {
          ctx: { module: 'policy', kind: 'policy-doc.analyze', userId: triggeredByUserId },
          methodVersion: POLICY_DOC_ANALYSIS_VERSION,
          messages: buildPolicyDocAnalysisMessages({
            fullText,
            originalFilename: pdf.originalFilename,
            candidateSkills: candidates,
          }),
          maxOutputTokens: 3000,
        },
        PolicyDocAnalysisSchema,
      );

      const autoApprove = resp.confidence >= deps.autoApproveThreshold;
      const row = await prisma.aiExtraction.create({
        data: {
          sourceEntityType: 'policy_document',
          sourceEntityId: pdf.id,
          extractionKind: 'POLICY_DOC_ANALYSIS',
          payloadJson: resp.parsed as unknown as Prisma.InputJsonValue,
          confidence: resp.confidence,
          methodVersion: POLICY_DOC_ANALYSIS_VERSION,
          aiInferenceId: resp.aiInferenceId,
          reviewStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
          reasoning: resp.reasoning,
        },
      });

      return {
        status: 'SUCCEEDED',
        aiExtractionId: row.id,
        aiInferenceId: resp.aiInferenceId,
      };
    },

    RUN_PROGRAM_DIGEST: async ({ entityId, triggeredByUserId }) => {
      if (!deps.storage) {
        return { status: 'FAILED', message: 'AiJobsHandlersDeps.storage missing — cannot read PDF' };
      }
      const outcome = await runProgramDigest({
        programId: entityId,
        ai: deps.ai,
        storage: deps.storage,
        triggeredByUserId,
      });
      if (outcome.status === 'SUCCEEDED') {
        logger.log(
          `RUN_PROGRAM_DIGEST programId=${entityId} ` +
            `extractionId=${outcome.aiExtractionId} ` +
            `tokens=${outcome.tokensInput}→${outcome.tokensOutput} ` +
            `$${outcome.costUsd.toFixed(4)}`,
        );
        return {
          status: 'SUCCEEDED',
          aiExtractionId: outcome.aiExtractionId,
          aiInferenceId: outcome.aiInferenceId ?? undefined,
        };
      }
      return {
        status: outcome.status,
        message: outcome.reason,
      };
    },

    // Runs the unified per-program pipeline (phases 1-6) by spawning
    // the existing CLI script. The script is the source of truth for
    // phase orchestration (parallel digest+faculty+skills, approve,
    // careers+demand, Oracle/MSSQL linkage, peer review, narrative).
    // Spawning here instead of importing keeps phase 4's child-script
    // model intact and avoids a dual code path when the CLI itself is
    // run by an operator.
    //
    // BullMQ's job lock is auto-renewed while we await the spawn —
    // 5-10 min runs are fine. Logs go to logs/programs-pipeline-<jobId>.log
    // alongside the operator-facing logs from the CLI.
    RUN_PROGRAM_PIPELINE: async ({ entityId, pipelinePhases, pipelineForce, triggeredByUserId }) => {
      const program = await prisma.program.findUnique({
        where: { id: entityId },
        select: { id: true, code: true, nameEn: true },
      });
      if (!program) return { status: 'SKIPPED', message: `program not found: ${entityId}` };

      const args: string[] = [program.code];
      if (pipelinePhases && pipelinePhases.length > 0) {
        args.push(`--only=${pipelinePhases.join(',')}`);
      }
      if (pipelineForce) args.push('--force');

      // Locate the script. Two layouts:
      //   - prod: only compiled .js exists under dist/scripts/
      //   - dev:  .ts source under src/scripts/ — dist/ may also exist
      //           from an earlier nest build but goes STALE the moment
      //           the developer edits the .ts. Picking the stale .js
      //           silently runs old code (and historically silent-killed
      //           the worker mid-pipeline). Verified 2026-05-13.
      //
      // Posture: in dev (NODE_ENV !== 'production') prefer .ts over .js
      // so editor saves always reach the worker. In prod, only .js is
      // available — the .ts probes return missing and we land on the
      // .js with no tsx wrapper.
      type ScriptLocation = { path: string; kind: 'js' | 'ts' };
      const isDev = process.env.NODE_ENV !== 'production';
      const jsCandidate: ScriptLocation = {
        path: path.resolve(__dirname, '..', 'scripts', 'programs-pipeline.js'),
        kind: 'js',
      };
      const tsCandidates: ScriptLocation[] = [
        // handlers.ts → ../scripts/programs-pipeline.ts (tsx-watched dev)
        { path: path.resolve(__dirname, '..', 'scripts', 'programs-pipeline.ts'), kind: 'ts' },
        // handlers.js in dist → ../../src/scripts/programs-pipeline.ts
        // (dev where the worker runs from dist but src/ still has .ts)
        { path: path.resolve(__dirname, '..', '..', 'src', 'scripts', 'programs-pipeline.ts'), kind: 'ts' },
      ];
      const scriptCandidates: ScriptLocation[] = isDev
        ? [...tsCandidates, jsCandidate]
        : [jsCandidate, ...tsCandidates];
      const located = scriptCandidates.find((c) => existsSync(c.path));
      if (!located) {
        return {
          status: 'FAILED',
          message: `programs-pipeline script not found. Tried: ${scriptCandidates
            .map((c) => c.path)
            .join(' | ')}`,
        };
      }

      const logsDir = path.resolve(process.cwd(), 'logs');
      try {
        mkdirSync(logsDir, { recursive: true });
      } catch {
        // ignore — fall through; logs just won't persist if FS is read-only
      }
      const logPath = path.resolve(
        logsDir,
        `programs-pipeline-job-${program.code}-${Date.now()}.log`,
      );

      logger.log(
        `RUN_PROGRAM_PIPELINE spawning ${located.kind} script (${located.path}) ` +
          `${args.join(' ')} (by user ${triggeredByUserId ?? 'unknown'}); log → ${logPath}`,
      );

      // For .js, spawn directly with node — the script is already
      // compiled. For .ts, route through tsx. Resolving tsx/cli via
      // Node's require so we don't depend on a shell PATH that may
      // not include pnpm/npx in the worker env.
      let spawnArgs: string[];
      if (located.kind === 'js') {
        spawnArgs = [located.path, ...args];
      } else {
        let tsxBin: string;
        try {
          tsxBin = require.resolve('tsx/cli');
        } catch (err) {
          return {
            status: 'FAILED',
            message: `tsx/cli not resolvable: ${(err as Error).message}`,
          };
        }
        spawnArgs = [tsxBin, located.path, ...args];
      }

      const exitCode: number = await new Promise((resolve) => {
        const child = spawn('node', spawnArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        });
        const logStream = createWriteStream(logPath, { flags: 'a' });
        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);
        child.on('exit', (code) => resolve(code ?? 1));
        child.on('error', (err) => {
          logStream.write(`\n[spawn error] ${err.message}\n`);
          resolve(1);
        });
      });

      if (exitCode === 0) {
        logger.log(`RUN_PROGRAM_PIPELINE ${program.code} succeeded`);
        return { status: 'SUCCEEDED', message: `pipeline finished; log=${logPath}` };
      }
      logger.error(`RUN_PROGRAM_PIPELINE ${program.code} failed (exit=${exitCode}); log=${logPath}`);
      return {
        status: 'FAILED',
        message: `pipeline exited with code ${exitCode}; log=${logPath}`,
      };
    },

    RUN_IMD_RANKINGS_EXTRACT: async ({ entityId, triggeredByUserId }) => {
      // entityId is a PdfDocument id. Reads the PDF from MinIO, calls
      // the imd-rankings.v1 extractor, and writes an AiExtraction row
      // (kind=IMD_RANKINGS) for analyst review at /admin/extraction-review.
      // Approving the extraction triggers materialiseImdRankings, which
      // upserts ImdEconomy + ImdRanking rows.
      if (!deps.storage) {
        return { status: 'FAILED', message: 'AiJobsHandlersDeps.storage missing — cannot read PDF' };
      }
      const outcome = await runImdRankingsExtract({
        pdfDocumentId: entityId,
        ai: deps.ai,
        storage: deps.storage,
        triggeredByUserId,
      });
      if (outcome.status === 'SUCCEEDED') {
        logger.log(
          `RUN_IMD_RANKINGS_EXTRACT pdfId=${entityId} ` +
            `extractionId=${outcome.aiExtractionId} ` +
            `rows=${outcome.rowsExtracted} conf=${outcome.confidence.toFixed(2)} ` +
            `$${outcome.costUsd.toFixed(4)}`,
        );
        return {
          status: 'SUCCEEDED',
          aiExtractionId: outcome.aiExtractionId,
          aiInferenceId: outcome.aiInferenceId ?? undefined,
        };
      }
      return {
        status: outcome.status,
        message: outcome.reason,
      };
    },

    // Full refresh of class_offerings + class_offering_teachers (incl.
    // the grade-distribution columns + precomputed class_gpa) by
    // spawning the bundled link-class-offerings script with --apply.
    // Same spawn model + script-location probe as RUN_PROGRAM_PIPELINE.
    // entityId is an unused sentinel — the refresh is portfolio-wide.
    RUN_CLASS_OFFERINGS_LINK: async ({ triggeredByUserId }) => {
      type ScriptLocation = { path: string; kind: 'js' | 'ts' };
      const isDev = process.env.NODE_ENV !== 'production';
      const jsCandidate: ScriptLocation = {
        path: path.resolve(__dirname, '..', 'scripts', 'link-class-offerings.js'),
        kind: 'js',
      };
      const tsCandidates: ScriptLocation[] = [
        { path: path.resolve(__dirname, '..', 'scripts', 'link-class-offerings.ts'), kind: 'ts' },
        { path: path.resolve(__dirname, '..', '..', 'src', 'scripts', 'link-class-offerings.ts'), kind: 'ts' },
      ];
      const scriptCandidates: ScriptLocation[] = isDev
        ? [...tsCandidates, jsCandidate]
        : [jsCandidate, ...tsCandidates];
      const located = scriptCandidates.find((c) => existsSync(c.path));
      if (!located) {
        return {
          status: 'FAILED',
          message: `link-class-offerings script not found. Tried: ${scriptCandidates
            .map((c) => c.path)
            .join(' | ')}`,
        };
      }

      const logsDir = path.resolve(process.cwd(), 'logs');
      try {
        mkdirSync(logsDir, { recursive: true });
      } catch {
        // read-only FS — logs just won't persist
      }
      const logPath = path.resolve(logsDir, `link-class-offerings-job-${Date.now()}.log`);

      let spawnArgs: string[];
      if (located.kind === 'js') {
        spawnArgs = [located.path, '--apply'];
      } else {
        let tsxBin: string;
        try {
          tsxBin = require.resolve('tsx/cli');
        } catch (err) {
          return { status: 'FAILED', message: `tsx/cli not resolvable: ${(err as Error).message}` };
        }
        spawnArgs = [tsxBin, located.path, '--apply'];
      }

      logger.log(
        `RUN_CLASS_OFFERINGS_LINK spawning ${located.kind} script (${located.path}) --apply ` +
          `(by user ${triggeredByUserId ?? 'unknown'}); log → ${logPath}`,
      );

      const exitCode: number = await new Promise((resolve) => {
        const child = spawn('node', spawnArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        });
        const logStream = createWriteStream(logPath, { flags: 'a' });
        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);
        child.on('exit', (code) => resolve(code ?? 1));
        child.on('error', (err) => {
          logStream.write(`\n[spawn error] ${err.message}\n`);
          resolve(1);
        });
      });

      if (exitCode === 0) {
        logger.log('RUN_CLASS_OFFERINGS_LINK succeeded');
        return { status: 'SUCCEEDED', message: `class-offerings refreshed; log=${logPath}` };
      }
      logger.error(`RUN_CLASS_OFFERINGS_LINK failed (exit=${exitCode}); log=${logPath}`);
      return {
        status: 'FAILED',
        message: `link-class-offerings exited with code ${exitCode}; log=${logPath}`,
      };
    },
  };
}

async function pickCandidateSkills(limit: number) {
  // Placeholder candidate strategy: most-recent N skills. Real impl
  // uses vector similarity over the query text once embeddings are
  // populated (see EMBED_SKILL handler). The switch is a single
  // $queryRaw replacement when prompt 04's embedding backfill runs.
  const rows = await prisma.skill.findMany({
    select: { id: true, nameTh: true, nameEn: true, category: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    category: r.category,
  }));
}
