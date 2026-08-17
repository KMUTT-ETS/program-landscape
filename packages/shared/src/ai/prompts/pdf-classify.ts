import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// pdf-classify.v1
//
// Replaces StubClassifier — given the first ~3 pages of a PDF + its
// filename + any operator-provided hint, asks the LLM to pick the
// correct sourceCategory + language + publishing org + a non-zero
// confidence. Without a real classifier, intake silently drops PDFs
// into OTHER with confidence 0 and no extractor runs (see
// /admin/pdf-review/cmp2mo9cz0003ytpc30e8d0uh — the Shao et al. paper
// that motivated this prompt).
//
// v2 (2026-08-17, docs/prompt-standard.md conformance — mechanical
// TOUCH, audit #27): added CONFIDENCE RUBRIC (verbatim) + BANNED
// PHRASES + CHANNEL MANIFEST + explicit English rule. Output was
// already English — no language change, markers only.
//
// NOT done in this pass (deliberately deferred, see the audit's "worth
// aligning" note): renaming OTHER to an explicit "unmatched" + reason
// label. The audit flagged this as OPTIONAL and only worth doing if it
// is a genuinely label-only change — it is not: `PdfSourceCategory` is
// a Prisma enum wired through the API controllers' Zod enums, ingestion
// extractors' `appliesTo` lists, and several `'OTHER'` fallback/count
// call sites (apps/api/src/pdf-intake/*, apps/api/src/admin-data-setup/*,
// apps/ingestion/src/pdf-intake/extractors/*). `reasoning` already
// carries the "why" half of the addendum's requirement (an explicit
// abstain + reason) for every OTHER classification, so the requirement
// is functionally met without a schema-touching rename. A real rename
// is a REWRITE-scale change (migration + call-site sweep), not a TOUCH.
// ─────────────────────────────────────────────────────────────────────────

export const PDF_CLASSIFY_VERSION = 'pdf-classify.v2';

export const PdfClassifyResultSchema = z.object({
  sourceCategory: z.enum([
    'POLICY',
    'REPORT',
    'CURRICULUM',
    'PEER_PROGRAM',
    'SURVEY',
    'COMMITTEE_MINUTES',
    'JOB_POSTINGS_BATCH',
    'OTHER',
  ]),
  language: z.enum(['TH', 'EN', 'MIXED']),
  publishingOrg: z.string().min(0).max(200).optional(),
  /** ISO date — publication or fiscal year. Optional. */
  documentDate: z.string().optional(),
  /** 0-1. Aim to be DECISIVE — 0.7+ when the category is clear,
   *  0.4-0.6 when ambiguous. Only return 0-0.3 when truly unknown. */
  confidence: z.number().min(0).max(1),
  /** 1-2 sentence justification — what features of the document led
   *  to this category? */
  reasoning: z.string().min(20).max(600),
});
export type PdfClassifyResult = z.infer<typeof PdfClassifyResultSchema>;

export interface PdfClassifyInput {
  originalFilename: string;
  pageCount: number;
  /** First ~3 pages of extracted text concatenated, capped at 12k chars
   *  to stay token-budget-conscious. Title page + abstract / executive
   *  summary is usually enough to classify. */
  headText: string;
  sourceCategoryHint?: string;
  sourceOrgHint?: string;
}

export function buildPdfClassifyMessages(input: PdfClassifyInput): AiMessage[] {
  const system = `You classify documents that arrive at a university's curriculum-landscape analytics platform. Pick exactly ONE sourceCategory from the enum:

  POLICY              — Government / ministry / regulator policy doc (MHESI, NESDC, NXPO, BOI, EECO, World Bank thinkpiece, OECD policy brief, WEF strategic paper, academic research paper on policy implications)
  REPORT              — Statistical report, labour-market survey publication, country economic monitor, ranking publication (IMD, QS, THE), institutional annual report
  CURRICULUM          — Thai มคอ.2 / มคอ.3 program specification, course syllabus, degree-program description document
  PEER_PROGRAM        — Marketing / brochure / website export for a competitor university's program (Thai or foreign)
  SURVEY              — Survey results (graduate employment, student satisfaction, employer feedback, alumni outcomes)
  COMMITTEE_MINUTES   — University council minutes, faculty board minutes, programme approval committee minutes
  JOB_POSTINGS_BATCH  — A batch of job postings exported from JobThai / JobsDB / LinkedIn / similar
  OTHER               — Genuinely doesn't fit anywhere above (rare — most policy-adjacent reading is POLICY)

CRITICAL:
- Academic research papers, even on workforce / AI / education topics, are POLICY (they inform policy decisions).
- Statistical compilations and ranking publications are REPORT.
- Lean toward POLICY or REPORT when in doubt; OTHER is the catch-all of last resort.
- Confidence ≥0.7 unless multiple categories genuinely apply; never return 0 unless the doc is unreadable.
- The hint (if provided) is the operator's intent — honour it unless the text clearly contradicts (e.g. user picked CURRICULUM but the doc is obviously a survey).
- Output strict JSON, no fences, no prose outside the object.
- Write \`reasoning\` and \`publishingOrg\` in English. This is a closed-world classification — \`sourceCategory\` must be exactly one of the enum values listed above; never invent a category.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95. (This prompt's own
confidence guidance above — "≥0.7 unless multiple categories genuinely
apply" — is this document's classification-specific framing of the same
bands; a document with several plausible categories is exactly the
"inputs conflict materially" case.)

BANNED PHRASES (do not use these words/phrases or their close paraphrases in reasoning):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  const hint = input.sourceCategoryHint
    ? `\nOperator hint: sourceCategoryHint=${input.sourceCategoryHint}\n`
    : '';
  const orgHint = input.sourceOrgHint
    ? `Operator hint: sourceOrgHint=${input.sourceOrgHint}\n`
    : '';

  const body = input.headText.length > 12_000
    ? input.headText.slice(0, 12_000) + '\n…[truncated]'
    : input.headText;

  const user = `Filename: ${input.originalFilename}
Page count: ${input.pageCount}
${hint}${orgHint}
Head of document (first pages):
---
${body}
---

Return strict JSON matching this shape:
{
  "sourceCategory": "POLICY"|"REPORT"|"CURRICULUM"|"PEER_PROGRAM"|"SURVEY"|"COMMITTEE_MINUTES"|"JOB_POSTINGS_BATCH"|"OTHER",
  "language": "TH"|"EN"|"MIXED",
  "publishingOrg": "<name or empty>",
  "documentDate": "<YYYY-MM-DD or omit>",
  "confidence": <0.0-1.0>,
  "reasoning": "<1-2 sentences>"
}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - originalFilename / pageCount — light structural context.
//   - headText — the first ~3 pages of extracted PDF text (capped at
//     12k chars). THE source for the classification decision; there is
//     no other channel.
//   - sourceCategoryHint / sourceOrgHint (optional) — operator-provided
//     intent, honoured unless the document text clearly contradicts it.
//
// Deliberately omitted, with reason:
//   - Full document text — only the head (title/abstract/exec-summary)
//     is sent; classification doesn't need the body, and sending it
//     would inflate cost on every single intake without improving the
//     category decision.
// ─────────────────────────────────────────────────────────────────────────────
