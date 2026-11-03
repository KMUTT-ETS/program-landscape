import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { brandingForRequest } from '@/lib/branding';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import {
  ProgramsDirectory,
  type FacultiesListResponse,
  type FacultyLite,
  type ProgramRow,
  type ProgramsListResponse,
} from '@/components/programs-directory';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Programs' };

export default async function ProgramsDirectoryPage({
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
  const orgShortName = (await brandingForRequest())?.shortNameEn;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  // Request a large page so we can get everything in one shot — pageSize=500
  // covers a whole portfolio.
  const qs = new URLSearchParams({
    scope: 'university',
    pageSize: '500',
    page: String(page),
  });
  if (sp.status) qs.set('status', sp.status);
  if (sp.level) qs.set('level', sp.level);
  if (sp.facultyId) qs.set('facultyId', sp.facultyId);
  if (sp.curriculumYearBE) qs.set('curriculumYearBE', sp.curriculumYearBE);
  if (sp.q) qs.set('q', sp.q);

  const [rows, faculties] = await Promise.all([
    apiFetch<ProgramsListResponse>(`/programs?${qs}`).catch(() => [] as ProgramRow[]),
    // hasPrograms=true drops faculties that have no canonical programs.
    apiFetch<FacultiesListResponse>('/faculties?hasPrograms=true').catch(
      () => [] as FacultyLite[],
    ),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Programs"
        subtitle={`${rows.length} canonical ${orgShortName ? `${orgShortName} ` : ''}programs — click through for the full deep-dive on any program. Legacy and non-canonical programs are excluded from this view but remain joinable from staff and education dashboards.`}
      />
      <ProgramsDirectory
        rows={rows}
        faculties={faculties}
        sp={sp}
        basePath="/programs"
        programHref={(id) => `/programs/${id}`}
      />
    </AuthedAppShell>
  );
}
