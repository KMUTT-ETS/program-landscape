import * as React from 'react';

import { formatScore } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Peer comparison. Reference-table shape.
//
// CORRECTION, overruling the batch-3 brief and the Matrix implementation it
// produced: this section was originally briefed as "Matrix — peer skill
// coverage." `PeersSchema` (see schema.ts) carries no skill-overlap data at
// all — it is a ranked institution roster (rank within tier / institution /
// country / QS World rank / programme name, per tier), sourced from the
// peer-programs-scraper + AI peer-suggestion pipeline. That is a different
// dataset from the Benchmarking module's separate skill-coverage matrix
// (`packages/ui/src/viz/coverage-matrix.tsx`, a live interactive-app
// surface, not part of this PDF package) — the two are easy to conflate by
// name alone. **Peer *skill* coverage has no data source on this payload —
// that is a real data-model gap, not something this section can render.**
// `Matrix` currently has no consumer anywhere in this template because of
// that gap; it stays in `@kku/pdf-templates` (tested, primitive-complete)
// for the day a skill-overlap payload actually exists.
//
// The predecessor's Matrix rescue — QS World rank per cell, capped to the
// top 3 institutions per tier, lower-is-better intensity ramp — is being
// replaced, not patched, for three reasons:
//   1. Every other chart in this document uses "darker = more" as its
//      intensity idiom. QS World rank is the one field in the whole
//      template where a smaller number is the better outcome, and an
//      unlabelled heatmap cell can't carry that inversion — a reader
//      pattern-matching off every other page in the report reads a dark
//      cell as "this institution is doing well," which is backwards.
//   2. Capping to the top 3 per tier drops real, curated rows. A peer
//      roster is exactly the kind of low-volume, high-provenance list
//      Council should be able to see in full, the same reasoning that
//      already kept `courses.tsx` and `decisions.tsx` as full tables
//      instead of chart summaries.
//   3. A grid of institution names — long, English, one per column header
//      — is not what Matrix's column axis is for; every real render
//      trips the primitive's column-rotation escape hatch just to fit.
//
// A table has none of those problems: nullable `rank`/`qsWorld` render as
// an honest em dash per cell, every curated peer across every tier is
// shown, and "lower is better" is stated once in the lede instead of
// smuggled into a colour ramp.
const LEDE_TH =
  'ตารางนี้แสดงสถาบันคู่เทียบที่คัดสรรในแต่ละระดับชั้น พร้อมอันดับ QS World University Rankings ' +
  'ยิ่งตัวเลขอันดับ QS น้อย ยิ่งมีอันดับโลกสูง';

interface PeerRow {
  tier: string;
  rank: number | null;
  institution: string;
  country: string;
  qsWorld: number | null;
  programme: string;
}

function buildRows(peers: NonNullable<ProgramDetailData['peers']>): PeerRow[] {
  const rows: PeerRow[] = [];
  for (const tier of peers.tiers) {
    for (const entry of tier.entries) {
      rows.push({
        tier: tier.tier,
        rank: entry.rank,
        institution: entry.institution,
        country: entry.country,
        qsWorld: entry.qsWorld,
        programme: entry.programme,
      });
    }
  }
  return rows;
}

export function renderPeersSection(data: ProgramDetailData): React.ReactElement | null {
  const { peers } = data;
  if (!peers) return null;

  const rows = buildRows(peers);

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Peer comparison</span>
          <h2 className="section-title">Peer institutions</h2>
        </div>
      </div>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>

      {rows.length === 0 ? (
        <p className="muted">
          No peer tiers curated for this program yet — run the peer-programs-scraper / AI
          peer-suggestion pipeline.
        </p>
      ) : (
        <table className="peer-list">
          <thead>
            <tr>
              <th>Tier</th>
              <th className="numeric">Rank</th>
              <th>Institution</th>
              <th>Country</th>
              <th className="numeric">QS World rank</th>
              <th>Programme</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.tier}</td>
                <td className="numeric">{formatScore(r.rank)}</td>
                <td>{r.institution}</td>
                <td>{r.country}</td>
                <td className="numeric">{formatScore(r.qsWorld)}</td>
                <td>{r.programme}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="caption">
        <strong>Source</strong> peer-programs-scraper (AI-curated peer benchmarking) ·{' '}
        {data.dateLabel} · <strong>Method</strong> subject signature:{' '}
        {peers.subjectSignature || 'unspecified'} · ranking year {peers.rankingYear ?? '—'}
      </p>
    </section>
  );
}
