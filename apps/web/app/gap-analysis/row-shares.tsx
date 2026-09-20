import * as React from 'react';
// Client-safe subpath, not the root barrel — see the HARD CONSTRAINT at the
// top of every file in this folder: the barrel pulls node:crypto.
import type { DemandBasis } from '@kku/shared/demand/sources';
import type { GapRowT } from './types';

// Both demand shares, side by side, each labelled with what it is a
// percentage OF and each carrying its own posting count — so a reader can
// see how a blended verdict (`basis=all`) was actually composed, rather than
// reading a single number that silently folded two markets together.
//
// The share matching the active basis is emphasised; the other stays
// present, only quieter — never hidden, because a de-emphasised number a
// reader cannot find is functionally the same as a missing one.

const pct1 = (v: number) => `${(v * 100).toFixed(1)} %`;
const int = (v: number) => Math.round(v).toLocaleString('en-US');

export function GapRowShares({ row, basis }: { row: GapRowT; basis: DemandBasis }): React.JSX.Element {
  return (
    <section className="rounded border border-default bg-surface-1 p-3 text-xs">
      <h4 className="mb-2 text-[11px] uppercase tracking-wide text-text-tertiary">Demand share by market</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <ShareCell
          label="Private sector"
          sourceNote="JobThai adverts"
          share={row.privateDemandShare}
          postings={row.privatePostings}
          ofText="of all private-sector adverts naming a field of study"
          emphasised={basis === 'all' || basis === 'private'}
        />
        <ShareCell
          label="Government"
          sourceNote="job-108 announcements, in the counting window"
          share={row.publicDemandShare}
          postings={row.publicPostings}
          ofText="of all government postings naming a field of study, in the counting window"
          emphasised={basis === 'all' || basis === 'public'}
        />
      </div>
    </section>
  );
}

function ShareCell({
  label,
  sourceNote,
  share,
  postings,
  ofText,
  emphasised,
}: {
  label: string;
  sourceNote: string;
  share: number;
  postings: number;
  ofText: string;
  emphasised: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`rounded border p-2 ${
        emphasised
          ? 'border-[oklch(var(--color-accent-default))] bg-accent-subtle'
          : 'border-default bg-surface-1 opacity-70'
      }`}
    >
      <div className="font-medium text-text-primary">
        {label} <span className="font-normal text-text-tertiary">({sourceNote})</span>
      </div>
      {/* Percentage and postings count are two separate lines on purpose —
          two adjacent numbers separated only by a gap have read as one
          token here before (memory: text-readability-adjacency). */}
      <div className="mt-1 font-tabular text-base font-semibold text-text-primary">{pct1(share)}</div>
      <div className="text-text-tertiary">{ofText}</div>
      <div className="mt-1 text-text-tertiary">
        {int(postings)} {postings === 1 ? 'posting counted' : 'postings counted'}
      </div>
    </div>
  );
}
