// Shared types for the Gap Analyzer UI. Mirror the API response shapes
// from @kku/db's gap-map helpers — intentionally not importing from db
// here because this is a client-reachable module.

import type { ApiMeta } from '@kku/shared';
// `@kku/shared/demand/sources` rather than the root barrel: this module is
// imported at runtime (not type-only) by server components in this folder,
// and staying on the client-safe subpath means it never becomes a trap if
// one of those files ever gains a 'use client' pragma.
import { DEFAULT_DEMAND_BASIS, DEMAND_BASES, type DemandBasis } from '@kku/shared/demand/sources';

export type { DemandBasis };

// ── The demand-first field map (gap-map.v1) ───────────────────────────────

/** Six verdicts, mirroring `GAP_VERDICTS` in `@kku/db/gap-map-rules`.
 *
 *  `supply-unknown` is the one that is easy to read wrongly: the field HAS
 *  KKU programmes, but not one of them carries a graduate figure, so no
 *  ratio exists. It is a missing measurement, never a shortfall — which is
 *  why it is toned like absent data rather than like a white space. */
export type GapVerdictT =
  | 'white-space'
  | 'under-served'
  | 'served'
  | 'over-served'
  | 'supply-unknown'
  | 'too-few-postings';

export const VERDICT_ORDER: readonly GapVerdictT[] = [
  'white-space',
  'under-served',
  'served',
  'over-served',
  'supply-unknown',
  'too-few-postings',
];

export const VERDICT_LABEL: Record<GapVerdictT, string> = {
  'white-space': 'White space',
  'under-served': 'Under-served',
  served: 'Served',
  'over-served': 'Over-served',
  'supply-unknown': 'Supply unknown',
  'too-few-postings': 'Too few postings',
};

/** A programme linked to an occupation, arriving with its names resolved.
 *  It deliberately carries no bare id for the page to display: the ids used
 *  to be sent alone and resolved against the field's own programme list,
 *  which missed every programme outside the field and printed a cuid. */
export interface GapLinkedProgrammeT {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  /** False means the occupation also recruits from a programme assigned to
   *  another field — said in words, not hidden. */
  inField: boolean;
}

export interface GapOccupationT {
  occupationId: string;
  code: string;
  category: string;
  subcategory: string;
  postings: number;
  /** A sample — at most three from inside the field and three from
   *  outside. `linkedInField` / `linkedOutsideField` are the full counts,
   *  so the page can say how many more there are. */
  linkedProgrammes: GapLinkedProgrammeT[];
  linkedInField: number;
  linkedOutsideField: number;
}

export interface GapProgrammeT {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  facultyId: string | null;
  facultyNameEn: string | null;
  gradsPerYear: number | null;
  supplySource: 'alumni' | 'enrolment-proxy' | null;
  /** How many entry cohorts the alumni mean was taken over — shown beside
   *  the figure, because one cohort and six are not the same evidence. */
  supplyCohorts: number | null;
  /** The academic year (CE) the enrolment fallback was read from. Shown
   *  whenever `supplySource === 'enrolment-proxy'`: the reach-back has no
   *  floor, so a figure can be years old and must say so. */
  supplyYear: number | null;
  durationYears: number | null;
  pipeline: number | null;
  healthScore: number | null;
  scored: boolean;
  reviewStatus: 'PROPOSED' | 'APPROVED';
}

export interface GapGlobalSignalT {
  /** Each pick carries its own series and its own context count — read
   *  `scope` and `contexts` here, next to the figure, never from the
   *  aggregate `scope` below: a 782 % figure averaged over one context
   *  and a 41 % figure averaged over 28 must not look alike. */
  skills: Array<{
    skillId: string;
    nameEn: string;
    nameTh: string;
    growthPct: number;
    scope?: 'THAILAND' | 'GLOBAL';
    contexts?: number;
  }>;
  /** Coarse "is there any Thai evidence here" flag for the whole trio —
   *  not a per-skill value. */
  scope: 'THAILAND' | 'GLOBAL' | null;
}

export interface GapTrendSignalT {
  id: string;
  title: string;
  signalType: string;
  impactScore: number;
  detectedDate: string;
  matchedBy: 'programme' | 'initiative';
}

export interface GapRowT {
  slug: string;
  nameTh: string;
  nameEn: string;
  reviewStatus: 'PROPOSED' | 'APPROVED';
  postings: number;
  demandShare: number;
  /** This field's share of eligible JobThai-only postings, normalised by
   *  the private side's own field-mentions — always computed, whatever the
   *  active basis, so switching the URL parameter shows the alternative
   *  without a second read. */
  privateDemandShare: number;
  /** This field's share of eligible job-108 postings inside the active
   *  public window, normalised the same "always computed" way. */
  publicDemandShare: number;
  /** Distinct eligible JobThai postings naming this field (unwindowed —
   *  JobThai carries no real posted date). */
  privatePostings: number;
  /** Distinct eligible job-108 postings naming this field, inside the
   *  active public window. */
  publicPostings: number;
  supplyShare: number;
  ratio: number | null;
  verdict: GapVerdictT;
  gradsPerYear: number | null;
  pipeline: number | null;
  pipelineArrow: 'up' | 'down' | 'flat' | null;
  programmeCount: number;
  /** Of `programmeCount` scored programmes, how many carry a graduate
   *  figure. Below `programmeCount` means the supply share is built from
   *  part of the field only — the programmes panel says so in words. */
  programmesWithSupply: number;
  /** Listed under the field but never scored because they are
   *  postgraduate. A white space carrying one of these is NOT a field KKU
   *  is absent from, and the collapsed row says so — otherwise
   *  "Programmes: —" reads identically to a field with nothing at all. */
  postgraduateProgrammes: number;
  signalCount: number;
  kkuTotal: { supplyShare: number; ratio: number | null; verdict: GapVerdictT } | null;
  provinces: Array<{ province: string; share: number }>;
  occupations: GapOccupationT[];
  programmes: GapProgrammeT[];
  facultyIds: string[];
  globalSignal: GapGlobalSignalT;
  trendSignals: GapTrendSignalT[];
}

export interface GapMapT {
  methodologyVersion: string;
  computedAt: string;
  scope: { level: 'university' | 'faculty' | 'department'; id: string | null; label: string | null };
  thresholds: { under: number; over: number };
  rows: GapRowT[];
  verdictCounts: Record<GapVerdictT, number>;
  facultyStrip: Array<{
    facultyId: string;
    nameTh: string;
    nameEn: string;
    counts: Record<GapVerdictT, number>;
  }>;
  reconciliation: {
    eligiblePostings: number;
    fieldPostings: number;
    fieldMentions: number;
    multiFieldPostings: number;
    anyFieldPostings: number;
    otherKinds: number;
    otherMentions: number;
    postgraduatePostings: number;
    demandShareSum: number;
    supplyShareSum: number;
    multiFieldProgrammes: number;
    /** Σ over fields of the field's graduates per year — the supply
     *  denominator, so a two-field programme is counted in both. */
    fieldGraduatesTotal: number;
    /** Distinct scored programmes across all rows — counted once each,
     *  unlike `fieldGraduatesTotal`. */
    scoredProgrammes: number;
    /** How many of those carry a graduates-per-year figure at all. */
    scoredWithSupply: number;
    /** How many of `scoredWithSupply` rest on the enrolment-metric
     *  fallback rather than on alumni entry cohorts. */
    supplyFromProxy: number;
  };
  taxonomy: { approved: number; proposed: number };
  freshness: { postingsAsOf: string | null; taxonomyAsOf: string | null };
}

export interface GapPageParams {
  scope: 'university' | 'faculty' | 'department';
  scopeId: string | null;
  verdict: 'all' | GapVerdictT;
  facultyId: string | null;
  under: number;
  over: number;
  field: string | null;
  /** Which market forms the demand denominator. Defaults to `all` (both
   *  markets) — see `DEFAULT_DEMAND_BASIS` for why. */
  basis: DemandBasis;
}

/** URL → params. Bad thresholds fall back to defaults rather than 500 the page;
 *  the api validates the same values and the drawer echoes what is in force. */
export function resolveGapParams(sp: Record<string, string | undefined>): GapPageParams {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  let under = num(sp.under, 0.5);
  let over = num(sp.over, 2);
  if (!(under < over)) {
    under = 0.5;
    over = 2;
  }
  const scope = sp.scope === 'faculty' || sp.scope === 'department' ? sp.scope : 'university';
  const verdict = (VERDICT_ORDER as readonly string[]).includes(sp.verdict ?? '')
    ? (sp.verdict as GapVerdictT)
    : 'all';
  const basis = (DEMAND_BASES as readonly string[]).includes(sp.basis ?? '')
    ? (sp.basis as DemandBasis)
    : DEFAULT_DEMAND_BASIS;
  return {
    scope,
    scopeId: sp.scopeId ?? null,
    verdict,
    facultyId: sp.faculty ?? null,
    under,
    over,
    field: sp.field ?? null,
    basis,
  };
}

export function gapHref(p: GapPageParams, patch: Partial<GapPageParams> = {}): string {
  const q = { ...p, ...patch };
  const s = new URLSearchParams();
  if (q.scope !== 'university') {
    s.set('scope', q.scope);
    if (q.scopeId) s.set('scopeId', q.scopeId);
  }
  if (q.verdict !== 'all') s.set('verdict', q.verdict);
  if (q.facultyId) s.set('faculty', q.facultyId);
  if (q.under !== 0.5) s.set('under', String(q.under));
  if (q.over !== 2) s.set('over', String(q.over));
  if (q.field) s.set('field', q.field);
  if (q.basis !== DEFAULT_DEMAND_BASIS) s.set('basis', q.basis);
  const qs = s.toString();
  return `/gap-analysis${qs ? `?${qs}` : ''}`;
}

export interface GapPageData {
  params: GapPageParams;
  map: GapMapT;
  meta: ApiMeta;
}

// ── Digital-competency attainment lens (dq-skill-lens.v1) ─────────────────
// A separate axis beside the gap output, never a modifier on it: nothing
// above this comment reads any of the fields below. The page that renders
// these lives at /education/digital-competency; the types stay here because
// the endpoint behind it is still /gap/digital-competency.

export type DqSkillConfidenceDto = 'exact' | 'near' | 'none';

export interface DqLensDemandDto {
  demand: number;
  careerCount: number;
  topCareers: string[];
}

export interface DqLensProgramRowDto {
  programId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  mean: number;
  takenCount: number;
}

export interface DqSkillLensRowDto {
  moduleNo: number;
  moduleKey: string;
  moduleNameEn: string;
  moduleNameTh: string | null;
  confidence: DqSkillConfidenceDto;
  note: string;
  skillId: string | null;
  skillNameEn: string | null;
  demandThailand: DqLensDemandDto | null;
  demandGlobal: DqLensDemandDto | null;
  mean: number | null;
  takenCount: number;
  studentsInScope: number;
  coveragePct: number | null;
  weakestPrograms: DqLensProgramRowDto[];
}

export interface DqSkillLensResponse {
  scope: string;
  scopeId: string | null;
  rows: DqSkillLensRowDto[];
  counts: {
    exact: number;
    near: number;
    none: number;
    withThailandDemand: number;
    withGlobalDemand: number;
  };
  thailandQuadrantRows: number;
  thailandQuadrantSkillRows: number;
  dqRefreshedAt: string | null;
  methodologyVersion: string;
  asOf: string;
}
