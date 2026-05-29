import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { RecruitmentClient, type RecruitmentDashboardPayload } from './client';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Undergraduate Recruitment — Education dashboard' };

interface SearchParams {
  entryYearBE?: string;
  facultyId?: string;
  level?: string;
  round?: string;
}

interface Faculty {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
}

export default async function RecruitmentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.entryYearBE) params.set('entryYearBE', sp.entryYearBE);
  if (sp.facultyId) params.set('facultyId', sp.facultyId);
  if (sp.level) params.set('level', sp.level);
  if (sp.round) params.set('round', sp.round);

  const [data, allFaculties] = await Promise.all([
    apiFetch<RecruitmentDashboardPayload>(
      `/education/recruitment${params.toString() ? '?' + params.toString() : ''}`,
    ).catch((e) => {
      console.error('recruitment fetch failed', e);
      return null;
    }),
    apiFetch<Faculty[]>('/faculties').catch(() => [] as Faculty[]),
  ]);

  // FACULTY_USER sees only their own faculty in the picker — the
  // server already clamps the query, but locking the dropdown avoids
  // the "I picked another faculty but the data didn't change" surprise.
  const faculties =
    user.role === 'FACULTY_USER' && user.facultyId
      ? allFaculties.filter((f) => f.id === user.facultyId)
      : allFaculties;
  const facultyFilterLocked = user.role === 'FACULTY_USER';

  if (!data) {
    return (
      <AuthedAppShell user={user}>
        <PageHeader
          title="Undergraduate Recruitment"
          subtitle="Failed to load recruitment data."
        />
      </AuthedAppShell>
    );
  }

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Undergraduate Recruitment"
        subtitle="Full TCAS round 1–4 funnel — quota, applicants, passed, Clearinghouse send + confirm, and registrar reporting per program × round × year. Source: KKU Registry POWERBI.ADMISSION_STAT_CURRID. The current cycle (BE 2569 / CE 2026) stays informational only; all aggregate metrics use the latest completed cohort."
      />
      <RecruitmentClient
        data={data}
        faculties={faculties}
        facultyFilterLocked={facultyFilterLocked}
      />
    </AuthedAppShell>
  );
}
