// Aggregates instructorPersonal() output into what the /profile evaluation
// panel shows: KPIs, the latest vs previous academic year, and a respondent-
// weighted score per question category (themeTag) all-time and for the latest
// year. Pure; type-only imports.
import type { InstructorPersonalResult } from '@kku/db';

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

export interface EvaluationCategoryScore {
  tag: string;
  questions: number;
  allTime: number | null;
  latest: number | null;
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
  freshnessDate: string | null;
  methodologyVersion: string;
}

function weighted(pairs: Array<{ value: number; weight: number }>): number | null {
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  return total > 0 ? pairs.reduce((s, p) => s + p.value * p.weight, 0) / total : null;
}

export function summariseTeachingEvaluation(
  r: InstructorPersonalResult,
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

  const byTag = new Map<string, InstructorPersonalResult['byQuestion']>();
  let untaggedQuestions = 0;
  for (const q of r.byQuestion) {
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
    freshnessDate,
    methodologyVersion: r.methodologyVersion,
  };
}

/** Radial axis for 1–5 ratings: start at 3 unless a plotted value is lower
 *  (then the half point below it), so no point is clipped to the centre. */
export function evaluationRadarDomain(values: Array<number | null>): [number, number] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return [3, 5];
  const min = Math.min(...present);
  return [Math.min(3, Math.floor(min * 2) / 2), 5];
}
