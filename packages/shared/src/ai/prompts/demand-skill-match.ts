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
// ─────────────────────────────────────────────────────────────────────────────

export const DEMAND_MATCH_VERSION = 'demand-match.v2';

export const DemandMatchEntrySchema = z.object({
  /** Skill.id from the demand list — used to update ProgramDemandMatch. */
  skillId: z.string(),
  /** The demanded skill's English label, for the AI's reference. */
  skillName: z.string(),
  /** TAUGHT — is this skill found in the program's PLOs / courses /
   *  extracted skills? */
  matched: z.boolean(),
  /** RELEVANT — is this skill plausibly relevant to a graduate of THIS
   *  discipline + their target careers, regardless of whether the
   *  curriculum currently teaches it?
   *
   *  - true  → relevant; if matched=false this is a real GAP
   *  - false → irrelevant to this discipline; suppress from the gap
   *            list (it's noise from cross-career labour-market data)
   *
   *  Example for a Mechanical Engineering BE:
   *    "Mechanical engineering"  → relevant=true,  matched=true  → TAUGHT
   *    "C++ programming"         → relevant=true,  matched=false → GAP
   *    "Civil engineering"       → relevant=false, matched=false → IRRELEVANT
   *    "Digital marketing"       → relevant=false, matched=false → IRRELEVANT
   *    "Maintenance and repair"  → relevant=true,  matched=false → GAP
   */
  relevantToCurriculum: z.boolean().default(true),
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
  programFaculty: string;
  /** PLOs verbatim (Thai), captured by program-skills-detailed.v2. */
  programLearningOutcomes: string[];
  /** Course list with descriptions, captured by program-digest.v1. */
  courses: Array<{ code: string; nameTh: string; nameEn: string; descriptionTh: string }>;
  /** Skills the program already known to teach (with evidence). */
  extractedSkills: Array<{ nameTh: string; nameEn: string; evidence: string }>;
  /** Demanded skills to check, in priority order. */
  demandedSkills: Array<{ skillId: string; nameEn: string; nameTh: string }>;
}

export function buildDemandMatchMessages(input: DemandMatchInput): AiMessage[] {
  const system = `For each demanded skill, evaluate two dimensions:

A. matched: Does the curriculum teach it? Search PLOs, courses, extracted-skills.
B. relevantToCurriculum: Would a graduate of THIS discipline plausibly need this skill in their target careers? (Independent of A.)

Output STRICT JSON (no markdown):
{"matches":[{"skillId":"...","skillName":"...","matched":bool,"relevantToCurriculum":bool,"matchSource":"plo|course|extracted-skill|unmatched","relatedness":0..1,"evidenceQuote":"...","matchedTaughtSkillName":"..."}],"confidence":0..1}

Rules:
1. EVERY skillId in input must appear in output exactly once.
2. matched=true ⇒ relevant=true automatically.
3. matched=false: decide relevant separately. Mech Eng program: "C++/Python/Maintenance/CAD" relevant=true; "Civil engineering/Digital marketing/Nursing" relevant=false (other discipline).
4. matchSource priority: extracted-skill > plo > course > unmatched. Set relatedness 1.0 / 0.9 / 0.7 / 0.2 respectively.
5. evidenceQuote: verbatim from source (Thai if Thai), ≤200 chars. Empty when unmatched.
6. Use semantic match: "Renewable Energy" ↔ "พลังงานทดแทน"; "Programming" ↔ "การเขียนโปรแกรม".`;

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
    .map((d) => `- ${d.skillId}: ${d.nameEn || d.nameTh}${d.nameTh && d.nameEn ? ` / ${d.nameTh}` : ''}`)
    .join('\n');

  const user = `[หลักสูตร]
ปริญญา: ${input.programDegree}
คณะ: ${input.programFaculty}

[Program Learning Outcomes]
${ploBlock}

[Course descriptions (top 80 by appearance)]
${coursesBlock}

[Extracted skills already on file]
${extractedBlock}

[Demanded skills to check (${input.demandedSkills.length})]
${demandedBlock}

ตรวจทุก demanded skill ตามขั้นตอนที่ระบุ ส่งออก JSON ตามรูปแบบที่กำหนด`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
