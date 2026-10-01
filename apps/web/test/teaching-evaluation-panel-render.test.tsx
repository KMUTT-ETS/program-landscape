import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import { TEACHING_EVALUATION_LABELS, TeachingEvaluationPanel } from '../app/profile/teaching-evaluation-panel';
import type { TeachingEvaluationSummary } from '@/lib/teaching-evaluation-summary';

const summary: TeachingEvaluationSummary = {
  overall: 4.348, totalAnswers: 1880, courseCount: 1, termCount: 10, firstYearBE: 2564, lastYearBE: 2568,
  latestYearBE: 2568, latestRating: 4.61, previousYearBE: 2567, previousRating: 4.7,
  categories: [
    { tag: 'active-learning', questions: 3, allTime: 4.36, latest: 4.62 },
    { tag: 'ethics', questions: 2, allTime: 4.32, latest: null },
  ],
  untaggedQuestions: 1,
  courses: [{ code: '000101', nameTh: 'วิชาทดสอบ', nameEn: 'Test course', rating: 4.348, answers: 1880, latestYearBE: 2568, latestSemester: 2 }],
  freshnessDate: '2026-09-30T00:00:00.000Z', methodologyVersion: 'kku-evaluations.v1',
};

// The app root supplies both providers; FreshnessBadge and ProvenanceButton
// need them to render at all.
const render = (s: TeachingEvaluationSummary | null | 'unavailable', lang: 'th' | 'en' = 'en') =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ProvenanceProvider>
        <TeachingEvaluationPanel summary={s} lang={lang} />
      </ProvenanceProvider>
    </TooltipProvider>,
  );

describe('TeachingEvaluationPanel', () => {
  it('shows the five KPIs with explicit units', () => {
    const html = render(summary);
    expect(html).toContain('4.35');
    expect(html).toContain('/ 5');
    expect(html).toContain('1,880');
    expect(html).toContain('2564–2568');
    expect(html).toMatch(/−0\.09|-0\.09/); // latest vs previous, signed
  });
  it('lists every category with exact numbers, n/d for a missing year', () => {
    const html = render(summary);
    expect(html).toContain('Active learning');
    expect(html).toContain('4.62');
    expect(html).toContain('4.36');
    expect(html).toContain('n/d');
  });
  it('states the scale floor and the untagged question', () => {
    const html = render(summary);
    expect(html).toContain('Scale starts at 3');
    expect(html).toContain('1 question has no category');
  });
  it('links to the full breakdown', () => {
    expect(render(summary)).toContain('href="/staff/teaching"');
  });
  it('has an empty state', () => {
    const html = render(null);
    expect(html).toContain('No student evaluations recorded yet');
    expect(html).toContain('href="/staff/teaching"');
  });
  it('speaks Thai', () => {
    expect(render(summary, 'th')).toContain('การประเมินการสอนของฉัน');
  });
  it('says the evaluations are unavailable when the read failed — not that there are none', () => {
    const en = render('unavailable');
    expect(en).toContain('Teaching evaluations are temporarily unavailable.');
    expect(en).not.toContain('No student evaluations recorded yet');
    expect(en).toContain('href="/staff/teaching"');
    const th = render('unavailable', 'th');
    expect(th).toContain('ผลการประเมินการสอนไม่พร้อมใช้งานชั่วคราว');
    expect(th).not.toContain('ยังไม่มีผลการประเมินจากนักศึกษา');
  });
  it('shows a zero change as neutral, not as a green rise', () => {
    const html = render({ ...summary, latestRating: 4.7, previousRating: 4.7 });
    expect(html).toContain('± 0.00 vs AY 2567');
    expect(html).not.toContain('▲');
    expect(html).not.toContain('▼');
    expect(html).toMatch(/<span class="text-text-tertiary">± 0\.00 vs AY 2567<\/span>/);
  });
  it('colours a real rise and fall', () => {
    expect(render({ ...summary, latestRating: 4.8, previousRating: 4.7 })).toContain('text-success');
    expect(render(summary)).toContain('text-danger');
  });
  it('hides the latest-year KPI when there is no latest year, instead of repeating Overall', () => {
    const html = render({ ...summary, latestYearBE: null, latestRating: null, previousYearBE: null, previousRating: null });
    expect(html.match(/>Overall</g)?.length).toBe(1);
    expect(html).not.toContain('AY 2568');
  });
  it('localises the freshness label and provenance caveats', () => {
    const { en, th } = TEACHING_EVALUATION_LABELS;
    expect(th.freshnessLabel).not.toBe(en.freshnessLabel);
    expect(th.freshnessLabel).toMatch(/[\u0E00-\u0E7F]/);
    expect(th.caveats).toHaveLength(en.caveats.length);
    for (const c of th.caveats) expect(c).toMatch(/[\u0E00-\u0E7F]/);
  });
});
