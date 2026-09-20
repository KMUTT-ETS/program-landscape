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

      {/* The two shares are what every verdict rests on, and a reader who
          cannot follow them cannot follow the page. Said here in full
          sentences, always visible — the precise definitions stay in the
          collapsed note below the table and in the provenance drawer. */}
      <p className="max-w-[80ch] text-xs text-text-secondary">
        Each row compares two percentages.{' '}
        <strong className="font-medium text-text-primary">Demand share</strong> is this field&apos;s share of
        all the job adverts that name a field of study.{' '}
        <strong className="font-medium text-text-primary">KKU share</strong> is its share of all the
        graduates KKU produces each year in the fields we can measure. The{' '}
        <strong className="font-medium text-text-primary">ratio</strong> is the second divided by the first:
        below 1 means KKU produces proportionally fewer graduates in this field than employers ask for,
        above 1 means proportionally more, and around 1 means the two are in step.
      </p>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-text-tertiary">
            <tr>
              <th className="px-3 py-2 font-medium">Field of study</th>
              <NumHead
                label="Demand share"
                unit="% of adverts"
                title="Demand share: of all the job adverts that name any field of study, the percentage that name this one."
              />
              <NumHead
                label="KKU share"
                unit="% of graduates"
                title="KKU share: of all the graduates KKU produces each year in fields we can measure, the percentage who hold this one."
              />
              {wide && (
                <NumHead
                  label="KKU total"
                  unit="% of graduates, all KKU"
                  title="The same KKU share measured over the whole university rather than over the faculty or department in scope."
                />
              )}
              <NumHead
                label="Ratio"
                unit="KKU ÷ demand"
                title="Ratio: KKU share divided by demand share. Below 1 means KKU produces proportionally fewer graduates in this field than employers ask for; above 1 means proportionally more."
              />
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
                      {/* A white space holding a Master's or a PhD used to
                          show the same bare dash as a field KKU teaches
                          nothing in. The count sits on its own line rather
                          than beside the dash, so the two numbers can never
                          be read as one. */}
                      {r.programmeCount === 0 && r.postgraduateProgrammes > 0 && (
                        <span className="block text-[10px] text-text-tertiary">
                          {r.postgraduateProgrammes} postgraduate
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-tabular">
                      {r.signalCount === 0 ? <span className="text-text-tertiary">0</span> : r.signalCount}
                    </td>
                    <td className={`px-3 py-2 ${VERDICT_TONE[r.verdict]}`}>{verdictText(r)}</td>
                  </tr>
                  {open && (
                    <tr className="bg-surface-2">
                      <td colSpan={columns} className="px-3 pb-4 pt-1">
                        <RowPanels row={r} meta={meta} basis={params.basis} />
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

      {/* Always visible, never a tooltip or a drawer — this exact sentence
          was written after "two bare percentages side by side" was reported
          as a defect on this page once already. */}
      <p className="text-xs text-text-secondary">
        Demand share is each field&apos;s share of all adverts naming a field of study, on the selected
        basis. KKU share is that field&apos;s share of KKU&apos;s bachelor graduates per year.
      </p>

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
          That total rests on {rec.scoredWithSupply} of {rec.scoredProgrammes} scored programmes —{' '}
          {rec.scoredWithSupply - rec.supplyFromProxy} counted from alumni entry cohorts,{' '}
          {rec.supplyFromProxy} from the enrolment-metric fallback, and{' '}
          {rec.scoredProgrammes - rec.scoredWithSupply} with no graduate figure at all.
        </p>
        <p>
          Every verdict on this page is about bachelor programmes only. A field&apos;s postgraduate
          programmes are listed inside its row with their graduates, but never scored, because only{' '}
          {rec.postgraduatePostings.toLocaleString('en-US')} of the{' '}
          {rec.eligiblePostings.toLocaleString('en-US')} adverts state a postgraduate minimum — too few
          to judge one against. So a white space means KKU has no bachelor programme in that field; it
          may still run a Master&apos;s or a PhD there, and the row says so where it does.
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
            demand share). Graduates per year = the mean of a programme&apos;s registrar entry cohorts
            that could already have graduated — an entry year counts only once it is at least the
            programme&apos;s length behind the current academic year — divided by however many such
            cohorts there are, not by a fixed five. The window is anchored on each programme
            separately, reaching six years back from its own newest graduatable cohort, so a six-year
            programme is averaged over as many cohorts as a four-year one; the row panel says how many
            each figure rests on. Where no alumni cohort qualifies, the fallback is the most recent
            graduated-on-time figure that records any graduations at all, shown with the academic year
            it came from because that reach-back has no floor; an academic year still in progress is
            never read as a measured zero. A field whose programmes carry neither is reported as
            supply unknown rather than as a shortfall. Pipeline = students currently enrolled; the
            arrow compares graduates per year with the annual intake behind that pipeline — each
            programme&apos;s enrolled students divided by its OWN length of study, then summed — at
            ±25 %. Where a programme records no length, the nominal one for its level is used (four
            years bachelor, three doctoral, two master&apos;s and higher graduate diploma). A field
            below the posting floor is shown with its advert count instead of a verdict. Cached five
            minutes; computed{' '}
            {map.computedAt.slice(0, 16).replace('T', ' ')} UTC.
          </p>
        </details>
      </div>
    </div>
  );
}

/** A numeric column header that says what its number is measured in.
 *
 *  "Demand share" and "KKU share" are the two figures every verdict rests
 *  on, and a bare noun phrase left a general reader guessing what the
 *  percentage was a percentage OF. The quieter second line carries the
 *  unit; the `title` carries the whole sentence for a reader who hovers. */
function NumHead({
  label,
  unit,
  title,
}: {
  label: string;
  unit: string;
  title: string;
}): React.JSX.Element {
  return (
    <th scope="col" title={title} className="px-3 py-2 text-right font-medium">
      <span className="block text-text-secondary">{label}</span>
      <span className="block text-[10px] font-normal text-text-tertiary">{unit}</span>
    </th>
  );
}

function verdictText(r: GapRowT): string {
  if (r.verdict === 'too-few-postings') return `too few postings (${r.postings})`;
  if (r.verdict === 'supply-unknown') return 'supply not recorded';
  // "White space" is this platform's term for a field KKU should launch
  // into but has not. Where a postgraduate track already exists, the
  // verdict is still true of the bachelor level it is scored on — and it
  // has to say which, at a glance, without expanding the row.
  if (r.verdict === 'white-space' && r.postgraduateProgrammes > 0) return 'White space at bachelor level';
  return VERDICT_LABEL[r.verdict];
}
