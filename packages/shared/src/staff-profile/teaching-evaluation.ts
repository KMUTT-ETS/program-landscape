// Aggregates a staff member's student course evaluations into what the
// /profile "My teaching evaluation" panel shows and the external staff-profile
// API carries: KPIs, the latest vs previous academic year, a respondent-
// weighted score per question category (themeTag) all-time and for the latest
// year, and a rating per course.
//
// BROWSER-SAFE: no imports at all. The /profile panel is a client component
// and reaches this file by deep path (`@kku/shared/src/staff-profile/
// teaching-evaluation`), never through the @kku/shared barrel, which pulls
// node:crypto. apps/web/test/profile-types-client-safe.test.ts pins that.
//
// The input is a structural type rather than @kku/db's InstructorPersonalResult
// (shared cannot import @kku/db); InstructorPersonalResult satisfies it.

export const EVALUATION_THEME_ORDER = [
  'active-learning', 'ethics', 'assessment', 'feedback', 'content-design', 'english-skills',
] as const;

export const EVALUATION_THEME_LABELS: Record<string, { en: string; th: string }> = {
  'active-learning': { en: 'Active learning', th: 'การเรียนรู้เชิงรุก' },
  ethics: { en: 'Ethics', th: 'คุณธรรมจริยธรรม' },
  assessment: { en: 'Assessment', th: 'การวัดและประเมินผล' },
  feedback: { en: 'Feedback / Q&A', th: 'การให้ข้อมูลย้อนกลับ' },
  'content-design': { en: 'Content & design', th: 'เนื้อหาและการออกแบบ' },
  'english-skills': { en: 'English skills', th: 'ทักษะภาษาอังกฤษ' },
};

/** The fields of instructorPersonal()'s result the summary reads. */
export interface EvaluationSource {
  methodologyVersion: string;
  summary: { ratingAvg: number; totalRespondents: number; courseCount: number };
  trend: Array<{ acadYearBE: number; ratingAvg: number | null; respondentCount: number }>;
  byQuestion: Array<{
    themeTag: string | null;
    ratingAvg: number;
    respondentCount: number;
    byYear: Record<string, { ratingAvg: number; respondentCount: number }>;
  }>;
  byCourse: Array<{
    courseCode: string;
    courseNameTh: string | null;
    courseNameEn: string | null;
    ratingAvg: number;
    respondentCount: number;
    latestYearBE: number;
    latestSemester: number;
  }>;
}

export interface EvaluationCategoryScore {
  tag: string;
  questions: number;
  allTime: number | null;
  latest: number | null;
}

export interface TeachingEvaluationCourse {
  code: string;
  nameTh: string | null;
  nameEn: string | null;
  rating: number;
  /** Answers, one per question answered — not students. */
  answers: number;
  latestYearBE: number;
  latestSemester: number;
}

export interface TeachingEvaluationSummary {
  overall: number;
  totalAnswers: number;
  courseCount: number;
  termCount: number;
  firstYearBE: number | null;
  lastYearBE: number | null;
  latestYearBE: number | null;
  latestRating: number | null;
  previousYearBE: number | null;
  previousRating: number | null;
  categories: EvaluationCategoryScore[];
  untaggedQuestions: number;
  /** Newest term first (latestYearBE desc, latestSemester desc), then code asc. */
  courses: TeachingEvaluationCourse[];
  freshnessDate: string | null;
  methodologyVersion: string;
}

function weighted(pairs: Array<{ value: number; weight: number }>): number | null {
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  return total > 0 ? pairs.reduce((s, p) => s + p.value * p.weight, 0) / total : null;
}

export function summariseTeachingEvaluation(
  r: EvaluationSource,
  freshnessDate: string | null,
): TeachingEvaluationSummary | null {
  if (r.summary.totalRespondents <= 0) return null;

  const termsWithData = r.trend.filter((t) => t.ratingAvg !== null && t.respondentCount > 0);
  const years = [...new Set(termsWithData.map((t) => t.acadYearBE))].sort((a, b) => a - b);
  const latestYearBE = years.at(-1) ?? null;
  const previousYearBE = years.length > 1 ? years.at(-2)! : null;
  const yearRating = (y: number | null): number | null =>
    y === null
      ? null
      : weighted(termsWithData.filter((t) => t.acadYearBE === y).map((t) => ({ value: t.ratingAvg!, weight: t.respondentCount })));

  const byTag = new Map<string, EvaluationSource['byQuestion']>();
  let untaggedQuestions = 0;
  for (const q of r.byQuestion) {
    // null and '' both mean "no category" — an empty tag must not become an axis.
    if (!q.themeTag) { untaggedQuestions += 1; continue; }
    byTag.set(q.themeTag, [...(byTag.get(q.themeTag) ?? []), q]);
  }
  const order = (tag: string) => {
    const i = (EVALUATION_THEME_ORDER as readonly string[]).indexOf(tag);
    return i === -1 ? EVALUATION_THEME_ORDER.length : i;
  };
  const categories = [...byTag.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([tag, qs]) => ({
      tag,
      questions: qs.length,
      allTime: weighted(qs.map((q) => ({ value: q.ratingAvg, weight: q.respondentCount }))),
      latest:
        latestYearBE === null
          ? null
          : weighted(
              qs.flatMap((q) => {
                const y = q.byYear[String(latestYearBE)];
                return y ? [{ value: y.ratingAvg, weight: y.respondentCount }] : [];
              }),
            ),
    }));

  const courses = r.byCourse
    .map((c) => ({
      code: c.courseCode,
      nameTh: c.courseNameTh,
      nameEn: c.courseNameEn,
      rating: c.ratingAvg,
      answers: c.respondentCount,
      latestYearBE: c.latestYearBE,
      latestSemester: c.latestSemester,
    }))
    .sort(
      (a, b) =>
        b.latestYearBE - a.latestYearBE ||
        b.latestSemester - a.latestSemester ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );

  return {
    overall: r.summary.ratingAvg,
    totalAnswers: r.summary.totalRespondents,
    courseCount: r.summary.courseCount,
    termCount: termsWithData.length,
    firstYearBE: years[0] ?? null,
    lastYearBE: latestYearBE,
    latestYearBE,
    latestRating: yearRating(latestYearBE),
    previousYearBE,
    previousRating: yearRating(previousYearBE),
    categories,
    untaggedQuestions,
    courses,
    freshnessDate,
    methodologyVersion: r.methodologyVersion,
  };
}
