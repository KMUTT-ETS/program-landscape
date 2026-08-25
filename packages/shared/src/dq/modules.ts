/**
 * KKU Digital Intelligence (DQ) competency framework — module table and
 * the pure helpers the dashboard, the connector and any future export
 * all share.
 *
 * Framework source: KKUDQ.pdf (LTIC) — "กรอบสมรรถนะความฉลาดทางดิจิทัล
 * สำหรับนักศึกษาระดับปริญญาตรี". That document defines modules 1-12 in
 * three domains. Module 13 (Generative AI) appears in the export but NOT
 * in the supplied revision of the framework, so it carries an English
 * label from the operator and no Thai name until the revised document
 * lands. Do not invent one.
 */

export type DqModuleKind = 'THEORY' | 'WORKSHOP';

export type DqDomain =
  | 'ESSENTIAL_COMPUTER'
  | 'ESSENTIAL_SOFTWARE'
  | 'TECHNOLOGY_AT_WORK'
  | 'GENERATIVE_AI';

export const DQ_DOMAIN_LABELS: Record<DqDomain, string> = {
  ESSENTIAL_COMPUTER: 'Essential Computer',
  ESSENTIAL_SOFTWARE: 'Essential Software',
  TECHNOLOGY_AT_WORK: 'Technology at Work',
  GENERATIVE_AI: 'Generative AI',
};

/** Measured from the source, not assumed: no `allPassed` student scores
 *  below this on any of modules 1-12. See the design doc. */
export const DQ_PASS_MARK = 70;

/** A score of 0 means the module was not taken — see the design doc.
 *  Exported so every consumer tests the same way rather than each
 *  writing `> 0` and one of them eventually writing `>= 0`. */
export function dqScoreWasTaken(score: number | null | undefined): boolean {
  return typeof score === 'number' && score > 0;
}

export interface DqModule {
  /** Exact key in the export payload, e.g. 'THEORY_MODULE_7'. */
  key: string;
  no: number;
  kind: DqModuleKind;
  nameEn: string;
  /** Null where the framework document does not define one (module 13). */
  nameTh: string | null;
  domain: DqDomain;
  /** Radar axis label — 13 axes must fit, so keep these short. */
  shortEn: string;
}

interface TheorySeed {
  no: number;
  nameEn: string;
  nameTh: string | null;
  domain: DqDomain;
  shortEn: string;
}

const THEORY_SEED: readonly TheorySeed[] = [
  { no: 1,  nameEn: 'Computer Basics',      nameTh: 'การใช้คอมพิวเตอร์พื้นฐาน',  domain: 'ESSENTIAL_COMPUTER', shortEn: 'Basics' },
  { no: 2,  nameEn: 'Internet',             nameTh: 'การใช้อินเทอร์เน็ต',        domain: 'ESSENTIAL_COMPUTER', shortEn: 'Internet' },
  { no: 3,  nameEn: 'Online Collaboration', nameTh: 'การทำงานร่วมกันแบบออนไลน์', domain: 'ESSENTIAL_COMPUTER', shortEn: 'Collaboration' },
  { no: 4,  nameEn: 'Operating System',     nameTh: 'ระบบปฏิบัติการ',            domain: 'ESSENTIAL_COMPUTER', shortEn: 'OS' },
  { no: 5,  nameEn: 'Word Processing',      nameTh: 'การใช้โปรแกรมประมวลคำ',     domain: 'ESSENTIAL_SOFTWARE', shortEn: 'Word' },
  { no: 6,  nameEn: 'Spreadsheet',          nameTh: 'การใช้โปรแกรมตารางคำนวณ',   domain: 'ESSENTIAL_SOFTWARE', shortEn: 'Spreadsheet' },
  { no: 7,  nameEn: 'Presentation',         nameTh: 'การใช้โปรแกรมการนำเสนองาน', domain: 'ESSENTIAL_SOFTWARE', shortEn: 'Presentation' },
  { no: 8,  nameEn: 'Digital Media',        nameTh: 'การสร้างสื่อดิจิทัล',         domain: 'ESSENTIAL_SOFTWARE', shortEn: 'Digital Media' },
  { no: 9,  nameEn: 'Social Media',         nameTh: 'การใช้สื่อสังคมออนไลน์',      domain: 'TECHNOLOGY_AT_WORK', shortEn: 'Social Media' },
  { no: 10, nameEn: 'Information Literacy', nameTh: 'การรู้สารสนเทศ',            domain: 'TECHNOLOGY_AT_WORK', shortEn: 'Info Literacy' },
  { no: 11, nameEn: 'Career Search Skills', nameTh: 'ทักษะการค้นหาอาชีพ',        domain: 'TECHNOLOGY_AT_WORK', shortEn: 'Career Search' },
  { no: 12, nameEn: 'Digital Footprint',    nameTh: 'ร่องรอยทางดิจิทัล',          domain: 'TECHNOLOGY_AT_WORK', shortEn: 'Footprint' },
  { no: 13, nameEn: 'Generative AI',        nameTh: null,                       domain: 'GENERATIVE_AI',      shortEn: 'Generative AI' },
];

/** Workshops exist only for the Essential Software modules — this
 *  matches the export, which carries WORKSHOP_MODULE_5..8 and no others. */
const WORKSHOP_NUMBERS = [5, 6, 7, 8] as const;

export const DQ_MODULES: readonly DqModule[] = [
  ...THEORY_SEED.map((t): DqModule => ({
    key: `THEORY_MODULE_${t.no}`,
    kind: 'THEORY',
    no: t.no,
    nameEn: t.nameEn,
    nameTh: t.nameTh,
    domain: t.domain,
    shortEn: t.shortEn,
  })),
  ...WORKSHOP_NUMBERS.map((no): DqModule => {
    const t = THEORY_SEED.find((x) => x.no === no)!;
    return {
      key: `WORKSHOP_MODULE_${no}`,
      kind: 'WORKSHOP',
      no,
      nameEn: `${t.nameEn} (workshop)`,
      nameTh: t.nameTh,
      domain: t.domain,
      shortEn: t.shortEn,
    };
  }),
];

export function theoryModules(): DqModule[] {
  return DQ_MODULES.filter((m) => m.kind === 'THEORY').sort((a, b) => a.no - b.no);
}

export function workshopModules(): DqModule[] {
  return DQ_MODULES.filter((m) => m.kind === 'WORKSHOP').sort((a, b) => a.no - b.no);
}

export function dqModuleByKey(key: string): DqModule | undefined {
  return DQ_MODULES.find((m) => m.key === key);
}

/**
 * Normalise the export's `faculty` field.
 *
 * The source mixes plain names with breadcrumb paths
 * ("คณะวิศวกรรมศาสตร์ / ปริญญาตรี ภาคปกติ / นักศึกษา"). Measured: 82 raw
 * strings collapse to 39 this way, of which 24 match Faculty.nameTh
 * exactly. Blank becomes one explicit bucket rather than an empty string
 * that renders as a nameless row.
 */
export function normaliseDqFaculty(raw: string | null | undefined): string {
  const head = (raw ?? '').split('/')[0] ?? '';
  const cleaned = head.trim().replace(/\s+/g, ' ');
  return cleaned.length > 0 ? cleaned : '(unknown)';
}

/** Plausible BE admission years. Outside this range the id is a bad
 *  record, not a cohort — the export contains ids starting "12" and "46",
 *  neither of which appears in the measured admission-year distribution
 *  (BE 63-69, plus an aggregated "63 and older" tail — see the design
 *  doc). The floor is set below that observed range to keep room for
 *  genuine long-tail alumni without admitting clearly bad prefixes; the
 *  ceiling tracks the current BE year plus a small buffer for the next
 *  intake. */
const COHORT_MIN_BE = 2550;
const COHORT_MAX_BE = 2570;

/**
 * BE admission year from a KKU student code — the first two digits.
 * `643020334-9` → 2564. Returns null when the id cannot yield a
 * plausible year, so callers group those explicitly instead of
 * inventing a 2512 cohort.
 */
export function cohortFromStudentId(studentId: string | null | undefined): number | null {
  const digits = (studentId ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 2) return null;
  const year = 2500 + Number(digits.slice(0, 2));
  if (!Number.isFinite(year) || year < COHORT_MIN_BE || year > COHORT_MAX_BE) return null;
  return year;
}

/**
 * Mean score for a module from a stored sum and count.
 *
 * Cubes store `scoreSum` + `takenCount` rather than a mean precisely so
 * that a rollup across programs or faculties is a true weighted mean and
 * not a mean of means. Returns null — never 0 — when nobody took it.
 */
export function dqModuleMean(scoreSum: number, takenCount: number): number | null {
  if (takenCount <= 0) return null;
  return scoreSum / takenCount;
}
