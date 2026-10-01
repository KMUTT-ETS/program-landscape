'use client';

// "My teaching evaluation" on the owner's own /profile: five KPIs, a radar
// with one axis per question category (latest academic year against
// all-time), and the same numbers in a table beside it so nobody has to read
// a value off a polygon. Data is summarised server-side by
// summariseTeachingEvaluation(); this file only renders it.

import * as React from 'react';
import { Card, FreshnessBadge, ProvenanceButton, RadarChartSmall, Section, type RadarPoint } from '@kku/ui';
import { ClipboardCheck } from 'lucide-react';
import {
  EVALUATION_THEME_LABELS,
  evaluationRadarDomain,
  type TeachingEvaluationSummary,
} from '@/lib/teaching-evaluation-summary';

type Lang = 'th' | 'en';

const L = {
  en: {
    title: 'My teaching evaluation',
    overall: 'Overall',
    year: (y: number) => `AY ${y}`,
    vs: (y: number) => `vs AY ${y}`,
    answers: 'Answers',
    answersHint: 'one per question answered, not students',
    courses: 'Courses',
    terms: 'Terms',
    category: 'Category',
    allTime: 'All-time',
    latestSeries: (y: number) => `AY ${y}`,
    floor: (f: number) => `Scale starts at ${f}, not 0 — differences look larger than they are.`,
    untagged: (n: number) =>
      `${n} question${n === 1 ? ' has' : 's have'} no category — counted in the overall rating, not plotted.`,
    full: 'Full breakdown by question and course →',
    empty: 'No student evaluations recorded yet.',
    nd: 'n/d',
  },
  th: {
    title: 'การประเมินการสอนของฉัน',
    overall: 'ภาพรวม',
    year: (y: number) => `ปีการศึกษา ${y}`,
    vs: (y: number) => `เทียบปี ${y}`,
    answers: 'คำตอบ',
    answersHint: 'นับต่อข้อที่ตอบ ไม่ใช่จำนวนนักศึกษา',
    courses: 'รายวิชา',
    terms: 'ภาคการศึกษา',
    category: 'หมวด',
    allTime: 'ทุกปี',
    latestSeries: (y: number) => `ปี ${y}`,
    floor: (f: number) => `แกนเริ่มที่ ${f} ไม่ใช่ 0 — ความต่างจึงดูมากกว่าความจริง`,
    untagged: (n: number) => `มี ${n} ข้อที่ไม่มีหมวด — นับในคะแนนภาพรวม แต่ไม่แสดงในกราฟ`,
    full: 'ดูรายละเอียดรายข้อและรายวิชา →',
    empty: 'ยังไม่มีผลการประเมินจากนักศึกษา',
    nd: 'n/d',
  },
} as const;

const fmt = (v: number | null, d = 2): string | null => (v === null ? null : v.toFixed(d));

function Kpi({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-2/40 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">{label}</dt>
      <dd className="mt-1">
        <span className="text-2xl font-bold tabular-nums leading-none text-text-primary">{value}</span>
        {unit && <span className="ml-1 text-xs text-text-tertiary">{unit}</span>}
        {hint && <div className="mt-1 text-[11px] text-text-tertiary">{hint}</div>}
      </dd>
    </div>
  );
}

export function TeachingEvaluationPanel({
  summary,
  lang,
}: {
  summary: TeachingEvaluationSummary | null;
  lang: Lang;
}) {
  const l = L[lang];
  const title = (
    <span className="flex items-center gap-2">
      <ClipboardCheck className="h-12 w-12 text-text-tertiary" aria-hidden />
      {l.title}
    </span>
  );
  const fullLink = (
    <a href="/staff/teaching" className="text-sm text-accent-default hover:underline">
      {l.full}
    </a>
  );

  if (!summary) {
    return (
      <Section title={title}>
        <Card className="p-5" elevation="lg">
          <p className="text-sm text-text-secondary">{l.empty}</p>
          <div className="mt-3">{fullLink}</div>
        </Card>
      </Section>
    );
  }

  const label = (tag: string) => EVALUATION_THEME_LABELS[tag]?.[lang] ?? tag;
  const latestPoints: RadarPoint[] = summary.categories.map((c) => ({ label: label(c.tag), value: c.latest }));
  const allTimePoints: RadarPoint[] = summary.categories.map((c) => ({ label: label(c.tag), value: c.allTime }));
  const domain = evaluationRadarDomain([...latestPoints, ...allTimePoints].map((p) => p.value));
  const delta =
    summary.latestRating !== null && summary.previousRating !== null
      ? summary.latestRating - summary.previousRating
      : null;
  const deltaHint =
    delta === null || summary.previousYearBE === null ? undefined : (
      <span className={delta >= 0 ? 'text-success' : 'text-danger'}>
        {`${delta >= 0 ? '▲ +' : '▼ −'}${Math.abs(delta).toFixed(2)} ${l.vs(summary.previousYearBE)}`}
      </span>
    );

  return (
    <Section title={title}>
      <Card className="p-5" elevation="lg">
        <div className="flex items-center justify-end gap-2">
          <FreshnessBadge freshnessDate={summary.freshnessDate} label="student evaluations" />
          <ProvenanceButton
            size="xs"
            title={l.title}
            meta={{
              freshnessDate: summary.freshnessDate,
              sources: [{ id: 'kku-evaluations', name: 'KKU student course evaluations' }],
              methodologyVersion: summary.methodologyVersion,
              caveats: [
                'Ratings are on a 1–5 scale; category scores are respondent-weighted means of their questions.',
                'Answers count each question answered, not students.',
              ],
            }}
          />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Kpi label={l.overall} value={summary.overall.toFixed(2)} unit="/ 5" />
          <Kpi
            label={summary.latestYearBE !== null ? l.year(summary.latestYearBE) : l.overall}
            value={fmt(summary.latestRating) ?? '—'}
            unit="/ 5"
            hint={deltaHint}
          />
          <Kpi label={l.answers} value={summary.totalAnswers.toLocaleString('en-US')} hint={l.answersHint} />
          <Kpi label={l.courses} value={String(summary.courseCount)} />
          <Kpi
            label={l.terms}
            value={String(summary.termCount)}
            hint={summary.firstYearBE !== null ? `${summary.firstYearBE}–${summary.lastYearBE}` : undefined}
          />
        </dl>

        {summary.categories.length > 0 && (
          <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start">
            <div className="shrink-0">
              <RadarChartSmall
                points={latestPoints}
                seriesLabel={summary.latestYearBE !== null ? l.latestSeries(summary.latestYearBE) : l.allTime}
                comparisons={[{ label: l.allTime, points: allTimePoints }]}
                domain={domain}
                width={320}
                height={260}
              />
              <p className="mt-1 text-xs text-text-tertiary">{l.floor(domain[0])}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
                  <th className="pb-2 font-semibold">{l.category}</th>
                  <th className="pb-2 text-right font-semibold">
                    {summary.latestYearBE !== null ? l.latestSeries(summary.latestYearBE) : '—'}
                  </th>
                  <th className="pb-2 text-right font-semibold">{l.allTime}</th>
                </tr>
              </thead>
              <tbody>
                {summary.categories.map((c) => (
                  <tr key={c.tag} className="border-t border-subtle">
                    <td className="py-2 text-text-primary">{label(c.tag)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {fmt(c.latest) ?? <span className="text-text-tertiary">{l.nd}</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmt(c.allTime) ?? <span className="text-text-tertiary">{l.nd}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary.untaggedQuestions > 0 && (
          <p className="mt-3 text-xs text-text-tertiary">{l.untagged(summary.untaggedQuestions)}</p>
        )}
        <div className="mt-4 border-t border-subtle pt-3">{fullLink}</div>
      </Card>
    </Section>
  );
}
