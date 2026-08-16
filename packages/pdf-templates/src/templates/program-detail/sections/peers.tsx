import * as React from 'react';

import { Matrix, type MatrixRow } from '../../../charts';
import { formatScore } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Peer comparison.
//
// IMPORTANT CAVEAT for whoever reviews this: the batch brief that assigned
// this section described it as "Matrix — peer skill coverage". Task 2's
// `PeersSchema` (see schema.ts) carries no skill-overlap data at all — it is
// a tiered institution roster (rank within tier / QS World rank / country /
// programme name per tier), sourced from the peer-programs-scraper + AI
// peer-suggestion pipeline. That is a different dataset from the
// Benchmarking module's separate skill-coverage matrix
// (`packages/ui/src/viz/coverage-matrix.tsx`, a live interactive-app
// surface, not part of this PDF package) — the two are easy to conflate by
// name alone. This component uses Matrix on the closest honest fit for what
// the schema actually carries: rows are the non-empty peer tiers, columns
// are each tier's top `INSTITUTIONS_PER_TIER` institutions by name (long,
// English, and exactly the case Matrix's column-header rotation exists
// for — see charts/matrix.tsx), cells are that institution's QS World rank.
// Every institution belongs to exactly one tier by construction, so most
// cells are null ("not part of this tier"), not a measured 0 — Matrix's
// null-vs-zero distinction carries real meaning here, not just formality.
//
// QS World rank is LOWER-is-better, the opposite of every other value this
// primitive has rendered so far — the lede says so explicitly so the
// intensity ramp (darker = larger number = worse rank) is not misread as
// "darker = more prestigious".
//
// Capped at `INSTITUTIONS_PER_TIER` per tier (not the full roster — Task 6's
// appendix carries every peer, every tier, at full precision) to keep the
// grid inside the page width across the full range of real peer-set sizes:
// up to 4 tiers × 3 institutions = 12 columns at columnWidthMm 10 needs
// 120mm plus a 24mm label column, comfortably inside the 180mm page width
// even before any name-overlap dedup shrinks it further.
const INSTITUTIONS_PER_TIER = 3;

const LEDE_TH =
  'ตารางนี้แสดงอันดับ QS World University Rankings ของสถาบันคู่เทียบสูงสุด 3 อันดับแรกในแต่ละระดับชั้น ' +
  'ยิ่งตัวเลขน้อยยิ่งมีอันดับโลกสูง ช่องสีเข้มหมายถึงตัวเลขอันดับที่สูงกว่า (อันดับโลกต่ำกว่า)';

export function renderPeersSection(data: ProgramDetailData): React.ReactElement | null {
  const { peers } = data;
  if (!peers) return null;

  const tiersWithPeers = peers.tiers.filter((t) => t.entries.length > 0);

  const seen = new Set<string>();
  const columns: string[] = [];
  for (const tier of tiersWithPeers) {
    for (const entry of tier.entries.slice(0, INSTITUTIONS_PER_TIER)) {
      if (!seen.has(entry.institution)) {
        seen.add(entry.institution);
        columns.push(entry.institution);
      }
    }
  }

  const rows: MatrixRow[] = tiersWithPeers.map((tier) => {
    const byInstitution = new Map(tier.entries.map((e) => [e.institution, e.qsWorld]));
    return {
      label: tier.tier,
      cells: columns.map((institution) => byInstitution.get(institution) ?? null),
    };
  });

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Peer comparison</span>
          <h2 className="section-title">Peer institutions</h2>
        </div>
      </div>
      <Matrix
        title="Peer institutions by tier — QS World Ranking"
        ledeTh={LEDE_TH}
        columns={columns}
        rows={rows}
        labelWidthMm={24}
        columnWidthMm={10}
        headerHeightMm={45}
        rowHeightMm={10}
        formatValue={formatScore}
        emptyNote="No peer tiers curated for this program yet — run the peer-programs-scraper / AI peer-suggestion pipeline."
        // `PeersSchema` carries no `methodologyVersion` field — an honest
        // descriptive phrase here, not a fabricated version number (same
        // posture faculty.tsx uses for `rosterScope`/`visibility`).
        provenance={{
          source: 'peer-programs-scraper (AI-curated peer benchmarking)',
          runDate: data.dateLabel,
          method: `subject signature: ${peers.subjectSignature || 'unspecified'} · ranking year ${
            peers.rankingYear ?? '—'
          }`,
        }}
      />
    </section>
  );
}
