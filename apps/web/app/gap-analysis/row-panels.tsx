import * as React from 'react';
import Link from 'next/link';
import type { ApiMeta } from '@kku/shared';
import { ProvenanceButton } from '@kku/ui';
import type { GapRowT } from './types';

// The three panels of an expanded row. Server-rendered from the row already
// in the page payload; no client fetch is needed because the map carries
// every row's panels. (The /api/gap-map/fields/[slug] proxy exists for the
// AI Analyst's evidence rail and for future incremental loads.)

const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const int = (v: number) => Math.round(v).toLocaleString('en-US');

export function RowPanels({ row, meta }: { row: GapRowT; meta: ApiMeta }): React.JSX.Element {
  const nameOf = new Map(row.programmes.map((p) => [p.programId, p.nameEn || p.nameTh]));
  return (
    <div className="grid gap-4 text-xs lg:grid-cols-[1.4fr_1fr_1fr]">
      <section>
        <Header title="Occupations asking for this field (JobThai)" meta={meta} />
        {row.occupations.length === 0 ? (
          <p className="text-text-tertiary">No occupation on eligible adverts names this field.</p>
        ) : (
          <ul className="space-y-1">
            {row.occupations.map((o) => (
              <li key={o.occupationId}>
                <span className="font-medium">{o.subcategory}</span>
                <span className="text-text-secondary"> — {int(o.postings)} adverts</span>
                {o.linkedProgramIds.length > 0 ? (
                  <span className="text-text-secondary">
                    {' '}
                    ← {o.linkedProgramIds.map((id) => nameOf.get(id) ?? id).slice(0, 3).join(', ')}
                  </span>
                ) : (
                  <span className="text-text-tertiary"> · no linked programme</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {row.provinces.length > 0 && (
          <p className="mt-2 text-text-tertiary">
            Provinces: {row.provinces.map((p) => `${p.province} ${pct(p.share)}`).join(' · ')}
          </p>
        )}
      </section>

      <section>
        <Header title="KKU programmes in this field" meta={meta} />
        <SupplyCoverageNote row={row} />
        {row.programmes.length === 0 ? (
          <p className="text-text-tertiary">No KKU programme is assigned to this field.</p>
        ) : (
          <ul className="space-y-1">
            {row.programmes.map((p) => (
              <li key={p.programId} className={p.scored ? '' : 'text-text-tertiary'}>
                <Link href={`/programs/${p.programId}`} className="font-medium hover:underline">
                  {p.nameEn || p.nameTh}
                </Link>
                <span className="font-mono text-[10px] text-text-tertiary"> {p.code}</span>
                {p.facultyNameEn && <span className="text-text-tertiary"> · {p.facultyNameEn}</span>}
                <div className="text-text-secondary">
                  {p.gradsPerYear == null
                    ? 'graduates not recorded'
                    : `${int(p.gradsPerYear)} graduates / yr`}
                  {' · '}
                  {p.pipeline == null ? 'pipeline not recorded' : `${int(p.pipeline)} enrolled`}
                  {' · '}
                  {p.healthScore == null ? 'health not scored' : `health ${Math.round(p.healthScore)}`}
                  {!p.scored && (
                    <span> · {p.level !== 'BACHELOR' ? 'postgraduate, not scored' : 'outside scope'}</span>
                  )}
                  {p.reviewStatus === 'PROPOSED' && <span> · assignment unreviewed</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <Header title="What's coming" meta={meta} />
        <p className="font-medium">
          Global signal{' '}
          <span className="font-normal text-text-tertiary">
            (LinkedIn data via MHESI
            {row.globalSignal.scope
              ? `, ${row.globalSignal.scope === 'THAILAND' ? 'Thailand' : 'global'} series`
              : ''}
            )
          </span>
        </p>
        {row.globalSignal.skills.length === 0 ? (
          <p className="text-text-tertiary">
            No rising skill among this field&apos;s occupations intersects the LinkedIn growth series.
          </p>
        ) : (
          <ul>
            {row.globalSignal.skills.map((s) => (
              <li key={s.skillId}>
                {s.nameEn} <span className="text-text-secondary">↑ {s.growthPct.toFixed(0)} %</span>{' '}
                {s.contexts != null && (
                  // A figure averaged over one context is a single raw
                  // observation, not a mean — stated beside the number so
                  // it is never read with the same weight as one averaged
                  // over dozens (memory: text-readability-adjacency —
                  // the count is its own parenthetical, not appended to
                  // the percentage).
                  <span className="text-text-tertiary">
                    ({s.contexts} {s.contexts === 1 ? 'context' : 'contexts'})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 font-medium">Trend signals</p>
        {row.trendSignals.length === 0 ? (
          <p className="text-text-tertiary">
            No Trends Radar signal names this field&apos;s programmes or occupations.
          </p>
        ) : (
          <ul>
            {row.trendSignals.map((s) => (
              <li key={s.id}>
                <Link href={`/trends/${s.id}`} className="hover:underline">
                  {s.title}
                </Link>{' '}
                <span className="text-text-tertiary">
                  · {s.signalType.toLowerCase()} · impact {s.impactScore.toFixed(1)} ·{' '}
                  {s.matchedBy === 'initiative' ? 'names an occupation' : 'names a programme'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** How much of the field the KKU share is actually built from. A partial gap
 *  would otherwise fold silently into the total — the reader sees three
 *  programmes and one share, and cannot tell that only two were measured. */
function SupplyCoverageNote({ row }: { row: GapRowT }): React.JSX.Element | null {
  if (row.programmeCount === 0) return null;
  if (row.programmesWithSupply === 0) {
    return (
      <p className="mb-1 text-text-tertiary">
        No graduate figure is recorded for any of the {row.programmeCount} scored{' '}
        {row.programmeCount === 1 ? 'programme' : 'programmes'} here, so this field has no KKU share
        — a missing measurement, not a shortfall.
      </p>
    );
  }
  if (row.programmesWithSupply < row.programmeCount) {
    return (
      <p className="mb-1 text-text-tertiary">
        Graduate figures for {row.programmesWithSupply} of {row.programmeCount} scored programmes; the
        KKU share is built from those only.
      </p>
    );
  }
  return null;
}

function Header({ title, meta }: { title: string; meta: ApiMeta }): React.JSX.Element {
  return (
    <div className="mb-1 flex items-center gap-2">
      <h4 className="text-[11px] uppercase tracking-wide text-text-tertiary">{title}</h4>
      <ProvenanceButton title={title} meta={meta} size="xs" />
    </div>
  );
}
