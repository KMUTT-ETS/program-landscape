'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Card,
  GapBars,
  ThailandMap,
  type GapBarRow,
  type ThailandRegion,
} from '@kku/ui';
import type {
  OccupationGapResponse,
  RegionalGapResponse,
  SectorGapResponse,
  SkillGapResponse,
} from './types';

type Dimension = 'skills' | 'occupations' | 'sectors';

const DIMENSION_OPTIONS: Array<{ value: Dimension; label: string }> = [
  { value: 'skills', label: 'Skills' },
  { value: 'occupations', label: 'Occupations' },
  { value: 'sectors', label: 'Sectors' },
];

const REGION_OPTIONS = [
  { value: 'TH', label: 'Thailand' },
  { value: 'Northeast', label: 'Northeast (Isaan)' },
  { value: 'Mekong', label: 'Mekong' },
  { value: 'Khon Kaen', label: 'Khon Kaen' },
  { value: 'Bangkok', label: 'Bangkok' },
];

const HORIZON_OPTIONS = [
  { value: '0', label: 'Current' },
  { value: '3', label: '3-year forecast' },
  { value: '5', label: '5-year forecast' },
  { value: '10', label: '10-year forecast' },
];

const COMPARISON_OPTIONS = [
  { value: 'absolute', label: 'Absolute gap' },
  { value: 'per-capita', label: 'Per-capita gap' },
  { value: 'growth-adjusted', label: 'Growth-adjusted' },
];

interface Filters {
  dimension: string;
  region: string;
  horizon: string;
  comparison: string;
  scope: string;
  scopeId: string;
}

export function GapAnalysisClient({
  initialFilters,
  data,
}: {
  initialFilters: Filters;
  data: {
    skills: SkillGapResponse | null;
    sectors: SectorGapResponse | null;
    occupations: OccupationGapResponse | null;
    regional: RegionalGapResponse | null;
  };
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState(initialFilters);

  const applyFilters = (next: Filters) => {
    const qs = new URLSearchParams();
    qs.set('dimension', next.dimension);
    qs.set('region', next.region);
    qs.set('horizon', next.horizon);
    qs.set('comparison', next.comparison);
    qs.set('scope', next.scope);
    if (next.scopeId) qs.set('scopeId', next.scopeId);
    router.push(`/gap-analysis?${qs}`);
  };

  const updateFilter = (key: keyof Filters, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    applyFilters(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Selector label="Dimension" value={filters.dimension} options={DIMENSION_OPTIONS} onChange={(v) => updateFilter('dimension', v)} />
          <Selector label="Region" value={filters.region} options={REGION_OPTIONS} onChange={(v) => updateFilter('region', v)} />
          <Selector label="Horizon" value={filters.horizon} options={HORIZON_OPTIONS} onChange={(v) => updateFilter('horizon', v)} />
          <Selector label="Comparison" value={filters.comparison} options={COMPARISON_OPTIONS} onChange={(v) => updateFilter('comparison', v)} />
          <div className="ml-auto flex items-center gap-2 text-xs text-text-tertiary">
            <Link href="/gap-analysis/opportunities" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
              Opportunities →
            </Link>
            <Link href="/gap-analysis/risks" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
              Risks →
            </Link>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* Main panel */}
        <div className="flex flex-col gap-4">
          {filters.dimension === 'skills' && <SkillsPanel data={data.skills} />}
          {filters.dimension === 'occupations' && <OccupationsPanel data={data.occupations} />}
          {filters.dimension === 'sectors' && <SectorsPanel data={data.sectors} />}
        </div>

        {/* Right rail: regional map */}
        <aside className="flex flex-col gap-3">
          <Card padding="md">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">Regional gap</h3>
            <p className="mb-3 text-xs text-text-tertiary">
              Click a region to filter this page to that scope.
            </p>
            <RegionalMap data={data.regional} highlight={filters.region} onRegionClick={(r) => updateFilter('region', r)} />
          </Card>

          <Card padding="md">
            <h3 className="mb-1 text-sm font-semibold text-text-primary">About this view</h3>
            <p className="text-xs leading-relaxed text-text-tertiary">
              Demand is sourced from job postings (last 12 months); supply from ProgramSkill × graduate counts. Forecasts use{' '}
              <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">forecasting.v1</code>{' '}
              (Holt's linear trend for demand; linear + demographic for supply). See{' '}
              <Link href="/styleguide" className="underline">
                methodology docs
              </Link>
              .
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Selector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <span className="uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-default bg-surface-1 px-2 py-1.5 text-sm text-text-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SkillsPanel({ data }: { data: SkillGapResponse | null }) {
  if (!data) return <EmptyState title="Skills gap unavailable" />;
  if (data.rows.length === 0) return <EmptyState title="No skill gap rows" hint={data.lowConfidenceReason ?? undefined} />;
  const gapBarRows: GapBarRow[] = data.rows.map((r) => ({
    id: r.skillId,
    label: r.nameEn,
    sublabel: r.nameTh,
    demand: r.demand,
    supply: r.supply,
  }));
  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Skill gap — top {data.rows.length}</h3>
        <span className="text-xs text-text-tertiary">by |gap| · {data.totalSkillsConsidered} skills considered</span>
      </div>
      {data.lowConfidenceReason && (
        <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          {data.lowConfidenceReason}
        </div>
      )}
      <GapBars rows={gapBarRows} width={800} />
    </Card>
  );
}

function OccupationsPanel({ data }: { data: OccupationGapResponse | null }) {
  if (!data) return <EmptyState title="Occupations gap unavailable" />;
  if (data.rows.length === 0)
    return <EmptyState title="No occupation rows" hint={data.lowConfidenceReason ?? undefined} />;

  return (
    <Card padding="md">
      <h3 className="mb-3 text-sm font-semibold text-text-primary">Occupation gap — top {data.rows.length}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
              <th className="py-2 pr-3">Code</th>
              <th className="py-2 pr-3">Region</th>
              <th className="py-2 pr-3 text-right">Demand now</th>
              <th className="py-2 pr-3 text-right">Supply now</th>
              <th className="py-2 pr-3 text-right">Gap</th>
              <th className="py-2 pr-3 text-right">TH share</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={`${r.occupationCode}-${r.region}`} className="border-b border-subtle last:border-0">
                <td className="py-2 pr-3 font-mono text-xs">{r.occupationCode}</td>
                <td className="py-2 pr-3">{r.region}</td>
                <td className="py-2 pr-3 text-right">{r.demandCurrent.toFixed(0)}</td>
                <td className="py-2 pr-3 text-right">{r.supplyCurrent.toFixed(0)}</td>
                <td className="py-2 pr-3 text-right">
                  <span className={r.gap > 0 ? 'text-danger' : r.gap < 0 ? 'text-success' : 'text-text-secondary'}>
                    {r.gap.toFixed(0)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right">{(r.thailandAverageShare * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SectorsPanel({ data }: { data: SectorGapResponse | null }) {
  if (!data) return <EmptyState title="Sectors gap unavailable" />;
  if (data.rows.length === 0) return <EmptyState title="No sector data" />;

  const gapBarRows: GapBarRow[] = data.rows.map((r) => ({
    id: r.sectorId,
    label: `${r.nameEn}`,
    sublabel: `${r.family} · ${r.nameTh}`,
    demand: r.demandIndex,
    supply: r.supplyIndex,
  }));

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">Sector gap — BCG + S-curve</h3>
        <GapBars rows={gapBarRows} width={800} />
      </Card>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.rows.slice(0, 6).map((r) => (
          <Card key={r.sectorId} padding="md">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone="outline">{r.family}</Badge>
                  <span className="text-xs font-mono text-text-tertiary">{r.sectorCode}</span>
                </div>
                <h4 className="mt-2 text-sm font-semibold text-text-primary">{r.nameEn}</h4>
                <p className="text-xs text-text-tertiary">{r.nameTh}</p>
              </div>
              <TrendBadge trend={r.trend} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Stat label="Demand" value={r.demandIndex.toFixed(0)} />
              <Stat label="Supply" value={r.supplyIndex.toFixed(0)} />
              <Stat
                label="Gap"
                value={r.gap.toFixed(0)}
                valueClass={r.gap > 0 ? 'text-danger' : r.gap < 0 ? 'text-success' : ''}
              />
            </dl>
            {r.contributingProgramIds.length > 0 && (
              <p className="mt-2 text-[11px] text-text-tertiary">
                {r.contributingProgramIds.length} KKU program{r.contributingProgramIds.length > 1 ? 's' : ''} contributing
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function RegionalMap({
  data,
  highlight,
  onRegionClick,
}: {
  data: RegionalGapResponse | null;
  highlight: string;
  onRegionClick: (region: string) => void;
}) {
  // Collapse province-level cells into 6 regions for the schematic map.
  const ISAAN = new Set([
    'Khon Kaen', 'Udon Thani', 'Nakhon Ratchasima', 'Ubon Ratchathani', 'Buriram',
    'Sisaket', 'Surin', 'Roi Et', 'Chaiyaphum', 'Sakon Nakhon', 'Kalasin',
    'Maha Sarakham', 'Loei', 'Nong Khai', 'Nong Bua Lamphu', 'Yasothon',
    'Mukdahan', 'Nakhon Phanom', 'Amnat Charoen', 'Bueng Kan',
  ]);
  const NORTH = new Set(['Chiang Mai', 'Chiang Rai', 'Lampang', 'Phayao', 'Nan', 'Mae Hong Son', 'Phrae', 'Lamphun']);
  const CENTRAL = new Set(['Bangkok', 'Nonthaburi', 'Pathum Thani', 'Samut Prakan', 'Ayutthaya', 'Nakhon Pathom', 'Saraburi']);
  const EAST = new Set(['Chonburi', 'Rayong', 'Chanthaburi', 'Trat', 'Sa Kaeo', 'Chachoengsao', 'Prachinburi']);
  const WEST = new Set(['Kanchanaburi', 'Ratchaburi', 'Suphanburi', 'Phetchaburi', 'Prachuap Khiri Khan']);
  const SOUTH = new Set(['Phuket', 'Krabi', 'Songkhla', 'Trang', 'Surat Thani', 'Pattani', 'Yala', 'Narathiwat', 'Nakhon Si Thammarat']);

  const regions: Record<string, { demand: number; supply: number; intensity: ThailandRegion['intensity'] }> = {
    N: { demand: 0, supply: 0, intensity: 'no-data' },
    NE: { demand: 0, supply: 0, intensity: 'no-data' },
    C: { demand: 0, supply: 0, intensity: 'no-data' },
    E: { demand: 0, supply: 0, intensity: 'no-data' },
    W: { demand: 0, supply: 0, intensity: 'no-data' },
    S: { demand: 0, supply: 0, intensity: 'no-data' },
  };

  for (const cell of data?.cells ?? []) {
    let key: keyof typeof regions | null = null;
    if (ISAAN.has(cell.province)) key = 'NE';
    else if (NORTH.has(cell.province)) key = 'N';
    else if (CENTRAL.has(cell.province)) key = 'C';
    else if (EAST.has(cell.province)) key = 'E';
    else if (WEST.has(cell.province)) key = 'W';
    else if (SOUTH.has(cell.province)) key = 'S';
    if (!key) continue;
    regions[key]!.demand += cell.demandTotal;
    regions[key]!.supply += cell.supplyTotal;
  }
  // Assign intensity based on demand/supply deltas.
  for (const key of Object.keys(regions)) {
    const r = regions[key]!;
    if (r.demand === 0 && r.supply === 0) r.intensity = 'no-data';
    else if (Math.abs(r.demand - r.supply) / Math.max(r.demand + r.supply, 1) < 0.1) r.intensity = 'balanced';
    else r.intensity = r.demand > r.supply ? 'demand-heavy' : 'supply-heavy';
  }

  const regionNames: Record<string, { en: string; th: string }> = {
    N: { en: 'North', th: 'ภาคเหนือ' },
    NE: { en: 'Northeast', th: 'ภาคอีสาน' },
    C: { en: 'Central', th: 'ภาคกลาง' },
    E: { en: 'East', th: 'ภาคตะวันออก' },
    W: { en: 'West', th: 'ภาคตะวันตก' },
    S: { en: 'South', th: 'ภาคใต้' },
  };

  const rows: ThailandRegion[] = Object.entries(regions).map(([code, r]) => ({
    code,
    nameEn: regionNames[code]!.en,
    nameTh: regionNames[code]!.th,
    demand: r.demand,
    supply: r.supply,
    intensity: r.intensity,
  }));

  const highlightCode = highlight === 'Northeast' ? 'NE' : highlight === 'TH' ? 'NE' : undefined;

  return (
    <ThailandMap
      regions={rows}
      highlightRegionCode={highlightCode}
      onRegionClick={(r) => {
        const regionMap: Record<string, string> = {
          N: 'Chiang Mai',
          NE: 'Northeast',
          C: 'Bangkok',
          E: 'Chonburi',
          W: 'Kanchanaburi',
          S: 'Phuket',
        };
        onRegionClick(regionMap[r.code] ?? 'TH');
      }}
    />
  );
}

function TrendBadge({ trend }: { trend: 'growing' | 'shrinking' | 'flat' }) {
  const colour = trend === 'growing' ? 'text-success' : trend === 'shrinking' ? 'text-danger' : 'text-text-tertiary';
  const label = trend === 'growing' ? '▲ Growing' : trend === 'shrinking' ? '▼ Shrinking' : '— Flat';
  return <span className={`text-xs font-medium ${colour}`}>{label}</span>;
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className={`font-mono text-sm ${valueClass ?? 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card padding="lg">
      <div className="flex flex-col items-center py-8 text-center">
        <div className="mb-2 text-sm font-semibold text-text-primary">{title}</div>
        {hint ? <p className="max-w-md text-xs leading-relaxed text-text-tertiary">{hint}</p> : null}
      </div>
    </Card>
  );
}
