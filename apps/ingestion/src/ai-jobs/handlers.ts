import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { Prisma, prisma, refreshAiModelCatalog, runScholarFetch } from '@kku/db';
import { z } from 'zod';
import {
  configFromEnv as scrapingBeeConfigFromEnv,
  fetchScrapingBeePage,
  RoleSchema,
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
  type MarkitdownClient,
} from '@kku/shared';
import { runProgramDigest } from '../program-digest/run';
import { runImdRankingsExtract } from '../imd-rankings-extract/run';
import { runTrendDocumentIngest } from '../trend-signals/ingest-document';
import { runModelHealthNotifier } from './model-health-notifier';
import type { AiJobKind, ProgramPipelinePhase } from './queue';
import type { Role, ScholarTrigger, ScrapingBeeConfig } from '@kku/shared';

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
  /** SCHOLAR_FETCH only — whose 30-day allowance the run spends. NOT the
   *  job `trigger` above; see the field's doc comment in queue.ts. */
  scholarTrigger?: ScholarTrigger;
  /** SCHOLAR_FETCH only — the actor's role, for the SUPER_ADMIN quota
   *  exemption. */
  scholarActorRole?: Role;
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
  // ANALYZE_TREND_DOCUMENT converts uploads/URLs to Markdown via the
  // markitdown sidecar. Optional — when absent the runner falls back to
  // pdfjs/html-strip.
  markitdown?: MarkitdownClient;
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

    // Uploaded PDF / pasted URL → a published TrendSignal on the radar.
    // entityId is a TrendDocument id. The runner extracts text, drafts the
    // signal, auto-publishes it, then runs the trend-signal-analysis pass.
    ANALYZE_TREND_DOCUMENT: async ({ entityId, triggeredByUserId }) => {
      const outcome = await runTrendDocumentIngest({
        trendDocumentId: entityId,
        ai: deps.ai,
        storage: deps.storage,
        markitdown: deps.markitdown,
        triggeredByUserId,
      });
      if (outcome.status === 'SUCCEEDED') {
        logger.log(
          `ANALYZE_TREND_DOCUMENT doc=${entityId} signal=${outcome.trendSignalId} ` +
            `type=${outcome.signalType} impact=${outcome.impactScore} ` +
            `extraction=${outcome.extractionMethod} analysis=${outcome.analysisOk ? 'ok' : 'skipped'}`,
        );
        return { status: 'SUCCEEDED', message: outcome.trendSignalId };
      }
      return { status: outcome.status, message: outcome.reason };
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

    // Re-fetch the Google Gemini model list from OpenRouter (discovery
    // only — model name + description + pricing). Runs daily via a
    // repeatable; a fetch failure leaves the last-known-good catalog.
    REFRESH_MODEL_CATALOG: async () => {
      const result = await refreshAiModelCatalog();
      if (result.ok) {
        logger.log(
          `REFRESH_MODEL_CATALOG refreshed ${result.count} model(s): ` +
            result.models.map((m) => m.id).join(', '),
        );
        return { status: 'SUCCEEDED', message: `${result.count} models refreshed` };
      }
      // Non-fatal — the existing catalog is untouched, so the app keeps
      // working on the last-known-good list. SKIPPED, not FAILED, so a
      // transient OpenRouter outage doesn't churn BullMQ retries.
      logger.warn(`REFRESH_MODEL_CATALOG skipped: ${result.error}`);
      return { status: 'SKIPPED', message: result.error ?? 'refresh failed' };
    },

    // Google Scholar on-demand fetch. This handler is the whole point of the
    // runner's injected `fetchPage`: the runner lives in packages/db and
    // cannot reach a network client of its own, so the ScrapingBee wrapper is
    // handed in from here.
    //
    // Job data arrives off Redis, so it is validated rather than trusted —
    // a job enqueued by an older build (or hand-poked into the queue) would
    // otherwise reach `runScholarFetch` with an undefined trigger and be
    // rejected there with a far less legible error.
    SCHOLAR_FETCH: async ({ entityId, triggeredByUserId, scholarTrigger, scholarActorRole }) => {
      const parsed = ScholarJobFieldsSchema.safeParse({
        triggeredByUserId,
        scholarTrigger,
        scholarActorRole,
      });
      if (!parsed.success) {
        return {
          status: 'FAILED',
          message:
            'SCHOLAR_FETCH job is missing required fields ' +
            `(${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}). ` +
            'It was probably enqueued by an older build — re-trigger it from the Scholar admin console.',
        };
      }

      // Resolved once per job, and eagerly: a missing SCRAPINGBEE_API_KEY is
      // a configuration fault, not a transient one, and finding out on page 1
      // of the walk would open a run row and mark it FAILED for what is
      // really "this deployment is not configured".
      let cfg: ScrapingBeeConfig;
      try {
        cfg = scrapingBeeConfigFromEnv();
      } catch (err) {
        return {
          status: 'FAILED',
          message: err instanceof Error ? err.message : 'ScrapingBee is not configured.',
        };
      }

      // Not wrapped in a try: the only paths on which `runScholarFetch`
      // throws rather than returns are the ones BEFORE the first page fetch
      // (input validation, person resolution, opening the run row), so a
      // BullMQ retry there costs nothing and may well succeed. Everything
      // after a credit has been spent is caught inside the runner and comes
      // back as a FAILED result.
      const result = await runScholarFetch({
        userId: entityId,
        triggeredById: parsed.data.triggeredByUserId,
        trigger: parsed.data.scholarTrigger,
        actorRole: parsed.data.scholarActorRole,
        fetchPage: async (targetUrl) => {
          const page = await fetchScrapingBeePage(targetUrl, cfg);
          return { html: page.html, creditsUsed: page.creditsUsed };
        },
      });

      // A refusal is NOT a success. `runScholarFetch` returns rather than
      // throws for "no staff record", "quota exhausted" and "needs binding",
      // and reporting those as SUCCEEDED would leave a completed job whose
      // only evidence that nothing happened is a run row nobody reads. SKIPPED
      // is the distinguishable outcome; the reason travels in `message`, and
      // GET /scholar/status/me reads the same reason off the ledger for the
      // user. SCHOLAR_NEEDS_BINDING passes through verbatim so the UI can
      // branch on it.
      //
      // FAILED is returned, never thrown: throwing hands the job back to
      // BullMQ, which would re-walk the profile at ~15 credits a page against
      // a condition (interstitial, bad binding, exhausted plan) that a retry
      // does not change.
      const detail = `scholar run ${result.runId ?? '(none)'}: ${result.status}` +
        (result.reason ? ` — ${result.reason}` : '') +
        ` [found=${result.papersFound} inserted=${result.papersInserted}` +
        ` citations=${result.citationsUpdated} credits=${result.creditsUsed}]`;
      logger.log(`SCHOLAR_FETCH user=${entityId} ${detail}`);

      if (result.status === 'REFUSED') return { status: 'SKIPPED', message: detail };
      if (result.status === 'FAILED') return { status: 'FAILED', message: detail };
      // SUCCEEDED and PARTIAL both imported data. PARTIAL keeps its own word
      // in the message so "some of it is missing" is greppable in the log.
      return { status: 'SUCCEEDED', message: detail };
    },

    // Daily aiModelHealth() sweep — raises/clears Notification rows for
    // SUPER_ADMINs when a pinned AI method is off-catalog / deprecated /
    // failing. See model-health-notifier.ts for the dedup + clear rules.
    NOTIFY_MODEL_HEALTH: async () => {
      await runModelHealthNotifier();
      logger.log('NOTIFY_MODEL_HEALTH sweep complete');
      return { status: 'SUCCEEDED' };
    },
  };
}

/**
 * The SCHOLAR_FETCH-specific slice of a job payload. Everything here is
 * optional on `AiJobData` (it is a shared envelope across ten job kinds) and
 * mandatory for this one, so the handler asserts it rather than defaulting:
 * a wrong `scholarTrigger` would draw down the wrong 30-day allowance.
 */
const ScholarJobFieldsSchema = z.object({
  triggeredByUserId: z.string().min(1),
  scholarTrigger: z.enum(['SELF', 'ADMIN', 'ADMIN_BULK']),
  scholarActorRole: RoleSchema,
});

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
