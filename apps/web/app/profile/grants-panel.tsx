'use client';

// "Grants & academic service" on the owner's own /profile — never on /p/[slug].
// Summarised server-side by summariseStaffGrants(); this file only renders.
// Budgets are whole-project figures: the source states no per-person share.

import * as React from 'react';
import { HandCoins } from 'lucide-react';
import type { StaffGrantsSummary } from '@kku/shared';
import { Card, FreshnessBadge, ProvenanceButton, Section } from '@kku/ui';

type Lang = 'th' | 'en';
export type GrantsPanelState = StaffGrantsSummary | 'unlinked' | 'unavailable';

const L = {
  en: {
    title: 'Grants & academic service',
    led: 'Led',
    co: 'Co-investigator',
    active: 'Active now',
    totalGrants: 'Total grants',
    totalHint: 'sum of project totals',
    chartTitle: 'Grant budget by fiscal year',
    chartCaption: 'Project totals by fiscal year (BE), split by your role — not your share.',
    noGrants: (y: number) => `FY ${y}: no grants`,
    yearTip: (y: number, led: string, co: string, n: number) =>
      `FY ${y}: led ${led} · co-investigator ${co} · ${n} project${n === 1 ? '' : 's'}`,
    lead: 'Lead',
    projectTotal: 'project total',
    types: {
      RESEARCH: 'Research',
      ACADEMIC_SERVICE: 'Academic service',
      CONSULTING: 'Consulting',
      OTHER: 'Other',
    },
    fy: (y: number) => `FY ${y}`,
    unlinked: "We couldn't link you to the grants system.",
    empty: 'No external grants on record.',
    unavailable: 'Grants are temporarily unavailable.',
    freshnessLabel: 'grants',
    source: 'KKU Research & Academic Services (external grants)',
    caveats: [
      'Budget is the whole project budget, not your share.',
      'Externally funded projects only (ทุนภายนอก). Synced daily from KKU Research Administration.',
      'Active now counts projects whose start and end dates include today; projects missing either date are not counted.',
    ],
  },
  th: {
    title: 'ทุนวิจัยและบริการวิชาการ',
    led: 'หัวหน้าโครงการ',
    co: 'ผู้ร่วมโครงการ',
    active: 'กำลังดำเนินการ',
    totalGrants: 'งบประมาณรวม',
    totalHint: 'ผลรวมงบรวมโครงการ',
    chartTitle: 'งบทุนตามปีงบประมาณ',
    chartCaption: 'งบรวมโครงการตามปีงบประมาณ (พ.ศ.) แยกตามบทบาทของคุณ — ไม่ใช่ส่วนของคุณ',
    noGrants: (y: number) => `ปีงบ ${y}: ไม่มีทุน`,
    yearTip: (y: number, led: string, co: string, n: number) =>
      `ปีงบ ${y}: หัวหน้าโครงการ ${led} · ผู้ร่วมโครงการ ${co} · ${n} โครงการ`,
    lead: 'หัวหน้า',
    projectTotal: 'งบรวมโครงการ',
    types: {
      RESEARCH: 'วิจัย',
      ACADEMIC_SERVICE: 'บริการวิชาการ',
      CONSULTING: 'ที่ปรึกษา',
      OTHER: 'อื่นๆ',
    },
    fy: (y: number) => `ปีงบ ${y}`,
    unlinked: 'ไม่สามารถเชื่อมโยงคุณกับระบบทุนวิจัยได้',
    empty: 'ไม่มีข้อมูลทุนภายนอก',
    unavailable: 'ข้อมูลทุนไม่พร้อมใช้งานชั่วคราว',
    freshnessLabel: 'ข้อมูลทุน',
    source: 'ระบบงานวิจัยและบริการวิชาการ มข. (ทุนภายนอก)',
    caveats: [
      'งบประมาณเป็นงบรวมของโครงการ ไม่ใช่ส่วนของคุณ',
      'เฉพาะโครงการทุนภายนอก ซิงก์ทุกวันจากกองบริหารงานวิจัย',
      'กำลังดำเนินการ นับเฉพาะโครงการที่วันนี้อยู่ระหว่างวันเริ่มและวันสิ้นสุด โครงการที่ไม่มีวันใดวันหนึ่งจะไม่ถูกนับ',
    ],
  },
} as const;

const thb = (n: number | null) => (n === null ? '—' : `฿${n.toLocaleString('en-US')}`);

/** Short money label for KPIs and axes: ฿12.3M, ฿1.2B; full figure below a million. */
function compactThb(n: number): string {
  if (n >= 1e9) return `฿${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`;
  if (n >= 1e6) return `฿${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  return `฿${n.toLocaleString('en-US')}`;
}

function Kpi({
  label,
  value,
  hint,
  title,
}: {
  label: string;
  value: number | string;
  hint?: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-2/40 p-3" title={title}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums leading-none text-text-primary">
        {value}
      </dd>
      {hint ? <dd className="mt-1 text-[11px] text-text-tertiary">{hint}</dd> : null}
    </div>
  );
}

const LED_FILL = { fill: 'oklch(var(--color-chart-1))' };
const CO_FILL = { fill: 'oklch(var(--color-chart-3))' };

/** Stacked bars of project totals per fiscal year (led below, co-investigator above).
 *  Every year between the first and last is a slot, so gaps read as gaps. */
function GrantsByYearChart({ years, t }: { years: StaffGrantsSummary['byYear']; t: (typeof L)['en' | 'th'] }) {
  const W = 560;
  const H = 180;
  const pad = { l: 8, r: 8, t: 20, b: 22 };
  const max = Math.max(...years.map((y) => y.ledThb + y.coThb), 1);
  const slot = (W - pad.l - pad.r) / years.length;
  const bw = Math.min(36, slot * 0.6);
  const h = (v: number) => ((H - pad.t - pad.b) * v) / max;
  const base = H - pad.b;
  const labelEvery = years.length > 12 ? Math.ceil(years.length / 12) : 1;
  return (
    <figure className="mt-5">
      <figcaption className="text-xs font-semibold text-text-secondary">{t.chartTitle}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={t.chartTitle}>
        <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} style={{ stroke: 'oklch(var(--color-border-default))' }} strokeWidth={1} />
        {years.map((y, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const x = cx - bw / 2;
          const led = h(y.ledThb);
          const co = h(y.coThb);
          const total = y.ledThb + y.coThb;
          const tip = total === 0 ? t.noGrants(y.fiscalYearBe) : t.yearTip(y.fiscalYearBe, compactThb(y.ledThb), compactThb(y.coThb), y.projects);
          return (
            <g key={y.fiscalYearBe}>
              <title>{tip}</title>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={base - pad.t} fill="transparent" />
              {led > 0 ? <rect x={x} y={base - led} width={bw} height={led} rx={2} style={LED_FILL} /> : null}
              {co > 0 ? <rect x={x} y={base - led - co} width={bw} height={co} rx={2} style={CO_FILL} /> : null}
              {total > 0 ? (
                <text x={cx} y={base - led - co - 5} textAnchor="middle" className="fill-text-secondary text-[10px] tabular-nums">
                  {compactThb(total)}
                </text>
              ) : null}
              {i % labelEvery === 0 || i === years.length - 1 ? (
                <text x={cx} y={H - 6} textAnchor="middle" className="fill-text-tertiary text-[10px] tabular-nums">
                  {y.fiscalYearBe}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1">
          <svg width={10} height={10} aria-hidden>
            <rect width={10} height={10} rx={2} style={LED_FILL} />
          </svg>
          {t.led}
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width={10} height={10} aria-hidden>
            <rect width={10} height={10} rx={2} style={CO_FILL} />
          </svg>
          {t.co}
        </span>
        <span className="text-text-tertiary">{t.chartCaption}</span>
      </div>
    </figure>
  );
}

export function GrantsPanel({ state, lang }: { state: GrantsPanelState; lang: Lang }) {
  const t = L[lang];
  const title = (
    <span className="flex items-center gap-2">
      <HandCoins className="h-12 w-12 text-text-tertiary" aria-hidden />
      {t.title}
    </span>
  );

  if (typeof state === 'string') {
    return (
      <Section title={title}>
        <Card className="p-5" elevation="lg">
          <p className="text-sm text-text-secondary">
            {state === 'unlinked' ? t.unlinked : t.unavailable}
          </p>
        </Card>
      </Section>
    );
  }

  return (
    <Section title={title}>
      <Card className="p-5" elevation="lg">
        <div className="flex items-center justify-end gap-2">
          <FreshnessBadge freshnessDate={state.freshnessDate} label={t.freshnessLabel} />
          <ProvenanceButton
            size="xs"
            title={t.title}
            meta={{
              freshnessDate: state.freshnessDate,
              sources: [{ id: 'kku-research-services', name: t.source }],
              caveats: [...t.caveats],
            }}
          />
        </div>
        {state.projects.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">{t.empty}</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi
                label={t.totalGrants}
                value={compactThb(state.totalBudgetThb)}
                hint={t.totalHint}
                title={thb(state.totalBudgetThb)}
              />
              <Kpi label={t.led} value={state.led} />
              <Kpi label={t.co} value={state.coInvestigator} />
              <Kpi label={t.active} value={state.active} />
            </dl>
            {state.byYear.length > 0 ? <GrantsByYearChart years={state.byYear} t={t} /> : null}
            <ul className="mt-4 flex flex-col">
              {state.projects.map((p) => (
                <li
                  key={p.sourceProposalId}
                  className="flex flex-col gap-1 border-t border-subtle py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5">
                      {p.role === 'LEAD' ? t.lead : t.co}
                    </span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{t.types[p.type]}</span>
                    <span className="text-text-tertiary">{t.fy(p.fiscalYearBe)}</span>
                  </div>
                  <div className="text-sm text-text-primary">{p.titleTh}</div>
                  {p.titleEn ? <div className="text-xs text-text-tertiary">{p.titleEn}</div> : null}
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-text-secondary">
                    <span>
                      {p.funderName ?? '—'}
                      {p.startDate && p.endDate ? ` · ${p.startDate} – ${p.endDate}` : ''}
                    </span>
                    <span className="tabular-nums">
                      {thb(p.budgetThb)}{' '}
                      <span className="text-text-tertiary">({t.projectTotal})</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </Section>
  );
}
