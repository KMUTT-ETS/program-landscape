import * as React from 'react';
import Link from 'next/link';
import type { ApiMeta } from '@kku/shared';
// Client-safe subpath, not the root barrel — see the HARD CONSTRAINT at the
// top of every file in this folder: the barrel pulls node:crypto.
import type { DemandBasis } from '@kku/shared/demand/sources';
import { ProvenanceButton } from '@kku/ui';
import { DataSourceMark, acknowledgementHref } from '@/components/data-source-mark';
import { GapRowShares } from './row-shares';
import type { GapLinkedProgrammeT, GapOccupationT, GapRowT } from './types';

// The panels of an expanded row. Server-rendered from the row already in the
// page payload; no client fetch is needed because the map carries every
// row's panels. (The /api/gap-map/fields/[slug] proxy exists for the AI
// Analyst's evidence rail and for future incremental loads.)

const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const int = (v: number) => Math.round(v).toLocaleString('en-US');

export function RowPanels({ row, meta, basis }: { row: GapRowT; meta: ApiMeta; basis: DemandBasis }): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
        <GapRowShares row={row} basis={basis} />
        <GovernmentPositionsBlock row={row} basis={basis} />
      </div>
      <div className="grid gap-4 text-xs lg:grid-cols-[1.4fr_1fr_1fr]">
        <section>
        <Header title="Occupations asking for this field (JobThai)" meta={meta} mark="jobthai" />
        {row.occupations.length === 0 ? (
          <p className="text-text-tertiary">No occupation on eligible adverts names this field.</p>
        ) : (
          <ul className="space-y-1">
            {row.occupations.map((o) => (
              <li key={o.occupationId} className="mb-2">
                <span className="font-medium">{o.subcategory}</span>
                <span className="text-text-secondary"> — {int(o.postings)} adverts</span>
                <LinkedProgrammes occupation={o} />
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
                    : `${int(p.gradsPerYear)} graduates / yr (${supplyBasis(p)})`}
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
    </div>
  );
}

/** Which KKU programmes an occupation recruits from, by name.
 *
 *  The names arrive resolved from the gap map, so nothing here can fall
 *  back to an id. Two groups, because they say different things: the
 *  programmes of the field being read, and programmes assigned to OTHER
 *  fields that this occupation nonetheless recruits from. The second is
 *  real signal — an occupation drawing on half the faculty is not the same
 *  finding as one drawing on a single programme — so it is stated in words
 *  rather than dropped. Each group names up to three and then says how
 *  many more there are; neither ever truncates in silence. */
function LinkedProgrammes({ occupation: o }: { occupation: GapOccupationT }): React.JSX.Element {
  const inField = o.linkedProgrammes.filter((p) => p.inField);
  const outside = o.linkedProgrammes.filter((p) => !p.inField);
  if (o.linkedInField === 0 && o.linkedOutsideField === 0) {
    return <div className="pl-6 text-text-tertiary">No KKU programme is linked to this occupation.</div>;
  }
  return (
    <div className="pl-6">
      {inField.length > 0 && (
        <div className="text-text-secondary">
          Recruits from <ProgrammeNames shown={inField} total={o.linkedInField} /> in this field.
        </div>
      )}
      {outside.length > 0 && (
        <div className="text-text-tertiary">
          Also recruits from <ProgrammeNames shown={outside} total={o.linkedOutsideField} />, assigned to
          other fields.
        </div>
      )}
    </div>
  );
}

/** Names, separated by semicolons because a single name already carries a
 *  Thai · English middle dot, and anything more it needs said in words. */
function ProgrammeNames({
  shown,
  total,
}: {
  shown: GapLinkedProgrammeT[];
  total: number;
}): React.JSX.Element {
  const more = total - shown.length;
  return (
    <>
      {shown.map((p, i) => (
        <React.Fragment key={p.programId}>
          {i > 0 && <span>; </span>}
          <ProgrammeName programme={p} />
        </React.Fragment>
      ))}
      {more > 0 && <span> and {more} more</span>}
    </>
  );
}

function ProgrammeName({ programme: p }: { programme: GapLinkedProgrammeT }): React.JSX.Element {
  if (!p.nameTh) return <span>{p.nameEn || p.code}</span>;
  return (
    <span>
      <span lang="th">{p.nameTh}</span>
      {p.nameEn ? ` · ${p.nameEn}` : ''}
    </span>
  );
}

/** What a graduates-per-year figure rests on, in the words beside it.
 *
 *  An alumni mean over one entry cohort and one over six are not the same
 *  evidence, and an enrolment fallback read from AY 2012 is not the same
 *  measurement as one read from last year. Both used to render as a bare
 *  "N graduates / yr (alumni cohorts)" / "(enrolment fallback)". */
function supplyBasis(p: GapRowT['programmes'][number]): string {
  if (p.supplySource === 'enrolment-proxy') {
    return p.supplyYear == null ? 'enrolment fallback' : `enrolment fallback, AY ${p.supplyYear}`;
  }
  if (p.supplyCohorts == null) return 'alumni cohorts';
  return `mean of ${p.supplyCohorts} alumni ${p.supplyCohorts === 1 ? 'cohort' : 'cohorts'}`;
}

/** How much of the field the KKU share is actually built from. A partial gap
 *  would otherwise fold silently into the total — the reader sees three
 *  programmes and one share, and cannot tell that only two were measured. */
function SupplyCoverageNote({ row }: { row: GapRowT }): React.JSX.Element | null {
  if (row.programmeCount === 0) {
    if (row.postgraduateProgrammes === 0) return null;
    // A white space that holds a Master's or a PhD. The verdict is still
    // "white space" — it is scored on bachelor programmes only — but the
    // reader must not take it as "KKU does not teach this at all".
    return (
      <p className="mb-1 text-text-tertiary">
        KKU has no bachelor programme in this field, which is what the white-space verdict measures.
        It does run {row.postgraduateProgrammes} postgraduate{' '}
        {row.postgraduateProgrammes === 1 ? 'programme' : 'programmes'} here, listed below and never
        scored.
      </p>
    );
  }
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

function Header({
  title,
  meta,
  mark,
}: {
  title: string;
  meta: ApiMeta;
  /** Optional brand mark for the source this panel draws on — see
   *  data-source-mark.tsx. Standalone here (not inside the ProvenanceButton,
   *  which is itself a button), so it carries its own link to the
   *  contributor's Acknowledgements entry. */
  mark?: 'jobthai' | 'job-108';
}): React.JSX.Element {
  return (
    <div className="mb-1 flex items-center gap-2">
      <h4 className="text-[11px] uppercase tracking-wide text-text-tertiary">{title}</h4>
      {mark && <DataSourceMark source={mark} size={14} href={acknowledgementHref(mark)} />}
      <ProvenanceButton title={title} meta={meta} size="xs" />
    </div>
  );
}

/** Government positions inside this field, from job-108.com. Rendered only
 *  when there is at least one to show.
 *
 *  `GapMapRow` (packages/db/src/gap-map.ts) does not carry per-position
 *  detail — no agency name, position title, seat count or closing date, and
 *  no announcement id to link out to job-108.com with. Only the count
 *  (`publicPostings`) reaches this row today. Rather than inventing an
 *  endpoint to fetch that detail, this block says plainly what is and isn't
 *  available; a later task can extend `GapMapRow` with a
 *  `governmentPositions` list once that is worth the payload cost. */
function GovernmentPositionsBlock({ row, basis }: { row: GapRowT; basis: DemandBasis }): React.JSX.Element | null {
  if (row.publicPostings === 0) return null;
  const body = (
    <div className="text-text-secondary">
      <p>
        {int(row.publicPostings)} government {row.publicPostings === 1 ? 'posting names' : 'postings name'}{' '}
        this field, from Thai government recruitment announcements on job-108.com, inside the counting window.
      </p>
      <p className="mt-1 text-text-tertiary">
        Per-position detail — agency, position title, seats and closing date, each linking to its
        announcement — is not yet carried into this view; only the count above is available here today.
      </p>
    </div>
  );
  return (
    <section className="rounded border border-default bg-surface-1 p-3 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <h4 className="text-[11px] uppercase tracking-wide text-text-tertiary">Government positions</h4>
        <DataSourceMark source="job-108" size={14} href={acknowledgementHref('job-108')} />
      </div>
      {basis === 'private' ? (
        <details>
          <summary className="cursor-pointer text-text-tertiary">
            Not counted in the current basis (private sector only) — {int(row.publicPostings)} government{' '}
            {row.publicPostings === 1 ? 'posting exists' : 'postings exist'} as evidence
          </summary>
          <div className="mt-2">{body}</div>
        </details>
      ) : (
        body
      )}
    </section>
  );
}
