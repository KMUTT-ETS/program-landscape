import {
  buildProgramCurriculumRevisionMessages,
  ProgramCurriculumRevisionSchema,
  PROGRAM_CURRICULUM_REVISION_VERSION,
  CLOSURE_POLICY,
  researchExpertiseConfidenceCeiling,
  lintBannedTells,
  extractStructuredWithParseRetry,
  type AiService,
  type ExtractionResponse,
  type ProgramCurriculumRevision,
} from '@kku/shared';
import { prisma } from './index';
import {
  assembleCurriculumRevisionInput,
  validateCurriculumRevisionPayload,
  type CurriculumRevisionReadiness,
  type CurriculumRevisionDrops,
} from './program-curriculum-revision';
import { activeRevisionIdFor } from './program-revision';

// ─────────────────────────────────────────────────────────────────────────────
// Generates course-level curriculum-revision advice for one program.
//
// Mirrors program-research-expertise-run.ts's three post-generation
// disciplines, plus two this feature adds:
//   1. extractStructuredWithParseRetry — one corrective retry on schema failure.
//   2. lintBannedTells over free text — one corrective retry, then persist-and-warn.
//   3. Deterministic confidence clamp — REUSING
//      researchExpertiseConfidenceCeiling, deliberately not a parallel scale:
//      this advice rests on exactly the same publication evidence the research
//      section grades, so a Deep-Dive page must never show a confident
//      curriculum recommendation directly beneath a low-confidence research
//      analysis built from identical evidence.
//   4. NEW — validateCurriculumRevisionPayload. It DROPS an item whose own
//      subject is unfounded (a courseCode or every themeRef that does not
//      exist, an enhancement with no real paper behind it), and STRIPS the
//      unfounded parts of an item that otherwise stands: a co-teacher who is
//      not on the roster loses their entry, a quote that is not verbatim is
//      blanked. Dropping and stripping are counted separately.
//   5. NEW — the coverage counts are DERIVED from the input, never taken from
//      the model.
//
// `no-research` / `no-courses` short-circuit BEFORE any AI call: a program
// with nothing to analyse should not cost a call to say so.
//
// INSERT-ONLY, like ProgramResearchExpertise — history accretes.
// ─────────────────────────────────────────────────────────────────────────────

/** Word-ish tokens, lowercased, for the bound-term scan below. Hyphenated
 *  compounds split at the hyphen, so '3-credit module' yields 'credit' —
 *  which is the reading we want. */
const WORD_TOKEN_RE = /[A-Za-z][A-Za-z']*/g;

/** Sentence and field boundaries. Adjacency does not carry across one. */
const SEGMENT_SPLIT_RE = /[.!?;\n\r]+/;

const UNAMBIGUOUS_PATTERNS: ReadonlyArray<{ phrase: string; regex: RegExp }> =
  CLOSURE_POLICY.unambiguous.map((phrase) => ({
    phrase,
    // A space in a policy phrase matches a hyphen too: 'phase out' must also
    // catch 'phase-out', which is how the noun form is usually written.
    regex: new RegExp(`\\b${phrase.replace(/\s+/g, '[-\\s]+')}\\b`, 'i'),
  }));

const AMBIGUOUS_TERMS = new Set<string>(CLOSURE_POLICY.ambiguous);
const OBJECT_NOUNS = new Set<string>(CLOSURE_POLICY.objectNouns);
const PASSIVE_GLUE = new Set<string>(CLOSURE_POLICY.passiveGlue);

/**
 * Phrases in `text` that propose ending or shrinking a course — HARD
 * CONSTRAINT 5 of the prompt, enforced.
 *
 * The vocabulary lives in `CLOSURE_POLICY` beside the constraint's own prose
 * (packages/shared/src/ai/prompts/program-curriculum-revision.ts) so the two
 * cannot drift; this function is only the matching. See that constant for
 * why the terms are split into two tiers and why the passive window is much
 * tighter than the forward one.
 */
export function findClosureViolations(text: string): string[] {
  const hits = new Set<string>();
  // Scan SENTENCE BY SENTENCE, never the joined string. Both binding rules
  // below reason about adjacency, and the lintable text is a concatenation of
  // unrelated fields — so a whole-string scan invents adjacencies that no
  // reader would perceive. Measured: "…to the water-treatment unit." followed
  // by "Merging the two topics…" fused into a passive-voice match across the
  // field boundary, and an `addition` of "phase" beside an `additionDetail`
  // of "out" matched the multi-word phrase 'phase out'. Both were false
  // positives manufactured entirely by the join.
  for (const segment of text.split(SEGMENT_SPLIT_RE)) {
    if (segment.trim().length === 0) continue;
    scanSegment(segment, hits);
  }
  return [...hits];
}

function scanSegment(segment: string, hits: Set<string>): void {
  for (const { phrase, regex } of UNAMBIGUOUS_PATTERNS) {
    if (regex.test(segment)) hits.add(phrase);
  }

  const tokens = (segment.match(WORD_TOKEN_RE) ?? []).map((t) => t.toLowerCase());
  const isObject = (index: number): boolean => {
    const token = tokens[index];
    return token !== undefined && OBJECT_NOUNS.has(token);
  };

  for (let i = 0; i < tokens.length; i++) {
    const term = tokens[i];
    if (term === undefined || !AMBIGUOUS_TERMS.has(term)) continue;

    // Forward: 'merge the two remaining courses'. Any tokens may intervene,
    // so long as the object is close enough to plausibly be the term's.
    let bound = false;
    const forwardEnd = Math.min(tokens.length - 1, i + CLOSURE_POLICY.forwardWindow);
    for (let j = i + 1; j <= forwardEnd; j++) {
      if (isObject(j)) {
        bound = true;
        break;
      }
    }

    // Passive: 'the course should be merged'. Only auxiliary glue may
    // intervene — 'a module on suspended solids' has the identical
    // object-then-term shape and must not match.
    if (!bound) {
      for (let back = 1; back <= CLOSURE_POLICY.passiveWindow + 1 && i - back >= 0; back++) {
        const k = i - back;
        if (!isObject(k)) continue;
        if (tokens.slice(k + 1, i).every((t) => PASSIVE_GLUE.has(t))) bound = true;
        break;
      }
    }

    if (bound) hits.add(term);
  }
}

export interface RunCurriculumRevisionParams {
  programId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
}

export type CurriculumRevisionOutcome =
  | {
      status: 'SUCCEEDED';
      readiness: CurriculumRevisionReadiness;
      rowId: string;
      aiInferenceId: string | null;
      /** The PERSISTED confidence — i.e. after the deterministic ceiling
       *  clamp, never the model's raw self-report if it exceeded it. */
      confidence: number;
      confidenceClamped: boolean;
      /** True when the first draft tripped the banned-tell or closure-term
       *  lint and a corrective retry was issued (regardless of whether the
       *  retry itself came back clean). */
      lintRetried: boolean;
      drops: CurriculumRevisionDrops;
      /** Counts of what SURVIVED validation — what a reader will actually
       *  see — not what the model produced. */
      enhanceCount: number;
      newCourseCount: number;
      promotionCount: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
    }
  | { status: 'SKIPPED'; reason: string; readiness: CurriculumRevisionReadiness | null }
  | { status: 'FAILED'; reason: string };

/**
 * Joins the payload's model-authored free text into one string for linting:
 * the coverage narrative, every recommendation's prose across all three
 * lanes, the proposed course titles, and the caveats. HARD CONSTRAINT 5 says
 * the closure ban applies IN ANY FIELD, so the titles are in scope — a
 * proposal titled "Consolidated Data Structures" is a title the model wrote.
 *
 * `currentlyCoversQuote` is deliberately NOT linted: it is a verbatim
 * quotation of the curriculum document's own Thai, so a violation there
 * would be a property of KKU's source text rather than of anything the model
 * chose to say. Linting it would make the gate fire on the university's
 * existing course descriptions and force a rewrite the model cannot perform
 * without breaking the verbatim requirement.
 *
 * NAMED FOR THIS MODULE, not `buildLintableText`: program-research-expertise-run.ts
 * already exports that name and packages/db/src/index.ts re-exports both
 * modules with `export *`. A duplicate name across two star-exports is
 * ambiguous, and TypeScript resolves that by silently exporting NEITHER —
 * which would have quietly removed the sibling's helper from the @kku/db
 * barrel rather than failing the build.
 *
 * Deliberately a pure function over a minimal structural shape (not the full
 * Zod-inferred type) so it is trivially unit-testable without constructing a
 * complete schema-valid payload.
 */
export function buildCurriculumRevisionLintableText(payload: {
  coverageSummary: { narrative: string };
  enhanceCourses: Array<{ addition: string; additionDetail: string }>;
  newCourseProposals: Array<{ titleTh: string; titleEn: string; rationale: string }>;
  promotionCandidates: Array<{ rationale: string }>;
  caveats: string[];
}): string {
  return [
    payload.coverageSummary.narrative,
    ...payload.enhanceCourses.flatMap((e) => [e.addition, e.additionDetail]),
    ...payload.newCourseProposals.flatMap((n) => [n.titleTh, n.titleEn, n.rationale]),
    ...payload.promotionCandidates.map((p) => p.rationale),
    ...payload.caveats,
  ].join('\n');
}

/**
 * Every phrase that must force a rewrite: the shared banned-AI-tell list plus
 * this feature's course-closure policy gate.
 *
 * One function so the pre-retry check and the post-retry check apply the SAME
 * rule. Linting only the tells on the retry would let a draft that swapped a
 * tell for "discontinue this course" through to Council unremarked — the
 * quieter and more damaging of the two failures.
 */
export function collectCurriculumRevisionViolations(text: string): Array<{ phrase: string }> {
  return [
    ...lintBannedTells(text).map((v) => ({ phrase: v.phrase })),
    ...findClosureViolations(text).map((phrase) => ({ phrase })),
  ];
}

export async function generateProgramCurriculumRevision(
  params: RunCurriculumRevisionParams,
): Promise<CurriculumRevisionOutcome> {
  const assembled = await assembleCurriculumRevisionInput(params.programId);
  if (!assembled) {
    return { status: 'SKIPPED', reason: `program not found: ${params.programId}`, readiness: null };
  }

  // Zero AI calls, nothing stored. Readiness is computed inline at the end of
  // assembleCurriculumRevisionInput() in program-curriculum-revision.ts. A
  // program with no research themes has nothing to reason from, and one with
  // no course rows has nothing to reason about; spending a call to say so
  // would be pure waste.
  if (assembled.readiness === 'no-research' || assembled.readiness === 'no-courses') {
    return { status: 'SKIPPED', reason: assembled.readiness, readiness: assembled.readiness };
  }

  const messages = buildProgramCurriculumRevisionMessages(assembled.input);
  const extractionParams = {
    ctx: {
      module: 'programs',
      kind: 'program-curriculum-revision',
      userId: params.triggeredByUserId ?? null,
      traceId: `curriculum-revision-${params.programId}`,
    },
    methodVersion: PROGRAM_CURRICULUM_REVISION_VERSION,
    // Same 50000 convention as program-research-expertise-run.ts and every
    // other structured-extraction runner here — see the 2026-05-13
    // program-digest/run.ts note (4096 → 50000: thinking-mode output was
    // getting truncated mid-JSON at the old budget).
    maxOutputTokens: 50000,
  };

  let response: ExtractionResponse<ProgramCurriculumRevision>;
  try {
    response = await extractStructuredWithParseRetry(
      params.ai,
      { ...extractionParams, messages },
      ProgramCurriculumRevisionSchema,
      'program-curriculum-revision',
    );
  } catch (err) {
    return { status: 'FAILED', reason: err instanceof Error ? err.message : String(err) };
  }

  // Banned-tell lint (docs/prompt-standard.md `## Banned AI tells`) PLUS the
  // course-closure policy gate — one corrective retry, then persist-and-warn
  // (same posture as program-research-expertise-run.ts).
  //
  // The closure ban is enforced here rather than trusted to the prompt
  // because recommending that a course be retired/merged/closed affects staff
  // livelihoods, and research volume is the wrong basis for that judgement.
  // The spec forbids it outright, so a violation must force a rewrite exactly
  // the way a banned tell does. Two of the banned words (merge, sunset) are
  // this product's own scenario-planner intervention names, which is exactly
  // why a model steeped in the codebase might reach for them here.
  let lintRetried = false;
  const violations = collectCurriculumRevisionViolations(
    buildCurriculumRevisionLintableText(response.parsed),
  );
  if (violations.length > 0) {
    lintRetried = true;
    const correctionMessages = [
      ...messages,
      { role: 'assistant' as const, content: response.rawText },
      {
        role: 'user' as const,
        content: `Your draft used banned phrase(s): ${violations
          .map((v) => `"${v.phrase}"`)
          .join(', ')}. Rewrite the ENTIRE response without any of these words or their close paraphrases — keep the same structure and grounding rules. Return the corrected JSON in the same format as before.`,
      },
    ];
    // A failed retry keeps the ORIGINAL draft rather than failing the run: the
    // first draft is schema-valid and about to be validated for fabrication
    // anyway, so discarding it over a second-call transport error would throw
    // away good work. The violation is logged either way.
    try {
      const retry = await extractStructuredWithParseRetry(
        params.ai,
        { ...extractionParams, messages: correctionMessages },
        ProgramCurriculumRevisionSchema,
        'program-curriculum-revision',
      );
      const stillViolating = collectCurriculumRevisionViolations(
        buildCurriculumRevisionLintableText(retry.parsed),
      );
      if (stillViolating.length > 0) {
        console.warn(
          `[program-curriculum-revision] lint still failing after retry for program ${params.programId}: ${stillViolating.map((v) => v.phrase).join(', ')}`,
        );
      }
      response = retry;
    } catch (err) {
      console.warn(
        `[program-curriculum-revision] lint-retry failed for program ${params.programId}, keeping original: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Anti-fabrication gate — the reason this feature can be trusted, and the
  // reason it runs BEFORE the clamp and the derived counts below: everything
  // downstream must be computed from what SURVIVES, never from the raw draft.
  const { payload: validated, drops } = validateCurriculumRevisionPayload(response.parsed, {
    validCourseCodes: new Set(assembled.input.courses.map((c) => c.courseCode)),
    // courseCode → category, so promotion advice can be held to the
    // MAJOR_ELECTIVE rule the prompt states but cannot enforce.
    categoryByCourseCode: new Map(assembled.input.courses.map((c) => [c.courseCode, c.category])),
    validThemeNames: new Set(assembled.input.themes.map((t) => t.name)),
    descriptionByCourseCode: new Map(
      assembled.input.courses.map((c) => [c.courseCode, c.descriptionTh]),
    ),
    // Every paper title the model was actually shown. An evidence title
    // outside this set was invented — and it is the citation a reader would
    // follow to check the recommendation.
    validPaperTitles: new Set(assembled.input.themes.flatMap((t) => t.exampleTitles)),
    // Roster names AND ranks the model was shown. A proposal naming someone
    // outside this set — or inflating a real lecturer to professor — makes an
    // unsupported claim about a real individual in front of a University
    // Council. Name and rank are checked together for that reason.
    validRosterRanks: new Map(assembled.input.roster.map((r) => [r.name, r.rank])),
  });

  // Two counters, because they mean different things to whoever reads the log:
  // a dropped ITEM is a recommendation that vanished, while a dropped
  // sub-claim (a fabricated citation, an invented co-teacher, a paraphrased
  // quote) leaves the recommendation standing but hollows out its evidence.
  // Both are prompt-quality signals and neither should be inferable only by
  // parsing the JSON blob, so the headline numbers are stated.
  const itemsDropped =
    drops.enhanceCoursesDropped + drops.newCourseProposalsDropped + drops.promotionCandidatesDropped;
  const subClaimsDropped =
    drops.themeRefsDropped +
    drops.evidenceTitlesDropped +
    drops.rosterNamesDropped +
    drops.quotesBlanked;
  if (itemsDropped > 0 || subClaimsDropped > 0) {
    console.warn(
      `[program-curriculum-revision] dropped ${itemsDropped} unfounded item(s) and ${subClaimsDropped} unfounded sub-claim(s) for program ${params.programId}: ${JSON.stringify(drops)}`,
    );
  }

  // Deterministic confidence ceiling (docs/prompt-standard.md `## Confidence
  // rubric`) — the model's self-report is a floor-signal only. Same scale as
  // the research section, deliberately: identical evidence, identical grade.
  const ceiling = researchExpertiseConfidenceCeiling(
    assembled.readiness === 'thin' ? 'thin' : 'ok',
    assembled.stats.totalDistinctPapers,
  );
  let confidence = validated.confidence;
  let confidenceClamped = false;
  if (confidence > ceiling) {
    confidenceClamped = true;
    console.warn(
      `[program-curriculum-revision] confidence clamped for program ${params.programId}: reported=${confidence} ceiling=${ceiling} (readiness=${assembled.readiness}, totalDistinct=${assembled.stats.totalDistinctPapers})`,
    );
    confidence = ceiling;
  }

  // themesTotal is trivially computable from the input, so do not let the
  // model report it — a Council-facing count that contradicts the evidence
  // block beside it destroys trust in the whole section. themesReflected is
  // derived the same way: total minus the themes that have no course home.
  //
  // Derived from `validated`, NOT from `response.parsed`: themesAbsent has
  // already had invented theme names filtered out of it, and counting the
  // unfiltered list would report a coverage figure computed from names the
  // runner itself just rejected.
  //
  // DEDUPED FIRST, and the deduped list is what gets persisted, so the count
  // and the rendered list agree. A repeated name does not just risk a
  // negative count — it silently UNDERSTATES coverage: three themes with one
  // absent name listed twice would report 1 reflected instead of 2. With the
  // list deduped and already restricted to real theme names, the subtraction
  // cannot go negative, so no clamp is needed to hide the arithmetic.
  const themesAbsent = [...new Set(validated.coverageSummary.themesAbsent)];
  const themesTotal = assembled.input.themes.length;
  const themesReflectedInCurriculum = themesTotal - themesAbsent.length;

  // Persist the POST-validation, POST-clamp payload — a Council-facing reader
  // must never see a claim the runner itself rejected.
  const payload = {
    ...validated,
    coverageSummary: {
      ...validated.coverageSummary,
      themesAbsent,
      themesTotal,
      themesReflectedInCurriculum,
    },
    confidence,
  };

  // Provenance: which curriculum revision produced this row. NULL is the
  // pre-feature baseline. See packages/db/src/program-revision.ts.
  const programRevisionId = await activeRevisionIdFor(params.programId);

  const created = await prisma.programCurriculumRevision.create({
    data: {
      programId: params.programId,
      programRevisionId,
      payloadJson: payload,
      // Spread (not a bare `assembled.stats`) — the stats type is a named
      // interface, and Prisma's JSON input type requires an explicit index
      // signature to accept one directly; a fresh object literal satisfies it
      // structurally without a cast. The drop counts ride along so the
      // validator's verdict on this run stays auditable after the fact.
      inputStatsJson: { ...assembled.stats, drops: { ...drops } },
      methodVersion: PROGRAM_CURRICULUM_REVISION_VERSION,
      aiInferenceId: response.aiInferenceId,
    },
    select: { id: true, aiInferenceId: true },
  });

  return {
    status: 'SUCCEEDED',
    readiness: assembled.readiness,
    rowId: created.id,
    aiInferenceId: created.aiInferenceId,
    confidence,
    confidenceClamped,
    lintRetried,
    drops,
    enhanceCount: payload.enhanceCourses.length,
    newCourseCount: payload.newCourseProposals.length,
    promotionCount: payload.promotionCandidates.length,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
  };
}
