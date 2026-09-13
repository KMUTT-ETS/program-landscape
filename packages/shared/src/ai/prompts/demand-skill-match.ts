import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// demand-match.v1
//
// Demand-driven curriculum match: for each labour-market demanded skill,
// search the program's PLOs + course descriptions + already-extracted
// taught-skill list to determine whether the curriculum teaches it
// (verbatim, semantically related, or not at all).
//
// This is the inverse of the supply-driven extraction. Where program-
// skills-detailed.v2 starts from the curriculum and pulls every skill,
// this prompt starts from the demand list and asks "which of these
// does the curriculum cover?" — catching skills that have a different
// surface name in PLOs/courses vs the demand taxonomy (synonyms,
// translation differences, related-but-not-identical concepts).
//
// Output per demanded skill:
//   - matched: true | false
//   - matchSource: 'plo' | 'course' | 'extracted-skill' | 'unmatched'
//   - relatedness: 0..1 (1.0 = explicit verbatim PLO match)
//   - evidenceQuote: verbatim text from where it was found
//
// v3 (2026-08-17, docs/prompt-standard.md conformance — mechanical
// TOUCH, audit #25): added CONFIDENCE RUBRIC (verbatim) + BANNED
// PHRASES + CHANNEL MANIFEST + explicit English rule. This prompt has
// no free-text analysis field beyond exempt verbatim/data-label fields
// (evidenceQuote, matchedTaughtSkillName, skillName) — no language
// change, markers only.
//
// v4 (2026-09-13): the RELEVANCE judgement becomes profession-aware.
// v3 asked one vague question — "would a graduate plausibly need this?" —
// and called "Electrical engineering" and "Industrial engineering" relevant
// gaps for Mechanical Engineering. Those are different professions. In the
// JobThai data such strings come almost entirely from qualification lines
// listing ACCEPTED degrees (41 of 45 mechanical-engineer postings tagged
// "Electrical engineering" mention it only there). v4 hands the model the
// programme's actual target careers and each skill's demand context, and
// asks for a closed-world FIT class with a one-line reason:
//   core | supporting | other-profession | not-relevant | uncertain.
// Relevance is DERIVED from fit (core/supporting) and no longer implied by
// matched: a Mechanical programme's electrical service course does not make
// "Electrical engineering" a skill its graduates are hired for.
// ─────────────────────────────────────────────────────────────────────────────

export const DEMAND_MATCH_VERSION = 'demand-match.v4';

export const DEMAND_SKILL_FITS = ['core', 'supporting', 'other-profession', 'not-relevant', 'uncertain'] as const;
export type DemandSkillFit = (typeof DEMAND_SKILL_FITS)[number];

/** Only these fits can be a gap or count toward a demand-match score. */
export function isRelevantFit(fit: DemandSkillFit): boolean {
  return fit === 'core' || fit === 'supporting';
}

export const DemandMatchEntrySchema = z.object({
  /** Skill.id from the demand list — used to update ProgramDemandMatch. */
  skillId: z.string(),
  /** The demanded skill's English label, for the AI's reference. */
  skillName: z.string(),
  /** TAUGHT — is this skill found in the program's PLOs / courses /
   *  extracted skills? */
  matched: z.boolean(),
  /** FIT — how this skill relates to the work this programme's graduates are
   *  hired for in its target careers. Independent of `matched`.
   *    core             — central to that work
   *    supporting       — routinely used on that job, not defining it
   *    other-profession — itself a different degree discipline or profession
   *    not-relevant     — belongs to careers outside the target set
   *    uncertain        — the input does not support a call (abstain) */
  fit: z.enum(DEMAND_SKILL_FITS),
  /** One English sentence naming the basis for the fit, ≤ 160 chars. */
  fitReason: z
    .union([z.string(), z.null()])
    .transform((v) => v ?? '')
    .default(''),
  /** Where the match was found. 'unmatched' when matched=false. */
  matchSource: z.enum(['plo', 'course', 'extracted-skill', 'unmatched']),
  relatedness: z.number().min(0).max(1),
  /** Verbatim quote from the matching PLO / course description /
   *  extracted-skill entry. Up to 200 chars. Empty when unmatched. */
  evidenceQuote: z
    .union([z.string(), z.null()])
    .transform((v) => v ?? '')
    .default(''),
  /** When matchSource='extracted-skill', the closest existing
   *  ProgramSkill name we matched to (for analyst cross-reference). */
  matchedTaughtSkillName: z
    .union([z.string(), z.null()])
    .transform((v) => v ?? '')
    .default(''),
});
export type DemandMatchEntry = z.infer<typeof DemandMatchEntrySchema>;

export const DemandMatchSchema = z.object({
  matches: z.array(DemandMatchEntrySchema),
  confidence: z.number().min(0).max(1),
});
export type DemandMatch = z.infer<typeof DemandMatchSchema>;

export interface DemandMatchInput {
  programDegree: string;
  /** English programme name — the discipline in its own words. */
  programDegreeEn: string;
  programLevel: string;
  programFaculty: string;
  /** The careers this programme's graduates are actually hired into. JobThai
   *  occupations come from the field of study postings ask for; LinkedIn
   *  careers from the programme's career mapping. Empty when neither exists. */
  targetCareers: Array<{ source: 'JobThai' | 'LinkedIn'; title: string; detail?: string }>;
  /** PLOs verbatim (Thai), captured by program-skills-detailed.v2. */
  programLearningOutcomes: string[];
  /** Course list with descriptions, captured by program-digest.v1. */
  courses: Array<{ code: string; nameTh: string; nameEn: string; descriptionTh: string }>;
  /** Skills the program already known to teach (with evidence). */
  extractedSkills: Array<{ nameTh: string; nameEn: string; evidence: string }>;
  /** Demanded skills to check, in priority order, with their demand context. */
  demandedSkills: Array<{
    skillId: string;
    nameEn: string;
    nameTh: string;
    sources: Array<'JobThai' | 'LinkedIn'>;
    /** % of the programme's linked JobThai postings naming it; null when LinkedIn-only. */
    demandPct: number | null;
    /** Occupation / career names the skill is demanded in (up to 3). */
    demandedIn: string[];
  }>;
}

export function buildDemandMatchMessages(input: DemandMatchInput): AiMessage[] {
  const system = `You judge labour-market skill demand against ONE university programme. For each demanded skill decide two independent things: whether the curriculum teaches it (matched) and how it fits the profession this programme prepares graduates for (fit).

STEP 1 — Pin down the profession before judging any skill.
From the degree name, PLOs, courses and [Target careers], settle what graduates of this programme are hired to do. The target careers are the ground truth for "the job"; the degree name tells you which discipline the graduate holds.

STEP 2 — fit, for every skill (closed set, pick exactly one):
- "core": central to the work these graduates are hired for in the target careers.
- "supporting": a tool, method or body of knowledge these graduates routinely use on those jobs without it defining the profession.
- "other-profession": the skill IS a different academic discipline, degree field or licensed profession from this programme's own.
- "not-relevant": belongs to careers outside the target careers.
- "uncertain": the input does not let you decide. Prefer this to a guess.

THE TRAP — read this before classifying any skill that names a discipline:
Job adverts list several acceptable degrees ("Bachelor's in Mechanical, Electrical or related engineering"). A skill list mined from adverts therefore contains OTHER disciplines that employers accept INSTEAD of this programme's graduates. That is evidence the job is shared between professions, NOT evidence that this programme's graduates must master the other discipline. A skill naming another degree field is "other-profession" unless this programme's own name or PLOs claim that discipline (e.g. a Mechatronics programme and electrical engineering), in which case judge it normally.

Worked examples (illustrative, not a lookup table):
- Mechanical Engineering programme; target careers mechanical / maintenance engineer:
  "Thermodynamics" core · "CAD / CAM" supporting · "Preventive Maintenance" supporting · "Electrical engineering" other-profession · "Industrial engineering" other-profession · "Digital marketing" not-relevant.
- Accountancy programme; target careers accounting / audit:
  "Auditing" core · "Tax Law" supporting · "Cash Flow Management" supporting · "Sales" not-relevant · "Law" other-profession.
- Law programme; target careers legal officer / litigation:
  "Litigation" core · "Corporate governance" supporting · "Accounting" other-profession.

STEP 3 — matched (independent of fit):
matched=true only when the PLOs, courses or extracted skills show the skill itself or a clear synonym / translation ("Renewable Energy" ↔ "พลังงานทดแทน"). An adjacent topic is not a match. A service course may make an other-profession skill matched=true; the fit stays other-profession.

Output STRICT JSON (no markdown):
{"matches":[{"skillId":"...","skillName":"...","matched":bool,"fit":"core|supporting|other-profession|not-relevant|uncertain","fitReason":"...","matchSource":"plo|course|extracted-skill|unmatched","relatedness":0..1,"evidenceQuote":"...","matchedTaughtSkillName":"..."}],"confidence":0..1}

Rules:
1. EVERY skillId in the input appears in the output exactly once. Never invent a skillId or a fit label.
2. fitReason: one English sentence, ≤160 characters, naming what the call rests on (the target career, the degree field, or the missing input). Required for every skill.
3. matchSource priority: extracted-skill > plo > course > unmatched. relatedness 1.0 / 0.9 / 0.7 / 0.2 respectively; unmatched when matched=false.
4. evidenceQuote: verbatim from the source (Thai if Thai), ≤200 chars. Empty when unmatched.
5. matchedTaughtSkillName: when matchSource is extracted-skill, the extracted skill's name exactly as listed; otherwise empty.
6. Knowledge of what professions do is permitted here as context for fit only. Never state a number that is not in the input.

LANGUAGE RULE (English-only free text): fitReason is the only prose field and is written in English. evidenceQuote is a verbatim quote in the source's own language (a structural extraction requirement); skillName and matchedTaughtSkillName are data labels.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases in any free text you produce):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  const ploBlock = input.programLearningOutcomes.length > 0
    ? input.programLearningOutcomes.map((p, i) => `PLO ${i + 1}: ${p}`).join('\n')
    : '(ไม่มี PLO ที่สกัดได้)';
  const coursesBlock = input.courses.length > 0
    ? input.courses
        .slice(0, 80) // cap at 80 courses to fit context window
        .map((c) => `${c.code} ${c.nameTh}${c.nameEn ? ` / ${c.nameEn}` : ''} — ${c.descriptionTh.slice(0, 200)}`)
        .join('\n')
    : '(ไม่มีคำอธิบายรายวิชา)';
  const extractedBlock = input.extractedSkills.length > 0
    ? input.extractedSkills
        .map((s) => `- ${s.nameTh}${s.nameEn ? ` / ${s.nameEn}` : ''}${s.evidence ? ` (evidence: ${s.evidence.slice(0, 100)})` : ''}`)
        .join('\n')
    : '(ไม่มี extracted skills)';
  const demandedBlock = input.demandedSkills
    .map((d) => {
      const name = `${d.nameEn || d.nameTh}${d.nameTh && d.nameEn ? ` / ${d.nameTh}` : ''}`;
      const ctx = [
        `sources: ${d.sources.join(', ')}`,
        d.demandPct !== null ? `${d.demandPct.toFixed(0)}% of linked postings` : null,
        d.demandedIn.length > 0 ? `demanded in: ${d.demandedIn.slice(0, 3).join('; ')}` : null,
      ].filter(Boolean).join(' · ');
      return `- ${d.skillId}: ${name} (${ctx})`;
    })
    .join('\n');
  const careersBlock = input.targetCareers.length > 0
    ? input.targetCareers.map((c) => `- [${c.source}] ${c.title}${c.detail ? ` — ${c.detail}` : ''}`).join('\n')
    : '(no target careers on file — judge fit from the degree and PLOs, and use "uncertain" where they do not settle it)';

  const user = `[Programme]
Degree (Thai): ${input.programDegree}
Degree (English): ${input.programDegreeEn || '(not available)'}
Level: ${input.programLevel}
Faculty: ${input.programFaculty}

[Target careers — what these graduates are hired into]
${careersBlock}

[Program Learning Outcomes]
${ploBlock}

[Course descriptions (top 80 by appearance)]
${coursesBlock}

[Extracted skills already on file]
${extractedBlock}

[Demanded skills to check (${input.demandedSkills.length})]
${demandedBlock}

Follow STEP 1-3 for every demanded skill and return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - programLearningOutcomes — PLOs verbatim, captured by
//     program-skills-detailed.
//   - courses — course list + descriptions, captured by program-digest
//     (capped at 80 by appearance for context budget).
//   - extractedSkills — skills already on file for the program, with
//     evidence, so a demanded skill can match via prior extraction
//     rather than only PLO/course text.
//   - demandedSkills — the labour-market-demanded skill list to check
//     against (the thing this prompt is inverse-searching for).
//   - programDegree / programDegreeEn / programLevel / programFaculty —
//     the discipline the graduate holds, for the fit judgement.
//   - targetCareers (v4) — JobThai occupations linked by field of study and
//     LinkedIn careers from the programme's career mapping: the ground truth
//     for "the job" that fit is judged against.
//   - demandedSkills[].sources / demandPct / demandedIn (v4) — where and how
//     strongly each skill is demanded, so a discipline name that appears only
//     beside accepted-degree lists can be recognised as other-profession.
//
// Deliberately omitted, with reason:
//   - Peer-program curricula — this prompt answers "does THIS program's
//     own curriculum teach the demanded skill," not a comparative
//     question; peer comparison is program-peer-review's job.
//   - Full Skill taxonomy — only extractedSkills (this program's own
//     already-resolved skills) is sent, not the full ~561-skill
//     taxonomy; taxonomy-wide matching is skill-name-normaliser's job.
// ─────────────────────────────────────────────────────────────────────────────
