import * as React from 'react';

import type { ProgramDetailData } from '../schema';

// §? — Council decisions. Reference-table shape.
//
// CHOICE: table, not Timeline — despite Timeline being purpose-built for
// exactly this kind of event list. Two reasons, both about not silently
// losing content:
//   1. `effectiveDate` is `z.string().nullable()` and frequently IS null —
//      "a decision with no effective date yet is a real 'not decided when'
//      fact, not an empty string" (schema.ts's own field comment). Timeline
//      requires a strict parseable ISO date on every event; a decision with
//      no effective date has nothing to plot it against. Falling back to
//      `createdAt` would work for every row, but then "when does this take
//      effect" — the single most Council-relevant date on a decision record
//      — would have no visual channel left to show it on. A table's
//      dedicated column carries both dates for every row, including the
//      null one (rendered as an em dash, not dropped).
//   2. `rationale` is free text with no fixed budget — it can run to a full
//      sentence or more (see the seeded sample decisions in the DB). A
//      Timeline event's label is a single fitLabel-bounded run; truncating
//      is explicitly rejected by this library's design (charts/README.md
//      rule 6). A table cell wraps it in full.
// Given a program has at most a handful of decisions on file (the API
// builder caps at 20), the "at a glance sequencing" a Timeline offers isn't
// worth the information loss.
//
// Same bare-array posture as trends.tsx: `data.decisions` has no wrapping
// nullable object, so this always renders (never returns null for an empty
// array) — zero decisions on file is a legitimate real state (Council
// simply hasn't ruled on this program), not a provenance failure.
const LEDE_TH =
  'ตารางนี้แสดงประวัติมติสภาและการตัดสินใจเชิงกลยุทธ์ที่เกี่ยวข้องกับหลักสูตรนี้';

function statusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('approv') || s.includes('implement') || s.includes('complet')) return 'badge success';
  if (s.includes('reject') || s.includes('archiv')) return 'badge danger';
  if (s.includes('propos') || s.includes('review') || s.includes('progress')) return 'badge warning';
  return 'badge';
}

// Return type stays `React.ReactElement | null` to match every other
// section's signature (Task 7 assembles them as a uniform list) even though
// this implementation never actually returns null — see the header comment
// above for why an empty `decisions` array renders an explained empty block
// instead.
export function renderDecisionsSection(data: ProgramDetailData): React.ReactElement | null {
  const { decisions } = data;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Decision Workspace</span>
          <h2 className="section-title">Council decisions</h2>
        </div>
      </div>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>

      {decisions.length === 0 ? (
        <p className="muted">No Council decisions on file for this program yet.</p>
      ) : (
        <table className="decision-list">
          <thead>
            <tr>
              <th>Decision</th>
              <th>Status</th>
              <th>Decided by</th>
              <th>Created</th>
              <th>Effective</th>
              <th>Rationale</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d, i) => (
              <tr key={i}>
                <td>{d.decisionType}</td>
                <td>
                  <span className={statusBadge(d.status)}>{d.status}</span>
                </td>
                <td>{d.decidedBy}</td>
                <td>{d.createdAt}</td>
                <td>{d.effectiveDate ?? '—'}</td>
                <td>{d.rationale || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="caption">
        <strong>Source</strong> Decision Workspace (council_decisions) · {data.dateLabel} ·{' '}
        <strong>Method</strong> decision records as filed, most recent 20
      </p>
    </section>
  );
}
