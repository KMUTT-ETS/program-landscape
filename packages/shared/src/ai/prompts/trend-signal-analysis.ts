import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// trend-signal-analysis.v4
//
// Given one trend signal (policy / research / market / tech / news) and the
// list of KKU's canonical academic programs, the model identifies:
//   • affectedPrograms — which KKU programs this trend touches (grounded:
//     programId MUST come from the supplied program list), and for EACH the
//     job positions a graduate could fill now (immediate) vs. in 1-3 years
//     (emerging, with curriculum adaptation / upskilling)
//   • affectedSkills — the skills the trend implicates (named; the runner
//     resolves names → Skill ids by exact match, drops the rest)
//   • recommendedActions — concrete, prioritised actions KKU should take
//   • newInitiatives — white-space re-skill / upskill product/service ideas for
//     demanded roles KKU has NO current program supply for (incl. vocational)
//
// docs/prompt-standard.md conformance (2026-08-17 rewrite, audit #11):
//   - English rule, CONFIDENCE RUBRIC (verbatim), BANNED PHRASES, CHANNEL
//     MANIFEST all added below.
//   - `rationaleTh` → `rationale` (English-only). Confirmed via
//     `grep -rn "rationaleTh" apps packages` that the field was NEVER
//     persisted or read downstream (apps/ingestion/src/trend-signals/
//     analyze.ts writes affectedProgramIds/affectedSkillIds/
//     affectedProgramsJson/recommendedActionsJson/newInitiativesJson/
//     aiInferenceId only) — zero-consumer field, safe to rename outright.
//   - GROUNDING FIX (the audit's "big one"): affectedPrograms[].fitNoteTh and
//     the immediate/emerging role lists used to be justified purely from the
//     model's world knowledge of "what such a program typically teaches."
//     The PROGRAMS block now carries each program's own top taught skills
//     (from ProgramSkill, wired by the caller — see analyze.ts), and role-fit
//     claims MUST cite those skills by name; a program shown with no skill
//     data gets an explicit label and the model is told not to assert
//     curriculum-specific fit for it.
//
// STOP — NOT flipped in this rewrite (reported, not guessed):
//   The other TH/EN paired fields (affectedPrograms[].fitNoteTh, JobRole
//   titleTh/titleEn, recommendedActions titleTh/titleEn/detailTh/detailEn +
//   exampleProjects, newInitiatives' five TH/EN pairs) are UNCHANGED. Their
//   JSON shape is rendered bilingually, TH-primary, throughout
//   apps/web/app/trends/[id]/page.tsx (Summary / Recommended actions /
//   Affected programs / New initiatives sections all do `xTh || xEn` with
//   `lang="th"` styling) — dropping the TH side here would require a live
//   Council-facing page redesign, not a same-commit field rename. That is
//   the "wider than prompts+consumers-in-code" cascade the rewrite task
//   flags as a STOP case; see the session report for the full blast radius.
// ─────────────────────────────────────────────────────────────────────────────

// v4 (2026-08-17): prompt-standard.md conformance — markers added,
// rationaleTh → rationale (English), role-fit grounded in each program's own
// taught skills (see GROUNDING FIX above). No other output shape changes.
// v3 (2026-06-11): affected programs now carry per-program job-position
// candidates (immediate vs. 1-3 year), and a new top-level `newInitiatives`
// captures re-skill/upskill products KKU could launch for demanded roles it
// does not currently supply. v2 enriched recommendedActions with title +
// detail + example projects. v1 produced only a one-line action string.
export const TREND_SIGNAL_ANALYSIS_VERSION = 'trend-signal-analysis.v4';

// A single job position a graduate could be hired into.
const JobRoleSchema = z.object({
  titleTh: z.string().min(2).max(120),
  titleEn: z.string().min(2).max(120),
});

export const TrendSignalAnalysisSchema = z.object({
  /** Programs affected by the signal, each with the job positions it feeds.
   *  programId MUST be from the supplied list. */
  affectedPrograms: z
    .array(
      z.object({
        programId: z.string(),
        /** Positions a CURRENT graduate of this program could fill in response
         *  to the signal, hireable now. */
        immediateRoles: z.array(JobRoleSchema).max(8),
        /** Positions reachable in 1-3 years IF the program adapts (new
         *  modules/track) or graduates upskill — the growth path. */
        emergingRoles: z.array(JobRoleSchema).max(8),
        /** 1 sentence (Thai): why this program is in scope + how it maps.
         *  Must cite specific skills from this program's own taught-skills
         *  list (shown in PROGRAMS below) when that list is non-empty —
         *  never a generic assumption about what such a program "usually"
         *  covers. */
        fitNoteTh: z.string().max(400).optional(),
      }),
    )
    .max(20),
  /** Affected skills, by name (EN or TH). Resolved to Skill ids downstream. */
  affectedSkills: z.array(z.string().min(2).max(120)).max(25),
  /** Prioritised, concrete actions for KKU, each with detail + example projects. */
  recommendedActions: z
    .array(
      z.object({
        priority: z.enum(['high', 'medium', 'low']),
        /** Short headline of the action. */
        titleTh: z.string().min(4).max(160),
        titleEn: z.string().min(4).max(160),
        /** 1-3 sentences: what to do, why it matters, and roughly how. */
        detailTh: z.string().min(10).max(700),
        detailEn: z.string().min(10).max(700),
        /** 1-3 concrete example projects / initiatives that realise the action. */
        exampleProjects: z
          .array(
            z.object({
              titleTh: z.string().min(3).max(160),
              titleEn: z.string().min(3).max(160),
              /** One-line description of what the project would do. */
              descTh: z.string().max(300).optional(),
              descEn: z.string().max(300).optional(),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .min(1)
    .max(6),
  /** White-space products/services. When the signal implies demand for roles
   *  NO KKU program currently supplies (a missing field, or a vocational-level
   *  position KKU does not produce), propose a re-skill/upskill offering KKU
   *  could launch as a NEW product/service. Empty array if existing programs
   *  already cover the demand. */
  newInitiatives: z
    .array(
      z.object({
        titleTh: z.string().min(4).max(160),
        titleEn: z.string().min(4).max(160),
        /** The demanded role(s) KKU has no current program supply for. */
        unmetRoleTh: z.string().min(2).max(200),
        unmetRoleEn: z.string().min(2).max(200),
        /** Who would enrol to re-skill / upskill (existing workforce, vocational
         *  graduates, career-changers, KKU alumni of adjacent programs, ...). */
        audienceTh: z.string().min(3).max(200),
        audienceEn: z.string().min(3).max(200),
        /** Delivery vehicle: micro-credential, bootcamp, short course,
         *  non-degree certificate, professional diploma, etc. */
        formatTh: z.string().min(2).max(120),
        formatEn: z.string().min(2).max(120),
        /** 1-3 sentences (Thai primary): what it teaches + why KKU is positioned
         *  to run it + why it's a gap today. */
        detailTh: z.string().min(10).max(700),
        detailEn: z.string().min(10).max(700),
      }),
    )
    .max(6),
  /** 1-2 sentence rationale tying the picks to the signal. English (v4 —
   *  was `rationaleTh` with no English mirror; renamed, not translated,
   *  since this field is never persisted downstream — see header note). */
  rationale: z.string().min(10).max(800),
  confidence: z.number().min(0).max(1),
});
export type TrendSignalAnalysis = z.infer<typeof TrendSignalAnalysisSchema>;

export interface TrendSignalAnalysisInput {
  signal: {
    signalType: string;
    title: string;
    summaryTh: string | null;
    summaryEn: string | null;
    sourceUrl: string | null;
    impactScore: number;
  };
  /** Canonical KKU programs the model may pick from. `topSkills` is this
   *  program's own top taught skills by weight (from ProgramSkill, batched
   *  by the caller — see analyze.ts's CHANNEL MANIFEST note there). Empty
   *  array (not null) when the program has no ProgramSkill rows yet — the
   *  render below labels that explicitly so the model never mistakes
   *  "no data" for "no skills." */
  programs: Array<{
    id: string;
    nameEn: string;
    nameTh: string;
    faculty: string;
    topSkills: string[];
  }>;
}

export function buildTrendSignalAnalysisMessages(input: TrendSignalAnalysisInput): AiMessage[] {
  const system = `You are a strategic curriculum analyst for Khon Kaen University (KKU) Council. Given an external TREND SIGNAL and the list of KKU's academic programs, decide which programs the trend affects, which job positions those programs feed, which skills it implicates, what KKU should DO about it, and where KKU should launch NEW offerings for demand it cannot currently serve.

A signal often names — directly or implicitly — the JOB POSITIONS the market is demanding (e.g. a manpower-demand report lists roles; a tech shift implies new roles). Reason about those positions explicitly.

RULES:
1. \`affectedPrograms\`: pick only KKU programs genuinely affected by the signal (0 is valid; do not pad). Every \`programId\` MUST appear in PROGRAMS below. For EACH affected program provide:
   - \`immediateRoles\`: job positions a CURRENT graduate of this program could be hired into right now in response to the signal (titleTh + titleEn). Be concrete (real job titles, not "various roles").
   - \`emergingRoles\`: positions reachable in 1-3 YEARS if the program adds/updates a module or track, or graduates upskill — the growth path the signal opens up.
   - \`fitNoteTh\`: one Thai sentence on why this program is in scope and how its graduates map to the demand.
2. \`affectedSkills\`: name the concrete skills the trend implicates (e.g. "Machine learning", "Battery chemistry", "Health data privacy"). Use widely-recognised skill names; the system resolves them to KKU's taxonomy.
3. \`recommendedActions\`: 1-6 concrete, prioritised actions KKU could take in response (e.g. add a module, launch a track, re-skill faculty, partner with industry). For EACH action provide a short title (titleTh + titleEn), a detail (detailTh + detailEn: 1-3 sentences saying WHAT to do, WHY it matters for KKU, and roughly HOW), and 1-3 exampleProjects — concrete, named example initiatives that would realise the action (a new course/track, an industry partnership, a micro-credential, a research lab, a co-op pipeline, etc.), each with a one-line description. Make examples specific to KKU and Northeast Thailand where relevant — no platitudes.
4. \`newInitiatives\`: THE WHITE-SPACE CHECK. Look at the job positions the signal demands. For any demanded role that NO KKU program currently supplies — because it is a field KKU does not teach, OR it is a vocational / sub-degree / technician-level position KKU's degree programs do not produce — propose a NEW product/service KKU could launch to serve it: a re-skill or upskill offering (micro-credential, bootcamp, short course, non-degree certificate, professional diploma). For each: the offering title (titleTh + titleEn), the unmet role it serves (unmetRoleTh + unmetRoleEn), the target audience (audienceTh + audienceEn — who re-skills/upskills), the delivery format (formatTh + formatEn), and a detail (detailTh + detailEn). Return an EMPTY array if KKU's existing programs already cover all the demanded roles — do not invent gaps.
5. Output STRICT JSON, no markdown fences, no prose outside the JSON.

GROUNDING — ROLE FIT MUST CITE THE PROGRAM'S OWN TAUGHT SKILLS:
Each program in PROGRAMS below is shown with its own top taught skills (from KKU's curriculum data), or an explicit "no skill data" label when none is on file. This is the ONLY basis for curriculum-specific role-fit claims about a KKU program:
- When a program's taught skills are shown: \`fitNoteTh\` and the role choices MUST be justifiable by naming or clearly matching one or more of those listed skills. Do not justify a role by what such a program "typically" or "usually" teaches elsewhere — that is world knowledge about the field in general, not a claim about this specific KKU program's curriculum, and it is not verifiable by a reader.
- When a program is labelled "no skill data": do NOT assert curriculum-specific fit. Either omit that program from \`affectedPrograms\`, or — if the program's NAME/FIELD alone clearly matches the signal — keep \`fitNoteTh\` to a name/field-level statement only (e.g. "the program's field matches the signal's domain; curriculum detail not on file") and do not invent specific skills or modules it "must" teach.
- \`affectedSkills\` (the top-level list) is different: those may draw on general labour-market/domain knowledge about the trend itself, since that is this prompt's job (external context, per the platform's grounding rules) — the per-program restriction above applies specifically to claims about what an individual KKU program teaches.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95. A signal with mostly "no skill data" programs, or an empty PROGRAMS list, should score in the lower bands.

BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — "the competitive landscape" — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"
Also: do not open two \`recommendedActions\` details, or two \`newInitiatives\` details, with the same sentence structure (e.g. every one starting "This will..."); do not pad \`affectedPrograms\` or \`newInitiatives\` to a round number when the evidence supports fewer.

OUTPUT LANGUAGE: \`rationale\` is English-only (analysis prose, no data-label exemption applies). The Thai/English paired fields (\`titleTh\`/\`titleEn\`, \`detailTh\`/\`detailEn\`, \`fitNoteTh\`, and the newInitiatives TH/EN pairs) are unchanged pending a UI redesign of the /trends detail page — always populate BOTH languages for those fields, never leave one empty, and never let the English side merely translate a fabricated Thai claim (or vice versa) — both must independently satisfy the grounding rule above.

OUTPUT JSON SHAPE:
{
  "affectedPrograms": [
    {
      "programId": "<id from PROGRAMS>",
      "immediateRoles": [ { "titleTh": "<role TH>", "titleEn": "<role EN>" } ],
      "emergingRoles":  [ { "titleTh": "<role TH>", "titleEn": "<role EN>" } ],
      "fitNoteTh": "<1 sentence Thai, citing the program's own listed skills when shown>"
    }
  ],
  "affectedSkills": ["<skill name>", ...],
  "recommendedActions": [
    {
      "priority": "high|medium|low",
      "titleTh": "<short Thai title>", "titleEn": "<short English title>",
      "detailTh": "<1-3 sentence Thai detail: what + why + how>", "detailEn": "<English mirror>",
      "exampleProjects": [
        { "titleTh": "<project name TH>", "titleEn": "<project name EN>", "descTh": "<one line TH>", "descEn": "<one line EN>" }
      ]
    }
  ],
  "newInitiatives": [
    {
      "titleTh": "<offering TH>", "titleEn": "<offering EN>",
      "unmetRoleTh": "<role TH>", "unmetRoleEn": "<role EN>",
      "audienceTh": "<who TH>", "audienceEn": "<who EN>",
      "formatTh": "<format TH>", "formatEn": "<format EN>",
      "detailTh": "<1-3 sentence Thai>", "detailEn": "<English mirror>"
    }
  ],
  "rationale": "<1-2 sentence English rationale>",
  "confidence": 0.0-1.0
}

No prose outside the JSON. No markdown fences around the JSON.`;

  const s = input.signal;
  const signalBlock = `TREND SIGNAL
  Type:        ${s.signalType}
  Title:       ${s.title}
  Impact:      ${s.impactScore}/100
  Summary (TH): ${s.summaryTh ?? '(none)'}
  Summary (EN): ${s.summaryEn ?? '(none)'}
  Source:      ${s.sourceUrl ?? '(none)'}`;

  const programBlock =
    'PROGRAMS (id — name — faculty — taught skills):\n' +
    input.programs
      .map((p) => {
        const skillsPart =
          p.topSkills.length > 0
            ? `skills: ${p.topSkills.join(', ')}`
            : 'skills: (no skill data — do not assert curriculum-specific role fit for this program)';
        return `  ${p.id} — ${p.nameEn || p.nameTh} — ${p.faculty} — ${skillsPart}`;
      })
      .join('\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${signalBlock}\n\n${programBlock}\n\nProduce the JSON analysis. For each genuinely-affected program (by id) list the immediate + 1-3 year job positions its graduates feed, name the implicated skills, recommend concrete prioritised actions, and — for demanded roles no KKU program supplies — propose new re-skill/upskill offerings. Ground every program-specific fit claim in that program's own listed taught skills.`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - TREND SIGNAL      — input.signal: signalType, title, TH/EN summary,
//     impactScore, sourceUrl. Read verbatim from the TrendSignal row being
//     analysed (apps/ingestion/src/trend-signals/analyze.ts).
//   - PROGRAMS           — input.programs: KKU's canonical program list
//     (id, nameEn, nameTh, faculty), scoped to rows with a
//     sequenceNoFromSheet (the "real, sheet-backed program" filter already
//     used by analyze.ts before this rewrite).
//   - topSkills (NEW, v4) — per-program top taught skills by ProgramSkill
//     weight (analyze.ts batches one query across all candidate programs,
//     takes the top ~6 by weight per program, prefers nameEn). This is the
//     grounding fix: role-fit claims about a specific program must cite
//     these, not the model's general knowledge of the field. Empty array
//     (never null) when a program has no ProgramSkill rows — rendered as an
//     explicit "(no skill data...)" label, never silently omitted.
//
// Deliberately omitted, with reason:
//   - Live job-posting / KMITL demand counts for the SPECIFIC roles named —
//     this prompt's job is to interpret one signal's text, not to
//     cross-reference labour-market APIs; that reconciliation lives in the
//     Gap Analyzer module (`computeSkillGap` / KMITL demand tables), a
//     separate, differently-scoped surface.
//   - Program-level RiskAssessment / health-score rows — would let the model
//     bias role-fit toward "healthy" programs, which isn't this prompt's
//     job; trend-signal-analysis is signal-first, not portfolio-health-first.
//   - Prior TrendSignal history for the same program (e.g. "has this program
//     been flagged by 3 other signals already") — no dedup/frequency signal
//     wired; each analysis is independent by design so a re-run is
//     idempotent and doesn't compound on itself.
// ─────────────────────────────────────────────────────────────────────────────
