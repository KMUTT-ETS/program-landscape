// Pure per-programme decision for scripts/materialise-program-courses.ts.
// Lives outside the script because that file runs main() on import.
//
// Precedence: a spreadsheet-imported course list always wins. --force exists
// to override the extractor guard for a deliberate rebuild; it must never
// override an operator's own upload.
export type MaterialiseDecision = 'write' | 'skip-extractor' | 'skip-import';

export function shouldMaterialise(input: {
  extractorOwned: boolean;
  importOwned: boolean;
  force: boolean;
}): MaterialiseDecision {
  if (input.importOwned) return 'skip-import';
  if (input.extractorOwned && !input.force) return 'skip-extractor';
  return 'write';
}
