import type { ExtractionRecord, PdfContext, PdfExtractor, PdfSourceCategory } from '@kku/shared';

// Stub extractors — one per domain category. Each returns a single
// "placeholder" extraction that:
//   - has confidence 0 (always routes to PENDING_REVIEW)
//   - carries the default empty variant of the payload schema
//   - reasoning explains this is a stub
//
// Prompt 04 replaces each `extract()` body with a real LLM call. The
// worker, the registry, the review UI — none of those care that these
// are stubs; the shape they consume is already correct.

abstract class StubExtractorBase implements PdfExtractor {
  abstract readonly name: string;
  abstract readonly extractionType: PdfExtractor['extractionType'];
  abstract readonly appliesTo: readonly PdfSourceCategory[];
  readonly methodVersion = 'stub-v1';

  protected abstract defaultPayload(ctx: PdfContext): unknown;
  protected abstract targetEntityType(): string;

  async extract(ctx: PdfContext): Promise<ExtractionRecord[]> {
    return [
      {
        extractionType: this.extractionType,
        targetEntityType: this.targetEntityType(),
        payload: this.defaultPayload(ctx),
        confidence: 0,
        reasoning:
          `Stub extractor for ${this.extractionType}: returning empty payload. ` +
          'Real LLM-backed extraction lands with prompt 04.',
        proposedLinks: [],
      },
    ];
  }
}

export class StubPolicyDocExtractor extends StubExtractorBase {
  readonly name = 'Policy document extractor';
  readonly extractionType = 'POLICY_DOC' as const;
  readonly appliesTo = ['POLICY'] as const;
  protected targetEntityType() { return 'policy_documents'; }
  protected defaultPayload(ctx: PdfContext) {
    return {
      titleTh: ctx.originalFilename.replace(/\.pdf$/i, ''),
      summaryTh: '',
      issuingOrg: ctx.sourceOrgHint ?? '',
      policySource: 'OTHER',
      keyDirectives: [],
      mentionedSectors: [],
      mentionedSkills: [],
      estimatedImpact: 'unknown',
    };
  }
}

export class StubStatisticalReportExtractor extends StubExtractorBase {
  readonly name = 'Statistical report extractor';
  readonly extractionType = 'LABOR_STAT' as const;
  readonly appliesTo = ['REPORT'] as const;
  protected targetEntityType() { return 'labor_statistics'; }
  protected defaultPayload(ctx: PdfContext) {
    return { indicator: ctx.originalFilename.replace(/\.pdf$/i, ''), tableRows: [] };
  }
}

export class StubCurriculumExtractor extends StubExtractorBase {
  readonly name = 'Curriculum extractor';
  readonly extractionType = 'CURRICULUM_SPEC' as const;
  readonly appliesTo = ['CURRICULUM'] as const;
  protected targetEntityType() { return 'curricula'; }
  protected defaultPayload(ctx: PdfContext) {
    return { programNameTh: ctx.originalFilename.replace(/\.pdf$/i, ''), courses: [] };
  }
}

export class StubPeerProgramExtractor extends StubExtractorBase {
  readonly name = 'Peer program extractor';
  readonly extractionType = 'PEER_PROGRAM' as const;
  readonly appliesTo = ['PEER_PROGRAM'] as const;
  protected targetEntityType() { return 'peer_programs'; }
  protected defaultPayload(ctx: PdfContext) {
    return {
      university: ctx.sourceOrgHint ?? 'unknown',
      country: 'TH',
      programNameEn: ctx.originalFilename.replace(/\.pdf$/i, ''),
      distinctiveFeatures: [],
    };
  }
}

export class StubSurveyExtractor extends StubExtractorBase {
  readonly name = 'Survey extractor';
  readonly extractionType = 'SURVEY_RESULT' as const;
  readonly appliesTo = ['SURVEY'] as const;
  protected targetEntityType() { return 'survey_results'; }
  protected defaultPayload(ctx: PdfContext) {
    return {
      surveyName: ctx.originalFilename.replace(/\.pdf$/i, ''),
      respondentType: 'other',
      aggregates: [],
      openEndedThemes: [],
    };
  }
}

export class StubCommitteeMinutesExtractor extends StubExtractorBase {
  readonly name = 'Committee minutes extractor';
  readonly extractionType = 'COMMITTEE_MINUTES' as const;
  readonly appliesTo = ['COMMITTEE_MINUTES'] as const;
  protected targetEntityType() { return 'council_decisions'; }
  protected defaultPayload(ctx: PdfContext) {
    return {
      committeeName: ctx.sourceOrgHint ?? ctx.originalFilename.replace(/\.pdf$/i, ''),
      attendees: [],
      decisions: [],
      actionItems: [],
    };
  }
}

export class StubJobPostingsBatchExtractor extends StubExtractorBase {
  readonly name = 'Job postings batch extractor';
  readonly extractionType = 'JOB_POSTING_BATCH' as const;
  readonly appliesTo = ['JOB_POSTINGS_BATCH'] as const;
  protected targetEntityType() { return 'job_postings'; }
  protected defaultPayload(ctx: PdfContext) {
    return { batchSourceOrg: ctx.sourceOrgHint, postings: [] };
  }
}

// Registry. The pipeline worker picks the extractor whose appliesTo
// includes the classification's sourceCategory. If no extractor matches
// (OTHER, or new category not wired yet), the PDF gets an "OTHER"
// extraction with the raw text payload so the review UI can still show it.

export const EXTRACTORS: readonly PdfExtractor[] = [
  new StubPolicyDocExtractor(),
  new StubStatisticalReportExtractor(),
  new StubCurriculumExtractor(),
  new StubPeerProgramExtractor(),
  new StubSurveyExtractor(),
  new StubCommitteeMinutesExtractor(),
  new StubJobPostingsBatchExtractor(),
];

export function extractorsFor(category: PdfSourceCategory): PdfExtractor[] {
  return EXTRACTORS.filter((e) => e.appliesTo.includes(category));
}
