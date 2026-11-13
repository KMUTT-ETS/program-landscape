import type { CheckResult } from './types';

/** Human-readable report: one line per check, an indented next step, a summary. */
export function formatReport(slug: string, results: readonly CheckResult[]): string {
  const idWidth = Math.max(...results.map((r) => label(r).length), 10);
  const lines = [`connector:verify ${slug}`, ''];
  for (const r of results) {
    lines.push(`${r.status.padEnd(4)}  ${label(r).padEnd(idWidth)}  ${r.reason}`);
    if (r.next) lines.push(`${' '.repeat(6 + idWidth + 2)}→ ${r.next}`);
  }
  const n = (s: CheckResult['status']): number => results.filter((r) => r.status === s).length;
  lines.push(
    '',
    `${n('PASS')} passed, ${n('FAIL')} failed, ${n('WARN')} warnings, ${n('SKIP')} skipped`,
  );
  if (results.some((r) => r.id === 'latest-run' && r.status === 'WARN')) {
    lines.push('A run is in progress, so the data is not verified yet — run connector:verify again when it ends.');
  }
  return lines.join('\n');
}

function label(r: CheckResult): string {
  return r.dataset ? `${r.id} (${r.dataset})` : r.id;
}

/** 0 when nothing failed, 1 otherwise. WARN and SKIP do not fail the run. */
export function exitCodeFor(results: readonly CheckResult[]): 0 | 1 {
  return results.some((r) => r.status === 'FAIL') ? 1 : 0;
}
