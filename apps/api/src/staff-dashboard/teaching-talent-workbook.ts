import * as XLSX from 'xlsx';
import {
  TALENT_WINDOW_YEARS,
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

/** The sentinel the controller passes when a user's grants resolve to
 *  nothing. It is an internal token; it must never be printed raw on a
 *  sheet a dean reads. Kept in sync with the controller's clamp branch. */
const NO_GRANTS_SENTINEL = '__none__';

function facultyFilterLabel(facultyName: string[]): string {
  if (facultyName.length === 0) return 'All faculties';
  if (facultyName.every((n) => n === NO_GRANTS_SENTINEL)) {
    return 'None — your account has no faculty grants';
  }
  return facultyName.join(', ');
}

/**
 * The single definition of who is in the file.
 *
 * Exported because the service also needs the count for its audit payload.
 * Deriving that count from a second copy of this predicate is exactly where
 * the page, the file and the log would drift apart — the one thing this
 * feature promises they never do.
 *
 * Returned sorted in sheet order: faculty (Thai collation), then strongest
 * overall first.
 */
export function selectTalents(
  result: TeachingTalentResult,
  threshold: number,
): TeachingTalentResult['rows'] {
  return result.rows
    .filter((r) => classifyTalent(ratingsOf(r.byYear), result.years, threshold).isTalent)
    .sort(
      (a, b) =>
        a.facultyName.localeCompare(b.facultyName, 'th') ||
        (b.overallRating ?? 0) - (a.overallRating ?? 0),
    );
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
  const talents = selectTalents(result, threshold);

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
  //
  // 'Responses', NOT 'Respondents': the underlying figure is
  // SUM(respondent_count) over evaluation_response_summaries, whose
  // natural key includes question_id_registrar — one row per (year,
  // semester, class, QUESTION, instructor). It counts question-answers,
  // not students. Measured live: the top instructor has 1,755 rows across
  // 63 classes and 29 distinct questions, summing to 175,320. A column
  // headed 'Respondents' reading 175,320 for one lecturer would be read as
  // students and is indefensible. The About sheet defines the term; the
  // arithmetic is unchanged.
  const unmatchedRows: Array<Array<string | number>> = [
    [
      'Email',
      // 'class owner' is load-bearing, not decoration — see the About
      // sheet's 'Populations' row. This column is the faculty that owned
      // the CLASS, which is not necessarily the teacher's home faculty.
      'Faculty (class owner)',
      ...years.map((y) => `BE ${y}`),
      'Responses',
      'Overall score',
      'Would qualify',
    ],
  ];
  // Classify once per teacher, then sort and write off the precomputed
  // flag — a comparator that classifies runs the rule O(n log n) times.
  const sortedUnmatched = unmatched.teachers
    .map((teacher) => ({
      teacher,
      qualifies: classifyTalent(ratingsOf(teacher.byYear), years, threshold).isTalent,
    }))
    .sort(
      (a, b) =>
        Number(b.qualifies) - Number(a.qualifies) ||
        (b.teacher.overallRating ?? 0) - (a.teacher.overallRating ?? 0),
    );
  for (const { teacher: t, qualifies } of sortedUnmatched) {
    unmatchedRows.push([
      t.kkuEmail,
      t.facultyName ?? '',
      ...years.map((y) => score(t.byYear[String(y)]?.ratingAvg ?? null)),
      t.totalRespondents,
      score(t.overallRating),
      qualifies ? 'yes' : 'no',
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
      // TALENT_WINDOW_YEARS, never years.length. The rule is always
      // three years; years.length is how many the DATA supports. On thin
      // data (0-2 years) interpolating the latter would print "in every
      // one of the last 2 completed academic years" beside "Talents
      // exported: 0" — reading as "nobody at KKU cleared this over two
      // years", which is false. The 'Window complete' row below is where
      // the shortfall gets stated.
      'Rule',
      `Student-evaluation score of at least ${threshold.toFixed(2)} in every one of the last ${TALENT_WINDOW_YEARS} completed academic years`,
    ],
    ['Assessment window', windowLabel],
    [
      'Window complete',
      result.windowComplete
        ? 'yes'
        : `no — only ${years.length} of ${TALENT_WINDOW_YEARS} completed years carry data; nobody qualifies`,
    ],
    ['Threshold', threshold],
    ['Semesters included', 'All (1, 2, summer and special terms)'],
    ['Faculty filter', facultyFilterLabel(opts.facultyName)],
    [
      'Responses',
      'Individual answers to evaluation questions, not students — a class evaluated on 29 questions contributes 29 responses per student.',
    ],
    [
      // The two counts below are NOT measured the same way, and printed
      // adjacently they invite the reader to compare them directly.
      'Populations',
      'Instructors assessed are grouped by their HOME faculty, so all of their teaching counts. Teachers with no HR record are grouped by the faculty that owned the CLASS, so under a faculty filter only that faculty’s classes count. The two rows below are therefore not directly comparable.',
    ],
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
