import * as XLSX from 'xlsx';
import {
  classifyTalent,
  displayRating,
  splitPersonName,
  type TeachingTalentResult,
} from '@kku/db';

// Thai rank labels. The web app has its own maps
// (apps/web/src/lib/profile-data.ts) but apps/api cannot import from
// apps/web, so the labels are restated here.
const RANK_LABEL_TH: Record<string, string> = {
  LECTURER: 'อาจารย์',
  ASST_PROF: 'ผู้ช่วยศาสตราจารย์',
  ASSOC_PROF: 'รองศาสตราจารย์',
  PROF: 'ศาสตราจารย์',
};

export interface TalentWorkbookOptions {
  threshold: number;
  /** Faculty filter in force, for the About sheet. Empty = all faculties. */
  facultyName: string[];
  /** Injectable for deterministic tests. */
  generatedAt?: Date;
}

function ratingsOf(byYear: TeachingTalentResult['rows'][number]['byYear']) {
  const out: Record<string, number | null> = {};
  for (const [year, cell] of Object.entries(byYear)) out[year] = cell.ratingAvg;
  return out;
}

function score(value: number | null): number | string {
  return value === null ? '' : displayRating(value);
}

export function buildTalentWorkbook(
  result: TeachingTalentResult,
  opts: TalentWorkbookOptions,
): Buffer {
  const { years, unmatched } = result;
  const threshold = opts.threshold;
  const windowLabel =
    years.length > 0 ? `BE ${years[0]}–${years[years.length - 1]}` : 'no complete years';

  // ── Sheet 1: Talent ──────────────────────────────────────────────────
  const talents = result.rows
    .filter((r) => classifyTalent(ratingsOf(r.byYear), years, threshold).isTalent)
    .sort(
      (a, b) =>
        a.facultyName.localeCompare(b.facultyName, 'th') ||
        (b.overallRating ?? 0) - (a.overallRating ?? 0),
    );

  const talentRows: Array<Array<string | number>> = [
    [
      'Faculty',
      'Academic rank',
      'First name',
      'Last name',
      'Email',
      'Overall score',
      'Full name (EN)',
    ],
  ];
  for (const r of talents) {
    const name = splitPersonName(r.nameTh);
    talentRows.push([
      r.facultyName,
      RANK_LABEL_TH[r.rank] ?? r.rank,
      name.first,
      name.last,
      r.kkuEmail ?? '',
      score(r.overallRating),
      r.nameEn,
    ]);
  }
  const talentSheet = XLSX.utils.aoa_to_sheet(talentRows);
  talentSheet['!cols'] = [
    { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 22 },
    { wch: 28 }, { wch: 13 }, { wch: 28 },
  ];

  // ── Sheet 2: Unmatched ───────────────────────────────────────────────
  // The reconciliation worklist. These teachers were evaluated but have no
  // HR record, so they cannot be named or exported as talents. Fixing this
  // means adding them to the kku-hr roster, not editing this dashboard.
  const unmatchedRows: Array<Array<string | number>> = [
    [
      'Email',
      'Faculty (class owner)',
      ...years.map((y) => `BE ${y}`),
      'Respondents',
      'Overall score',
      'Would qualify',
    ],
  ];
  const sortedUnmatched = [...unmatched.teachers].sort((a, b) => {
    const aq = classifyTalent(ratingsOf(a.byYear), years, threshold).isTalent ? 1 : 0;
    const bq = classifyTalent(ratingsOf(b.byYear), years, threshold).isTalent ? 1 : 0;
    return bq - aq || (b.overallRating ?? 0) - (a.overallRating ?? 0);
  });
  for (const t of sortedUnmatched) {
    unmatchedRows.push([
      t.kkuEmail,
      t.facultyName ?? '',
      ...years.map((y) => score(t.byYear[String(y)]?.ratingAvg ?? null)),
      t.totalRespondents,
      score(t.overallRating),
      classifyTalent(ratingsOf(t.byYear), years, threshold).isTalent ? 'yes' : 'no',
    ]);
  }
  const unmatchedSheet = XLSX.utils.aoa_to_sheet(unmatchedRows);
  unmatchedSheet['!cols'] = [
    { wch: 30 }, { wch: 28 },
    ...years.map(() => ({ wch: 11 })),
    { wch: 13 }, { wch: 13 }, { wch: 14 },
  ];

  // ── Sheet 3: About ───────────────────────────────────────────────────
  const aboutSheet = XLSX.utils.aoa_to_sheet([
    ['Field', 'Value'],
    ['Report', 'KKU Teaching and Learning Talent'],
    [
      'Rule',
      `Student-evaluation score of at least ${threshold.toFixed(2)} in every one of the last ${years.length} completed academic years`,
    ],
    ['Assessment window', windowLabel],
    ['Threshold', threshold],
    ['Semesters included', 'All (1, 2, summer and special terms)'],
    ['Faculty filter', opts.facultyName.length > 0 ? opts.facultyName.join(', ') : 'All faculties'],
    ['Instructors assessed', result.rows.length],
    ['Talents exported', talents.length],
    ['Evaluated teachers with no HR record', unmatched.teachers.length],
    ['Evaluation rows credited to no identifiable person', unmatched.unattributableRowCount],
    ['Methodology version', result.methodologyVersion],
    ['Generated at', (opts.generatedAt ?? new Date()).toISOString()],
  ]);
  aboutSheet['!cols'] = [{ wch: 44 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, talentSheet, 'Talent');
  XLSX.utils.book_append_sheet(wb, unmatchedSheet, 'Unmatched');
  XLSX.utils.book_append_sheet(wb, aboutSheet, 'About');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** `kku-teaching-talent-BE2566-2568-min4.00.xlsx` */
export function talentWorkbookFilename(years: number[], threshold: number): string {
  const window =
    years.length > 0 ? `BE${years[0]}-${years[years.length - 1]}` : 'no-window';
  return `kku-teaching-talent-${window}-min${threshold.toFixed(2)}.xlsx`;
}
