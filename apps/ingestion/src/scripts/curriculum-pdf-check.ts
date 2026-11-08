#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Structural check of a curriculum PDF on a LOCAL file path.
//
//   pnpm curriculum:check <path-to-pdf>
//
// Prints ONLY counts, booleans and page numbers — never text, names or code
// lists — so it is safe to run against a PDF that holds personal data and to
// paste the output into a bug report. It answers: can the curriculum
// extractors read this document's course list?
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { courseCodeRegex, extractCandidateCourseCodes, extractCourseListSection } from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';
import { pdfNoTextReason } from '../program-pdf-prep/load';

const HEADINGS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'plo', re: /ผลลัพธ์การเรียนรู้|\bPLO\b/ },
  { label: 'roster', re: /อาจารย์ผู้รับผิดชอบหลักสูตร/ },
  { label: 'appendix', re: /ภาคผนวก/ },
];

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: pnpm curriculum:check <path-to-pdf>');
    process.exit(2);
  }
  const prep = await extractNativeText(readFileSync(path.resolve(process.cwd(), file)));
  const text = prep.fullText;

  // Course-code shapes: 2-4 letters + 3+3 digits (KKU) vs 3 digits (KMUTT-style).
  let sixDigit = 0;
  let threeDigit = 0;
  for (const m of text.matchAll(courseCodeRegex('g'))) {
    if (/\d{3}\s?\d{3}/.test(m[0])) sixDigit += 1;
    else threeDigit += 1;
  }

  const slice = extractCourseListSection(text);
  const candidates = slice.found ? extractCandidateCourseCodes(slice.text) : [];

  const out: Record<string, number | boolean | string> = {
    pages: prep.pages.length,
    characters: text.length,
    likelyScanned: prep.isLikelyScanned,
    readable: pdfNoTextReason(prep) === null,
    codesSixDigitShape: sixDigit,
    codesThreeDigitShape: threeDigit,
    courseListSliceFound: slice.found,
    courseListSliceLength: slice.found ? slice.text.length : 0,
    candidateCodeCount: candidates.length,
  };
  for (const { label, re } of HEADINGS) {
    const at = text.search(re);
    out[`${label}HeadingOffset`] = at;
    const pageIdx = prep.pages.findIndex((p) => re.test(p.textContent ?? ''));
    out[`${label}HeadingFirstPage`] = pageIdx === -1 ? -1 : pageIdx + 1;
  }
  for (const [k, v] of Object.entries(out)) console.log(`${k}: ${String(v)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'check failed');
  process.exit(1);
});
