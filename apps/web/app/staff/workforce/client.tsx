'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { MultiSelectField } from '../multi-select';
import type {
  FilterOptions,
  TrackBlock,
  WorkforceResponse,
} from '../types';

interface Props {
  data: WorkforceResponse;
  options: FilterOptions;
  initialFilters: { facultyName: string[]; track: Array<'ACADEMIC' | 'SUPPORT'> };
}

export function WorkforceClient({ data, options, initialFilters }: Props) {
  const router = useRouter();
  const [faculty, setFaculty] = React.useState<string[]>(initialFilters.facultyName);
  const [track, setTrack] = React.useState<Array<'ACADEMIC' | 'SUPPORT'>>(initialFilters.track);

  const apply = (next: { faculty?: string[]; track?: Array<'ACADEMIC' | 'SUPPORT'> }) => {
    const params = new URLSearchParams();
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.track ?? track).forEach((v) => params.append('track', v));
    router.push(`/staff/workforce${params.toString() ? `?${params}` : ''}`);
  };

  const cliffPct =
    data.headcount.total > 0
      ? ((data.retirementCliff5y.total / data.headcount.total) * 100).toFixed(1) + '%'
      : '—';

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter rail ────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={options.faculties.map((f) => ({ value: f, label: f }))}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              apply({ faculty: vs });
            }}
          />
          <MultiSelectField
            label="Staff type"
            options={options.tracks.map((t) => ({ value: t.id, label: t.label }))}
            selected={track as string[]}
            onChange={(vs) => {
              const v = vs as Array<'ACADEMIC' | 'SUPPORT'>;
              setTrack(v);
              apply({ track: v });
            }}
            preserveOrder
          />
          {(faculty.length > 0 || track.length > 0) && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setTrack([]);
                router.push('/staff/workforce');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            {data.headcount.total.toLocaleString('en-US')} people matching filters
          </span>
        </div>
      </Card>

      {/* ── Headline KPIs ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <KpiTile
          label="Total staff"
          value={data.headcount.total.toLocaleString('en-US')}
          sub={data.headcount.unknownTrack > 0 ? `${data.headcount.unknownTrack} unclassified` : 'All classified'}
        />
        <KpiTile
          label="Academic"
          value={data.headcount.academic.toLocaleString('en-US')}
          sub={pct(data.headcount.academic, data.headcount.total)}
          tone="academic"
        />
        <KpiTile
          label="Support"
          value={data.headcount.support.toLocaleString('en-US')}
          sub={pct(data.headcount.support, data.headcount.total)}
          tone="support"
        />
        <KpiTile
          label="In leadership roles"
          value={data.headcount.executives.toLocaleString('en-US')}
          sub={pct(data.headcount.executives, data.headcount.total)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiTile
          label="Retiring in next 5 years"
          value={data.retirementCliff5y.total.toLocaleString('en-US')}
          sub={`${cliffPct} of all staff · ${data.retirementCliff5y.academic} academic · ${data.retirementCliff5y.support} support`}
          tone="warn"
        />
        <KpiTile
          label="New hires (last 12 months)"
          value={`+${data.flow12m.hires.toLocaleString('en-US')}`}
          sub="Newly recruited or re-appointed"
          tone="ok"
        />
        <KpiTile
          label="Departures (last 12 months)"
          value={`−${data.flow12m.separations.toLocaleString('en-US')}`}
          sub="Retirements, resignations, and contract endings"
          tone="warn"
        />
      </div>

      {/* ── Faculty mosaic ────────────────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold">Headcount per faculty</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Sorted by total. The split inside each bar shows how many are academic (purple) versus support (teal).
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.facultyMosaic.slice(0, 30).map((row) => {
            const max = Math.max(...data.facultyMosaic.map((x) => x.total), 1);
            const widthPct = (row.total / max) * 100;
            const acaPct = row.total > 0 ? (row.academic / row.total) * 100 : 0;
            return (
              <li
                key={row.facultyName}
                className="grid grid-cols-[16rem_minmax(0,1fr)_4rem_4rem_4rem] items-center gap-x-4 text-xs"
              >
                <span className="truncate" title={row.facultyName}>
                  {row.facultyName}
                </span>
                <div
                  className="relative h-4 overflow-hidden rounded-sm"
                  style={{ background: 'rgba(120,120,120,0.18)' }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.max(widthPct, 0.5)}%`,
                      background: `linear-gradient(90deg, #6366f1 ${acaPct}%, #14b8a6 ${acaPct}%)`,
                    }}
                  />
                </div>
                <span className="text-right font-tabular text-accent">
                  {row.academic.toLocaleString('en-US')}
                </span>
                <span className="text-right font-tabular text-text-secondary">
                  {row.support.toLocaleString('en-US')}
                </span>
                <span className="text-right font-tabular font-semibold">
                  {row.total.toLocaleString('en-US')}
                </span>
              </li>
            );
          })}
          <li className="grid grid-cols-[16rem_minmax(0,1fr)_4rem_4rem_4rem] gap-x-4 pt-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            <span></span>
            <span></span>
            <span className="text-right">Academic</span>
            <span className="text-right">Support</span>
            <span className="text-right">Total</span>
          </li>
        </ul>
      </Card>

      {/* ── Retirement timeline + Tenure distribution ─────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <RetirementProjectionCard rows={data.retirementProjection} />
        <TenureDistributionCard tenure={data.tenure} />
      </div>

      {/* ── Faculty turnover (HCM ENDWORKDATE) ───────────────── */}
      <FacultyTurnoverCard turnover={data.facultyTurnover} />

      {/* ── Demographics: age pyramids + tenure ─────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TrackPanel title="สายวิชาการ — Academic" block={data.demographics.academic} />
        <TrackPanel title="สายสนับสนุน — Support" block={data.demographics.support} />
      </div>

      {/* ── Faculty retirement risk ───────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold">Faculties at retirement risk</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Where more than 1 in 5 staff are in their late 50s — succession planning likely needed soon. Sorted by % at risk.
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.demographics.facultyRetirementRisk.slice(0, 25).map((r) => {
            const tone = r.pct >= 20 ? 'text-warning font-semibold' : '';
            return (
              <li
                key={r.facultyName}
                className="grid grid-cols-[16rem_minmax(0,1fr)_5rem_5rem_5rem] gap-x-4 text-xs items-center"
              >
                <span className="truncate" title={r.facultyName}>
                  {r.facultyName}
                </span>
                <div className="h-3 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                  <div
                    className="h-full"
                    style={{ width: `${Math.min(r.pct * 3, 100)}%`, background: r.pct >= 20 ? '#f59e0b' : '#0ea5e9' }}
                  />
                </div>
                <span className="text-right font-tabular">{r.total.toLocaleString('en-US')}</span>
                <span className="text-right font-tabular">{r.retire5y.toLocaleString('en-US')}</span>
                <span className={`text-right font-tabular ${tone}`}>{r.pct.toFixed(1)}%</span>
              </li>
            );
          })}
          <li className="grid grid-cols-[16rem_minmax(0,1fr)_5rem_5rem_5rem] gap-x-4 pt-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            <span></span>
            <span></span>
            <span className="text-right">total staff</span>
            <span className="text-right">retiring</span>
            <span className="text-right">% at risk</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}

function pct(part: number, total: number): string {
  if (!total) return '—';
  return ((part / total) * 100).toFixed(1) + '%';
}

const TONE_CLASS: Record<string, string> = {
  warn: 'text-warning',
  ok: 'text-success',
  academic: 'text-accent',
  support: 'text-text-primary',
};

function KpiTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'warn' | 'ok' | 'academic' | 'support';
}) {
  return (
    <Card>
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className={`mt-1 font-tabular text-2xl font-semibold ${tone ? TONE_CLASS[tone] : ''}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-text-tertiary">{sub}</div>}
    </Card>
  );
}

function TrackPanel({ title, block }: { title: string; block: TrackBlock }) {
  const maxPyramid = Math.max(...block.agePyramid.map((c) => c.total), 1);
  const maxTenure = Math.max(...Object.values(block.tenureBuckets), 1);
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="text-xs text-text-tertiary">
          {block.total.toLocaleString('en-US')} people · {block.nearRetirement.toLocaleString('en-US')} aged 55–59
        </div>
      </div>
      <div className="mt-3">
        <div className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">Age and gender</div>
        <ul className="mt-2 flex flex-col gap-1">
          {block.agePyramid.map((c) => {
            const malePct = (c.male / maxPyramid) * 100;
            const femalePct = (c.female / maxPyramid) * 100;
            return (
              <li key={c.bucket} className="grid grid-cols-[3rem_1fr_3rem] gap-x-2 items-center text-xs">
                <span className="font-tabular text-text-tertiary">{c.bucket}</span>
                <div className="flex items-center gap-px">
                  <div className="flex flex-1 justify-end">
                    <div className="h-3" style={{ width: `${malePct}%`, background: '#6366f1' }} title={`Male ${c.male}`} />
                  </div>
                  <div className="flex flex-1">
                    <div className="h-3" style={{ width: `${femalePct}%`, background: '#ec4899' }} title={`Female ${c.female}`} />
                  </div>
                </div>
                <span className="text-right font-tabular">{c.total.toLocaleString('en-US')}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-3">
        <div className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">Years at KKU</div>
        <ul className="mt-2 flex flex-col gap-1">
          {Object.entries(block.tenureBuckets).map(([bucket, n]) => {
            const widthPct = (n / maxTenure) * 100;
            return (
              <li key={bucket} className="grid grid-cols-[4rem_1fr_3rem] gap-x-2 items-center text-xs">
                <span className="font-tabular text-text-tertiary">{bucket}</span>
                <div className="h-3 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                  <div className="h-full" style={{ width: `${widthPct}%`, background: '#14b8a6' }} />
                </div>
                <span className="text-right font-tabular">{n.toLocaleString('en-US')}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

// ── 10-year retirement projection ─────────────────────────────────────
// Stacked bars per fiscal year (academic = purple, support = teal).
// Year-grain only — vw_history.retireday is computed from birthday +
// 60-year boundary so the day-of-year is uniformly 1 Oct (KKU mandatory
// retirement = start of next fiscal year), which makes month-grain
// unhelpful.
function RetirementProjectionCard({
  rows,
}: {
  rows: WorkforceResponse['retirementProjection'];
}) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <Card>
      <h3 className="text-sm font-semibold">Retirement timeline — next 10 years</h3>
      <p className="mt-1 text-xs text-text-tertiary">
        {total.toLocaleString('en-US')} staff scheduled to retire over the next decade · per-fiscal-year academic/support split · source: <span className="font-mono text-text-secondary">vw_history.retireday</span>
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {rows.map((row) => {
          const wPct = (row.total / max) * 100;
          const acPct = row.total > 0 ? (row.academic / row.total) * 100 : 0;
          return (
            <li
              key={row.fiscalYear}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem] items-center gap-x-3 text-xs"
            >
              <span className="font-tabular text-text-tertiary">FY {row.fiscalYear}</span>
              <div
                className="relative h-4 overflow-hidden rounded-sm"
                style={{ background: 'rgba(120,120,120,0.18)' }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(wPct, 0.5)}%`,
                    background: `linear-gradient(90deg, #6366f1 ${acPct}%, #14b8a6 ${acPct}%)`,
                  }}
                />
              </div>
              <span className="text-right font-tabular text-accent">{row.academic.toLocaleString('en-US')}</span>
              <span className="text-right font-tabular text-text-secondary">{row.support.toLocaleString('en-US')}</span>
              <span className="text-right font-tabular font-semibold">{row.total.toLocaleString('en-US')}</span>
            </li>
          );
        })}
        <li className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem] gap-x-3 pt-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
          <span></span>
          <span></span>
          <span className="text-right">academic</span>
          <span className="text-right">support</span>
          <span className="text-right">total</span>
        </li>
      </ul>
    </Card>
  );
}

// ── Tenure distribution (years since hireDate) ────────────────────────
// Stacked bars per 5-year bucket. Reveals the experience pyramid —
// heavy late-career counts signal succession risk; thin early-career
// counts signal a recruitment gap.
function TenureDistributionCard({
  tenure,
}: {
  tenure: WorkforceResponse['tenure'];
}) {
  const max = Math.max(...tenure.buckets.map((b) => b.total), 1);
  return (
    <Card>
      <h3 className="text-sm font-semibold">Tenure distribution</h3>
      <p className="mt-1 text-xs text-text-tertiary">
        Years at KKU since hire date · {tenure.withHireDate.toLocaleString('en-US')} staff with known hire date · mean {tenure.meanYears.toFixed(1)}y · median {tenure.medianYears.toFixed(1)}y · source: <span className="font-mono text-text-secondary">vw_history.putday</span>
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {tenure.buckets.map((b) => {
          const wPct = (b.total / max) * 100;
          const acPct = b.total > 0 ? (b.academic / b.total) * 100 : 0;
          return (
            <li
              key={b.label}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem] items-center gap-x-3 text-xs"
            >
              <span className="font-tabular text-text-tertiary">{b.label}y</span>
              <div
                className="relative h-4 overflow-hidden rounded-sm"
                style={{ background: 'rgba(120,120,120,0.18)' }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(wPct, 0.5)}%`,
                    background: `linear-gradient(90deg, #6366f1 ${acPct}%, #14b8a6 ${acPct}%)`,
                  }}
                />
              </div>
              <span className="text-right font-tabular text-accent">{b.academic.toLocaleString('en-US')}</span>
              <span className="text-right font-tabular text-text-secondary">{b.support.toLocaleString('en-US')}</span>
              <span className="text-right font-tabular font-semibold">{b.total.toLocaleString('en-US')}</span>
            </li>
          );
        })}
        <li className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem] gap-x-3 pt-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
          <span></span>
          <span></span>
          <span className="text-right">academic</span>
          <span className="text-right">support</span>
          <span className="text-right">total</span>
        </li>
      </ul>
    </Card>
  );
}

// ── Faculty turnover (HCMEmployee.ENDWORKDATE) ────────────────────────
// Pre-retirement separation tracking for academic faculty. Last 12
// months KPI + 5-year trend bars. ENDWORKDATE = actual termination
// date (resignation, contract end, dismissal, death). Note the scope
// limit — this counts only academic faculty in the FacultyMember
// population. All-staff (academic + support) flow is in the existing
// "Departures (last 12 months)" KPI above, sourced from DS2001.
function FacultyTurnoverCard({
  turnover,
}: {
  turnover: WorkforceResponse['facultyTurnover'];
}) {
  const max = Math.max(...turnover.yearly.map((y) => y.separations), 1);
  const rateText = turnover.turnoverRate12mPct.toFixed(2) + '%';
  const tone =
    turnover.turnoverRate12mPct >= 5
      ? 'text-warning'
      : turnover.turnoverRate12mPct >= 2
        ? 'text-text-primary'
        : 'text-success';
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Academic-faculty turnover</h3>
        <span className={`font-tabular text-2xl font-semibold ${tone}`}>{rateText}</span>
      </div>
      <p className="mt-1 text-xs text-text-tertiary">
        Pre-retirement separations only · {turnover.separations12m.toLocaleString('en-US')} faculty left in last 12 months · denominator {turnover.activeFacultyCount.toLocaleString('en-US')} active faculty · source: <span className="font-mono text-text-secondary">HCMEmployee.ENDWORKDATE</span>
      </p>
      <p className="mt-1 text-[11px] text-text-tertiary">
        Scope note: this is the <span className="text-text-secondary">academic faculty</span> turnover signal (FacultyMember population). The &quot;Departures (last 12 months)&quot; KPI above uses DS2001 movement codes and covers all staff types.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {turnover.yearly.map((y) => {
          const wPct = (y.separations / max) * 100;
          return (
            <li key={y.year} className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-x-3 text-xs">
              <span className="font-tabular text-text-tertiary">{y.year}</span>
              <div className="relative h-4 overflow-hidden rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                <div className="h-full" style={{ width: `${Math.max(wPct, 0.5)}%`, background: '#f97316' }} />
              </div>
              <span className="text-right font-tabular font-semibold">{y.separations.toLocaleString('en-US')}</span>
            </li>
          );
        })}
        <li className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] gap-x-3 pt-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
          <span></span>
          <span></span>
          <span className="text-right">separations</span>
        </li>
      </ul>
    </Card>
  );
}
