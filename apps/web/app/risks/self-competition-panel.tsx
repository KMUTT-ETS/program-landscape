'use client';

// /risks "Self-competition" panel (program-overlap spec §10.2). Lists the
// programme pairs behind a WARN / CRITICAL reading of the two overlap KRIs —
// curriculum_overlap_max and market_confusion_max — with both intakes and the
// overlap-triggered measures already proposed. Every number arrives computed
// from GET /risks/self-competition; this file only renders.
//
// Type-only imports from @kku/shared: the barrel reaches node:crypto.

import Link from 'next/link';
import type { ApiMeta } from '@kku/shared';
import { Badge, ProvenanceButton } from '@kku/ui';
import { programmeLabel } from '@/components/overlap/labels';
import { MEASURE_KIND_LABEL, type SelfCompetitionKri, type SelfCompetitionRow } from './types';

export const SELF_COMPETITION_EMPTY =
  'No programme is breaching the overlap or market-confusion indicators.';

const SEVERITY_LABEL: Record<SelfCompetitionKri['severity'], string> = {
  WARN: 'warning',
  CRITICAL: 'critical',
};

/** The worst breach of one indicator on the pair, either side. */
export function worstBreach(
  breaches: readonly SelfCompetitionKri[],
  slug: SelfCompetitionKri['indicatorSlug'],
): SelfCompetitionKri['severity'] | null {
  const of = breaches.filter((b) => b.indicatorSlug === slug);
  if (of.length === 0) return null;
  return of.some((b) => b.severity === 'CRITICAL') ? 'CRITICAL' : 'WARN';
}

export function SelfCompetitionPanel({
  rows,
  meta,
}: {
  /** null when the endpoint could not be reached. */
  rows: SelfCompetitionRow[] | null;
  meta: ApiMeta | null;
}) {
  return (
    <section className="rounded-lg border border-subtle bg-surface-0 p-[16px]">
      <header className="mb-[12px] flex flex-wrap items-baseline gap-[8px]">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Self-competition</h3>
          <p className="mt-[2px] text-xs text-text-tertiary">
            Programme pairs breaching the curriculum-overlap or market-confusion indicators. Overlap is a prompt
            for review, not evidence that one programme takes the other’s students.
          </p>
        </div>
        {meta ? (
          <span className="ml-auto">
            <ProvenanceButton title="Self-competition" meta={meta} size="xs" />
          </span>
        ) : null}
      </header>
      {rows === null ? (
        <p className="text-sm text-text-tertiary">Self-competition data is unavailable right now.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-tertiary">{SELF_COMPETITION_EMPTY}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-xs text-text-tertiary">
                <th className="py-[8px] pr-[12px] font-medium">Pair</th>
                <th className="px-[12px] py-[8px] text-right font-medium">Overlap index</th>
                <th className="px-[12px] py-[8px] text-right font-medium">Market similarity</th>
                <th className="px-[12px] py-[8px] font-medium">Latest intake</th>
                <th className="py-[8px] pl-[12px] font-medium">Measures</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <SelfCompetitionRowView key={r.pairId} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SelfCompetitionRowView({ r }: { r: SelfCompetitionRow }) {
  const overlapSeverity = worstBreach(r.breaches, 'curriculum_overlap_max');
  const marketSeverity = worstBreach(r.breaches, 'market_confusion_max');
  return (
    <tr className="border-t border-subtle align-top">
      <td className="py-[10px] pr-[12px]">
        <ProgrammeLink p={r.programA} />
        <span className="my-[2px] block text-xs text-text-tertiary" aria-hidden>
          ↕
        </span>
        <ProgrammeLink p={r.programB} />
      </td>
      <td className="px-[12px] py-[10px] text-right">
        <Figure value={r.overlapIndex} severity={overlapSeverity} />
      </td>
      <td className="px-[12px] py-[10px] text-right">
        <Figure value={r.marketSimilarity} severity={marketSeverity} />
      </td>
      <td className="px-[12px] py-[10px] text-xs">
        <Intake code={r.programA.code} value={r.intakeA} yearBE={r.intakeEntryYearA} />
        <Intake code={r.programB.code} value={r.intakeB} yearBE={r.intakeEntryYearB} />
      </td>
      <td className="py-[10px] pl-[12px]">
        {r.measureKinds.length === 0 ? (
          <span className="text-xs text-text-tertiary">None proposed yet</span>
        ) : (
          <div className="flex flex-wrap gap-[4px]">
            {r.measureKinds.map((k) => (
              <Badge key={k} tone="neutral" size="sm">
                {MEASURE_KIND_LABEL[k]}
              </Badge>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

function ProgrammeLink({ p }: { p: SelfCompetitionRow['programA'] }) {
  return (
    <span className="block">
      <Link href={`/risks/${p.id}`} className="font-medium text-text-primary hover:underline" lang="th">
        {programmeLabel(p)}
      </Link>
      <span className="block text-xs text-text-tertiary">
        {[p.code, p.facultyNameEn].filter(Boolean).join(' · ')}
        {' · '}
        <Link href={`/programs/${p.id}`} className="text-accent-default hover:underline">
          Deep-Dive
        </Link>
      </span>
    </span>
  );
}

function Figure({
  value,
  severity,
}: {
  value: number | null;
  severity: SelfCompetitionKri['severity'] | null;
}) {
  return (
    <>
      <span
        className={`block text-base font-semibold tabular-nums ${value === null ? 'text-text-tertiary' : 'text-text-primary'}`}
      >
        {value === null ? '—' : Math.round(value)}
      </span>
      {severity ? (
        <span className={`block text-xs ${severity === 'CRITICAL' ? 'text-danger' : 'text-warning'}`}>
          {SEVERITY_LABEL[severity]}
        </span>
      ) : null}
    </>
  );
}

function Intake({ code, value, yearBE }: { code: string; value: number | null; yearBE: number | null }) {
  return (
    <span className="mb-[4px] block whitespace-nowrap">
      <span className="text-text-tertiary">{code}</span>
      {' · '}
      {value === null ? (
        <span className="text-text-tertiary">no intake data</span>
      ) : (
        <>
          <span className="tabular-nums text-text-primary">{value.toLocaleString('en-US')}</span>
          <span className="text-text-secondary"> students</span>
          {yearBE !== null ? <span className="text-text-tertiary"> · entry {yearBE}</span> : null}
        </>
      )}
    </span>
  );
}
