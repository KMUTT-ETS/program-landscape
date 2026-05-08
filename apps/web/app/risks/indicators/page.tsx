import * as React from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { ShieldAlert, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { RisksBackNav } from '../viz';
import type { IndicatorsResponse, IndicatorBreachesResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Risk Indicators' };

export default async function IndicatorsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const list = await apiFetch<IndicatorsResponse>('/risks/indicators').catch(() => null);

  // Pull breach detail for each indicator in parallel — gives us the value
  // histogram + per-program list for the redesigned cards.
  const detailsBySlug: Record<string, IndicatorBreachesResponse | null> = {};
  if (list) {
    const detailFetches = await Promise.all(
      list.indicators.map((ind) =>
        apiFetch<IndicatorBreachesResponse>(`/risks/indicators/${ind.slug}/breaches`).catch(
          () => null,
        ),
      ),
    );
    list.indicators.forEach((ind, i) => {
      detailsBySlug[ind.slug] = detailFetches[i] ?? null;
    });
  }

  return (
    <AuthedAppShell user={user}>
      <RisksBackNav current="Key Risk Indicators" />
      <PageHeader
        title="Key Risk Indicators"
        subtitle="Each KRI evaluates one specific aspect of program risk. Hover the histogram to see counts; click a program in the breach list to drill in."
      />
      {list ? (
        <div className="space-y-4">
          {list.indicators.map((ind) => {
            const detail = detailsBySlug[ind.slug];
            return (
              <IndicatorCard key={ind.slug} indicator={ind} detail={detail ?? null} />
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-border-default bg-surface-1 p-6 text-text-secondary">
          Unable to load KRI data.
        </div>
      )}
    </AuthedAppShell>
  );
}

function IndicatorCard({
  indicator,
  detail,
}: {
  indicator: IndicatorsResponse['indicators'][number];
  detail: IndicatorBreachesResponse | null;
}) {
  const totalProgs = indicator.latestBreaches.total;
  const pctCritical = totalProgs > 0 ? (indicator.latestBreaches.critical / totalProgs) * 100 : 0;
  const pctWarn = totalProgs > 0 ? (indicator.latestBreaches.warn / totalProgs) * 100 : 0;
  const pctOk = totalProgs > 0 ? (indicator.latestBreaches.ok / totalProgs) * 100 : 0;
  const issueCount = indicator.latestBreaches.critical + indicator.latestBreaches.warn;
  const SEVERITY_FILL: Record<'OK' | 'WARN' | 'CRITICAL', string> = {
    OK: 'rgb(16 185 129)',
    WARN: 'rgb(234 179 8)',
    CRITICAL: 'rgb(244 63 94)',
  };

  // Top-5 critical/warn programs from the detail breach list — sorted by
  // severity then most recently observed.
  const topIssues = detail
    ? [...detail.breaches]
        .filter((b) => b.severity !== 'OK')
        .sort(
          (a, b) =>
            (a.severity === 'CRITICAL' ? 0 : 1) - (b.severity === 'CRITICAL' ? 0 : 1) ||
            new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
        )
        .slice(0, 5)
    : [];

  return (
    <article className="rounded-lg border border-border-default bg-surface-0 p-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {issueCount > 0 ? (
              indicator.latestBreaches.critical > 0 ? (
                <ShieldAlert className="h-4 w-4 text-rose-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
            <h3 className="text-base font-semibold">{indicator.labelEn}</h3>
            <span className="text-xs text-text-tertiary" lang="th">
              / {indicator.labelTh}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-text-secondary" lang="th">
            {indicator.descriptionTh}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5"
            style={{
              borderColor: SEVERITY_FILL.CRITICAL + '66',
              background: SEVERITY_FILL.CRITICAL + '15',
              color: SEVERITY_FILL.CRITICAL,
            }}
          >
            <ShieldAlert className="h-3 w-3" />
            <span className="font-semibold tabular-nums">{indicator.latestBreaches.critical}</span>
            <span className="opacity-70">crit</span>
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5"
            style={{
              borderColor: SEVERITY_FILL.WARN + '66',
              background: SEVERITY_FILL.WARN + '15',
              color: SEVERITY_FILL.WARN,
            }}
          >
            <AlertTriangle className="h-3 w-3" />
            <span className="font-semibold tabular-nums">{indicator.latestBreaches.warn}</span>
            <span className="opacity-70">warn</span>
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5"
            style={{
              borderColor: SEVERITY_FILL.OK + '66',
              background: SEVERITY_FILL.OK + '15',
              color: SEVERITY_FILL.OK,
            }}
          >
            <CheckCircle2 className="h-3 w-3" />
            <span className="font-semibold tabular-nums">{indicator.latestBreaches.ok}</span>
            <span className="opacity-70">ok</span>
          </span>
        </div>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Distribution + thresholds */}
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-baseline justify-between text-[11px] text-text-tertiary">
              <span>Severity distribution ({totalProgs} programs)</span>
              <span>
                {Math.round(pctCritical + pctWarn)}% at risk
              </span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
              {pctCritical > 0 && (
                <div
                  style={{ width: `${pctCritical}%`, background: SEVERITY_FILL.CRITICAL }}
                  title={`Critical: ${indicator.latestBreaches.critical}`}
                />
              )}
              {pctWarn > 0 && (
                <div
                  style={{ width: `${pctWarn}%`, background: SEVERITY_FILL.WARN }}
                  title={`Warn: ${indicator.latestBreaches.warn}`}
                />
              )}
              {pctOk > 0 && (
                <div
                  style={{ width: `${pctOk}%`, background: SEVERITY_FILL.OK + 'aa' }}
                  title={`OK: ${indicator.latestBreaches.ok}`}
                />
              )}
            </div>
          </div>

          {detail && detail.valueHistogram.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] text-text-tertiary">
                Value distribution · hover bars for counts
              </div>
              <div className="flex items-end gap-0.5" style={{ height: 64 }}>
                {detail.valueHistogram.map((b, i) => {
                  const max = Math.max(1, ...detail.valueHistogram.map((x) => x.count));
                  const h = (b.count / max) * 60;
                  return (
                    <div
                      key={i}
                      className="flex flex-1 flex-col items-center justify-end"
                      title={`${b.range}: ${b.count} program${b.count === 1 ? '' : 's'} · ${b.severity}`}
                    >
                      <div
                        className="w-full rounded-t-sm transition-opacity hover:opacity-100"
                        style={{
                          height: `${h}px`,
                          background: SEVERITY_FILL[b.severity],
                          opacity: b.count > 0 ? 0.85 : 0.15,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-text-tertiary">
                <span>↓ low</span>
                <span className="ml-auto">high ↑</span>
              </div>
            </div>
          )}

          <div className="grid gap-1 text-[11px] text-text-tertiary">
            <div>
              <span className="font-medium text-text-secondary">Formula:</span>{' '}
              <code className="font-mono">{indicator.formula}</code>
            </div>
            <div>
              <span className="font-medium text-text-secondary">Thresholds:</span> warn{' '}
              {indicator.alarmDirection === 'low' ? '≤' : '≥'} {indicator.warnThreshold} · critical{' '}
              {indicator.alarmDirection === 'low' ? '≤' : '≥'} {indicator.criticalThreshold}
            </div>
            <div className="text-text-tertiary">
              Methodology: {indicator.methodologyVersion}
            </div>
          </div>
        </div>

        {/* Top issue programs */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            Programs flagged
            {issueCount > 0 ? ` · top ${Math.min(5, issueCount)}` : ''}
          </div>
          {issueCount === 0 ? (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mr-1.5 inline-block h-3.5 w-3.5" />
              All programs are within thresholds for this indicator.
            </div>
          ) : topIssues.length === 0 ? (
            <div className="text-xs text-text-tertiary">Loading…</div>
          ) : (
            <ul className="space-y-1.5">
              {topIssues.map((b) => (
                <li
                  key={b.programId}
                  className="rounded-md border border-border-subtle bg-surface-1 px-3 py-2 transition-colors hover:bg-surface-2"
                >
                  <Link href={`/risks/${b.programId}`} className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium" lang="th">
                        {b.programNameTh}
                      </span>
                      <span
                        className="text-[10px] font-semibold uppercase"
                        style={{ color: SEVERITY_FILL[b.severity] }}
                      >
                        {b.severity}
                      </span>
                    </div>
                    <div className="text-[10px] text-text-tertiary">
                      {b.programNameEn} · {b.facultyNameTh}
                    </div>
                    {b.value != null && (
                      <div className="mt-0.5 text-[10px] tabular-nums text-text-secondary">
                        Value{' '}
                        <span className="font-semibold" style={{ color: SEVERITY_FILL[b.severity] }}>
                          {b.value < 1 ? b.value.toFixed(2) : b.value.toFixed(1)}
                        </span>{' '}
                        · threshold{' '}
                        {indicator.alarmDirection === 'low' ? '≤' : '≥'}{' '}
                        {b.severity === 'CRITICAL' ? indicator.criticalThreshold : indicator.warnThreshold}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
              {issueCount > 5 && (
                <li className="text-center text-[11px] text-text-tertiary">
                  + {issueCount - 5} more flagged
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
