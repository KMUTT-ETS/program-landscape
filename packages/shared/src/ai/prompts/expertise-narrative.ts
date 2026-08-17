import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// expertise-narrative.v3
//
// Reads education + publication titles and synthesises ONLY the
// person's expertise / research focus — what they work on, what
// methods they use, what domains they contribute to.
//
// v3 (2026-08-17, docs/prompt-standard.md): the narrative paragraph is
// English-only. v2's `narrativeTh` (a full 80-160 word analysis
// paragraph) was NOT on the standard's Thai-exemption list — audit #10
// flagged it as the one field in this prompt that needed to flip. The
// keyword arrays (`expertiseKeywordsTh` / `expertiseKeywordsEn`) STAY —
// they're on the exemption list verbatim (the profile page's Thai
// keyword chip surface, a UI display list rather than analysis prose).
// Adds the CONFIDENCE RUBRIC + BANNED PHRASES + CHANNEL MANIFEST markers.
//
// Consumer note: `UserExpertiseNarrative.narrativeTh` (the DB column) is
// now nullable (migration 20260817130000_expertise_narrative_th_nullable)
// — v3 rows write null there; v1/v2 rows keep their historical Thai
// content unchanged. apps/web/src/lib/profile-data.ts's read query was
// ALSO fixed in this bump to filter on the current methodVersion (it
// previously read "most recent row for this user, any version" — the
// model's own doc comment claimed a version bump "shadows" the old row
// on next view, which was not what the code did; see the profile-data.ts
// diff for the fix that makes that claim true).
//
// Hard rules:
//   - DO NOT restate basic info (name, rank, faculty, department,
//     position) — those are already on the page header.
//   - DO NOT cite publication counts, citation totals, year spans, or
//     "X years active" framing — those are already on the page.
//   - DO NOT list venue names or programs taught — also on the page.
//   - DO NOT invent achievements (awards, h-index, leadership) that
//     aren't in the input.
//   - Total narrative length: 80-160 words.
//
// What the AI SHOULD do:
//   1. Read each publication title carefully.
//   2. Read each education-degree string (level + major + institute).
//   3. Group titles by topical theme — extract the methods, problem
//      domains, and applications that recur.
//   4. Cross-reference with the education major to anchor the
//      expertise in formal training.
//   5. Synthesise a tight expertise statement:
//      "Research focuses on <topic1>, <topic2>, and <topic3>, with
//       particular emphasis on <method/application>. Recent work
//       extends to <emerging theme>." — the WHAT and the HOW, no
//       biographical scaffolding.
// ─────────────────────────────────────────────────────────────────────────────

export const EXPERTISE_NARRATIVE_VERSION = 'expertise-narrative.v3';

const CONFIDENCE_RUBRIC_BLOCK = `CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.`;

const BANNED_PHRASES_BLOCK = `BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — "the competitive landscape" — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"
- marketing language already banned by this prompt's own rules: "passionate", "world-class", "cutting-edge", "leading expert", "renowned"`;

export const ExpertiseNarrativeSchema = z.object({
  /** English paragraph(s) — the sole narrative field as of v3. Pure
   *  expertise statement, no biography. */
  narrativeEn: z.string().min(40).max(2000),
  /** Top expertise keywords (English) extracted from titles + degrees. */
  expertiseKeywordsEn: z.array(z.string()).max(8),
  /** Same keywords in Thai (parallel order). Exempt from the
   *  English-only rule — docs/prompt-standard.md `## Language`,
   *  consuming surface: the profile page's Thai keyword chips. */
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
An English expertise statement that captures, from the publication titles + education:
  - Core research themes (the WHAT — e.g. "thermal management of electronic packaging", "online learning in Thai higher education", "biodiesel from waste cooking oil").
  - Methods or techniques recurring across titles (the HOW — e.g. "computational fluid dynamics", "mixed-methods case studies", "AI-driven recommendation systems").
  - Application domains (the WHERE — e.g. "data centre cooling", "ICT readiness assessment", "biomass-to-energy supply chains").
  - Any explicit cross-disciplinary thread that connects the education major to the recent publication topics.

Also extract up to 8 expertise keywords in English, with a parallel Thai translation array (same length, same order) — the Thai array feeds the profile page's keyword chips and is the one place Thai output is expected from this prompt.

WHAT NOT TO PRODUCE — under any circumstance:
  - Do NOT name the person, restate their rank, faculty, department, or position. The page already shows these above your text.
  - Do NOT cite a publication count, citation total, year span, peak year, "active for X years", journal-venue names, or program names taught.
  - Do NOT use biographical framing ("[Person] is a researcher who…") — open directly with the expertise.
  - Do NOT invent awards, grants, h-index, leadership roles, or contributions not visible in the titles.
  - Do NOT translate journal names or technical terms to Thai in the keyword array when the English term is the standard.
  - Write the narrative in English only. Do not write any Thai sentence in narrativeEn.

OUTPUT STYLE:
  - Open with a topic, not a person: "Research focuses on…", "Expertise spans…", "Work centres on…"
  - 80-160 words. Concise academic English register.

${CONFIDENCE_RUBRIC_BLOCK}

${BANNED_PHRASES_BLOCK}

GROUNDING RULES:
- Every theme you name must be traceable to a publication title or education entry given below. Never invent a research theme the titles don't support.
- When the input has few titles (see the input block below), keep the statement proportionate — do not claim a broad research program from 2-3 titles.
- Causal or emphasis claims ("particular emphasis on X") should follow from how often a theme recurs across the titles shown, not from a single occurrence read as a specialism.

OUTPUT JSON:
{
  "narrativeEn": "<English expertise paragraph, 80-160 words, opens with a topic not a person>",
  "expertiseKeywordsEn": ["<English keyword 1>", ...],   // up to 8
  "expertiseKeywordsTh": ["<Thai keyword 1>", ...],       // up to 8, parallel order with EN
  "confidence": 0.0-1.0   // how confident the extraction is given title quality + count
}

The two keyword arrays must be the SAME length and parallel — index N of expertiseKeywordsEn corresponds to index N of expertiseKeywordsTh.

No prose outside the JSON. No markdown fences around the JSON.`;

  const educationBlock =
    input.education.length > 0
      ? input.education.map((e) => `  - ${e}`).join('\n')
      : '  data not available (no education record on file)';

  const titlesBlock =
    input.publicationTitles.length > 0
      ? input.publicationTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
      : '  data not available (no publication titles available)';

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

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - education           — input.education: FacultyMember/DS2003 degree
//     strings, resolved by apps/web/app/api/profile-narrative/route.ts
//     from getProfileData()'s education list.
//   - publicationTitles    — input.publicationTitles: top 30 publication
//     titles (by citations then year), same source as the profile page's
//     publication list (Scopus / PubMed / kkuscholar, deduped).
//
// Deliberately omitted, with reason:
//   - Abstracts / full text — not stored for most publications (title +
//     venue + citations + quartile only, per program-research-expertise's
//     same limitation); a title-only prompt is explicit about this rather
//     than pretending to have read a paper it wasn't shown.
//   - Citation counts / venue names / program-taught list — deliberately
//     excluded from the OUTPUT, not the input, per the hard rules above:
//     these are already rendered elsewhere on the profile page, and
//     restating them would be redundant, not analysis.
//   - Faculty rank / position / department — identity fields the page
//     header already shows; including them here would invite the "[Name]
//     is a researcher who..." biographical framing the hard rules ban.
// ─────────────────────────────────────────────────────────────────────────────
