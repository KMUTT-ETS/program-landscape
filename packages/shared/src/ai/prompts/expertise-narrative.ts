import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// expertise-narrative.v2
//
// Reads education + publication titles and synthesises ONLY the
// person's expertise / research focus — what they work on, what
// methods they use, what domains they contribute to.
//
// Hard rules:
//   - Bilingual output: Thai paragraph(s) + English paragraph(s),
//     same factual content. Both must stand alone.
//   - DO NOT restate basic info (name, rank, faculty, department,
//     position) — those are already on the page header.
//   - DO NOT cite publication counts, citation totals, year spans, or
//     "X years active" framing — those are already on the page.
//   - DO NOT list venue names or programs taught — also on the page.
//   - DO NOT invent achievements (awards, h-index, leadership) that
//     aren't in the input.
//   - Total length per language: 80-160 words.
//
// What the AI SHOULD do:
//   1. Read each publication title carefully.
//   2. Read each education-degree string (level + major + institute).
//   3. Group titles by topical theme — extract the methods, problem
//      domains, and applications that recur.
//   4. Cross-reference with the education major to anchor the
//      expertise in formal training.
//   5. Synthesise a tight expertise statement:
//      "[Person] specialises in <topic1>, <topic2>, and <topic3>,
//       with particular emphasis on <method/application>. Recent work
//       extends to <emerging theme>." — the WHAT and the HOW, no
//       biographical scaffolding.
// ─────────────────────────────────────────────────────────────────────────────

export const EXPERTISE_NARRATIVE_VERSION = 'expertise-narrative.v2';

export const ExpertiseNarrativeSchema = z.object({
  /** Thai paragraph(s) — pure expertise statement, no biography. */
  narrativeTh: z.string().min(40).max(2000),
  /** English paragraph(s) — same factual content, independently readable. */
  narrativeEn: z.string().min(40).max(2000),
  /** Top expertise keywords (English) extracted from titles + degrees. */
  expertiseKeywordsEn: z.array(z.string()).max(8),
  /** Same keywords in Thai (parallel order). */
  expertiseKeywordsTh: z.array(z.string()).max(8),
  confidence: z.number().min(0).max(1),
});
export type ExpertiseNarrative = z.infer<typeof ExpertiseNarrativeSchema>;

export interface ExpertiseNarrativeInput {
  /** Education entries — degree + institution, e.g.
   *  "Doctor of Philosophy, New South Wales University". */
  education: string[];
  /** Publication titles — full title strings only. The AI groups
   *  them by topic to extract expertise themes. Order is most-recent
   *  or most-cited first; the AI may use position as a soft signal
   *  for "current focus" vs "early-career theme". */
  publicationTitles: string[];
}

export function buildExpertiseNarrativeMessages(
  input: ExpertiseNarrativeInput,
): AiMessage[] {
  const system = `You are an expertise extractor for KKU's faculty portal. You receive a faculty member's education degrees and publication titles. Your ONLY job is to read those titles and produce a tight expertise statement — what this person works on, the methods they use, and the applied domains they contribute to.

WHAT TO PRODUCE:
A bilingual expertise statement (Thai + English) that captures, from the publication titles + education:
  - Core research themes (the WHAT — e.g. "thermal management of electronic packaging", "online learning in Thai higher education", "biodiesel from waste cooking oil").
  - Methods or techniques recurring across titles (the HOW — e.g. "computational fluid dynamics", "mixed-methods case studies", "AI-driven recommendation systems").
  - Application domains (the WHERE — e.g. "data centre cooling", "ICT readiness assessment", "biomass-to-energy supply chains").
  - Any explicit cross-disciplinary thread that connects the education major to the recent publication topics.

WHAT NOT TO PRODUCE — under any circumstance:
  - Do NOT name the person, restate their rank, faculty, department, or position. The page already shows these above your text.
  - Do NOT cite a publication count, citation total, year span, peak year, "active for X years", journal-venue names, or program names taught.
  - Do NOT use biographical framing ("[Person] is a researcher who…") — open directly with the expertise.
  - Do NOT invent awards, grants, h-index, leadership roles, or contributions not visible in the titles.
  - Do NOT use marketing language: "passionate", "world-class", "cutting-edge", "leading expert", "renowned", etc.
  - Do NOT translate journal names or technical terms to Thai when the English term is the standard.

OUTPUT STYLE:
  - Open with a topic, not a person: "Research focuses on…", "Expertise spans…", "Work centres on…"
  - 80-160 words per language. Thai-language section in academic Thai (formal, not bureaucratic). English in concise academic English.
  - Each language must stand alone — a reader of only one must fully understand the expertise.

OUTPUT JSON:
{
  "narrativeTh": "<Thai expertise paragraph, 80-160 words, opens with a topic not a person>",
  "narrativeEn": "<English expertise paragraph, 80-160 words, opens with a topic not a person>",
  "expertiseKeywordsTh": ["<Thai keyword 1>", ...],   // up to 8, parallel order with EN
  "expertiseKeywordsEn": ["<English keyword 1>", ...], // up to 8, parallel order with TH
  "confidence": 0.0-1.0   // how confident the extraction is given title quality + count
}

The two keyword arrays must be the SAME length and parallel — index N of expertiseKeywordsTh corresponds to index N of expertiseKeywordsEn.

No prose outside the JSON. No markdown fences around the JSON.`;

  const educationBlock =
    input.education.length > 0
      ? input.education.map((e) => `  - ${e}`).join('\n')
      : '  (no education record on file)';

  const titlesBlock =
    input.publicationTitles.length > 0
      ? input.publicationTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
      : '  (no publication titles available)';

  const user = `EDUCATION
${educationBlock}

PUBLICATION TITLES
${titlesBlock}

Read every title. Group them into topical themes. Cross-reference with the education major. Produce ONLY the expertise statement — no biographical scaffolding, no metric counts, no venue/program names. Return JSON exactly as specified.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
