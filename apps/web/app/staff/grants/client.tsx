'use client';

// Staff → Research and academic service grants. Evidence-page design language:
// quiet data cards, KPIs first, caveats in the provenance drawer. All numbers
// arrive pre-aggregated from /staff-dashboard/grants; this file only renders.
// Absent data is grey text, never a warning colour.

import { useOrgNames } from '@/components/org-names-context';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ApiMeta } from '@kku/shared';
import { Card, FreshnessBadge, ProvenanceButton, RightPanel } from '@kku/ui';
import { DataSourceMark, acknowledgementHref } from '@/components/data-source-mark';
import { startRouteProgress } from '@/components/route-progress';
import { MultiSelectField } from '../multi-select';
import type { FilterOptions, GrantProjectDetail, GrantType, GrantsResponse } from '../types';

const TYPE_LABEL: Record<GrantType, string> = {
  RESEARCH: 'Research',
  ACADEMIC_SERVICE: 'Academic service',
  CONSULTING: 'Consulting',
  OTHER: 'Other',
};

const thb = (n: number | null) =>
  n === null
    ? '—'
    : n >= 1e9
      ? `฿${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`
      : n >= 1e6
        ? `฿${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`
        : `฿${n.toLocaleString('en-US')}`;

// Changing any of these narrows the project set, so an open project may no
// longer be in it — the side panel closes. Page and sort keep it open.
const FILTER_KEYS = ['facultyName', 'type', 'funder', 'yearFrom', 'yearTo'] as const;

export interface GrantsFilters {
  facultyName: string[];
  type: string[];
  funder: string[];
  yearFrom?: number;
  yearTo?: number;
  page: number;
  sort: 'year' | 'budget' | 'title';
  project: string | null;
}

export function GrantsClient({
  data,
  meta,
  options,
  initialFilters,
}: {
  data: GrantsResponse;
  meta: ApiMeta;
  options: FilterOptions;
  initialFilters: GrantsFilters;
}) {
  const org = useOrgNames();
  const router = useRouter();
  const push = (next: Partial<GrantsFilters>) => {
    const changesFilter = FILTER_KEYS.some((k) => k in next);
    const f = { ...initialFilters, page: 1, ...(changesFilter ? { project: null } : {}), ...next };
    const qs = new URLSearchParams();
    f.facultyName.forEach((v) => qs.append('facultyName', v));
    f.type.forEach((v) => qs.append('type', v));
    f.funder.forEach((v) => qs.append('funder', v));
    if (f.yearFrom !== undefined) qs.set('yearFrom', String(f.yearFrom));
    if (f.yearTo !== undefined) qs.set('yearTo', String(f.yearTo));
    if (f.page > 1) qs.set('page', String(f.page));
    if (f.sort !== 'year') qs.set('sort', f.sort);
    if (f.project) qs.set('project', f.project);
    startRouteProgress();
    router.push(`/staff/grants?${qs}`, { scroll: false });
  };
  const { kpis } = data;
  // Credit the connector's mark only when it actually supplied rows.
  const fromConnector = meta.sources.some((s) => s.id === 'kku-research-services');
  const coverage = kpis.membersTotal
    ? `${Math.round((kpis.membersMatched / kpis.membersTotal) * 100)}%`
    : '—';

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <FilterBar data={data} options={options} f={initialFilters} push={push} />
      </Card>

      <section aria-label="Key figures" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Key figures</h2>
          <ProvenanceButton title="Grants — key figures" meta={meta} size="xs" />
          {fromConnector && (
            <DataSourceMark
              source="kku-research-services"
              href={acknowledgementHref('kku-research-services')}
            />
          )}
          <span className="ml-auto">
            <FreshnessBadge freshnessDate={meta.freshnessDate} label="grants data" />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Projects" value={kpis.projects.toLocaleString('en-US')} />
          <Kpi label="Total budget" value={thb(kpis.budgetThb)} hint="each project counted once" />
          <Kpi
            label="Staff involved"
            value={kpis.staffInvolved.toLocaleString('en-US')}
            hint="matched to HR records, in the faculties shown"
          />
          <Kpi
            label="Match coverage"
            value={coverage}
            hint={`${kpis.membersMatched.toLocaleString('en-US')} of ${kpis.membersTotal.toLocaleString('en-US')} team members`}
          />
        </div>
        <p className="text-xs text-text-tertiary">
          A project appears when any team member is in the faculties you can see or have selected;
          its team list may include people from other faculties.
        </p>
      </section>

      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">By fiscal year</h2>
          <ProvenanceButton title="Grants — by fiscal year" meta={meta} size="xs" />
          {fromConnector && <DataSourceMark source="kku-research-services" />}
        </div>
        <TrendChart trend={data.trend} />
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">By faculty</h2>
          <ProvenanceButton title="Grants — by faculty" meta={meta} size="xs" />
          {fromConnector && <DataSourceMark source="kku-research-services" />}
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          A project counts for every faculty with a team member on it, so these rows add up to more
          than the {org.en} total.
        </p>
        {data.byFaculty.length === 0 ? (
          <p className="mt-3 text-sm text-text-tertiary">No faculties match these filters.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-text-tertiary">
              <tr>
                <th className="py-2 font-medium">Faculty / unit</th>
                <th className="py-2 text-right font-medium">Led</th>
                <th className="py-2 text-right font-medium">Co-investigator only</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.byFaculty.map((r) => (
                <tr key={r.facultyName} className="border-t border-subtle">
                  <td className="py-2 pr-4">{r.facultyName}</td>
                  <td className="py-2 text-right tabular-nums">{r.led.toLocaleString('en-US')}</td>
                  <td className="py-2 text-right tabular-nums">
                    {r.coOnly.toLocaleString('en-US')}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {r.total.toLocaleString('en-US')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Top funders</h2>
          <ProvenanceButton title="Grants — top funders" meta={meta} size="xs" />
          {fromConnector && <DataSourceMark source="kku-research-services" />}
        </div>
        {data.topFunders.length === 0 ? (
          <p className="mt-3 text-sm text-text-tertiary">No funders match these filters.</p>
        ) : (
          <ul className="mt-3 flex flex-col text-sm">
            {data.topFunders.map((fu) => (
              <li
                key={fu.funderName ?? '∅'}
                className="flex items-baseline justify-between gap-4 border-t border-subtle py-2"
              >
                <span className={fu.funderName ? '' : 'text-text-tertiary'}>
                  {fu.funderName ?? 'Funder not recorded'}
                </span>
                <span className="shrink-0 tabular-nums text-text-secondary">
                  {fu.projects.toLocaleString('en-US')} projects · {thb(fu.budgetThb)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Projects</h2>
          <ProvenanceButton title="Grants — projects" meta={meta} size="xs" />
          {fromConnector && <DataSourceMark source="kku-research-services" />}
        </div>
        <ProjectTable data={data} f={initialFilters} push={push} />
      </Card>

      {initialFilters.project ? (
        <ProjectPanel
          id={initialFilters.project}
          onClose={() => push({ project: null, page: initialFilters.page })}
        />
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-subtle bg-surface-1 p-5">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-xl font-semibold tabular-nums text-text-primary">{value}</span>
      {hint ? <span className="text-xs text-text-tertiary">{hint}</span> : null}
    </div>
  );
}

function TrendChart({ trend }: { trend: GrantsResponse['trend'] }) {
  if (trend.length === 0)
    return <p className="mt-3 text-sm text-text-tertiary">No projects match these filters.</p>;
  const W = 640;
  const H = 180;
  const pad = { l: 8, r: 8, t: 16, b: 24 };
  const max = Math.max(...trend.map((t) => t.RESEARCH + t.ACADEMIC_SERVICE + t.OTHER), 1);
  const bw = (W - pad.l - pad.r) / trend.length;
  const y = (v: number) => ((H - pad.t - pad.b) * v) / max;
  // Thin the year labels on long ranges so they never overlap.
  const labelEvery = Math.ceil(trend.length / 14);
  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Projects per fiscal year by type"
      >
        {trend.map((t, i) => {
          const x = pad.l + i * bw + bw * 0.15;
          const w = bw * 0.7;
          const base = H - pad.b;
          const r = y(t.RESEARCH);
          const s = y(t.ACADEMIC_SERVICE);
          const o = y(t.OTHER);
          const total = t.RESEARCH + t.ACADEMIC_SERVICE + t.OTHER;
          return (
            <g key={t.fiscalYearBe}>
              <title>{`FY ${t.fiscalYearBe}: ${t.RESEARCH} research, ${t.ACADEMIC_SERVICE} academic service, ${t.OTHER} other (incl. consulting) — ${thb(t.budgetThb)}`}</title>
              <rect
                x={x}
                y={base - r}
                width={w}
                height={r}
                style={{ fill: 'oklch(var(--color-chart-1))' }}
              />
              <rect
                x={x}
                y={base - r - s}
                width={w}
                height={s}
                style={{ fill: 'oklch(var(--color-chart-3))' }}
              />
              <rect
                x={x}
                y={base - r - s - o}
                width={w}
                height={o}
                style={{ fill: 'oklch(var(--color-chart-6))' }}
              />
              {total === max ? (
                <text
                  x={x + w / 2}
                  y={base - r - s - o - 4}
                  textAnchor="middle"
                  className="fill-text-tertiary text-[10px] tabular-nums"
                >
                  {total}
                </text>
              ) : null}
              {i % labelEvery === 0 ? (
                <text
                  x={x + w / 2}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-text-tertiary text-[10px] tabular-nums"
                >
                  {t.fiscalYearBe}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {/* Per-year budget, readable without hovering: one cell per bar, in the
          bar's own column, thinned exactly like the year labels. */}
      <div
        className="grid text-[10px] tabular-nums text-text-tertiary"
        style={{
          gridTemplateColumns: `repeat(${trend.length}, minmax(0, 1fr))`,
          paddingLeft: `${(pad.l / W) * 100}%`,
          paddingRight: `${(pad.r / W) * 100}%`,
        }}
        aria-label="Budget per fiscal year"
      >
        {trend.map((t, i) => (
          <span
            key={t.fiscalYearBe}
            className="whitespace-nowrap text-center"
            title={`FY ${t.fiscalYearBe}: ${thb(t.budgetThb)}`}
          >
            {i % labelEvery === 0 ? thb(t.budgetThb) : ''}
          </span>
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-xs text-text-secondary">
        <Legend color="--color-chart-1" label="Research" />
        <Legend color="--color-chart-3" label="Academic service" />
        <Legend color="--color-chart-6" label="Other (incl. consulting)" />
        <span className="text-text-tertiary">
          Projects per fiscal year (BE); the row under the bars is each year’s total budget.
        </span>
      </figcaption>
    </figure>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={10} height={10} aria-hidden>
        <rect width={10} height={10} style={{ fill: `oklch(var(${color}))` }} />
      </svg>
      {label}
    </span>
  );
}

function ProjectTable({
  data,
  f,
  push,
}: {
  data: GrantsResponse;
  f: GrantsFilters;
  push: (n: Partial<GrantsFilters>) => void;
}) {
  const { table } = data;
  const pages = Math.max(1, Math.ceil(table.total / table.pageSize));
  const open = (id: string) => push({ project: id, page: f.page });
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex items-center gap-4 text-xs text-text-tertiary">
        <span>Sort:</span>
        {(['year', 'budget', 'title'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === f.sort}
            onClick={() => push({ sort: s })}
            className={s === f.sort ? 'font-semibold text-text-primary' : 'hover:text-text-primary'}
          >
            {s === 'year' ? 'Newest' : s === 'budget' ? 'Budget' : 'Title'}
          </button>
        ))}
        <span className="ml-auto tabular-nums">{table.total.toLocaleString('en-US')} projects</span>
      </div>
      {table.rows.length === 0 ? (
        <p className="text-sm text-text-tertiary">No projects match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-tertiary">
              <tr>
                <th className="py-2 font-medium">Project</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 text-right font-medium">FY</th>
                <th className="py-2 pl-4 font-medium">Lead</th>
                <th className="py-2 font-medium">Funder</th>
                <th className="py-2 text-right font-medium">Budget</th>
                <th className="py-2 text-right font-medium">Team</th>
                <th className="py-2 pl-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => open(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open(r.id);
                    }
                  }}
                  className="cursor-pointer border-t border-subtle align-top transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <td className="py-2 pr-4">
                    <div>{r.titleTh}</div>
                    {r.titleEn ? (
                      <div className="text-xs text-text-tertiary">{r.titleEn}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{TYPE_LABEL[r.type]}</td>
                  <td className="py-2 text-right tabular-nums">{r.fiscalYearBe}</td>
                  <td className="py-2 pl-4 pr-4">
                    <div className={r.leadName ? '' : 'text-text-tertiary'}>
                      {r.leadName ?? 'Not recorded'}
                    </div>
                    <div className="text-xs text-text-tertiary">{r.leadFacultyName}</div>
                  </td>
                  <td className="py-2 pr-4">
                    {r.funderName ?? <span className="text-text-tertiary">Not recorded</span>}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${r.budgetThb === null ? 'text-text-tertiary' : ''}`}
                  >
                    {thb(r.budgetThb)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{r.teamSize}</td>
                  <td className="py-2 pl-4 text-xs text-text-tertiary">{r.workflowStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-end gap-6 text-xs">
        <button
          type="button"
          disabled={f.page <= 1}
          onClick={() => push({ page: f.page - 1 })}
          className="disabled:opacity-40"
        >
          ← Previous
        </button>
        <span className="tabular-nums text-text-tertiary">
          Page {f.page} of {pages}
        </span>
        <button
          type="button"
          disabled={f.page >= pages}
          onClick={() => push({ page: f.page + 1 })}
          className="disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

const isoDay = (d: string | null) => (d ? d.slice(0, 10) : null);

function ProjectPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [state, setState] = React.useState<{
    detail: GrantProjectDetail | null;
    freshnessDate: string | null;
    error: string | null;
  }>({
    detail: null,
    freshnessDate: null,
    error: null,
  });
  React.useEffect(() => {
    let live = true;
    setState({ detail: null, freshnessDate: null, error: null });
    fetch(`/api/proxy/staff/grants/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const payload = (await r.json()) as {
          data: GrantProjectDetail | null;
          meta?: { freshnessDate?: string | null };
          error?: { message?: string };
        };
        if (!r.ok || !payload.data) throw new Error(payload.error?.message ?? `HTTP ${r.status}`);
        return { detail: payload.data, freshnessDate: payload.meta?.freshnessDate ?? null };
      })
      .then(({ detail, freshnessDate }) => {
        if (live) setState({ detail, freshnessDate, error: null });
      })
      .catch((e: Error) => {
        if (live) setState({ detail: null, freshnessDate: null, error: e.message });
      });
    return () => {
      live = false;
    };
  }, [id]);
  const d = state.detail;
  return (
    <RightPanel open onOpenChange={(o) => !o && onClose()} title={d?.titleTh ?? 'Project'}>
      {state.error ? (
        <p className="text-sm text-text-tertiary">
          This project is unavailable or outside your scope.
        </p>
      ) : !d ? (
        <div className="h-24 animate-pulse rounded-md bg-surface-2" />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          {d.titleEn ? <p className="text-text-secondary">{d.titleEn}</p> : null}
          <FreshnessBadge freshnessDate={state.freshnessDate} label="grants data" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-text-tertiary">Type</dt>
            <dd>{d.typeRaw}</dd>
            <dt className="text-text-tertiary">Fiscal year</dt>
            <dd className="tabular-nums">{d.fiscalYearBe}</dd>
            <dt className="text-text-tertiary">Period</dt>
            <dd className="tabular-nums">
              {isoDay(d.startDate) ?? '—'} – {isoDay(d.endDate) ?? '—'}
            </dd>
            <dt className="text-text-tertiary">Funder</dt>
            <dd className={d.funderName ? '' : 'text-text-tertiary'}>
              {d.funderName ?? 'Not recorded'}
            </dd>
            <dt className="text-text-tertiary">Budget</dt>
            <dd className="tabular-nums">
              {thb(d.budgetThb)} <span className="text-text-tertiary">(whole project)</span>
            </dd>
            <dt className="text-text-tertiary">Status</dt>
            <dd>{d.workflowStatus}</dd>
            {d.keywords ? (
              <>
                <dt className="text-text-tertiary">Keywords</dt>
                <dd>{d.keywords}</dd>
              </>
            ) : null}
          </dl>
          <h3 className="text-xs font-semibold text-text-tertiary">Team</h3>
          <ul className="flex flex-col">
            {d.team.map((m, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-6 border-t border-subtle py-2"
              >
                <span>
                  <span className={m.displayName ? '' : 'text-text-tertiary'}>
                    {m.displayName ?? 'Name not recorded'}
                  </span>
                  <span className="ml-2 text-xs text-text-tertiary">
                    {m.role === 'LEAD' ? 'Lead' : 'Co-investigator'}
                  </span>
                </span>
                <span className="text-right text-xs text-text-tertiary">
                  {m.facultyName ?? '—'}
                  {m.matched ? '' : ' · not matched to HR'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </RightPanel>
  );
}

function FilterBar({
  data,
  options,
  f,
  push,
}: {
  data: GrantsResponse;
  options: FilterOptions;
  f: GrantsFilters;
  push: (n: Partial<GrantsFilters>) => void;
}) {
  const years: number[] = [];
  if (data.options.yearMin !== null && data.options.yearMax !== null) {
    for (let y = data.options.yearMax; y >= data.options.yearMin; y -= 1) years.push(y);
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <MultiSelectField
        label="Faculty"
        options={options.faculties.map((x) => ({ value: x, label: x }))}
        selected={f.facultyName}
        onChange={(v) => push({ facultyName: v })}
      />
      <MultiSelectField
        label="Type"
        options={(Object.entries(TYPE_LABEL) as Array<[GrantType, string]>).map(
          ([value, label]) => ({ value, label }),
        )}
        selected={f.type}
        onChange={(v) => push({ type: v })}
        preserveOrder
      />
      <MultiSelectField
        label="Funder"
        options={data.options.funders.map((x) => ({ value: x, label: x }))}
        selected={f.funder}
        onChange={(v) => push({ funder: v })}
      />
      <YearSelect
        label="From FY"
        value={f.yearFrom}
        years={years}
        onChange={(v) => push({ yearFrom: v })}
      />
      <YearSelect
        label="To FY"
        value={f.yearTo}
        years={years}
        onChange={(v) => push({ yearTo: v })}
      />
    </div>
  );
}

function YearSelect({
  label,
  value,
  years,
  onChange,
}: {
  label: string;
  value: number | undefined;
  years: number[];
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-tertiary">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        className="rounded-md border border-default bg-surface-1 px-4 py-2 text-sm text-text-primary"
      >
        <option value="">Any</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}
