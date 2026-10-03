// Plain-language line for the external-grant award on the Financial dimension
// (health-score.v5.4). An award, never a penalty: a null award is a data gap
// and the reader is told which; +0 means no grant in the window.

export interface HealthAwardLike {
  label: string;
  points: number | null;
  baseScore: number | null;
  raw?: unknown;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function windowText(raw: Record<string, unknown>): string {
  const w = raw.windowFyBe;
  return Array.isArray(w) && w.length === 2 ? `FY ${w[0]}–${w[1]}` : 'the last 3 fiscal years';
}

function baht(v: number): string {
  const k = Math.round(v / 1000);
  return k >= 1000 ? `฿${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} M` : `฿${k}k`;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function grantAwardLine(award: HealthAwardLike | null | undefined): string | null {
  if (!award) return null;
  const raw = (award.raw && typeof award.raw === 'object' ? award.raw : {}) as Record<string, unknown>;
  if (award.points === null) {
    switch (raw.reason) {
      case 'source-not-synced':
        return 'External-grant award: grant data has not been synced on this server yet.';
      case 'no-active-staff':
        return 'External-grant award: no active teaching staff on record.';
      default:
        return null;
    }
  }
  if (award.points === 0) return `External-grant award: +0 (no external grant in ${windowText(raw)})`;
  const perStaff = num(raw.bahtPerStaffPerYear);
  const measure = perStaff === null ? windowText(raw) : `${baht(perStaff)} per teaching staff per year, ${windowText(raw)}`;
  const base = award.baseScore;
  const pts = round1(award.points);
  const tail = base === null ? '' : ` · base ${round1(base).toFixed(1)} → ${Math.min(100, round1(base) + pts).toFixed(1)}`;
  return `External-grant award: +${pts.toFixed(1)} (${measure})${tail}`;
}

/** The disclosed-undercount caveat, only for a computed award. */
export function grantAwardCaveat(award: HealthAwardLike | null | undefined): string | null {
  if (!award || award.points === null || !award.raw || typeof award.raw !== 'object') return null;
  const c = (award.raw as { caveat?: unknown }).caveat;
  return typeof c === 'string' && c.length > 0 ? c : null;
}
