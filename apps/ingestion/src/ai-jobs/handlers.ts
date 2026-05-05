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

      // Locate the script. apps/ingestion runs from its own dist folder
      // in prod and from the source tree in dev — derive both.
      const scriptCandidates = [
        path.resolve(__dirname, '..', 'scripts', 'programs-pipeline.ts'),
        path.resolve(__dirname, '..', '..', 'src', 'scripts', 'programs-pipeline.ts'),
      ];
      const scriptPath = scriptCandidates.find((p) => existsSync(p));
      if (!scriptPath) {
        return {
          status: 'FAILED',
          message: `programs-pipeline.ts not found in ${scriptCandidates.join(' | ')}`,
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
        `RUN_PROGRAM_PIPELINE spawning programs-pipeline ${args.join(' ')} ` +
          `(by user ${triggeredByUserId ?? 'unknown'}); log → ${logPath}`,
      );

      // Resolve tsx/cli via Node's require so we don't depend on a
      // shell PATH that may not include pnpm/npx in the worker env.
      let tsxBin: string;
      try {
        tsxBin = require.resolve('tsx/cli');
      } catch (err) {
        return {
          status: 'FAILED',
          message: `tsx/cli not resolvable: ${(err as Error).message}`,
        };
      }

      const exitCode: number = await new Promise((resolve) => {
        const child = spawn('node', [tsxBin, scriptPath, ...args], {
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
