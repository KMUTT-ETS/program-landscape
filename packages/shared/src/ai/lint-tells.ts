// ─────────────────────────────────────────────────────────────────────────────
// Post-generation banned-tell lint (FIX 2, docs/prompt-standard.md
// `## Banned AI tells`).
//
// The prompt-level ban list is not airtight — the 2026-08-16 prompt audit's
// 3-program gate reproduced "robust" verbatim twice on the same
// high-competition TCAS snapshot. This module re-checks generated text
// deterministically after the model call, so a caller can retry once
// rather than trusting the system prompt alone.
//
// Word-family decision: single-word tells match their whole word family
// (`\b<word>\w*\b`) — "robust" also catches "robustness", "delve" also
// catches "delving" — because the TELL is the word choice, not the exact
// inflection. Multi-word tells ("it is important to note", "in today's
// rapidly evolving") match the literal phrase only.
//
// False-positive guard: the product is literally named "Program
// Landscape" (see CLAUDE.md's product-naming memory). A bare match on
// "landscape" is suppressed whenever it is immediately preceded by the
// word "program" (case-insensitive) — every other "landscape" occurrence
// (the metaphorical "competitive landscape" tell this list exists to
// catch) is still flagged.
// ─────────────────────────────────────────────────────────────────────────────

export interface TellViolation {
  phrase: string;
  excerpt: string;
}

const WORD_FAMILY_TELLS = [
  'delve',
  'leverage',
  'robust',
  'tapestry',
  'furthermore',
  'moreover',
] as const;

const PHRASE_TELLS = ['it is important to note', "in today's rapidly evolving"] as const;

const EXCERPT_RADIUS = 40;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CompiledTell {
  phrase: string;
  regex: RegExp;
  /** Only 'landscape' carries the "Program Landscape" false-positive guard. */
  isLandscape?: boolean;
}

const COMPILED_TELLS: CompiledTell[] = [
  ...WORD_FAMILY_TELLS.map((w) => ({ phrase: w, regex: new RegExp(`\\b${w}\\w*\\b`, 'gi') })),
  ...PHRASE_TELLS.map((p) => ({ phrase: p, regex: new RegExp(escapeRegExp(p), 'gi') })),
  { phrase: 'landscape', regex: /\blandscape\w*\b/gi, isLandscape: true },
];

/** True when the "landscape" match at `matchIndex` is part of "Program Landscape". */
function isProductNameOccurrence(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 20), matchIndex);
  return /\bprogram\s*$/i.test(before);
}

/** Scan generated analysis text for the standard's banned tells. */
export function lintBannedTells(text: string): TellViolation[] {
  const violations: TellViolation[] = [];
  for (const tell of COMPILED_TELLS) {
    // Fresh regex per scan — the module-level instances carry the 'g' flag
    // and RegExp.exec is stateful across calls on the same instance.
    const regex = new RegExp(tell.regex.source, tell.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (tell.isLandscape && isProductNameOccurrence(text, match.index)) {
        continue;
      }
      const start = Math.max(0, match.index - EXCERPT_RADIUS);
      const end = Math.min(text.length, match.index + match[0].length + EXCERPT_RADIUS);
      violations.push({ phrase: tell.phrase, excerpt: text.slice(start, end) });
    }
  }
  return violations;
}
