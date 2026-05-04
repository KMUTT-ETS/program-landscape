'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import type {
  FacetCount,
  StatusGroup,
  StudentInfoResponse,
} from '../types';
import { MultiSelectField } from '../multi-select';

interface Props {
  data: StudentInfoResponse;
  initialFilters: {
    facultyName: string[];
    programLevel: string[];
    programName: string[];
    statusCode: number[];
    statusGroup: StatusGroup[];
  };
}

const GROUP_LABELS: Record<StatusGroup, { label: string; hint: string }> = {
  INCOMING: {
    label: 'Incoming students',
    hint: 'arriving — not yet enrolled',
  },
  CURRENT: {
    label: 'Current students',
    hint: 'currently enrolled',
  },
  FORMER: { label: 'Former students', hint: 'graduated, withdrawn, or dismissed' },
};

// Tone palette used across the breakdown bars. Solid colours via inline
// style sidestep any Tailwind alpha quirks; the values come from the
// design-token chart palette resolved against the light-theme defaults.
const BAR_TONE = {
  accent: '#664073',
  warm: '#d49000',
  green: '#069c6a',
  blue: '#2b4ba4',
  rose: '#a6192e',
};

export function StudentInfoClient({ data, initialFilters }: Props) {
  const router = useRouter();

  const [faculty, setFaculty] = React.useState(initialFilters.facultyName);
  const [level, setLevel] = React.useState(initialFilters.programLevel);
  const [program, setProgram] = React.useState(initialFilters.programName);
  const [statusCodes, setStatusCodes] = React.useState(
    initialFilters.statusCode.map(String),
  );
  const [statusGroups, setStatusGroups] = React.useState<StatusGroup[]>(
    initialFilters.statusGroup,
  );

  const apply = (next: {
    faculty?: string[];
    level?: string[];
    program?: string[];
    statusCodes?: string[];
    statusGroups?: StatusGroup[];
  }) => {
    const params = new URLSearchParams();
    const setMulti = (k: string, vs: string[]) => {
      params.delete(k);
      for (const v of vs) if (v.length > 0) params.append(k, v);
    };
    setMulti('facultyName', next.faculty ?? faculty);
    setMulti('programLevel', next.level ?? level);
    setMulti('programName', next.program ?? program);
    setMulti('statusCode', next.statusCodes ?? statusCodes);
    setMulti('statusGroup', next.statusGroups ?? statusGroups);
    router.push(`/education/student-info?${params.toString()}`);
  };

  const filteredLevels = React.useMemo(() => {
    if (faculty.length === 0) return data.filters.programLevels;
    const set = new Set(
      data.filters.programs
        .filter((p) => faculty.includes(p.facultyName))
        .map((p) => p.programLevel),
    );
    return data.filters.programLevels.filter((l) => set.has(l));
  }, [faculty, data.filters]);

  const filteredPrograms = React.useMemo(() => {
    return data.filters.programs.filter(
      (p) =>
        (faculty.length === 0 || faculty.includes(p.facultyName)) &&
        (level.length === 0 || level.includes(p.programLevel)),
    );
  }, [faculty, level, data.filters]);

  const totalThai = data.thaiVsNonThai.thai;
  const totalNonThai = data.thaiVsNonThai.nonThai;
  const total = data.totalActive;
  const thaiPct = total === 0 ? 0 : (totalThai / total) * 100;

  const anyFilter =
    faculty.length > 0 ||
    level.length > 0 ||
    program.length > 0 ||
    statusCodes.length > 0 ||
    statusGroups.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter rail ─────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={data.filters.faculties.map((f) => ({ value: f, label: f }))}
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
            label="Status group"
            options={(['INCOMING', 'CURRENT', 'FORMER'] as StatusGroup[]).map(
              (g) => {
                const bucket = data.filters.statusGroups.find(
                  (b) => b.group === g,
                );
                return {
                  value: g,
                  label: GROUP_LABELS[g].label,
                  hint: bucket
                    ? bucket.count.toLocaleString('en-US')
                    : GROUP_LABELS[g].hint,
                };
              },
            )}
            selected={statusGroups as string[]}
            onChange={(vs) => {
              const next = vs as StatusGroup[];
              setStatusGroups(next);
              setStatusCodes([]);
              apply({ statusGroups: next, statusCodes: [] });
            }}
            placeholder="Default: Current students"
            disabled={statusCodes.length > 0}
            preserveOrder
          />
          <MultiSelectField
            label="Status code (override)"
            options={data.filters.statuses.map((s) => ({
              value: String(s.code),
              label: `${s.code} · ${s.name || '—'}`,
              hint: s.count.toLocaleString('en-US'),
            }))}
            selected={statusCodes}
            onChange={(vs) => {
              setStatusCodes(vs);
              apply({ statusCodes: vs });
            }}
            placeholder="(use status group)"
            preserveOrder
          />
          {anyFilter && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setLevel([]);
                setProgram([]);
                setStatusCodes([]);
                setStatusGroups([]);
                router.push('/education/student-info');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            {total.toLocaleString('en-US')} matching student
            {total === 1 ? '' : 's'}
          </span>
        </div>
      </Card>

      {/* ── KPI + donuts strip ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Total students"
          value={total.toLocaleString('en-US')}
          subtitle={
            data.appliedStatusGroups.length > 0
              ? data.appliedStatusGroups
                  .map((g) => GROUP_LABELS[g].label)
                  .join(', ')
              : 'all groups'
          }
        />
        <KpiTile
          label="Average age"
          value={
            data.averageAge === null
              ? '—'
              : `${data.averageAge.toFixed(1)} yrs`
          }
          subtitle={
            data.ageSampleCount > 0
              ? `from ${data.ageSampleCount.toLocaleString('en-US')} on-file ages (16–80 yrs)`
              : 'no age data on file'
          }
        />
        <DonutCard
          label="Thai vs non-Thai"
          segments={[
            { label: 'Thai', value: totalThai, color: BAR_TONE.accent },
            { label: 'Non-Thai', value: totalNonThai, color: BAR_TONE.blue },
          ]}
          centerPct={thaiPct}
          centerLabel="Thai"
        />
        <DonutCard
          label="Gender mix"
          segments={data.byGender.map((g, i) => ({
            label: g.label,
            value: g.count,
            color: [BAR_TONE.blue, BAR_TONE.rose, BAR_TONE.warm, BAR_TONE.green][
              i % 4
            ]!,
          }))}
        />
      </div>

      {/* ── Status mix strip ────────────────────────────────────── */}
      <StatusGroupCard groups={data.byStatusGroup} total={total} />

      {/* Breakdowns layout — left column stacks program level +
          nationality, right column is recruitment-method spanning both
          rows so the right side fills to match the left column's
          height. The default expanded count tracks the combined left-
          column row count so the right card is never visually short. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
        <BreakdownCard
          title="By program level"
          rows={data.byProgramLevel}
          total={total}
          tone={BAR_TONE.accent}
          className="lg:col-start-1 lg:row-start-1"
        />
        <BreakdownCard
          title="By recruitment method"
          rows={data.byEntryType}
          total={total}
          collapseAt={Math.max(
            15,
            data.byProgramLevel.length + data.byNationality.length,
          )}
          tone={BAR_TONE.warm}
          className="lg:col-start-2 lg:row-span-2"
        />
        <BreakdownCard
          title="By nationality (top 25)"
          rows={data.byNationality}
          total={total}
          tone={BAR_TONE.blue}
          className="lg:col-start-1 lg:row-start-2"
        />
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div className="mt-1 font-tabular text-3xl font-semibold">{value}</div>
      {subtitle && (
        <div className="mt-0.5 text-xs text-text-tertiary">{subtitle}</div>
      )}
    </Card>
  );
}

// Donut card — single SVG arc per segment using stroke-dasharray on a
// circle. Solid colour fills via inline style; no external lib.
function DonutCard({
  label,
  segments,
  centerPct,
  centerLabel,
}: {
  label: string;
  segments: { label: string; value: number; color: string }[];
  /** Override the centre percentage label (otherwise shows total). */
  centerPct?: number;
  centerLabel?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 36;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-4">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <circle
            cx="46"
            cy="46"
            r={r}
            fill="none"
            stroke="rgba(120,120,120,0.18)"
            strokeWidth="14"
          />
          {total > 0 &&
            segments.map((s, i) => {
              const len = (s.value / total) * c;
              const dasharray = `${len} ${c - len}`;
              const dashoffset = c / 4 - offset;
              offset += len;
              return (
                <circle
                  key={i}
                  cx="46"
                  cy="46"
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="14"
                  strokeDasharray={dasharray}
                  strokeDashoffset={dashoffset}
                  transform="rotate(-90 46 46)"
                />
              );
            })}
          {centerPct !== undefined && (
            <>
              <text
                x="46"
                y="50"
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill="currentColor"
              >
                {centerPct.toFixed(1)}%
              </text>
              {centerLabel && (
                <text
                  x="46"
                  y="62"
                  textAnchor="middle"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.55"
                >
                  {centerLabel}
                </text>
              )}
            </>
          )}
        </svg>
        <ul className="flex-1 text-xs">
          {segments.map((s) => {
            const pct = total === 0 ? 0 : (s.value / total) * 100;
            return (
              <li
                key={s.label}
                className="grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-baseline gap-x-3"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: s.color }}
                  />
                  <span className="truncate" title={s.label}>
                    {s.label}
                  </span>
                </span>
                <span
                  className="text-right font-tabular font-semibold"
                  title={s.value.toLocaleString('en-US')}
                >
                  {s.value.toLocaleString('en-US')}
                </span>
                <span className="text-right font-tabular text-text-tertiary">
                  {pct.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

function StatusGroupCard({
  groups,
  total,
}: {
  groups: StudentInfoResponse['byStatusGroup'];
  total: number;
}) {
  const grand = groups.reduce((s, g) => s + g.count, 0);
  const COLORS: Record<StatusGroup, string> = {
    // Incoming = warm orange — same colour treatment used for "non-first-
    // semester arrivals" once we surface that signal, so the eye learns
    // "warm = not yet enrolled".
    INCOMING: '#d49000',
    CURRENT: '#664073',
    FORMER: '#7a7a7a',
  };
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Status group mix</h3>
        <span className="text-xs text-text-tertiary">
          across all status codes
        </span>
      </div>
      <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full">
        {groups.map((g) => {
          if (g.count === 0) return null;
          const widthPct = grand === 0 ? 0 : (g.count / grand) * 100;
          return (
            <div
              key={g.group}
              className="h-full"
              style={{ width: `${widthPct}%`, background: COLORS[g.group] }}
              title={`${g.label}: ${g.count.toLocaleString('en-US')}`}
            />
          );
        })}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs md:grid-cols-3">
        {groups.map((g) => {
          const pct = grand === 0 ? 0 : (g.count / grand) * 100;
          return (
            <li
              key={g.group}
              className="grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-baseline gap-x-3"
            >
              <span className="flex items-center gap-1.5 truncate">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: COLORS[g.group] }}
                />
                <span className="truncate text-text-secondary">{g.label}</span>
              </span>
              <span
                className="text-right font-tabular font-semibold"
                title={g.count.toLocaleString('en-US')}
              >
                {g.count.toLocaleString('en-US')}
              </span>
              <span className="text-right font-tabular text-text-tertiary">
                {pct.toFixed(0)}%
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 text-[0.7rem] text-text-tertiary">
        Filter shows {total.toLocaleString('en-US')} of{' '}
        {grand.toLocaleString('en-US')}.
      </div>
    </Card>
  );
}

function BreakdownCard({
  title,
  rows,
  total,
  collapseAt,
  tone,
  className,
}: {
  title: string;
  rows: FacetCount[];
  total: number;
  collapseAt?: number;
  tone: string;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (rows.length === 0) {
    return (
      <Card className={className}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-xs text-text-tertiary">No data.</p>
      </Card>
    );
  }
  const collapsed = collapseAt && !expanded && rows.length > collapseAt;
  const visible = collapsed ? rows.slice(0, collapseAt) : rows;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <Card className={className}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {collapseAt && rows.length > collapseAt && (
          <button
            onClick={() => setExpanded((s) => !s)}
            className="text-[0.7rem] text-text-tertiary hover:text-text-primary"
          >
            {expanded ? `Show top ${collapseAt}` : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {visible.map((r) => {
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
                    background: tone,
                  }}
                />
              </div>
              <span className="text-right font-tabular font-semibold">
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
