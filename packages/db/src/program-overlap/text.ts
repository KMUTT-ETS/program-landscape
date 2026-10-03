// program-overlap.v1 — pure text helpers. No DB, no AI.
import { createHash } from 'node:crypto';

const PLO_LABEL = /^\s*(?:(?:PLO|ELO|LO|YLO)\s*[\d.]*\s*[:.)\-–]?\s*|\d+(?:\.\d+)*\s*[.)]\s*)/i;

/** Strip "PLO 1.1", "PLO1:", "ELO 2", "3." style prefixes; trim. */
export function normalisePloText(raw: string): string {
  return raw.replace(PLO_LABEL, '').trim();
}

/** Name key that ignores international markers, so Thai and international
 *  versions of the same programme compare equal. */
export function languageVariantKey(name: string): string {
  return name
    .replace(/\(?\s*หลักสูตรนานาชาติ\s*\)?/g, '')
    .replace(/\(\s*นานาชาติ\s*\)/g, '')
    .replace(/\(?\s*international\s+program(me)?\s*\)?/gi, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

const INTERNATIONAL_MARKER = /หลักสูตรนานาชาติ|\(\s*นานาชาติ\s*\)|international\s+program(?:me)?/i;

/** True when a programme name says it is the international version:
 *  "หลักสูตรนานาชาติ", "(นานาชาติ)" or "International Program(me)". A subject
 *  that merely contains "international" (International Affairs) does not count. */
export function hasInternationalMarker(name: string | null): boolean {
  return name !== null && INTERNATIONAL_MARKER.test(name);
}

export interface MarketProfileInput {
  nameTh: string;
  nameEn: string | null;
  degreeNameTh: string | null;
  degreeNameEn: string | null;
  recruitmentSummaryTh: string | null;
  careers: string[];
}

export function buildMarketProfileText(p: MarketProfileInput): string {
  const lines = [
    [p.nameTh, p.nameEn].filter(Boolean).join(' / '),
    [p.degreeNameTh, p.degreeNameEn].filter(Boolean).join(' / '),
    p.recruitmentSummaryTh ?? '',
    p.careers.length ? `Careers: ${p.careers.join('; ')}` : '',
  ];
  return lines.filter((l) => l.trim().length > 0).join('\n');
}

export interface CourseTextInput {
  nameTh: string | null;
  nameEn: string | null;
  descriptionTh: string | null;
  learningOutcomesTh: string[];
}

export function courseEmbeddingText(c: CourseTextInput): string {
  const lines = [
    [c.nameTh, c.nameEn].filter(Boolean).join(' / '),
    c.descriptionTh ?? '',
    c.learningOutcomesTh.length ? `CLO: ${c.learningOutcomesTh.join('; ')}` : '',
  ];
  return lines.filter((l) => l.trim().length > 0).join('\n');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
