// Humanize helpers — canonical formatters for table + viz tooltip text.
// "Humanize" here means: render the value in the form a human reads at
// the glance the tooltip lives for. Always pair the compact display
// (3.4M, 12.0k) with the exact value (3,412,005) on hover; that's the
// pattern every DataTable cell and chart tooltip now defaults to.

export function humanizeNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US');
}

export function humanizeCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${abs.toLocaleString('en-US')}`;
}

export function humanizeMoney(
  n: number | null | undefined,
  currency: '฿' | '$' = '฿',
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1_000_000_000) return `${sign}${currency}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${currency}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${currency}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${currency}${abs.toFixed(0)}`;
}

export function humanizePercent(
  n: number | null | undefined,
  digits: 0 | 1 | 2 = 0,
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function humanizeDelta(
  n: number | null | undefined,
  formatter: (v: number) => string = humanizeCompact,
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n === 0) return formatter(0);
  return `${n > 0 ? '+' : ''}${formatter(n)}`;
}
