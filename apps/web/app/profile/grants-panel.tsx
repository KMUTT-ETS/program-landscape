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
    lead: 'Lead',
    projectTotal: 'project total',
    types: { RESEARCH: 'Research', ACADEMIC_SERVICE: 'Academic service', CONSULTING: 'Consulting', OTHER: 'Other' },
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
    lead: 'หัวหน้า',
    projectTotal: 'งบรวมโครงการ',
    types: { RESEARCH: 'วิจัย', ACADEMIC_SERVICE: 'บริการวิชาการ', CONSULTING: 'ที่ปรึกษา', OTHER: 'อื่นๆ' },
    fy: (y: number) => `ปีงบ ${y}`,
    unlinked: 'ไม่สามารถเชื่อมโยงคุณกับระบบทุนวิจัยได้',
    empty: 'ไม่มีข้อมูลทุนภายนอก',
    unavailable: 'ข้อมูลทุนไม่พร้อมใช้งานชั่วคราว',
    freshnessLabel: 'ข้อมูลทุน',
    source: 'ระบบงานวิจัยและบริการวิชาการ มข. (ทุนภายนอก)',
    caveats: [
      'งบประมาณเป็นงบรวมของโครงการ ไม่ใช่ส่วนของคุณ', 'เฉพาะโครงการทุนภายนอก ซิงก์ทุกวันจากกองบริหารงานวิจัย',
      'กำลังดำเนินการ นับเฉพาะโครงการที่วันนี้อยู่ระหว่างวันเริ่มและวันสิ้นสุด โครงการที่ไม่มีวันใดวันหนึ่งจะไม่ถูกนับ',
    ],
  },
} as const;

const thb = (n: number | null) => (n === null ? '—' : `฿${n.toLocaleString('en-US')}`);

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-2/40 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums leading-none text-text-primary">{value}</dd>
    </div>
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
          <p className="text-sm text-text-secondary">{state === 'unlinked' ? t.unlinked : t.unavailable}</p>
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
            <dl className="mt-3 grid grid-cols-3 gap-3">
              <Kpi label={t.led} value={state.led} />
              <Kpi label={t.co} value={state.coInvestigator} />
              <Kpi label={t.active} value={state.active} />
            </dl>
            <ul className="mt-4 flex flex-col">
              {state.projects.map((p) => (
                <li key={p.sourceProposalId} className="flex flex-col gap-1 border-t border-subtle py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{p.role === 'LEAD' ? t.lead : t.co}</span>
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
                      {thb(p.budgetThb)} <span className="text-text-tertiary">({t.projectTotal})</span>
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
