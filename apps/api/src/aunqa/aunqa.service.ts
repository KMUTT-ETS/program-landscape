import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PrismaAiInferenceRecorder,
  aunqaCompletenessForPrograms,
  aunqaReadinessForProgram,
  generateAunqaCriterionNarrative,
  getAiModelOverrideStore,
  prisma,
  type AunqaCriterionNarrativeGap,
  type CriterionCompleteness,
  type CriterionReadiness,
  type ReadinessBand,
} from '@kku/db';
import {
  AUNQA_CRITERIA,
  AUNQA_UNEVIDENCED_CRITERIA,
  ApiError,
  createAiService,
  type AiProviderId,
  type AiService,
  type AunqaUnevidencedCriterion,
} from '@kku/shared';

export interface AunqaProgramSummary {
  id: string;
  code: string;
  nameEn: string | null;
  nameTh: string;
  level: string;
  facultyId: string;
  facultyNameTh: string;
  facultyNameEn: string | null;
}

export interface AunqaProgramAnalysis {
  program: AunqaProgramSummary;
  criteria: CriterionReadiness[];
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
  /** Criteria 6 and 7 travel with the payload so the page can name them
   *  once. They are not "missing data" for this programme — the platform
   *  holds nothing that could evidence them for any programme, and a
   *  reader who saw six criteria and no note would infer six is the whole
   *  framework. */
  unevidencedCriteria: readonly AunqaUnevidencedCriterion[];
}

export interface AunqaOverviewRow {
  program: AunqaProgramSummary;
  criteria: CriterionCompleteness[];
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
}

export interface AunqaFacultyOverview {
  /** Column headers for the table, from the registry — the page never
   *  writes a criterion number or title of its own. */
  criteria: Array<{ id: string; title: string; subCriteriaTotal: number }>;
  programs: AunqaOverviewRow[];
  unevidencedCriteria: readonly AunqaUnevidencedCriterion[];
}

const PROGRAM_SELECT = {
  id: true,
  code: true,
  nameEn: true,
  nameTh: true,
  level: true,
  facultyId: true,
  faculty: { select: { nameTh: true, nameEn: true } },
} as const;

interface ProgramRow {
  id: string;
  code: string;
  nameEn: string | null;
  nameTh: string;
  level: string;
  facultyId: string;
  faculty: { nameTh: string; nameEn: string | null };
}

function toSummary(row: ProgramRow): AunqaProgramSummary {
  return {
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameTh: row.nameTh,
    level: row.level,
    facultyId: row.facultyId,
    facultyNameTh: row.faculty.nameTh,
    facultyNameEn: row.faculty.nameEn,
  };
}

/** An AI-drafted self-assessment paragraph for one criterion, plus the gaps
 *  it could not evidence. A DRAFT for a QA officer to edit — not a rating,
 *  not a compliance claim. */
export interface AunqaCriterionNarrativeResult {
  programId: string;
  criterionId: string;
  criterionTitle: string;
  paragraph: string;
  gaps: AunqaCriterionNarrativeGap[];
  band: string;
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  confidence: number;
  methodVersion: string;
  aiInferenceId: string | null;
}

@Injectable()
export class AunqaService implements OnModuleInit {
  private ai!: AiService;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const providerId = (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId;
    const intelSphereUrl = this.config.get<string>('KKU_INTELSPHERE_URL');
    const intelSphereKey = this.config.get<string>('KKU_INTELSPHERE_API_KEY');
    this.ai = createAiService({
      recorder: new PrismaAiInferenceRecorder(),
      providerId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
        intelSphere:
          intelSphereUrl && intelSphereKey
            ? { url: intelSphereUrl, apiKey: intelSphereKey }
            : undefined,
      },
      modelOverrideResolver: getAiModelOverrideStore(),
    });
  }

  /**
   * Drafts the self-assessment paragraph for ONE criterion, on demand.
   *
   * One criterion per call by design — there is no bulk path. The caller has
   * already run `assertProgramAccessible`.
   */
  async criterionNarrative(
    programId: string,
    criterionId: string,
    userId: string,
  ): Promise<AunqaCriterionNarrativeResult> {
    const hasProvider = Boolean(
      this.config.get<string>('GOOGLE_AI_API_KEY') ||
        this.config.get<string>('ANTHROPIC_API_KEY'),
    );
    if (!hasProvider) {
      throw new ApiError(
        'AI_PROVIDER_ERROR',
        'No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to draft an AUN-QA self-assessment.',
      );
    }

    const outcome = await generateAunqaCriterionNarrative({
      programId,
      criterionId,
      ai: this.ai,
      triggeredByUserId: userId,
    });
    // SKIPPED here means an unknown criterion number (the programme was
    // already checked by `assertProgramAccessible`), which is a 404 on the
    // path parameter, not a generation failure.
    if (outcome.status === 'SKIPPED') throw new NotFoundException(outcome.reason);

    return {
      programId: outcome.programId,
      criterionId: outcome.criterionId,
      criterionTitle: outcome.criterionTitle,
      paragraph: outcome.paragraph,
      gaps: outcome.gaps,
      band: outcome.band,
      subCriteriaTotal: outcome.subCriteriaTotal,
      subCriteriaWithEvidence: outcome.subCriteriaWithEvidence,
      confidence: outcome.confidence,
      methodVersion: outcome.methodVersion,
      aiInferenceId: outcome.aiInferenceId,
    };
  }

  /** One programme, every binding resolved. The caller has already run
   *  `assertProgramAccessible`. */
  async programAnalysis(programId: string): Promise<AunqaProgramAnalysis> {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: PROGRAM_SELECT,
    });
    if (!program) throw new NotFoundException();

    const readiness = await aunqaReadinessForProgram(programId);
    return {
      program: toSummary(program),
      criteria: readiness.criteria,
      subCriteriaTotal: readiness.subCriteriaTotal,
      subCriteriaWithEvidence: readiness.subCriteriaWithEvidence,
      band: readiness.band,
      unevidencedCriteria: AUNQA_UNEVIDENCED_CRITERIA,
    };
  }

  /**
   * Completeness for every programme in the caller's scope.
   *
   * `facultyName` arrives already clamped by the controller. An empty
   * array means no filter — the university-wide caller — and the sentinel
   * `['__none__']` matches no faculty, which is how a caller with no
   * grants gets an empty table instead of the whole university.
   */
  async facultyOverview(filter: { facultyName: string[] }): Promise<AunqaFacultyOverview> {
    const programs = await prisma.program.findMany({
      where:
        filter.facultyName.length > 0
          ? { faculty: { nameTh: { in: filter.facultyName } } }
          : {},
      select: PROGRAM_SELECT,
      orderBy: [{ faculty: { nameTh: 'asc' } }, { code: 'asc' }],
    });

    const completeness = await aunqaCompletenessForPrograms(programs.map((p) => p.id));
    const byId = new Map(completeness.map((c) => [c.programId, c]));

    return {
      criteria: AUNQA_CRITERIA.map((c) => ({
        id: c.id,
        title: c.title,
        subCriteriaTotal: c.subCriteria.length,
      })),
      programs: programs.map((p) => {
        const row = byId.get(p.id);
        return {
          program: toSummary(p),
          criteria: row?.criteria ?? [],
          subCriteriaTotal: row?.subCriteriaTotal ?? 0,
          subCriteriaWithEvidence: row?.subCriteriaWithEvidence ?? 0,
          band: row?.band ?? 'no-evidence',
        };
      }),
      unevidencedCriteria: AUNQA_UNEVIDENCED_CRITERIA,
    };
  }
}
