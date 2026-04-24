import { notFound, redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import type {
  DeepDiveDecisions,
  DeepDiveFaculty,
  DeepDiveFinancials,
  DeepDiveOutcomes,
  DeepDiveOverview,
  DeepDiveSkills,
} from '../types';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program Scorecard — Print' };

// Minimal printable scorecard — designed to print cleanly on A4 with
// `Ctrl/Cmd+P`. Deliberately NOT an AppShell page: no sidebar, no nav.
// Pure content + KKU-letterhead styling.
//
// For the proper Council-Pack PDF export (via Gotenberg + TH Sarabun
// New), use the "Export PDF" button on /programs/[id] which routes
// through the 02c PDF service and server-renders the @kku/pdf-templates
// program-brief template. This route is for "open and hit print".

export default async function ProgramPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const { id } = await params;
  const [overview, financials, skills, outcomes, faculty, decisions] = await Promise.all([
    apiFetch<DeepDiveOverview>(`/programs/${id}/overview`).catch(() => null),
    apiFetch<DeepDiveFinancials>(`/programs/${id}/financials`).catch(() => null),
    apiFetch<DeepDiveSkills>(`/programs/${id}/skills`).catch(() => null),
    apiFetch<DeepDiveOutcomes>(`/programs/${id}/outcomes`).catch(() => null),
    apiFetch<DeepDiveFaculty>(`/programs/${id}/faculty`).catch(() => null),
    apiFetch<DeepDiveDecisions>(`/programs/${id}/decisions`).catch(() => null),
  ]);
  if (!overview) notFound();

  const h = overview.health;

  return (
    <main className="mx-auto max-w-4xl bg-surface-0 p-8 text-text-primary print:p-0">
      <style>{`
        @page { size: A4; margin: 15mm 12mm; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-hide { display: none; }
        }
      `}</style>
      <header className="mb-6 flex items-start justify-between border-b border-border-default pb-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            KKU Curriculum Intelligence Platform · Program Landscape · Program Scorecard
          </div>
          <h1 className="mt-1 text-2xl font-bold">{overview.program.nameTh}</h1>
          <div className="text-sm text-text-secondary">
            {overview.program.nameEn} · {overview.program.code} · {overview.program.level}
          </div>
          <div className="text-sm text-text-tertiary">
            {overview.program.faculty.nameEn}
            {overview.program.department ? ` · ${overview.program.department.nameEn}` : ''}
          </div>
        </div>
        {h && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-text-tertiary">
              Overall health
            </div>
            <div className="font-tabular text-4xl font-semibold">
              {h.overall.score === null ? '—' : Math.round(h.overall.score)}
            </div>
            <div className="text-xs text-text-tertiary">
              {h.methodologyVersion} · data {Math.round(h.overall.dataCompletenessPct)}%
            </div>
          </div>
        )}
      </header>

      {h && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Health dimensions</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-tertiary">
                <th>Dimension</th>
                <th className="text-right">Score</th>
                <th className="text-right">Data completeness</th>
              </tr>
            </thead>
            <tbody>
              {(['demand', 'financial', 'quality', 'relevance', 'capability'] as const).map(
                (dim) => {
                  const s = h.dimensions[dim];
                  return (
                    <tr key={dim} className="border-t border-border-subtle">
                      <td className="py-1 capitalize">{dim}</td>
                      <td className="py-1 text-right font-tabular">
                        {s.score === null ? '—' : Math.round(s.score)}
                      </td>
                      <td className="py-1 text-right font-tabular">
                        {Math.round(s.dataCompletenessPct)}%
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </section>
      )}

      {financials && financials.waterfall.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Financial snapshot</h2>
          <table className="w-full text-sm">
            <tbody>
              {financials.waterfall.map((s) => (
                <tr key={s.label} className="border-t border-border-subtle">
                  <td className="py-1">{s.label}</td>
                  <td
                    className={
                      'py-1 text-right font-tabular ' +
                      (s.kind === 'negative' ? 'text-danger' : '')
                    }
                  >
                    {s.value.toLocaleString('en-US')} THB
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {financials.sensitivity && (
            <p className="mt-2 text-xs text-text-tertiary">
              Sensitivity — tuition + 5% raises net contribution to{' '}
              {financials.sensitivity.tuitionPlus5Pct.netContribution.toLocaleString('en-US')} THB.
            </p>
          )}
        </section>
      )}

      {skills && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">
            Skills match — {Math.round(skills.matchScore)}
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="mb-1 text-xs text-text-tertiary">Taught (top 10)</div>
              <ul>
                {skills.taught.slice(0, 10).map((s) => (
                  <li key={s.skillId}>{s.nameEn}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs text-text-tertiary">Demanded (top 10)</div>
              <ul>
                {skills.demanded.slice(0, 10).map((s) => (
                  <li key={s.skillId}>
                    {s.nameEn} <span className="text-text-tertiary">({s.jobCount})</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {outcomes?.latest && (
        <section className="mb-6 text-sm">
          <h2 className="mb-2 text-lg font-semibold">Outcomes (latest survey)</h2>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-xs text-text-tertiary">Employment rate</div>
              <div className="font-tabular text-lg font-semibold">
                {(outcomes.latest.employmentRate * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-text-tertiary">Avg salary</div>
              <div className="font-tabular text-lg font-semibold">
                {outcomes.latest.averageSalary.toLocaleString('en-US')} THB
              </div>
            </div>
            <div>
              <div className="text-xs text-text-tertiary">Job relevance</div>
              <div className="font-tabular text-lg font-semibold">
                {(outcomes.latest.jobRelevanceScore * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </section>
      )}

      {faculty && (
        <section className="mb-6 text-sm">
          <h2 className="mb-2 text-lg font-semibold">Faculty capability</h2>
          <p>
            {faculty.totalActive} active faculty · avg age{' '}
            {faculty.averageAgeYears === null ? '—' : faculty.averageAgeYears.toFixed(0)} ·
            succession risk{' '}
            <span className={faculty.successionRiskPct > 30 ? 'text-danger' : ''}>
              {faculty.successionRiskPct.toFixed(0)}%
            </span>{' '}
            ({faculty.retiringWithin5Years} retiring in 5 yrs)
          </p>
          <p className="mt-1">
            Ranks:{' '}
            {Object.entries(faculty.ranks)
              .map(([r, n]) => `${r}: ${n}`)
              .join(' · ')}
          </p>
        </section>
      )}

      {decisions && decisions.decisions.length > 0 && (
        <section className="mb-6 text-sm">
          <h2 className="mb-2 text-lg font-semibold">Recent Council decisions</h2>
          <ul className="ml-4 list-disc">
            {decisions.decisions.slice(0, 5).map((d) => (
              <li key={d.id}>
                {d.decisionType} · {d.status} ·{' '}
                {new Date(d.createdAt).toLocaleDateString()} ({d.decidedBy})
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-border-default pt-4 text-xs text-text-tertiary">
        Generated by KKU Curriculum Intelligence Platform · Program Landscape · Methodology{' '}
        {overview.methodologyVersion} · {new Date().toLocaleString()}
        <div className="print-hide mt-2">
          <PrintButton />
        </div>
      </footer>
    </main>
  );
}
