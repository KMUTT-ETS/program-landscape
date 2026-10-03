// program-overlap.v1 — pure scoring core. Spec:
// docs/superpowers/specs/2026-10-03-program-overlap-design.md §4.5–§6.1.
// Deterministic: same inputs → same scores. No DB, no AI, no clock.
import type { CourseCategory, OverlapAction, OverlapBand, ProgramLevel } from '@prisma/client';
import { createHash } from 'node:crypto';
import { hasInternationalMarker, languageVariantKey } from './text';

export const PROGRAM_OVERLAP_VERSION = 'program-overlap.v1';

/** Provisional until calibration (spec §9). Changing any value after release
 *  bumps PROGRAM_OVERLAP_VERSION. */
export interface OverlapThresholds {
  courseEquiv: number;        // cosine for two DESCRIBED courses to count as equivalent
  courseEquivName: number;    // cosine when either course is embedded on its name alone (D7)
  ploMatch: number;           // cosine for a PLO to count as covered
  marketFloor: number;        // cosine mapped to 0
  marketCeiling: number;      // cosine mapped to 100
  /** 0–100 market similarity: market_confusion_max WARN, and the floor at
   *  which a pair is stored even with low curriculum overlap. PROVISIONAL. */
  marketConfusionWarn: number;
  /** 0–100 market similarity: market_confusion_max CRITICAL and the
   *  DIFFERENTIATE action. PROVISIONAL. */
  marketConfusion: number;
  bandLow: number;
  bandModerate: number;
  bandHigh: number;
  serviceCourseShare: number; // share of same-level programmes above which a code is a service course
  minEmbeddedCourses: number;  // minimum embedded major courses per side for the content layer
  courseActionCredits: number;
  actionIndex: number;
  mergeIndex: number;
  mergeContainment: number;
  storeIndex: number;
}

export const OVERLAP_THRESHOLDS: OverlapThresholds = {
  courseEquiv: 0.85,
  courseEquivName: 0.9,
  ploMatch: 0.8,
  marketFloor: 0.6,
  marketCeiling: 0.95,
  // PROVISIONAL — the market-confusion thresholds are set at calibration
  // (Task 11, spec §9). The single source of truth: risk-scoring.ts reads them.
  marketConfusionWarn: 60,
  marketConfusion: 75,
  bandLow: 30,
  bandModerate: 50,
  bandHigh: 70,
  serviceCourseShare: 0.25,
  minEmbeddedCourses: 3,
  courseActionCredits: 6,
  actionIndex: 50,
  mergeIndex: 70,
  mergeContainment: 80,
  storeIndex: 30,
};

/** A course with no recorded credits is weighted as a typical 3-credit course;
 *  how many were defaulted is reported in the evidence coverage. */
export const DEFAULT_COURSE_CREDITS = 3;

const EXCLUDED_CATEGORIES: ReadonlySet<CourseCategory> = new Set(['GENERAL_EDUCATION', 'FREE_ELECTIVE', 'THESIS_PROJECT']);

export interface OverlapCourse {
  id: string;
  code: string;
  credits: number | null;
  category: CourseCategory | null;
  described: boolean;
  vector: number[] | null;
  nameTh: string | null;
  nameEn: string | null;
}
export interface OverlapPlo { ordinal: number; text: string; vector: number[] }
export interface OverlapProgramme {
  id: string;
  code: string;
  level: ProgramLevel;
  facultyId: string;
  nameTh: string;
  nameEn: string | null;
  degreeNameTh: string | null;
  language: string | null;
  courses: OverlapCourse[];
  plos: OverlapPlo[];
  marketVector: number[] | null;
  staffIds: string[];
}

export interface PairEvidence {
  sharedCourses: Array<{ code: string; credits: number; nameTh: string | null }>;
  equivalentCourses: Array<{
    codeA: string; codeB: string; nameA: string | null; nameB: string | null;
    credits: number; similarity: number;
    /** 'description' when both courses are described, otherwise 'name' (D7). */
    basis: 'description' | 'name';
  }>;
  matchedPlos: Array<{ ordinalA: number; ordinalB: number; textA: string; textB: string; similarity: number }>;
  unmatchedPlosA: string[];
  unmatchedPlosB: string[];
  coverage: {
    majorCoursesA: number; majorCoursesB: number;
    embeddedA: number; embeddedB: number;
    describedA: number; describedB: number;
    /** Equivalent pairs whose basis is 'description'. */
    descriptionMatches: number;
    plosA: number; plosB: number;
    defaultedCredits: number;
  };
}

export interface PairScore {
  programAId: string;
  programBId: string;
  structure: number | null;
  content: number | null;
  outcome: number | null;
  overlapIndex: number | null;
  containmentAInB: number | null;
  containmentBInA: number | null;
  band: OverlapBand;
  sharedCredits: number;
  equivCredits: number;
  sharedStaff: number;
  marketSimilarity: number | null;
  languageVariant: boolean;
  actions: OverlapAction[];
  primaryAction: OverlapAction | null;
  evidence: PairEvidence;
  evidenceHash: string;
}

function assertSameLength(a: readonly number[], b: readonly number[]): void {
  if (a.length !== b.length) throw new Error(`program-overlap: vector length mismatch (${a.length} vs ${b.length})`);
}

/** General cosine similarity; any non-zero vectors. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  assertSameLength(a, b);
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : d / Math.sqrt(na * nb);
}

/** Dot product — equals the cosine for UNIT vectors only. The course and PLO
 *  matching hot paths use it because every stored embedding is L2-normalised
 *  on write (`writeVector` in ./vectors) and the readers return the stored
 *  values unchanged. Anything not from those tables must go through `cosine`. */
export function dot(a: readonly number[], b: readonly number[]): number {
  assertSameLength(a, b);
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
  return d;
}

/** One-to-one greedy matching: all candidate pairs at or above `threshold`,
 *  most similar first; each left and right item is used at most once. Equal
 *  similarities break by left index, then right index, so callers must pass
 *  inputs in a stable order. */
export function greedyMatch<L, R>(
  left: readonly L[],
  right: readonly R[],
  sim: (l: L, r: R) => number,
  threshold: number,
): Array<{ left: L; right: R; similarity: number }> {
  const cands: Array<{ i: number; j: number; s: number }> = [];
  for (let i = 0; i < left.length; i++) {
    for (let j = 0; j < right.length; j++) {
      const s = sim(left[i]!, right[j]!);
      if (s >= threshold) cands.push({ i, j, s });
    }
  }
  cands.sort((x, y) => y.s - x.s || x.i - y.i || x.j - y.j);
  const usedL = new Set<number>(), usedR = new Set<number>();
  const out: Array<{ left: L; right: R; similarity: number }> = [];
  for (const c of cands) {
    if (usedL.has(c.i) || usedR.has(c.j)) continue;
    usedL.add(c.i);
    usedR.add(c.j);
    out.push({ left: left[c.i]!, right: right[c.j]!, similarity: c.s });
  }
  return out;
}

/** Codes used by more than `share` of the given (same-level) programmes. */
export function serviceCourseCodes(programmes: readonly OverlapProgramme[], share: number): Set<string> {
  const counts = new Map<string, number>();
  for (const p of programmes) for (const code of new Set(p.courses.map((c) => c.code))) counts.set(code, (counts.get(code) ?? 0) + 1);
  const limit = programmes.length * share;
  return new Set([...counts].filter(([, n]) => n > limit).map(([code]) => code));
}

/** Major courses, filtered first and then de-duplicated by code: a code also
 *  listed under an excluded category still counts as major. On a repeat the
 *  first occurrence is kept, with the largest recorded credits. */
export function majorCourses(p: OverlapProgramme, serviceCodes: ReadonlySet<string>): OverlapCourse[] {
  const byCode = new Map<string, OverlapCourse>();
  for (const c of p.courses) {
    if (c.category && EXCLUDED_CATEGORIES.has(c.category)) continue;
    if (serviceCodes.has(c.code)) continue;
    const prev = byCode.get(c.code);
    if (!prev) {
      byCode.set(c.code, c);
    } else if (c.credits !== null && (prev.credits === null || c.credits > prev.credits)) {
      byCode.set(c.code, { ...prev, credits: c.credits });
    }
  }
  return [...byCode.values()];
}

const credits = (c: OverlapCourse): number => c.credits ?? DEFAULT_COURSE_CREDITS;
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
const mean = (xs: Array<number | null>): number | null => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? sum(ok) / ok.length : null;
};
const clamp = (x: number): number => Math.max(0, Math.min(100, x));
/** 0–100 share, or null when the denominator is 0 (0-credit S/U courses are real). */
const pct = (num: number, den: number): number | null => (den > 0 ? clamp((num / den) * 100) : null);

/** Rounds every number (deeply) to 4 dp so float noise never moves the hash. */
function roundDeep(x: unknown): unknown {
  if (typeof x === 'number') return Math.round(x * 1e4) / 1e4;
  if (Array.isArray(x)) return x.map(roundDeep);
  if (x !== null && typeof x === 'object') {
    return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, roundDeep(val)]));
  }
  return x;
}

/** Everything the AI recommendation reads. A change here re-runs the AI. */
export interface EvidenceHashInput {
  evidence: PairEvidence;
  structure: number | null;
  content: number | null;
  outcome: number | null;
  containmentAInB: number | null;
  containmentBInA: number | null;
  sharedStaff: number;
  marketSimilarity: number | null;
  actions: OverlapAction[];
  languageVariant: boolean;
}

export function computeEvidenceHash(x: EvidenceHashInput): string {
  const stable = {
    evidence: x.evidence, structure: x.structure, content: x.content, outcome: x.outcome,
    containmentAInB: x.containmentAInB, containmentBInA: x.containmentBInA,
    sharedStaff: x.sharedStaff, marketSimilarity: x.marketSimilarity,
    actions: x.actions, languageVariant: x.languageVariant,
  };
  return createHash('sha256').update(JSON.stringify(roundDeep(stable))).digest('hex');
}

export function bandFor(index: number | null, t: OverlapThresholds = OVERLAP_THRESHOLDS): OverlapBand {
  if (index === null || index < t.bandLow) return 'NONE';
  if (index < t.bandModerate) return 'LOW';
  if (index < t.bandHigh) return 'MODERATE';
  return 'HIGH';
}

/** Weakest → strongest; the last applicable one is the primary action. */
export const ACTION_STRENGTH: readonly OverlapAction[] = [
  'COORDINATE_SHARED_COURSES',
  'CONSOLIDATE_EQUIVALENT_COURSES',
  'SHARE_STAFF_RESOURCES',
  'DIFFERENTIATE',
  'CONSIDER_MERGE_OR_TRACK',
];

export function scorePair(
  a: OverlapProgramme,
  b: OverlapProgramme,
  ctx: { serviceCodes: ReadonlySet<string>; thresholds: OverlapThresholds },
): PairScore {
  const t = ctx.thresholds;
  const majA = majorCourses(a, ctx.serviceCodes);
  const majB = majorCourses(b, ctx.serviceCodes);
  const creditsA = sum(majA.map(credits));
  const creditsB = sum(majB.map(credits));
  const defaultedCredits = [...majA, ...majB].filter((c) => c.credits === null).length;

  // Structure — same code in both.
  const codesB = new Map(majB.map((c) => [c.code, c]));
  const shared = majA.filter((c) => codesB.has(c.code));
  const sharedCredits = sum(shared.map((c) => Math.min(credits(c), credits(codesB.get(c.code)!))));
  const structure = majA.length && majB.length ? pct(2 * sharedCredits, creditsA + creditsB) : null;

  // Content — equivalent courses with different codes, over every EMBEDDED
  // major course (D7): most are embedded on their names alone, about a fifth
  // also carry a description and CLOs.
  const sharedCodes = new Set(shared.map((c) => c.code));
  const embA = majA.filter((c) => c.vector !== null);
  const embB = majB.filter((c) => c.vector !== null);
  const describedA = embA.filter((c) => c.described).length;
  const describedB = embB.filter((c) => c.described).length;
  let content: number | null = null;
  let equivCredits = 0;
  let equivalent: PairEvidence['equivalentCourses'] = [];
  if (embA.length >= t.minEmbeddedCourses && embB.length >= t.minEmbeddedCourses) {
    const candA = embA.filter((c) => !sharedCodes.has(c.code));
    const candB = embB.filter((c) => !sharedCodes.has(c.code));
    const bothDescribed = (x: OverlapCourse, y: OverlapCourse): boolean => x.described && y.described;
    // Titles carry less information than descriptions, so a name-based match
    // must agree more closely (spec §5.1).
    const threshold = (x: OverlapCourse, y: OverlapCourse): number => (bothDescribed(x, y) ? t.courseEquiv : t.courseEquivName);
    const matches = greedyMatch(
      candA,
      candB,
      (x, y) => {
        const s = dot(x.vector!, y.vector!);
        return s >= threshold(x, y) ? s : -1;
      },
      Math.min(t.courseEquiv, t.courseEquivName),
    );
    equivalent = matches.map((m) => ({
      codeA: m.left.code, codeB: m.right.code, nameA: m.left.nameTh, nameB: m.right.nameTh,
      credits: Math.min(credits(m.left), credits(m.right)), similarity: m.similarity,
      basis: bothDescribed(m.left, m.right) ? 'description' : 'name',
    }));
    equivCredits = sum(equivalent.map((e) => e.credits));
    // An embedded course both programmes share by code is trivially equivalent:
    // it counts in the content layer too, or two identical programmes would
    // score 0 on content. equivCredits (different codes only) still drives the
    // CONSOLIDATE_EQUIVALENT_COURSES action.
    const embCodesB = new Map(embB.map((c) => [c.code, c]));
    const sharedEmbeddedCredits = sum(
      embA.filter((c) => embCodesB.has(c.code)).map((c) => Math.min(credits(c), credits(embCodesB.get(c.code)!))),
    );
    const eA = sum(embA.map(credits)), eB = sum(embB.map(credits));
    content = pct(2 * (sharedEmbeddedCredits + equivCredits), eA + eB);
  }

  // Outcome — PLO coverage, both directions.
  let outcome: number | null = null;
  let matchedPlos: PairEvidence['matchedPlos'] = [];
  let unmatchedA: string[] = [], unmatchedB: string[] = [];
  let ploShareA: number | null = null, ploShareB: number | null = null;
  if (a.plos.length && b.plos.length) {
    const bestFor = (p: OverlapPlo, others: OverlapPlo[]) =>
      others.reduce<{ o: OverlapPlo | null; s: number }>((best, o) => {
        const s = dot(p.vector, o.vector);
        return s > best.s ? { o, s } : best;
      }, { o: null, s: -1 });
    const coveredA = a.plos.filter((p) => bestFor(p, b.plos).s >= t.ploMatch);
    const coveredB = b.plos.filter((p) => bestFor(p, a.plos).s >= t.ploMatch);
    outcome = clamp(((coveredA.length + coveredB.length) / (a.plos.length + b.plos.length)) * 100);
    ploShareA = (coveredA.length / a.plos.length) * 100;
    ploShareB = (coveredB.length / b.plos.length) * 100;
    matchedPlos = coveredA.map((p) => {
      const best = bestFor(p, b.plos);
      return { ordinalA: p.ordinal, ordinalB: best.o!.ordinal, textA: p.text, textB: best.o!.text, similarity: best.s };
    });
    unmatchedA = a.plos.filter((p) => !coveredA.includes(p)).map((p) => p.text);
    unmatchedB = b.plos.filter((p) => !coveredB.includes(p)).map((p) => p.text);
  }

  const overlapIndex = mean([structure, content, outcome]);
  const matchedCredits = sharedCredits + (content === null ? 0 : equivCredits);
  const containmentAInB = mean([majA.length && majB.length ? pct(matchedCredits, creditsA) : null, ploShareA]);
  const containmentBInA = mean([majA.length && majB.length ? pct(matchedCredits, creditsB) : null, ploShareB]);

  const staffB = new Set(b.staffIds);
  const sharedStaff = new Set(a.staffIds.filter((s) => staffB.has(s))).size;
  const marketSimilarity =
    a.marketVector && b.marketVector
      ? clamp(((cosine(a.marketVector, b.marketVector) - t.marketFloor) / (t.marketCeiling - t.marketFloor)) * 100)
      : null;
  const languageVariant = isLanguageVariant(a, b);

  const actions: OverlapAction[] = [];
  if (sharedCredits >= t.courseActionCredits) actions.push('COORDINATE_SHARED_COURSES');
  if (equivCredits >= t.courseActionCredits) actions.push('CONSOLIDATE_EQUIVALENT_COURSES');
  if (overlapIndex !== null && overlapIndex >= t.actionIndex) actions.push('SHARE_STAFF_RESOURCES');
  if (overlapIndex !== null && overlapIndex >= t.actionIndex && marketSimilarity !== null && marketSimilarity >= t.marketConfusion) actions.push('DIFFERENTIATE');
  const maxContainment = Math.max(containmentAInB ?? 0, containmentBInA ?? 0);
  if (overlapIndex !== null && overlapIndex >= t.mergeIndex && maxContainment >= t.mergeContainment && !languageVariant) actions.push('CONSIDER_MERGE_OR_TRACK');
  const primaryAction = [...ACTION_STRENGTH].reverse().find((x) => actions.includes(x)) ?? null;

  const evidence: PairEvidence = {
    sharedCourses: shared.map((c) => ({ code: c.code, credits: Math.min(credits(c), credits(codesB.get(c.code)!)), nameTh: c.nameTh })),
    equivalentCourses: equivalent,
    matchedPlos,
    unmatchedPlosA: unmatchedA,
    unmatchedPlosB: unmatchedB,
    coverage: {
      majorCoursesA: majA.length, majorCoursesB: majB.length,
      embeddedA: embA.length, embeddedB: embB.length,
      describedA, describedB,
      descriptionMatches: equivalent.filter((e) => e.basis === 'description').length,
      plosA: a.plos.length, plosB: b.plos.length, defaultedCredits,
    },
  };
  return {
    programAId: a.id, programBId: b.id,
    structure, content, outcome, overlapIndex, containmentAInB, containmentBInA,
    band: bandFor(overlapIndex, t),
    sharedCredits, equivCredits, sharedStaff, marketSimilarity, languageVariant,
    actions, primaryAction, evidence,
    evidenceHash: computeEvidenceHash({
      evidence, structure, content, outcome, containmentAInB, containmentBInA,
      sharedStaff, marketSimilarity, actions, languageVariant,
    }),
  };
}

/** Thai and international versions of the same programme: the same programme
 *  name once international markers are stripped, AND either the recorded
 *  languages differ (both known) or exactly one of the two programmes carries
 *  an international marker in its Thai or English name. The marker arm exists
 *  because dev records both halves of some pairs as MIXED (e.g. the Thai and
 *  international MSc Pharmacology). Identical unmarked names in the same
 *  language are a true duplicate, not a variant.
 *  A shared degreeNameTh alone is deliberately NOT sufficient: on dev, generic
 *  degree names such as "วิศวกรรมศาสตรบัณฑิต" and "ปรัชญาดุษฎีบัณฑิต" span
 *  unrelated programmes in both languages, and would shield real overlaps from
 *  the merge action and the KRIs. */
export function isLanguageVariant(a: OverlapProgramme, b: OverlapProgramme): boolean {
  if (languageVariantKey(a.nameTh) !== languageVariantKey(b.nameTh)) return false;
  if (a.language && b.language && a.language !== b.language) return true;
  const marked = (p: OverlapProgramme): boolean => hasInternationalMarker(p.nameTh) || hasInternationalMarker(p.nameEn);
  return marked(a) !== marked(b);
}

/** Store a pair when it scores ≥ storeIndex, shares a major course or staff,
 *  or its market similarity reaches the market-confusion WARN — so
 *  market_confusion_max sees a confusable pair even when its curriculum
 *  overlap is low or unmeasured. */
export function shouldStorePair(s: PairScore, t: OverlapThresholds = OVERLAP_THRESHOLDS): boolean {
  return (
    (s.overlapIndex !== null && s.overlapIndex >= t.storeIndex) ||
    s.evidence.sharedCourses.length > 0 ||
    s.sharedStaff > 0 ||
    (s.marketSimilarity !== null && s.marketSimilarity >= t.marketConfusionWarn)
  );
}
