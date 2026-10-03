'use client';

// /education/program-overlap — clustered heatmap of same-level programme
// overlap (program-overlap.v1, spec §10.1). Every number arrives computed from
// /education/program-overlap; this file only renders. Data is the loudest
// layer, chrome stays quiet, absent figures are grey text — never red.
//
// Type-only imports from @kku/db / @kku/shared: a runtime import of either
// barrel would drag node-only modules into the client bundle.

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApiMeta } from '@kku/shared';
import {
  Badge,
  Card,
  FreshnessBadge,
  OverlapMatrix,
  ProvenanceButton,
  RightPanel,
  type OverlapMatrixCell as VizCell,
  type OverlapMatrixProgramme,
} from '@kku/ui';
import { FilterField, FilterRail, FilterSelect } from '@/components/filter-rail';
import { startRouteProgress } from '@/components/route-progress';
import {
  EquivalentCoursesList,
  EvidenceQualityNote,
  OverlapLayerBar as LayerBar,
  OverlapPanelSection as PanelSection,
  OverlapRecommendation,
  PloMatchView,
  SharedCoursesTable,
} from '@/components/overlap/pair-evidence';
import {
  LANGUAGE_VARIANT_LABEL,
  OVERLAP_LAYERS,
  OVERLAP_LEVELS,
  THRESHOLD_OPTIONS,
  actionBadgeLabel,
  layerValue,
  matrixTitle,
  overlapQueryString,
  isUncorroborated,
  pct,
  programmeLabel,
  sortActionsStrongestFirst,
  type OverlapFilters,
  type OverlapMatrixResponse,
  type OverlapPairDetail,
} from './types';

export interface FacultyOption {
  id: string;
  code: string;
  label: string;
}

const PATH = '/education/program-overlap';
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function ProgramOverlapClient({
  data,
  meta,
  filters,
  faculties,
  canPickFaculty,
  emptyState,
}: {
  data: OverlapMatrixResponse;
  meta: ApiMeta;
  filters: OverlapFilters;
  faculties: FacultyOption[];
  canPickFaculty: boolean;
  emptyState: React.ReactNode;
}) {
  const router = useRouter();
  // Threshold and the open pair are client-only state: they never change
  // what the server returns, so they update the URL in place instead of
  // re-rendering the page.
  const [threshold, setThreshold] = React.useState(filters.threshold);
  const [pairId, setPairId] = React.useState<string | null>(filters.pair);

  const replaceUrl = (next: Partial<OverlapFilters>) => {
    const qs = overlapQueryString({ ...filters, threshold, pair: pairId, ...next });
    window.history.replaceState(null, '', qs ? `${PATH}?${qs}` : PATH);
  };
  // Level, layer and faculty change the server answer: navigate.
  const push = (next: Partial<OverlapFilters>) => {
    const qs = overlapQueryString({ ...filters, threshold, pair: null, ...next });
    startRouteProgress();
    router.push(qs ? `${PATH}?${qs}` : PATH, { scroll: false });
  };

  const refs = React.useMemo(() => new Map(data.programmes.map((p) => [p.id, p])), [data.programmes]);
  const names = React.useMemo(
    () => new Map(data.programmes.map((p) => [p.id, programmeLabel(p)])),
    [data.programmes],
  );
  const facultyIndex = React.useMemo(() => {
    const codes = [...new Set(data.programmes.map((p) => p.facultyCode ?? p.facultyId))].sort();
    return new Map(codes.map((c, i) => [c, i]));
  }, [data.programmes]);

  const vizProgrammes: OverlapMatrixProgramme[] = React.useMemo(
    () =>
      data.order.flatMap((id) => {
        const p = refs.get(id);
        if (!p) return [];
        return [
          {
            id,
            label: programmeLabel(p),
            sublabel: [p.nameEn, p.code, p.facultyNameEn].filter(Boolean).join(' · '),
            groupColorIndex: facultyIndex.get(p.facultyCode ?? p.facultyId) ?? 0,
          },
        ];
      }),
    [data.order, refs, facultyIndex],
  );
  const vizCells: VizCell[] = React.useMemo(
    () =>
      data.cells.map((c) => ({
        a: c.a,
        b: c.b,
        value: layerValue(c, data.layer),
        title: matrixTitle(c, names),
      })),
    [data.cells, data.layer, names],
  );
  const cellByPair = React.useMemo(
    () => new Map(data.cells.map((c) => [pairKey(c.a, c.b), c])),
    [data.cells],
  );
  const selectedCell = pairId ? data.cells.find((c) => c.pairId === pairId) ?? null : null;

  const layerMeta = OVERLAP_LAYERS.find((l) => l.value === data.layer) ?? {
    value: data.layer,
    label: data.layer,
    hint: '',
  };
  const levelLabel = OVERLAP_LEVELS.find((l) => l.value === data.level)?.label ?? data.level;
  const k = data.kpis;

  return (
    <div className="flex flex-col gap-[16px]">
      <FilterRail cols={4} onSubmit={(e) => e.preventDefault()}>
        <FilterField label="Level">
          <FilterSelect
            value={filters.level}
            onChange={(e) => push({ level: e.target.value as OverlapFilters['level'] })}
          >
            {OVERLAP_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
        <FilterField label="Layer">
          <FilterSelect
            value={filters.layer}
            onChange={(e) => push({ layer: e.target.value as OverlapFilters['layer'] })}
          >
            {OVERLAP_LAYERS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
        {canPickFaculty ? (
          <FilterField label="Faculty">
            <FilterSelect
              value={filters.facultyId ?? ''}
              onChange={(e) => push({ facultyId: e.target.value || null })}
            >
              <option value="">All faculties</option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </FilterSelect>
          </FilterField>
        ) : null}
        <FilterField label="Show cells from">
          <FilterSelect
            value={String(threshold)}
            onChange={(e) => {
              const t = Number(e.target.value);
              setThreshold(t);
              replaceUrl({ threshold: t });
            }}
          >
            {THRESHOLD_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === 0 ? 'Every stored pair' : `${t} and above`}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
      </FilterRail>

      {emptyState ?? (
        <>
          <section aria-label="Key figures" className="grid grid-cols-2 gap-[12px] md:grid-cols-4">
            <Kpi
              label="High-overlap pairs"
              value={k.highPairs.toLocaleString('en-US')}
              hint={
                k.highLanguageVariantPairs > 0
                  ? `index ≥ 70 · ${k.highLanguageVariantPairs} are Thai / international versions`
                  : 'index ≥ 70'
              }
            />
            <Kpi
              label="Programmes in overlap groups"
              value={k.programmesInGroups.toLocaleString('en-US')}
              hint={`of ${data.programmes.length} shown · linked at index ≥ 50`}
            />
            <Kpi
              label="Merge-or-track candidates"
              value={k.mergeCandidates.toLocaleString('en-US')}
              hint="pairs for review, language variants excluded"
            />
            <Kpi
              label="Consolidatable credits"
              value={k.consolidatableCredits.toLocaleString('en-US')}
              hint="equivalent-course credits across flagged pairs"
            />
          </section>

          <Card>
            <div className="flex flex-wrap items-center gap-[8px]">
              <h2 className="text-sm font-semibold text-text-primary">
                {levelLabel} programmes — {layerMeta.label.toLowerCase()}
              </h2>
              <ProvenanceButton title={`Program overlap — ${layerMeta.label}`} meta={meta} size="xs" />
              <span className="ml-auto">
                <FreshnessBadge freshnessDate={data.completedAt} label="overlap run" />
              </span>
            </div>
            <p className="mt-[4px] text-xs text-text-tertiary">
              {layerMeta.hint}. Programmes are ordered by clustering on this layer; outlined blocks are
              groups linked at index ≥ 50. The strips show faculty. Click a cell for the evidence.
            </p>
            {vizProgrammes.length === 0 ? (
              <p className="mt-[16px] text-sm text-text-tertiary">
                No stored pairs for {levelLabel.toLowerCase()} programmes
                {filters.facultyId ? ' in this faculty' : ''}.
              </p>
            ) : (
              <div className="mt-[16px]">
                <OverlapMatrix
                  programmes={vizProgrammes}
                  cells={vizCells}
                  groups={data.groups}
                  threshold={threshold}
                  selected={selectedCell ? { a: selectedCell.a, b: selectedCell.b } : null}
                  onSelect={(a, b) => {
                    const c = cellByPair.get(pairKey(a, b));
                    if (!c) return;
                    setPairId(c.pairId);
                    replaceUrl({ pair: c.pairId });
                  }}
                  ariaLabel={`${levelLabel} programme overlap matrix, ${layerMeta.label}`}
                />
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-[8px]">
              <h2 className="text-sm font-semibold text-text-primary">Overlap groups</h2>
              <ProvenanceButton title="Program overlap — groups" meta={meta} size="xs" />
            </div>
            {data.groups.length === 0 ? (
              <p className="mt-[8px] text-sm text-text-tertiary">
                No programmes are linked at index ≥ 50 here.
              </p>
            ) : (
              <ul className="mt-[8px] flex flex-col">
                {[...data.groups]
                  .sort((a, b) => b.peakIndex - a.peakIndex)
                  .map((g) => (
                    <li
                      key={g.members.join('|')}
                      className="flex items-baseline gap-[16px] border-t border-subtle py-[10px] first:border-t-0"
                    >
                      <span className="w-[72px] shrink-0 text-xs tabular-nums text-text-tertiary">
                        peak {Math.round(g.peakIndex)}
                      </span>
                      <span className="flex flex-wrap gap-x-[12px] gap-y-[4px] text-sm">
                        {g.members.map((id) => {
                          const p = refs.get(id);
                          return (
                            <Link key={id} href={`/programs/${id}`} className="hover:underline" lang="th">
                              {p ? programmeLabel(p) : id}
                              {p?.facultyCode ? (
                                <span className="ml-[4px] text-xs text-text-tertiary">{p.facultyCode}</span>
                              ) : null}
                            </Link>
                          );
                        })}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {pairId ? (
        <PairPanel
          pairId={pairId}
          onClose={() => {
            setPairId(null);
            replaceUrl({ pair: null });
          }}
        />
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="flex flex-col gap-[4px]">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-xl font-semibold tabular-nums text-text-primary">{value}</span>
      <span className="text-xs text-text-tertiary">{hint}</span>
    </Card>
  );
}

// ── Side panel ──────────────────────────────────────────────────────────

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: OverlapPairDetail };

function PairPanel({ pairId, onClose }: { pairId: string; onClose: () => void }) {
  const [state, setState] = React.useState<PanelState>({ status: 'loading' });
  React.useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    fetch(`/api/proxy/education/program-overlap/pairs/${encodeURIComponent(pairId)}`)
      .then(async (r) => {
        const payload = (await r.json()) as {
          data: OverlapPairDetail | null;
          error?: { message?: string } | null;
        };
        if (!r.ok || !payload.data) throw new Error(payload.error?.message ?? `HTTP ${r.status}`);
        return payload.data;
      })
      .then((detail) => {
        if (live) setState({ status: 'ready', detail });
      })
      .catch((e: Error) => {
        if (live) setState({ status: 'error', message: e.message });
      });
    return () => {
      live = false;
    };
  }, [pairId]);

  const title =
    state.status === 'ready'
      ? `${programmeLabel(state.detail.programA)} ↔ ${programmeLabel(state.detail.programB)}`
      : 'Programme pair';
  return (
    <RightPanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      widthClass="w-[min(640px,92vw)]"
    >
      {state.status === 'error' ? (
        <p className="text-sm text-text-tertiary">
          This pair is unavailable or outside your scope.
        </p>
      ) : state.status === 'loading' ? (
        <div className="flex flex-col gap-[12px]" aria-busy>
          <div className="h-[20px] w-2/3 animate-pulse rounded-md bg-surface-2" />
          <div className="h-[96px] animate-pulse rounded-md bg-surface-2" />
          <div className="h-[160px] animate-pulse rounded-md bg-surface-2" />
        </div>
      ) : (
        <PairDetailView d={state.detail} />
      )}
    </RightPanel>
  );
}

function PairDetailView({ d }: { d: OverlapPairDetail }) {
  const ev = d.evidence;
  const actions = sortActionsStrongestFirst(d.actions);
  const nameA = programmeLabel(d.programA);
  const nameB = programmeLabel(d.programB);
  return (
    <div className="flex flex-col gap-[20px] text-sm">
      <div className="flex flex-col gap-[8px]">
        <ProgrammeLine side="A" p={d.programA} />
        <ProgrammeLine side="B" p={d.programB} />
        <div className="flex flex-wrap items-center gap-[8px]">
          <FreshnessBadge freshnessDate={d.completedAt} label="overlap run" />
          {d.languageVariant ? <Badge tone="info">{LANGUAGE_VARIANT_LABEL}</Badge> : null}
          {!d.isCurrent ? <Badge tone="outline">Superseded by a newer run</Badge> : null}
        </div>
        <EvidenceQualityNote evidence={ev} />
        {d.languageVariant ? (
          <p className="text-xs text-text-tertiary">
            These are the Thai and international versions of one programme. They overlap by design, are
            never suggested for merging, and are left out of the risk indicators.
          </p>
        ) : null}
      </div>

      <PanelSection title="Layers">
        <div className="flex flex-col gap-[8px]">
          <LayerBar
            label="Overlap index"
            value={d.overlapIndex}
            strong
            nullText={isUncorroborated(ev) ? 'Not scored' : undefined}
          />
          <LayerBar label="Structure — shared courses" value={d.structure} />
          <LayerBar label="Content — equivalent courses" value={d.content} />
          <LayerBar label="Outcome — PLO alignment" value={d.outcome} />
          <LayerBar label="Market similarity (not in the index)" value={d.marketSimilarity} />
        </div>
        <dl className="mt-[12px] grid grid-cols-[1fr_auto] gap-x-[16px] gap-y-[4px] text-xs">
          <dt className="text-text-tertiary">Share of A found in B</dt>
          <dd className="tabular-nums">{d.containmentAInB === null ? '—' : `${pct(d.containmentAInB)}%`}</dd>
          <dt className="text-text-tertiary">Share of B found in A</dt>
          <dd className="tabular-nums">{d.containmentBInA === null ? '—' : `${pct(d.containmentBInA)}%`}</dd>
          <dt className="text-text-tertiary">Shared active staff</dt>
          <dd className="tabular-nums">{d.sharedStaff}</dd>
        </dl>
      </PanelSection>

      <PanelSection title="Suggested actions">
        {actions.length === 0 ? (
          <p className="text-text-tertiary">No action suggested for this pair.</p>
        ) : (
          <div className="flex flex-wrap gap-[6px]">
            {actions.map((a) => (
              <Badge key={a} tone={a === d.primaryAction ? 'accent' : 'neutral'}>
                {actionBadgeLabel(a)}
              </Badge>
            ))}
          </div>
        )}
        <p className="mt-[6px] text-xs text-text-tertiary">
          Chosen by fixed rules from the figures above. They are prompts for a review, not decisions.
        </p>
      </PanelSection>

      <PanelSection title={`Shared courses · ${d.sharedCredits} credits`}>
        <SharedCoursesTable evidence={ev} />
      </PanelSection>

      <PanelSection title={`Equivalent courses · ${d.equivCredits} credits`}>
        <EquivalentCoursesList evidence={ev} />
      </PanelSection>

      <PanelSection title="Programme learning outcomes">
        <PloMatchView evidence={ev} labelA={`A · ${nameA}`} labelB={`B · ${nameB}`} />
      </PanelSection>

      <OverlapRecommendation
        pairId={d.pairId}
        recommendation={d.recommendation}
        primaryAction={d.primaryAction}
        programmes={[d.programA, d.programB]}
        labelA="A"
        labelB="B"
      />

      {ev ? (
        <details className="text-xs text-text-tertiary">
          <summary className="cursor-pointer select-none hover:text-text-secondary">Coverage behind these figures</summary>
          <dl className="mt-[6px] grid grid-cols-[1fr_auto_auto] gap-x-[16px] gap-y-[2px] tabular-nums">
            <dt />
            <dd>A</dd>
            <dd>B</dd>
            <dt>Major courses</dt>
            <dd>{ev.coverage.majorCoursesA}</dd>
            <dd>{ev.coverage.majorCoursesB}</dd>
            <dt>Embedded for content</dt>
            <dd>{ev.coverage.embeddedA}</dd>
            <dd>{ev.coverage.embeddedB}</dd>
            <dt>With a description</dt>
            <dd>{ev.coverage.describedA}</dd>
            <dd>{ev.coverage.describedB}</dd>
            <dt>PLOs</dt>
            <dd>{ev.coverage.plosA}</dd>
            <dd>{ev.coverage.plosB}</dd>
          </dl>
          <p className="mt-[6px]">
            {ev.coverage.descriptionMatches} equivalent pair(s) matched on descriptions; the rest on course
            names alone. {ev.coverage.defaultedCredits} course credit value(s) were defaulted. Methodology{' '}
            {d.methodologyVersion}.
          </p>
        </details>
      ) : null}
    </div>
  );
}

function ProgrammeLine({ side, p }: { side: 'A' | 'B'; p: OverlapPairDetail['programA'] }) {
  return (
    <div className="flex items-baseline gap-[8px]">
      <span className="w-[16px] shrink-0 text-xs font-semibold text-text-tertiary">{side}</span>
      <span>
        <Link href={`/programs/${p.id}`} className="font-medium text-text-primary hover:underline" lang="th">
          {programmeLabel(p)}
        </Link>
        <span className="block text-xs text-text-tertiary">
          {[p.nameEn, p.code, p.facultyNameEn].filter(Boolean).join(' · ')}
        </span>
      </span>
    </div>
  );
}
