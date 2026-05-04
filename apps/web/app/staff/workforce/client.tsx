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
