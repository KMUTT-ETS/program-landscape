// Plain-language reason a null external_grant_engagement driver carries
// (health-score.v5.3). The driver is gated on 30 days of green grant-sync history;
// a null is a data gap, never a low score, and the reader should be told which.

const day = (iso: string): string => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 'unknown' : new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
};

export function grantDriverNullNote(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || !('reason' in raw)) return null;
  const r = raw as { reason: unknown; daysOfHistory?: unknown; successfulDaysLast30?: unknown; lastSuccessAt?: unknown };
  switch (r.reason) {
    case 'awaiting-green-history':
    {
      const days = typeof r.daysOfHistory === 'number' ? r.daysOfHistory : 0;
      if (days >= 30 && typeof r.successfulDaysLast30 === 'number') {
        return `Waiting for steadier grant syncs (only ${r.successfulDaysLast30} of the last 30 days synced; 25 needed).`;
      }
      return `Waiting for 30 days of grant-sync history (${days} so far).`;
    }
    case 'source-not-synced':
      return 'Grant data has not been synced on this server yet.';
    case 'source-stale':
      return `Grant data is out of date (last synced ${typeof r.lastSuccessAt === 'string' ? day(r.lastSuccessAt) : 'unknown'}).`;
    default:
      return null;
  }
}

/** The disclosed-undercount caveat a populated driver carries in raw.caveat. */
export function grantDriverCaveat(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = (raw as { caveat?: unknown }).caveat;
  return typeof c === 'string' && c.length > 0 ? c : null;
}
