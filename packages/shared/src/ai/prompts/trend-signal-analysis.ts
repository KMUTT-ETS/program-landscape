import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// trend-signal-analysis
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
// Thai-primary content (per the language strategy) with English mirror.
// ─────────────────────────────────────────────────────────────────────────────

// v3 (2026-06-11): affected programs now carry per-program job-position
// candidates (immediate vs. 1-3 year), and a new top-level `newInitiatives`
// captures re-skill/upskill products KKU could launch for demanded roles it
// does not currently supply. v2 enriched recommendedActions with title +
// detail + example projects. v1 produced only a one-line action string.
export const TREND_SIGNAL_ANALYSIS_VERSION = 'trend-signal-analysis.v3';

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
        /** 1 sentence (Thai): why this program is in scope + how it maps. */
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
  /** 1-2 sentence Thai rationale tying the picks to the signal. */
  rationaleTh: z.string().min(10).max(800),
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
  /** Canonical KKU programs the model may pick from. */
  programs: Array<{ id: string; nameEn: string; nameTh: string; faculty: string }>;
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

OUTPUT JSON SHAPE:
{
  "affectedPrograms": [
    {
      "programId": "<id from PROGRAMS>",
      "immediateRoles": [ { "titleTh": "<role TH>", "titleEn": "<role EN>" } ],
      "emergingRoles":  [ { "titleTh": "<role TH>", "titleEn": "<role EN>" } ],
      "fitNoteTh": "<1 sentence Thai>"
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
  "rationaleTh": "<1-2 sentence Thai rationale>",
  "confidence": 0.0-1.0
}`;

  const s = input.signal;
  const signalBlock = `TREND SIGNAL
  Type:        ${s.signalType}
  Title:       ${s.title}
  Impact:      ${s.impactScore}/100
  Summary (TH): ${s.summaryTh ?? '(none)'}
  Summary (EN): ${s.summaryEn ?? '(none)'}
  Source:      ${s.sourceUrl ?? '(none)'}`;

  const programBlock =
    'PROGRAMS (id — name — faculty):\n' +
    input.programs.map((p) => `  ${p.id} — ${p.nameEn || p.nameTh} — ${p.faculty}`).join('\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${signalBlock}\n\n${programBlock}\n\nProduce the JSON analysis. For each genuinely-affected program (by id) list the immediate + 1-3 year job positions its graduates feed, name the implicated skills, recommend concrete prioritised actions, and — for demanded roles no KKU program supplies — propose new re-skill/upskill offerings.`,
    },
  ];
}
