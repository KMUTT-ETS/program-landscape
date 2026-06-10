import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { getBenchmarkingOverview } from '@kku/db';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import {
  ProgramsDirectory,
  type FacultiesListResponse,
  type FacultyLite,
  type ProgramRow,
  type ProgramsListResponse,
} from '@/components/programs-directory';
import { CurriculumModernity } from '@/components/dashboard/curriculum-modernity';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Competitive Benchmarking' };

export default async function BenchmarkingPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    level?: string;
    q?: string;
    page?: string;
    facultyId?: string;
    curriculumYearBE?: string;
    language?: string;
  }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  const qs = new URLSearchParams({ scope: 'university', pageSize: '500', page: String(page) });
  if (sp.status) qs.set('status', sp.status);
  if (sp.level) qs.set('level', sp.level);
  if (sp.facultyId) qs.set('facultyId', sp.facultyId);
  if (sp.curriculumYearBE) qs.set('curriculumYearBE', sp.curriculumYearBE);
  if (sp.q) qs.set('q', sp.q);

  const [overview, rows, faculties] = await Promise.all([
    getBenchmarkingOverview(),
    apiFetch<ProgramsListResponse>(`/programs?${qs}`).catch(() => [] as ProgramRow[]),
    apiFetch<FacultiesListResponse>('/faculties?hasPrograms=true').catch(() => [] as FacultyLite[]),
  ]);

  const { hero } = overview;
  const counts = hero.modernityCounts;
  const judged = counts.OLD_SCHOOL + counts.IN_BETWEEN + counts.FRONTIER + counts.UNKNOWN;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Competitive Benchmarking"
        subtitle={
          `How KKU's curricula stack up against globally-ranked peer programs — content, relevance, ` +
          `modernization and AI readiness, judged by AI against the actual content of named peers. ` +
          `${hero.programsReviewed} of ${hero.totalActivePrograms} programs have a full peer review.`
        }
      />

      <div className="flex flex-col gap-5">
        {/* ── At-a-glance stats ────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Programs benchmarked" value={hero.programsBenchmarked} of={hero.totalActivePrograms} hint="≥1 AI-picked peer" />
          <StatCard label="Full AI peer reviews" value={hero.programsReviewed} of={hero.totalActivePrograms} hint="strengths · gaps · recs" />
          <StatCard label="At the frontier" value={counts.FRONTIER} of={judged} hint="curriculum modernity" ink="text-success" />
          <StatCard label="Old school" value={counts.OLD_SCHOOL} of={judged} hint="needs modernizing" ink="text-warning" />
        </div>

        {/* ── Curriculum modernity verdict ─────────────────────────── */}
        <Card padding="md">
          <header className="mb-3">
            <h3 className="text-sm font-semibold text-text-primary">Curriculum modernity verdict</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">
              Where KKU&rsquo;s reviewed curricula sit on the{' '}
              <span className="font-medium text-warning">old-school</span> →{' '}
              <span className="font-medium text-success">frontier</span> spectrum — AI-judged against the
              actual content of named peer programs.
            </p>
          </header>
          <CurriculumModernity counts={counts} variant="full" />
        </Card>

        {/* ── Programs directory (same filters + table as /programs) ── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Programs</h3>
          <p className="-mt-1 text-xs text-text-tertiary">
            Pick a program for its focused benchmarking view — content positioning, gaps, AI readiness, and the
            peer references it was judged against.
          </p>
          <ProgramsDirectory
            rows={rows}
            faculties={faculties}
            sp={sp}
            basePath="/benchmarking"
            programHref={(id) => `/benchmarking/programs/${id}`}
          />
        </section>
      </div>
    </AuthedAppShell>
  );
}

function StatCard({
  label,
  value,
  of,
  hint,
  ink,
}: {
  label: string;
  value: number;
  of?: number;
  hint?: string;
  ink?: string;
}) {
  return (
    <Card padding="md">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`font-tabular text-2xl font-bold ${ink ?? 'text-text-primary'}`}>{value}</span>
        {of !== undefined && <span className="text-sm text-text-tertiary">/ {of}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-text-tertiary">{hint}</div>}
    </Card>
  );
}
