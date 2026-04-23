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
} from '@kku/shared';
import type { AiJobKind } from './queue';

// Each handler consumes one job, calls the AI service, writes an
// AiExtraction row. Approval (in the review UI) materialises the
// payload into the real domain tables.

export interface AiJobContext {
  entityId: string;
  trigger: 'MANUAL' | 'SCHEDULED' | 'CHAINED';
  triggeredByUserId: string | null;
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
