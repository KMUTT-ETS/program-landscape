import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ─────────────────────────────────────────────────────────────────────────────
// program-peer-selection.v1
//
// For one KKU program, select the best-fit peer programs from a curated
// universe of QS / THE-ranked institutions across four geographic tiers:
//   - WORLD
//   - ASIA
//   - SOUTHEAST_ASIA
//   - THAILAND_PEER (Thai universities in the candidate list)
//
// The AI weighs subject ranking first (where available in `subjectRanksJson`),
// then world ranking. It picks 3-5 peers per tier and writes a 1-3 sentence
// rationale for each pick.
//
// Output is a flat list of selections, each tagged with its tier. The
// downstream materialiser writes one ProgramPeerSelection row per pick.
//
// v2 (2026-08-17) — surgical hotfix only, NOT a full docs/prompt-standard.md
// rewrite (this file stays on that standard's conformance allowlist).
// Instruction 7 previously told the model "if you don't know the exact
// name, write a defensible estimate based on naming conventions" — i.e.
// instructed fabrication of official-sounding programme titles, flagged
// by the 2026-08-16 prompt audit (docs/superpowers/notes/2026-08-16-prompt-audit.md).
// Rewritten so an unconfident pick gets a plainly descriptive,
// non-official-sounding name instead, with the confidence noted in
// `rationale`. No schema change; existing v1-stamped rows are untouched —
// peer regeneration + its cascade into peer-review is plan 2's job.
//
// v3 (2026-11-04) — adopter readiness. Instruction 4 told the model the
// THAILAND_PEER candidates were "ranked at or above <institution>", a claim
// that was only true of KKU's curated list; an adopter's list is whatever its
// University Rankings sheet holds. Reworded to describe the list neutrally
// (the candidate list; this institution is excluded). No schema change;
// v2-stamped rows are untouched.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_PEER_SELECTION_VERSION = 'program-peer-selection.v3';

export const PeerSelectionTierSchema = z.enum([
  'WORLD',
  'ASIA',
  'SOUTHEAST_ASIA',
  'THAILAND_PEER',
]);
export type PeerSelectionTier = z.infer<typeof PeerSelectionTierSchema>;

export const PeerSelectionEntrySchema = z.object({
  /** RankedUniversity.id from the candidate list. */
  rankedUniversityId: z.string(),
  tier: PeerSelectionTierSchema,
  /** Best-guess peer program name at this institution (e.g.
   *  "Bachelor of Engineering in Mechanical Engineering"). */
  peerProgramName: z.string().min(1),
  /** Optional URL to the peer program page if known. */
  peerProgramUrl: z
    .union([z.string(), z.null()])
    .transform((v) => v ?? '')
    .default(''),
  /** 1-3 sentence rationale. */
  rationale: z.string().min(10),
  /** AI's confidence in this pick. */
  confidence: z.number().min(0).max(1),
  /** QS/THE subject area used for the match (slug). */
  subjectArea: z
    .union([z.string(), z.null()])
    .transform((v) => v ?? '')
    .default(''),
  /** 1-based rank within the tier (1 = best fit). */
  rankInTier: z.number().int().min(1),
});
export type PeerSelectionEntry = z.infer<typeof PeerSelectionEntrySchema>;

export const ProgramPeerSelectionSchema = z.object({
  selections: z.array(PeerSelectionEntrySchema),
  /** Subject signature the AI considered most relevant for this
   *  program (e.g. "engineering-mechanical"). Helps the analyst
   *  understand the lens the AI used. */
  subjectSignature: z.string(),
  /** Overall confidence across all picks. */
  confidence: z.number().min(0).max(1),
});
export type ProgramPeerSelection = z.infer<typeof ProgramPeerSelectionSchema>;

export interface ProgramPeerSelectionInput {
  programDegree: string;
  programNameTh: string;
  programNameEn: string;
  programLevel: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  programFaculty: string;
  /** Free-text subject hint (typically `Program.majors[0]`). */
  subjectHint: string;
  /** Candidate universities — one entry per tier the AI is selecting from.
   *  Each carries QS/THE rank, subject ranks (when available), country. */
  candidates: Array<{
    rankedUniversityId: string;
    name: string;
    country: string;
    region: 'World' | 'Asia' | 'Southeast Asia' | 'Thailand';
    qsWorldRank?: number | null;
    theWorldRank?: number | null;
    qsAsiaRank?: number | null;
    /** Optional subject-area ranks: { "engineering": { qs: 50, the: 60 } } */
    subjectRanks?: Record<string, { qs?: number; the?: number }> | null;
    notes?: string | null;
  }>;
}

export function buildProgramPeerSelectionMessages(
  input: ProgramPeerSelectionInput,
): AiMessage[] {
  const inst = getInstitution();
  const system = `You are an academic peer-selection analyst. Pick the best-fit peer programs from a curated universe of QS / THE-ranked universities across four tiers.

Output strict JSON (no markdown fences, no prose outside JSON):
{
  "selections": [
    {
      "rankedUniversityId": "<id from candidates>",
      "tier": "WORLD" | "ASIA" | "SOUTHEAST_ASIA" | "THAILAND_PEER",
      "peerProgramName": "<best-guess program name at that institution>",
      "peerProgramUrl": "<optional URL or empty string>",
      "rationale": "<1-3 sentences explaining the fit>",
      "confidence": 0.0-1.0,
      "subjectArea": "<lowercased slug, e.g. 'engineering-mechanical'>",
      "rankInTier": 1
    }
  ],
  "subjectSignature": "<the subject signature you used for matching>",
  "confidence": 0.0-1.0
}

Selection rules:
1. Pick **3-5 peers per tier** (12-20 total). Use \`rankInTier\` 1=best, 2=second, etc.
2. **Subject ranking takes precedence** over world rank when subject ranks are available in the candidate's subjectRanks blob. A university ranked top-50 in the program's subject is a better peer than one ranked top-10 globally but unknown in this subject.
3. **Tier definitions are exclusive in this prompt** (a single university appears in only one tier in the input candidates). Do NOT cross-tier.
4. **For THAILAND_PEER**: candidates are the Thai universities in the candidate list (this institution is excluded). Pick the ones with the strongest match to this program's subject + level.
5. **For SOUTHEAST_ASIA**: pick Singapore / Malaysia / Indonesia / Vietnam / Philippines candidates with strong subject programs.
6. **For ASIA + WORLD**: pick the highest-fit candidates considering subject + level. Prefer institutions known for this discipline.
7. \`peerProgramName\` must be the institution's **actual programme title ONLY when you are confident it is real** (e.g. "Bachelor of Engineering in Mechanical Engineering" at NUS, "BSc in Mechanical Engineering" at MIT). When you are not confident, write a plainly descriptive, non-official-sounding name instead — e.g. "Undergraduate mechanical engineering programme" — never invent an official-sounding title you are not sure exists. State in \`rationale\` whether the name is verified or descriptive.
8. \`rationale\` should mention WHY this is a peer: subject ranking, geographic relevance, curriculum approach, research strength, etc.
9. \`subjectArea\` should be a lowercased kebab-case slug (e.g. "engineering-mechanical", "computer-science", "agriculture-food-science").
10. ${inst.shortNameEn} is the source program — never select ${inst.nameEn} as its own peer (filter out if it appears in candidates).`;

  const formatRanks = (c: ProgramPeerSelectionInput['candidates'][number]): string => {
    const parts: string[] = [];
    if (c.qsWorldRank) parts.push(`QS#${c.qsWorldRank}`);
    if (c.theWorldRank) parts.push(`THE#${c.theWorldRank}`);
    if (c.qsAsiaRank) parts.push(`QS-Asia#${c.qsAsiaRank}`);
    if (c.subjectRanks) {
      for (const [subj, ranks] of Object.entries(c.subjectRanks)) {
        const r = [
          ranks.qs ? `QS#${ranks.qs}` : null,
          ranks.the ? `THE#${ranks.the}` : null,
        ].filter(Boolean).join('/');
        parts.push(`${subj}:${r}`);
      }
    }
    return parts.join(', ') || 'unranked';
  };
  const candidateBlock = input.candidates
    .map(
      (c) =>
        `[${c.rankedUniversityId}] ${c.name} (${c.country}, tier=${c.region.toUpperCase().replace(' ', '_')}) — ${formatRanks(c)}${c.notes ? ` — ${c.notes}` : ''}`,
    )
    .join('\n');

  const user = `[${inst.shortNameEn} PROGRAM]
Degree: ${input.programDegree}
Name (TH): ${input.programNameTh}
Name (EN): ${input.programNameEn}
Level: ${input.programLevel}
Faculty: ${input.programFaculty}
Subject hint: ${input.subjectHint || '(none)'}

[CANDIDATE UNIVERSITIES — pick 3-5 peers per tier]
${candidateBlock}

Output the JSON described above. Pick 3-5 best-fit peers in each of the four tiers (WORLD, ASIA, SOUTHEAST_ASIA, THAILAND_PEER).`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
