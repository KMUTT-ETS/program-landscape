// ──────────────────────────────────────────────────────────────────────────
// <DataSourceMark> — the upstream brand icon shown wherever a number, list or
// driver on screen comes from an external data provider.
//
// Rule (2026-09-13): every surface that renders JobThai-derived data carries
// the JobThai mark next to that data — the health-score driver, the job
// postings list, the admin tile, the data-sources row, the topology nodes.
// A new surface reading `job_postings`, `job_posting_skills`,
// `job_thai_occupations*` or `program_job_thai_links` must add it too.
//
// The icon is served from /brand, not hotlinked from jobthai.com: the CSP
// allows `img-src 'self'`, and the prod server sits on KKU's internal network
// where the upstream host may not be reachable.
//
// Server-safe (no hooks), so it renders in server and client components.
// ──────────────────────────────────────────────────────────────────────────

export type DataSourceMarkSlug = 'jobthai';

export const DATA_SOURCE_MARKS: Record<DataSourceMarkSlug, { src: string; name: string }> = {
  jobthai: { src: '/brand/jobthai.png', name: 'JobThai' },
};

/** True when a `DataSource.slug` has a brand mark — lets tables keyed by slug opt in. */
export function isMarkedSource(slug: string): slug is DataSourceMarkSlug {
  return Object.prototype.hasOwnProperty.call(DATA_SOURCE_MARKS, slug);
}

/** Driver labels in the health score whose value is computed from a marked source. */
export const DRIVER_SOURCE_MARK: Record<string, DataSourceMarkSlug> = {
  jobthai_demand_alignment: 'jobthai',
};

/** The mark for a health-score driver, or nothing when the driver has no marked source. */
export function DriverSourceMark({ label, size }: { label: string; size?: number }) {
  const source = DRIVER_SOURCE_MARK[label];
  return source ? <DataSourceMark source={source} size={size} /> : null;
}

export function DataSourceMark({
  source,
  size = 14,
  className = '',
}: {
  source: DataSourceMarkSlug;
  /** Rendered width and height in px. The source image is 32×32. */
  size?: number;
  className?: string;
}) {
  const mark = DATA_SOURCE_MARKS[source];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mark.src}
      alt={`Data from ${mark.name}`}
      title={`Data from ${mark.name}`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-[3px] align-[-0.125em] ${className}`}
    />
  );
}
