import {
  AUNQA_CRITERION_NARRATIVE_VERSION,
  AunqaCriterionNarrativeSchema,
  aunqaCriterionConfidenceCeiling,
  buildAunqaCriterionNarrativeMessages,
  criterionById,
  extractStructuredWithParseRetry,
  lintBannedTells,
  unevidencedSubCriterionIds,
  type AiService,
  type AunqaCriterionNarrativeInput,
  type AunqaEvidenceLine,
  type EvidenceBinding,
} from '@kku/shared';
import { prisma } from './index';
import { aunqaReadinessForProgram } from './aunqa-readiness';
import type { ResolvedEvidence } from './aunqa-evidence';

// ─────────────────────────────────────────────────────────────────────────────
// Generates the AUN-QA self-assessment draft for ONE criterion of ONE
// programme, on demand.
//
// There is deliberately NO bulk path and no `--all` script: 301 programmes ×
// 6 criteria has no reader and a real cost. A QA officer asks for the
// criterion they are writing up, and gets that one.
//
// Three post-generation disciplines, two shared with the narrative and
// research-expertise runners and one specific to this surface:
//   1. extractStructuredWithParseRetry — one corrective retry on schema
//      validation failure.
//   2. lintBannedTells over the prose — one corrective retry, then
//      persist-anyway-and-warn.
//   3. GAP COVERAGE — every sub-criterion the platform could not evidence
//      must appear in the model's `gaps`. This is the check that makes the
//      "say what is missing" instruction enforceable rather than hopeful:
//      a draft that quietly skips an unevidenced sub-criterion is exactly
//      the padding this feature exists to prevent, and it travels in the
//      same corrective retry as the tell lint.
//
// Re-running at the same prompt version UPSERTS the row; a version bump
// writes a new row alongside, shadowing rather than destroying the old draft.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunAunqaCriterionNarrativeParams {
  programId: string;
  /** AUN-QA criterion number as the registry states it, e.g. '4'. */
  criterionId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
}

export interface AunqaCriterionNarrativeGap {
  subCriterionId: string;
  missing: string;
}

export type AunqaCriterionNarrativeOutcome =
  | {
      status: 'SUCCEEDED';
      programId: string;
      criterionId: string;
      criterionTitle: string;
      paragraph: string;
      gaps: AunqaCriterionNarrativeGap[];
      band: string;
      subCriteriaTotal: number;
      subCriteriaWithEvidence: number;
      /** Post-clamp — never the model's raw self-report if it exceeded the
       *  deterministic ceiling. */
      confidence: number;
      confidenceClamped: boolean;
      /** True when the first draft tripped the tell lint or left an
       *  unevidenced sub-criterion out of `gaps`, and a corrective retry
       *  was issued (regardless of whether the retry came back clean). */
      correctiveRetried: boolean;
      methodVersion: string;
      aiInferenceId: string | null;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
    }
  | { status: 'SKIPPED'; reason: string };

/** Channel label for a binding: kind, plus the field or theme that
 *  distinguishes two bindings of the same kind. Mirrors `bindingKey` /
 *  `availabilityKey` in the sibling files (both private there) and, like
 *  them, contains no criterion name or number — only the registry's own
 *  binding vocabulary. */
function channelLabel(binding: EvidenceBinding): string {
  switch (binding.kind) {
    case 'evaluation-theme':
      return `evaluation-theme:${binding.theme}`;
    case 'graduate-outcome':
    case 'staff-metric':
    case 'curriculum':
    case 'pedagogy-assessment':
    case 'peer-review':
    case 'enrollment-metric':
      return `${binding.kind}:${binding.field}`;
    default:
      return binding.kind;
  }
}

/** Cap on the serialised value handed to the model per channel. The widest
 *  values (cohort progression, DQ module profile, class-GPA bands) run to a
 *  few hundred characters; the cap is a guard against a future resolver
 *  returning something unbounded, not a routine truncation. Truncation is
 *  marked in the text so the model never treats a cut-off list as complete. */
const MAX_VALUE_CHARS = 1500;

function serialiseValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    // A value the resolver produced that will not serialise is a bug there,
    // not a reason to fail the draft — degrade to unavailable-shaped input
    // so the model reports the channel as missing rather than inventing it.
    return null;
  }
  if (json.length <= MAX_VALUE_CHARS) return json;
  return `${json.slice(0, MAX_VALUE_CHARS)}… (value truncated for length — treat the list as partial)`;
}

function blankToNull(value: string | null): string | null {
  return value === null || value.trim().length === 0 ? null : value;
}

function toEvidenceLine(resolved: ResolvedEvidence): AunqaEvidenceLine {
  const valueJson = resolved.available ? serialiseValue(resolved.value) : null;
  return {
    channel: channelLabel(resolved.binding),
    // `assertAvailable` upstream already forbids available-with-null, but a
    // value that failed to serialise here must not reach the model as an
    // available channel with no figure attached.
    available: resolved.available && valueJson !== null,
    valueJson,
    sourceLabel: resolved.sourceLabel,
    freshness: resolved.freshness ? resolved.freshness.toISOString().slice(0, 10) : null,
    caveat: resolved.caveat,
  };
}

/** Assembles the prompt input for one criterion. Exported for the API layer
 *  and for tests: it is a pure transform over the readiness result, so a
 *  caller can inspect exactly what the model will be shown without spending
 *  an AI call. Returns null when the programme or the criterion is unknown. */
export async function assembleAunqaCriterionNarrativeInput(
  programId: string,
  criterionId: string,
): Promise<AunqaCriterionNarrativeInput | null> {
  const criterion = criterionById(criterionId);
  if (!criterion) return null;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      code: true,
      nameTh: true,
      nameEn: true,
      level: true,
      faculty: { select: { nameTh: true, nameEn: true } },
    },
  });
  if (!program) return null;

  // Reuses the readiness path rather than resolving the criterion's bindings
  // directly: it already zips resolved evidence back onto the sub-criteria
  // that asked for it, and a second implementation of that zip is a second
  // place for a value to land under the wrong sub-criterion. It resolves all
  // six criteria (130-1300 ms) where one would do — trivial next to the AI
  // call that follows, and worth it for having one counting path.
  const readiness = await aunqaReadinessForProgram(programId);
  const criterionReadiness = readiness.criteria.find((c) => c.criterionId === criterionId);
  if (!criterionReadiness) return null;

  return {
    programCode: program.code,
    programNameTh: program.nameTh,
    // Blank English names normalise to null. Left as `''` the prompt renders
    // an empty half to the name line, which reads as an omission and invites
    // the model to translate the Thai name — putting an English title into an
    // accreditation draft that no KKU record holds. Observed on KKU-SEQ-0184.
    programNameEn: blankToNull(program.nameEn),
    programLevel: program.level,
    facultyNameTh: program.faculty.nameTh,
    facultyNameEn: blankToNull(program.faculty.nameEn),
    criterionId: criterionReadiness.criterionId,
    criterionTitle: criterionReadiness.title,
    band: criterionReadiness.band,
    subCriteriaTotal: criterionReadiness.subCriteriaTotal,
    subCriteriaWithEvidence: criterionReadiness.subCriteriaWithEvidence,
    subCriteria: criterionReadiness.subCriteria.map((sub) => ({
      id: sub.id,
      title: sub.title,
      hasEvidence: sub.hasEvidence,
      evidence: sub.evidence.map(toEvidenceLine),
    })),
  };
}

/** Sub-criteria with no evidence that the draft failed to name in `gaps`.
 *  Pure, so the rule is testable without an AI call. */
export function missingGapCoverage(
  input: AunqaCriterionNarrativeInput,
  gaps: AunqaCriterionNarrativeGap[],
): string[] {
  const named = new Set(gaps.map((g) => g.subCriterionId.trim()));
  return unevidencedSubCriterionIds(input).filter((id) => !named.has(id));
}

export async function generateAunqaCriterionNarrative(
  params: RunAunqaCriterionNarrativeParams,
): Promise<AunqaCriterionNarrativeOutcome> {
  const input = await assembleAunqaCriterionNarrativeInput(
    params.programId,
    params.criterionId,
  );
  if (!input) {
    return {
      status: 'SKIPPED',
      reason: `no such programme or criterion: program=${params.programId} criterion=${params.criterionId}`,
    };
  }

  const messages = buildAunqaCriterionNarrativeMessages(input);
  const extractionParams = {
    ctx: {
      module: 'aunqa',
      kind: 'aunqa-criterion-narrative',
      userId: params.triggeredByUserId ?? null,
      traceId: `aunqa-narrative-${params.programId}-${params.criterionId}`,
    },
    methodVersion: AUNQA_CRITERION_NARRATIVE_VERSION,
    // Same 50000 convention as every other structured-extraction runner here
    // — thinking-mode output truncates mid-JSON at smaller budgets.
    maxOutputTokens: 50000,
  };

  let response = await extractStructuredWithParseRetry(
    params.ai,
    { ...extractionParams, messages },
    AunqaCriterionNarrativeSchema,
    'aunqa-criterion-narrative',
  );

  // One corrective retry covering BOTH post-generation rules, so a draft that
  // trips each of them costs one extra call rather than two.
  const complaints: string[] = [];
  const tellViolations = lintBannedTells(
    [response.parsed.paragraph, ...response.parsed.gaps.map((g) => g.missing)].join('\n'),
  );
  if (tellViolations.length > 0) {
    complaints.push(
      `you used banned phrase(s): ${tellViolations.map((v) => `"${v.phrase}"`).join(', ')}`,
    );
  }
  const uncovered = missingGapCoverage(input, response.parsed.gaps);
  if (uncovered.length > 0) {
    complaints.push(
      `sub-criteria ${uncovered.join(', ')} have NO available evidence but do not appear in your "gaps" array — every unevidenced sub-criterion must be named there`,
    );
  }

  let correctiveRetried = false;
  if (complaints.length > 0) {
    correctiveRetried = true;
    const correctionMessages = [
      ...messages,
      { role: 'assistant' as const, content: response.rawText },
      {
        role: 'user' as const,
        content: `Your draft has these problems: ${complaints.join('; ')}. Rewrite the ENTIRE draft correcting them, keeping every grounding rule — in particular, do not compensate for a thin criterion by adding general statements the evidence does not support. Return the corrected JSON in the same format as before.`,
      },
    ];
    const retry = await extractStructuredWithParseRetry(
      params.ai,
      { ...extractionParams, messages: correctionMessages },
      AunqaCriterionNarrativeSchema,
      'aunqa-criterion-narrative',
    );
    const retryTells = lintBannedTells(
      [retry.parsed.paragraph, ...retry.parsed.gaps.map((g) => g.missing)].join('\n'),
    );
    const retryUncovered = missingGapCoverage(input, retry.parsed.gaps);
    if (retryTells.length > 0 || retryUncovered.length > 0) {
      console.warn(
        `[aunqa-criterion-narrative] corrective retry still failing for program ${params.programId} criterion ${params.criterionId}: tells=[${retryTells
          .map((v) => v.phrase)
          .join(', ')}] uncoveredGaps=[${retryUncovered.join(', ')}]`,
      );
    }
    response = retry;
  }

  // Confidence clamp — the model's self-report is a floor-signal only.
  const ceiling = aunqaCriterionConfidenceCeiling(
    input.subCriteriaTotal,
    input.subCriteriaWithEvidence,
  );
  let confidence = response.parsed.confidence;
  let confidenceClamped = false;
  if (confidence > ceiling) {
    confidenceClamped = true;
    console.warn(
      `[aunqa-criterion-narrative] confidence clamped for program ${params.programId} criterion ${params.criterionId}: reported=${confidence} ceiling=${ceiling} (${input.subCriteriaWithEvidence}/${input.subCriteriaTotal} sub-criteria evidenced)`,
    );
    confidence = ceiling;
  }

  const gaps: AunqaCriterionNarrativeGap[] = response.parsed.gaps.map((g) => ({
    subCriterionId: g.subCriterionId,
    missing: g.missing,
  }));

  const row = {
    paragraph: response.parsed.paragraph,
    // Fresh object literals, not the named-interface array: Prisma's JSON
    // input type needs a structural index signature, which
    // `AunqaCriterionNarrativeGap` (a named interface) does not carry. Same
    // reason program-research-expertise-run.ts spreads `input.stats`.
    gapsJson: gaps.map((g) => ({ ...g })),
    band: input.band,
    subCriteriaTotal: input.subCriteriaTotal,
    subCriteriaWithEvidence: input.subCriteriaWithEvidence,
    confidence,
    aiInferenceId: response.aiInferenceId,
  };

  await prisma.aunqaCriterionNarrative.upsert({
    where: {
      programId_criterionId_methodVersion: {
        programId: params.programId,
        criterionId: input.criterionId,
        methodVersion: AUNQA_CRITERION_NARRATIVE_VERSION,
      },
    },
    create: {
      programId: params.programId,
      criterionId: input.criterionId,
      methodVersion: AUNQA_CRITERION_NARRATIVE_VERSION,
      ...row,
    },
    update: row,
  });

  return {
    status: 'SUCCEEDED',
    programId: params.programId,
    criterionId: input.criterionId,
    criterionTitle: input.criterionTitle,
    paragraph: response.parsed.paragraph,
    gaps,
    band: input.band,
    subCriteriaTotal: input.subCriteriaTotal,
    subCriteriaWithEvidence: input.subCriteriaWithEvidence,
    confidence,
    confidenceClamped,
    correctiveRetried,
    methodVersion: AUNQA_CRITERION_NARRATIVE_VERSION,
    aiInferenceId: response.aiInferenceId,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
  };
}
