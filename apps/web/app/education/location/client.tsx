'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import type { FacetCount, LocationResponse, ThailandRegion } from '../types';
import { MultiSelectField } from '../multi-select';
import { ThailandProvinceMap } from './thailand-map';

interface Props {
  data: LocationResponse;
  initialFilters: {
    cohortYearBe: number[];
    region: ThailandRegion[];
    facultyName: string[];
    programLevel: string[];
    programName: string[];
  };
}

const REGION_LABELS: Record<ThailandRegion, { th: string; en: string }> = {
  NORTH: { th: 'ภาคเหนือ', en: 'Northern' },
  NORTHEAST: { th: 'ภาคตะวันออกเฉียงเหนือ', en: 'Northeastern (Isan)' },
  CENTRAL: { th: 'ภาคกลาง', en: 'Central' },
  EAST: { th: 'ภาคตะวันออก', en: 'Eastern' },
  WEST: { th: 'ภาคตะวันตก', en: 'Western' },
  SOUTH: { th: 'ภาคใต้', en: 'Southern' },
};
const REGION_ORDER: ThailandRegion[] = [
  'NORTH',
  'NORTHEAST',
  'CENTRAL',
  'EAST',
  'WEST',
  'SOUTH',
];

export function LocationClient({ data, initialFilters }: Props) {
  const router = useRouter();
  const [cohortYears, setCohortYears] = React.useState<string[]>(
    initialFilters.cohortYearBe.map(String),
  );
  const [regions, setRegions] = React.useState<ThailandRegion[]>(
    initialFilters.region,
  );
  const [faculty, setFaculty] = React.useState<string[]>(
    initialFilters.facultyName,
  );
  const [level, setLevel] = React.useState<string[]>(
    initialFilters.programLevel,
  );
  const [program, setProgram] = React.useState<string[]>(
    initialFilters.programName,
  );

  const apply = (next: {
    cohortYears?: string[];
    regions?: ThailandRegion[];
    faculty?: string[];
    level?: string[];
    program?: string[];
  }) => {
    const params = new URLSearchParams();
    (next.cohortYears ?? cohortYears).forEach((v) =>
      params.append('cohortYearBe', v),
    );
    (next.regions ?? regions).forEach((v) => params.append('region', v));
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.level ?? level).forEach((v) => params.append('programLevel', v));
    (next.program ?? program).forEach((v) => params.append('programName', v));
    router.push(`/education/location?${params.toString()}`);
  };

  // Cascading helpers — same pattern used on student-info.
  const filteredLevels = React.useMemo(() => {
    if (faculty.length === 0) return data.filters.programLevels;
    const set = new Set(
      data.filters.programs
        .filter((p) => faculty.includes(p.facultyName))
        .map((p) => p.programLevel),
    );
    return data.filters.programLevels.filter((l) => set.has(l));
  }, [faculty, data.filters]);
  const filteredPrograms = React.useMemo(
    () =>
      data.filters.programs.filter(
        (p) =>
          (faculty.length === 0 || faculty.includes(p.facultyName)) &&
          (level.length === 0 || level.includes(p.programLevel)),
      ),
    [faculty, level, data.filters],
  );

  const total = data.totalActive;
  const maxRegionCount = Math.max(...data.byRegion.map((r) => r.count), 1);
  const anyFilter =
    cohortYears.length > 0 ||
    regions.length > 0 ||
    faculty.length > 0 ||
    level.length > 0 ||
    program.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter rail ─────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={data.filters.faculties.map((f) => ({
              value: f,
              label: f,
            }))}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              setLevel([]);
              setProgram([]);
              apply({ faculty: vs, level: [], program: [] });
            }}
          />
          <MultiSelectField
            label="Program level"
            options={filteredLevels.map((l) => ({ value: l, label: l }))}
            selected={level}
            onChange={(vs) => {
              setLevel(vs);
              setProgram([]);
              apply({ level: vs, program: [] });
            }}
            disabled={filteredLevels.length === 0}
            preserveOrder
          />
          <MultiSelectField
            label="Program"
            options={filteredPrograms.map((p) => ({
              value: p.programName,
              label: p.programName,
              hint: p.programLevel,
            }))}
            selected={program}
            onChange={(vs) => {
              setProgram(vs);
              apply({ program: vs });
            }}
            disabled={filteredPrograms.length === 0}
          />
          <MultiSelectField
            label="Entry year (BE)"
            options={data.cohortYears.map((y) => ({
              value: String(y),
              label: `BE ${y}`,
            }))}
            selected={cohortYears}
            onChange={(vs) => {
              setCohortYears(vs);
              apply({ cohortYears: vs });
            }}
            preserveOrder
          />
          <MultiSelectField
            label="Region"
            options={REGION_ORDER.map((r) => ({
              value: r,
              label: REGION_LABELS[r].en,
              hint: REGION_LABELS[r].th,
            }))}
            selected={regions as string[]}
            onChange={(vs) => {
              setRegions(vs as ThailandRegion[]);
              apply({ regions: vs as ThailandRegion[] });
            }}
            preserveOrder
          />
          {anyFilter && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setCohortYears([]);
                setRegions([]);
                setFaculty([]);
                setLevel([]);
                setProgram([]);
                router.push('/education/location');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            {total.toLocaleString('en-US')} active student
            {total === 1 ? '' : 's'} matching filters
          </span>
        </div>
      </Card>

      {/* ── Region heat-strip ──────────────────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold">Distribution by Thailand region</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Region is derived from each student&apos;s school province via NESDC&apos;s
          standard 6-region classification. Click a region to add it to the
          filter.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          {data.byRegion.map((r) => {
            const intensity = r.count / maxRegionCount;
            const pct = total === 0 ? 0 : (r.count / total) * 100;
            const bgOpacity = 0.15 + intensity * 0.6;
            const isSelected = regions.includes(r.region);
            return (
              <button
                key={r.region}
                onClick={() => {
                  const next = isSelected
                    ? regions.filter((x) => x !== r.region)
                    : [...regions, r.region];
                  setRegions(next);
                  apply({ regions: next });
                }}
                className={`flex flex-col items-start gap-1 rounded-md border-2 p-3 text-left transition-colors ${
                  isSelected ? 'border-accent' : 'border-transparent'
                }`}
                style={{ background: `rgba(102, 51, 153, ${bgOpacity})` }}
              >
                <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-text-secondary">
                  {r.label}
                </span>
                <span className="font-tabular text-xl font-semibold">
                  {r.count.toLocaleString('en-US')}
                </span>
                <span className="text-[0.65rem] text-text-tertiary">
                  {pct.toFixed(1)}% of total
                </span>
              </button>
            );
          })}
        </div>
        {data.unknownRegionCount > 0 && (
          <p className="mt-2 text-xs text-text-tertiary">
            <strong className="text-text-primary">
              {data.unknownRegionCount.toLocaleString('en-US')}
            </strong>{' '}
            student
            {data.unknownRegionCount === 1 ? '' : 's'} have a school province
            not recognised in the Thailand region map (foreign schools or
            non-canonical names).
          </p>
        )}
      </Card>

      {/* ── Interactive choropleth ─────────────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold">Province choropleth</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Each province is tinted by the number of students whose registered
          school is located there. Hover for exact counts; click a province
          to scope the lists below.
        </p>
        <div className="mt-3">
          <ThailandProvinceMap
            rows={data.byProvince.map((p) => ({
              name: p.label,
              count: p.count,
            }))}
          />
        </div>
      </Card>

      {/* ── Province + School lists ────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BreakdownCard
          title="Top provinces (school location)"
          rows={data.byProvince}
          total={total}
        />
        <BreakdownCard
          title="Top schools"
          rows={data.bySchool}
          total={total}
        />
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
  total,
}: {
  title: string;
  rows: FacetCount[];
  total: number;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-xs text-text-tertiary">No data.</p>
      </Card>
    );
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <Card>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((r) => {
          const pct = total === 0 ? 0 : (r.count / total) * 100;
          const widthPct = (r.count / max) * 100;
          return (
            <li
              key={r.key}
              className="grid grid-cols-[16rem_minmax(0,1fr)_4.5rem_3.5rem] items-center gap-x-4 text-xs"
            >
              <span className="truncate" title={r.label}>
                {r.label}
              </span>
              <div
                className="relative h-4 overflow-hidden rounded-sm"
                style={{ background: 'rgba(120,120,120,0.18)' }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(widthPct, 0.5)}%`,
                    background: '#664073',
                  }}
                />
              </div>
              <span
                className="text-right font-tabular font-semibold"
                title={r.count.toLocaleString('en-US')}
              >
                {r.count.toLocaleString('en-US')}
              </span>
              <span className="text-right font-tabular text-text-tertiary">
                {pct.toFixed(0)}%
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
