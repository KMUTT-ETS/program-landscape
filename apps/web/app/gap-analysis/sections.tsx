import * as React from 'react';
import Link from 'next/link';
import { Card, FreshnessBadge, ProvenanceButton } from '@kku/ui';
import { DataSourceMark, acknowledgementHref } from '@/components/data-source-mark';
import { GapControls } from './controls';
import { RowPanels } from './row-panels';
import { BriefPanelTrigger } from './brief-panel';
import { VERDICT_LABEL, gapHref, type GapPageData, type GapRowT, type GapVerdictT } from './types';

// Pure function of GapPageData: everything below the PageHeader. The only
// client leaf is the brief panel; controls and row panels are server-rendered
// so the render test can assert on the whole page without a DOM or a router,
// and so the page filters with client JavaScript switched off.

const pct1 = (v: number) => `${(v * 100).toFixed(1)} %`;
const int = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const ARROW = { up: '↑', down: '↓', flat: '→' } as const;
const ARROW_LABEL = { up: 'rising', down: 'falling', flat: 'steady' } as const;

/** `supply-unknown` is toned like absent data, not like a shortfall: the
 *  field has programmes, none of them has a graduate figure, and there is
 *  therefore no ratio to be alarmed about. Giving it the danger colour a
 *  white space carries would turn a measurement gap into a finding. */
const VERDICT_TONE: Record<GapVerdictT, string> = {
  'white-space': 'text-danger font-semibold',
  'under-served': 'text-warning font-semibold',
  served: 'text-text-primary font-medium',
  'over-served': 'text-info font-semibold',
  'supply-unknown': 'text-text-tertiary',
  'too-few-postings': 'text-text-tertiary',
};

export function visibleRows(
  rows: GapRowT[],
  verdict: 'all' | GapVerdictT,
  facultyId: string | null,
): GapRowT[] {
  return rows.filter(
    (r) => (verdict === 'all' || r.verdict === verdict) && (!facultyId || r.facultyIds.includes(facultyId)),
  );
}

export function GapMapSections({ data }: { data: GapPageData }): React.JSX.Element {
  const { params, map, meta } = data;
  const rows = visibleRows(map.rows, params.verdict, params.facultyId);
  const wide = map.scope.level !== 'university';
  const columns = wide ? 10 : 9;
  const rec = map.reconciliation;
  const fieldsTotal = map.taxonomy.approved + map.taxonomy.proposed;
  const scopeNote =
    wide && map.scope.label
      ? `Supply narrowed to ${map.scope.label}; the KKU-total column shows the same field over the whole university.`
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
          <DataSourceMark source="jobthai" size={18} href={acknowledgementHref('jobthai')} />
          <span>
            {rec.eligiblePostings.toLocaleString('en-US')} eligible adverts · {map.rows.length} fields of
            study · {map.taxonomy.approved} reviewed, {map.taxonomy.proposed} awaiting review
          </span>
          <ProvenanceButton title="Gap map" meta={meta} />
          <FreshnessBadge freshnessDate={map.freshness.postingsAsOf} label="JobThai adverts" />
        </div>
        <BriefPanelTrigger params={params} />
      </div>

      <GapControls
        params={params}
        verdictCounts={map.verdictCounts}
        total={map.rows.length}
        facultyStrip={map.facultyStrip}
      />

      {scopeNote && <p className="text-xs text-text-tertiary">{scopeNote}</p>}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-text-tertiary">
            <tr>
              <th className="px-3 py-2 font-medium">Field of study</th>
              <th className="px-3 py-2 text-right font-medium">Demand share</th>
              <th className="px-3 py-2 text-right font-medium">KKU share</th>
              {wide && <th className="px-3 py-2 text-right font-medium">KKU total</th>}
              <th className="px-3 py-2 text-right font-medium">Ratio</th>
              <th className="px-3 py-2 text-right font-medium">Graduates / yr</th>
              <th className="px-3 py-2 text-right font-medium">Pipeline</th>
              <th className="px-3 py-2 text-right font-medium">Programmes</th>
              <th className="px-3 py-2 text-right font-medium">Signals</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {rows.map((r) => {
              const open = params.field === r.slug;
              // A field with programmes but no graduate figure has no KKU
              // share to show. "0 %" there would be a measured zero, which
              // is exactly the wrong thing to say.
              const supplyMeasured = r.programmeCount === 0 || r.programmesWithSupply > 0;
              return (
                <React.Fragment key={r.slug}>
                  <tr data-verdict={r.verdict} className={open ? 'bg-surface-2' : ''}>
                    <td className="px-3 py-2">
                      <Link href={gapHref(params, { field: open ? null : r.slug })} className="hover:underline">
                        <span aria-hidden className="mr-1 text-text-tertiary">
                          {open ? '▾' : '▸'}
                        </span>
                        <span lang="th">{r.nameTh}</span>
                        <span className="text-text-secondary"> · {r.nameEn}</span>
                      </Link>
                      {r.reviewStatus === 'PROPOSED' && (
                        <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-tertiary">
                          unreviewed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-tabular">{pct1(r.demandShare)}</td>
                    <td className="px-3 py-2 text-right font-tabular">
                      {supplyMeasured ? (
                        pct1(r.supplyShare)
                      ) : (
                        <span className="text-text-tertiary" title="No graduate figure recorded">
                          —
                        </span>
                      )}
                    </td>
                    {wide && (
                      <td className="px-3 py-2 text-right font-tabular text-text-secondary">
                        {r.kkuTotal ? (
                          <>
                            {r.kkuTotal.verdict === 'supply-unknown' ? '—' : pct1(r.kkuTotal.supplyShare)}
                            <span className="block text-[10px] text-text-tertiary">
                              {VERDICT_LABEL[r.kkuTotal.verdict].toLowerCase()}
                            </span>
                          </>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-tabular">
                      {r.ratio == null ? <span className="text-text-tertiary">—</span> : r.ratio.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-tabular">
                      {r.gradsPerYear == null ? <span className="text-text-tertiary">—</span> : int(r.gradsPerYear)}
                    </td>
                    <td className="px-3 py-2 text-right font-tabular">
                      {r.pipeline == null ? (
                        <span className="text-text-tertiary">—</span>
                      ) : (
                        <>
                          {int(r.pipeline)}
                          {r.pipelineArrow && (
                            <span className="ml-1 text-text-secondary" title={`Pipeline ${ARROW_LABEL[r.pipelineArrow]}`}>
                              <span aria-hidden>{ARROW[r.pipelineArrow]}</span>
                              <span className="sr-only">pipeline {ARROW_LABEL[r.pipelineArrow]}</span>
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-tabular">
                      {r.programmeCount === 0 ? <span className="text-text-tertiary">—</span> : r.programmeCount}
                    </td>
                    <td className="px-3 py-2 text-right font-tabular">
                      {r.signalCount === 0 ? <span className="text-text-tertiary">0</span> : r.signalCount}
                    </td>
                    <td className={`px-3 py-2 ${VERDICT_TONE[r.verdict]}`}>{verdictText(r)}</td>
                  </tr>
                  {open && (
                    <tr className="bg-surface-2">
                      <td colSpan={columns} className="px-3 pb-4 pt-1">
                        <RowPanels row={r} meta={meta} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-3 py-8 text-center text-sm text-text-tertiary">
                  {map.rows.length === 0
                    ? 'No fields yet — the taxonomy has not been built. An admin runs pnpm jobthai:fields --apply after a JobThai upload.'
                    : 'No field matches this verdict and faculty.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="space-y-1 text-xs text-text-tertiary">
        <p>
          Demand shares sum to 100 % of the {rec.fieldMentions.toLocaleString('en-US')} field mentions
          carried by {rec.fieldPostings.toLocaleString('en-US')} eligible adverts that name a canonical
          field ({rec.multiFieldPostings.toLocaleString('en-US')} of those adverts name more than one).
          Not assigned to a field: &ldquo;any field&rdquo; on {rec.anyFieldPostings.toLocaleString('en-US')}{' '}
          adverts · long-tail strings, {rec.otherKinds.toLocaleString('en-US')} distinct kinds over{' '}
          {rec.otherMentions.toLocaleString('en-US')} mentions.
        </p>
        <p>
          Supply shares sum to {pct1(rec.supplyShareSum)} of {int(rec.fieldGraduatesTotal)} graduates per
          year because {rec.multiFieldProgrammes} programmes are assigned to two fields and count in each.
          Postgraduate programmes are listed but not scored — {rec.postgraduatePostings} adverts state a
          postgraduate minimum.
        </p>
        <p>
          Field review: {map.taxonomy.approved} of {fieldsTotal} fields have been checked by an admin;
          the remaining {map.taxonomy.proposed} are AI proposals, shown as they stand and marked
          unreviewed. Review changes a field&apos;s name and which raw strings it gathers, not the
          adverts underneath.
        </p>
        <details>
          <summary className="cursor-pointer">Thresholds in force and the supply rule</summary>
          <p className="mt-1">
            Under-served below {params.under}, over-served above {params.over} (ratio = KKU share ÷
            demand share). Graduates per year = the last five registrar cohorts ÷ 5, or the latest
            graduated-on-time figure where alumni rows are missing; a field whose programmes carry
            neither is reported as supply unknown rather than as a shortfall. Pipeline = students
            currently enrolled; the arrow compares pipeline ÷ 4 with graduates per year at ±25 %. A
            field below the posting floor is shown with its advert count instead of a verdict. Cached
            five minutes; computed{' '}
            {map.computedAt.slice(0, 16).replace('T', ' ')} UTC.
          </p>
        </details>
      </div>
    </div>
  );
}

function verdictText(r: GapRowT): string {
  if (r.verdict === 'too-few-postings') return `too few postings (${r.postings})`;
  if (r.verdict === 'supply-unknown') return 'supply not recorded';
  return VERDICT_LABEL[r.verdict];
}
