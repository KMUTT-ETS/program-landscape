// ─────────────────────────────────────────────────────────────────────────
// AI method catalog — admin-facing metadata for every AI prompt version
// in the system. Drives the /admin/app/ai-settings page (per-method model
// picker) and the GET /admin/ai-settings endpoint.
//
// Adding a new prompt? Add it here AND to the relevant *_VERSION export
// in packages/shared/src/ai/prompts/* so the runtime stamps match what
// admins see in the picker.
//
// `methodPrefix` MUST match `startsWith()` semantics against the runtime
// `methodVersion` (e.g. "program-pedagogy" matches "program-pedagogy.v1"
// and "program-pedagogy.v2" alike). Prefix → override is the dispatch
// contract — once an admin picks a model for "program-pedagogy", any
// future v-bump inherits the choice unless explicitly cleared.
// ─────────────────────────────────────────────────────────────────────────

import { JOB_FIELD_TAXONOMY_VERSION } from './prompts/job-field-taxonomy';
import { PROGRAM_JOB_FIELD_VERSION } from './prompts/program-job-field';
import { JOB108_ANNOUNCEMENT_VERSION } from './prompts/job108-announcement';

export type AiMethodTier =
  | 'reasoning' // Pro-class — needs reasoning, slow, expensive
  | 'extraction' // Structured PDF / text extraction
  | 'narrative' // Long-form generation
  | 'classification' // Short label / score generation
  | 'embedding'; // Vector embedding only

export interface AiMethodEntry {
  /** Prefix matched against the runtime methodVersion. */
  methodPrefix: string;
  /** Current pinned version — what the prompts/* file exports today. */
  currentVersion: string;
  /** Human label for the admin UI. */
  label: string;
  /** One-sentence description (admin-facing). */
  description: string;
  /** Which module surfaces this prompt. */
  module:
    | 'cockpit'
    | 'gap'
    | 'scenarios'
    | 'decisions'
    | 'benchmarking'
    | 'analyst'
    | 'pipeline'
    | 'ingestion'
    | 'profile'
    | 'trends'
    | 'teaching';
  /** Workload tier — drives which models in the catalog make sense. */
  tier: AiMethodTier;
  /** Static MODEL_BY_METHOD_PREFIX default for this prefix (Google side). */
  defaultModel: string;
  /** When set, admin cannot override this method — runtime always uses
   *  this model. The /settings/ai picker is hidden for locked methods.
   *  Pre-existing DB overrides are silently ignored at runtime. Use this
   *  for methods that have a documented model-specific failure mode
   *  (e.g. program-courses-extract on Flash truncates deterministically). */
  lockedModel?: string;
  /** Why this method is locked (admin UI surfaces this text). */
  lockReason?: string;
}

export const AI_METHOD_CATALOG: AiMethodEntry[] = [
  // ── Program pipeline (heaviest cost cluster) ─────────────────────────
  {
    methodPrefix: 'program-digest',
    currentVersion: 'program-digest.v3',
    label: 'Program digest (PDF → structured)',
    description: 'Single-shot extraction of program metadata, courses, skills, and recruitment summary from curriculum PDF.',
    module: 'pipeline',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-faculty',
    currentVersion: 'program-faculty.v2',
    label: 'Program faculty extraction',
    description: 'Pulls academic staff roster from curriculum PDF (names, ranks, ORCID, areas).',
    module: 'pipeline',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-courses-extract',
    currentVersion: 'program-courses-extract.v4',
    label: 'Program courses (exhaustive)',
    description: 'Regex-anchored course-code extractor scoped to the รายวิชา section (3 หมวด). Distinct from program-digest — focused, complete course list. Was locked to Pro under v2/v2.2 (Flash truncated on the full-PDF + embedded-candidate-list prompt); v2.3 narrowed the input to a ~20KB slice and Flash now returns the same result ~2× faster. v4 also captures each course\'s หมวด grouping (category) from the section headings.',
    module: 'pipeline',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-skills-detailed',
    currentVersion: 'program-skills-detailed.v3',
    label: 'Program skills (per-course)',
    description: 'Per-course skill extraction with weight + verbatim evidence quote per skill.',
    module: 'pipeline',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-peer-review',
    currentVersion: 'program-peer-review.v2.1',
    label: 'Peer-comparative program review',
    description: 'Frank cross-program critique against peer institutions; curriculum modernity verdict.',
    module: 'pipeline',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-peer-selection',
    currentVersion: 'program-peer-selection.v2',
    label: 'Peer selection',
    description: 'Picks the 5 most-comparable peer programs from a candidate set.',
    module: 'pipeline',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'aunqa-criterion-narrative',
    currentVersion: 'aunqa-criterion-narrative.v1',
    label: 'AUN-QA criterion narrative',
    description:
      'Writes the per-criterion assessment narrative behind /teaching-learning/[id]. Programme-scoped, but NOT a programs-pipeline phase — it is generated from its own runner, which is why it sits under Teaching & learning rather than Program pipeline.',
    module: 'teaching',
    tier: 'narrative',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'trend-document-ingest',
    currentVersion: 'trend-document-ingest.v2',
    label: 'Trend document ingest',
    description:
      'Drafts a TrendSignal from an uploaded PDF or a pasted URL, then hands off to trend-signal-analysis for enrichment. Backs the "Add signal from document" flow on /admin/trend-documents.',
    module: 'trends',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'trend-signal-analysis',
    currentVersion: 'trend-signal-analysis.v4',
    label: 'Trend signal analysis',
    description:
      'Enriches a TrendSignal with affected programmes, per-programme job-position candidates (immediate vs emerging) and white-space initiatives KKU could launch. Runs for both monitor-sourced and document-sourced signals.',
    module: 'trends',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-research-expertise',
    currentVersion: 'program-research-expertise.v3',
    label: 'Program research expertise',
    description:
      "Maps the programme's teaching roster onto their published research — themes, depth and gaps — from the kku-publications mirror. Phase RE of the programme pipeline; the Research expertise section on /programs/[id] renders it, and phase CR derives its course-level advice from it, skipping entirely when this has not run.",
    module: 'pipeline',
    tier: 'narrative',
    // Display/health metadata only. pickModelForMethod() never reads
    // defaultModel — with no lockedModel, no override and an empty
    // MODEL_BY_METHOD_PREFIX, the call falls through to the provider's
    // DEFAULT_COMPLETION_MODEL, which is this same id. Adding this entry is
    // therefore behaviour-neutral; it exists so the method is pinnable on
    // /admin/app/ai-settings and visible to assessModelHealth(), neither of
    // which was true before 2026-09-07.
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-overlap-recommendation',
    currentVersion: 'program-overlap-recommendation.v2',
    label: 'Programme overlap recommendation',
    description:
      'Drafts the reasoning, distinctive features and next steps behind the rule-chosen actions for an overlapping pair of same-level programmes (program-overlap.v1). Phase OV of the programme pipeline and pnpm programs:overlap; never changes the action, may record a disagreement.',
    // The call's ctx.module is 'program-overlap', but AiMethodEntry.module is a
    // closed union of admin groupings with no such member; it runs as phase OV
    // of the programme pipeline, so 'pipeline' is the honest grouping.
    module: 'pipeline',
    tier: 'narrative',
    // Display/health metadata only — the runner passes no model, so the call
    // falls through to the provider default, which is this same id.
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-strategic-narrative',
    currentVersion: 'program-strategic-narrative.v1',
    label: 'Program strategic narrative',
    description: 'Council-grade strategic brief — official Thai format with disciplined drafting.',
    module: 'pipeline',
    tier: 'narrative',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-ai-readiness',
    currentVersion: 'program-ai-readiness.v4',
    label: 'Program AI readiness',
    description: 'Discipline-aware AI-readiness assessment + Shao et al. 2025 HAS / four-zone framework (per-discipline rubric grounded in worker preference + AI capability, not generic keyword count).',
    module: 'pipeline',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-pedagogy',
    currentVersion: 'program-pedagogy.v1.1',
    label: 'Program pedagogy',
    description: 'Reads PDF teaching/learning/QA narrative and scores against discipline best practice (PBL, internship, clinical, etc.).',
    module: 'pipeline',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-curriculum-revision',
    currentVersion: 'program-curriculum-revision.v1',
    label: 'Curriculum revision (course-level)',
    description: 'Turns the program\'s own research themes into course-level advice: which existing course to extend and with what, where a new course is warranted, and which elective merits promotion. Reasoning tier — the input is a full course list with Thai descriptions plus the research-theme set, and every claim must be anchored to a named course.',
    module: 'pipeline',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'risk-assessment',
    currentVersion: 'risk-assessment.v4',
    label: 'Risk assessment',
    description: 'Per-program risk indicators + recommended mitigation measures.',
    module: 'pipeline',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },

  // ── Cross-module AI surfaces ─────────────────────────────────────────
  {
    methodPrefix: 'gap-brief',
    currentVersion: 'gap-brief.v1',
    label: 'Gap map Council brief',
    description: 'Up to five findings over the demand-map rows on screen, plus what the data cannot tell.',
    module: 'gap',
    tier: 'narrative',
    defaultModel: 'gemini-3.5-flash',
  },
  // `gap-insights` (three modes over the seven-lens analyzer) was removed in
  // v1.9.7 along with its prompt module. An entry here for a prompt nobody
  // can run is worse than no entry: it offers a model to pin on
  // /admin/app/ai-settings for a method that never executes, and
  // assessModelHealth would report it as silently unused for ever.
  // `gap-brief` above is its replacement.
  {
    methodPrefix: 'scenario-insights',
    currentVersion: 'scenario-insights.v1',
    label: 'Scenario planner insights',
    description: '5 modes: suggest-assumptions / identify-risks / compare / devils-advocate / what-would-change.',
    module: 'scenarios',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'benchmarking-insights',
    currentVersion: 'benchmarking-insights.v1',
    label: 'Benchmarking insights',
    description: '4 modes: suggest-peers / curriculum-gap / distinctiveness / positioning-brief.',
    module: 'benchmarking',
    tier: 'narrative',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'outcome-review',
    currentVersion: 'outcome-review.v1',
    label: 'Decision outcome review',
    description: 'AI-generated post-decision outcome review (6mo / 1yr / 3yr horizons).',
    module: 'decisions',
    tier: 'reasoning',
    defaultModel: 'gemini-3.5-flash',
  },

  // ── Ingestion / classification (lighter workload) ────────────────────
  {
    methodPrefix: 'course-skills',
    currentVersion: 'course-skills.v2',
    label: 'Course → skill extraction',
    description: 'Maps a course description to its taxonomy skills (ai-jobs queue).',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'job-posting-skills',
    currentVersion: 'job-posting-skills.v2',
    label: 'Job posting → skill extraction',
    description: 'Maps a job posting to its taxonomy skills (labour-market path).',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'evaluation-question-translate',
    currentVersion: 'evaluation-question-translate.v2',
    label: 'Evaluation questions TH → EN',
    description: 'Translates the POWERBI.EVALUATE_INSTRUCTOR student-evaluation question catalog (Thai authoritative source) to English for the courtesy UI watermark. One batched call per catalog refresh; DEAN / ADMIN can override per row.',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'policy-doc',
    currentVersion: 'policy-doc.v2',
    label: 'Policy document analysis',
    description: 'Extracts narrative + topic tags + sector relevance from policy PDFs.',
    module: 'ingestion',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'pdf-classify',
    currentVersion: 'pdf-classify.v2',
    label: 'PDF classifier (intake)',
    description: 'Reads the first ~3 pages of an uploaded PDF and picks sourceCategory + language + confidence. Replaces the prior stub that silently dropped uploads into OTHER.',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'skill-name-normaliser',
    currentVersion: 'skill-name-normaliser.v2',
    label: 'Skill name normaliser',
    description: 'Resolves free-text skill names to the canonical taxonomy (low-stakes classification).',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'demand-match',
    currentVersion: 'demand-match.v3',
    label: 'Demand → skill match',
    description: 'Cross-references labour-market demand strings against the KKU skill taxonomy.',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'career-kmitl-mapping',
    currentVersion: 'career-kmitl-mapping.v2',
    label: 'KMITL career mapping',
    description: 'Maps KMITL skill-mapping careers to ISCO-08 + program affinity.',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'job-field-taxonomy',
    currentVersion: JOB_FIELD_TAXONOMY_VERSION,
    label: 'Job-field taxonomy',
    description: 'Clusters the free-text "field of study" strings on JobThai postings into canonical fields of study with Thai and English names. Runs after every JobThai batch upload; reviewed at /admin/job-fields.',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'program-job-field',
    currentVersion: PROGRAM_JOB_FIELD_VERSION,
    label: 'Programme → job-field assignment',
    description: 'Assigns up to three canonical fields of study to each KKU programme, for the programmes the name-match rule could not settle.',
    module: 'ingestion',
    tier: 'classification',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'job108-announcement',
    currentVersion: JOB108_ANNOUNCEMENT_VERSION,
    label: 'Job-108 announcement extraction',
    description: 'Extracts one or more positions (title, seats, salary, minimum education, fields of study) from a Thai government recruitment announcement page.',
    module: 'ingestion',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'imd-rankings',
    currentVersion: 'imd-rankings.v2',
    label: 'IMD rankings extract',
    description: 'Extracts country ranking rows from the annual IMD World Competitiveness PDF.',
    module: 'ingestion',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'graduate-employment-survey',
    currentVersion: 'graduate-employment-survey.v2',
    label: 'Graduate employment survey',
    description: 'Extracts structured outcomes from KKU graduate-employment-survey PDFs.',
    module: 'ingestion',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
  },

  // ── External AI search & synthesis (Phase 5) ─────────────────────────
  {
    methodPrefix: 'external-feed-summary',
    currentVersion: 'external-feed-summary.v2',
    label: 'External feed summary',
    description: 'Distils a fetched URL or search result into a TrendSignal payload (Phase-5 admin source catalog).',
    module: 'ingestion',
    tier: 'narrative',
    defaultModel: 'gemini-3.5-flash',
  },

  // ── Profile / analyst ────────────────────────────────────────────────
  {
    methodPrefix: 'expertise-narrative',
    currentVersion: 'expertise-narrative.v2',
    label: 'Profile expertise narrative',
    description: 'Per-user expertise blurb from education + publication titles (profile page).',
    module: 'profile',
    tier: 'narrative',
    defaultModel: 'gemini-3.5-flash',
  },
  {
    methodPrefix: 'analyst-system',
    currentVersion: 'analyst-system.v1',
    label: 'AI Analyst (tool-use)',
    description: 'Conversational analyst with 12 grounding tools. Uses Anthropic for tool-use.',
    module: 'analyst',
    tier: 'reasoning',
    defaultModel: 'claude-sonnet-4-6',
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Available models — the curated catalog admins can pick from. Keep this
// short on purpose: every entry here must be one we've QA'd against at
// least one prompt in the system. New entries land here AFTER a smoke run.
// ─────────────────────────────────────────────────────────────────────────

export type AiModelProvider = 'google' | 'anthropic';

export interface AiModelEntry {
  id: string;
  label: string;
  provider: AiModelProvider;
  tier: 'pro' | 'flash' | 'sonnet' | 'haiku' | 'opus';
  description: string;
  /** USD per 1M input tokens. */
  costInputPer1m: number;
  /** USD per 1M output tokens. */
  costOutputPer1m: number;
  /** True when this model should NOT be the default pick for new methods. */
  legacy?: boolean;
  /** True when the provider has announced retirement, or we have observed it
   *  stop working. Hand-maintained: no provider exposes a model-lifecycle API,
   *  and building machinery around data nobody updates is worse than a flag
   *  someone edits when they read a deprecation notice. Surfaces as a
   *  `deprecated` verdict in assessModelHealth(). */
  deprecated?: boolean;
  /** Operator-facing sentence shown beside the warning, e.g. "Retired by
   *  Google on 2026-11-01; use gemini-3.5-flash." */
  deprecatedNote?: string;
}

export const AVAILABLE_AI_MODELS: AiModelEntry[] = [
  // ── Google Gemini ────────────────────────────────────────────────────
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (preview)',
    provider: 'google',
    tier: 'pro',
    description: 'Pro tier — strongest reasoning, slowest, ~$1.25/$10 per 1M tokens. Pin per-method here for a high-stakes prompt that warrants Pro over the gemini-3.5-flash default.',
    costInputPer1m: 1.25,
    costOutputPer1m: 10,
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'google',
    tier: 'pro',
    description: 'Pro tier with stable thoughtSignature support — preferred for analyst tool-use loops.',
    costInputPer1m: 1.25,
    costOutputPer1m: 10,
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    provider: 'google',
    tier: 'flash',
    description: 'Universal default for every method — premium Flash tier, fast, strong structured output, low truncation risk. Priced well above legacy Flash (~$1.50/$9.00 per 1M tokens), close to Pro.',
    costInputPer1m: 1.5,
    costOutputPer1m: 9,
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'google',
    tier: 'flash',
    description: 'Flash tier — fast, cheap (~$0.075/$0.30 per 1M tokens). Use for classification / normalisation. Truncation risk on >400-token outputs.',
    costInputPer1m: 0.075,
    costOutputPer1m: 0.3,
    legacy: true,
  },
  {
    id: 'gemini-flash-latest',
    label: 'Gemini Flash (latest)',
    provider: 'google',
    tier: 'flash',
    description: 'Latest Flash alias — same pricing as 2.5 Flash but may track ahead of stable.',
    costInputPer1m: 0.075,
    costOutputPer1m: 0.3,
    legacy: true,
  },

  // ── Anthropic Claude ─────────────────────────────────────────────────
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    provider: 'anthropic',
    tier: 'opus',
    description: 'Most capable Claude — best for nuanced narrative + critique. Most expensive.',
    costInputPer1m: 15,
    costOutputPer1m: 75,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    tier: 'sonnet',
    description: 'Mid-tier Claude — strong tool-use support. Default for the AI Analyst.',
    costInputPer1m: 3,
    costOutputPer1m: 15,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    tier: 'haiku',
    description: 'Fastest, cheapest Claude — fine for classification / short summaries.',
    costInputPer1m: 1,
    costOutputPer1m: 5,
  },
];

export function findAiMethodEntry(prefix: string): AiMethodEntry | undefined {
  return AI_METHOD_CATALOG.find((e) => e.methodPrefix === prefix);
}

export function findAiModelEntry(id: string): AiModelEntry | undefined {
  return AVAILABLE_AI_MODELS.find((m) => m.id === id);
}
