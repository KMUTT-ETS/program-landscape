import { orgShortNamesForRequest } from '@/lib/branding';
import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, isUniversityWide, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { CampaignsClient, type CampaignDashboardPayload } from './client';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Actual Recruitment Campaigns — Education dashboard' };

interface SearchParams {
  acadYearBE?: string;
  facultyId?: string;
  round?: string;
  unmappedOnly?: string;
}

export default async function RecruitmentCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const org = await orgShortNamesForRequest();
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.acadYearBE) params.set('acadYearBE', sp.acadYearBE);
  if (sp.facultyId) params.set('facultyId', sp.facultyId);
  if (sp.round) params.set('round', sp.round);
  if (sp.unmappedOnly) params.set('unmappedOnly', sp.unmappedOnly);

  const data = await apiFetch<CampaignDashboardPayload>(
    `/education/recruitment-campaigns${params.toString() ? '?' + params.toString() : ''}`,
  ).catch((e) => {
    console.error('recruitment-campaigns fetch failed', e);
    return null;
  });

  // Scoped users (FACULTY_USER / PROGRAM_USER) get their faculty forced by the
  // server clamp; lock the filter so the dropdown can't offer faculties they
  // can't see. University-wide roles keep the free filter.
  const facultyFilterLocked = !isUniversityWide(user.effectiveRole ?? user.role);

  if (!data) {
    return (
      <AuthedAppShell user={user}>
        <PageHeader
          title="Actual Recruitment Campaigns"
          subtitle="Failed to load campaign data."
        />
      </AuthedAppShell>
    );
  }

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Actual Recruitment Campaigns"
        subtitle={`The practical recruitment grain — one row per campaign track (competency / language / exam option / quota type / branch-campus intake) within a program × round × year. Source: ${org.en} Registry POWERBI.ADMISSION_STAT. The current cycle stays informational; headline metrics use the latest completed cohort.`}
      />
      <CampaignsClient data={data} facultyFilterLocked={facultyFilterLocked} />
    </AuthedAppShell>
  );
}
