// Plain-language reason a null external_grant_engagement driver carries
// (health-score.v5.3). The driver is gated on 30 days of green grant-sync history;
// a null is a data gap, never a low score, and the reader should be told which.

const day = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export function grantDriverNullNote(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || !('reason' in raw)) return null;
  const r = raw as { reason: unknown; daysOfHistory?: unknown; lastSuccessAt?: unknown };
  switch (r.reason) {
    case 'awaiting-green-history':
      return `Waiting for 30 days of grant-sync history (${typeof r.daysOfHistory === 'number' ? r.daysOfHistory : 0} so far).`;
    case 'source-not-synced':
      return 'Grant data has not been synced on this server yet.';
    case 'source-stale':
      return `Grant data is out of date (last synced ${typeof r.lastSuccessAt === 'string' ? day(r.lastSuccessAt) : 'unknown'}).`;
    default:
      return null;
  }
}
