import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { TeachingTalentClient, type TalentResponse } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching and learning talent — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function TeachingTalentPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const role = user.effectiveRole ?? user.role;
  if (!canSeeProgramAwareDashboards(role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const thresholdRaw = Number(Array.isArray(sp.threshold) ? sp.threshold[0] : sp.threshold);
  const threshold = [4, 4.25, 4.5, 4.75].includes(thresholdRaw) ? thresholdRaw : 4;
  const talentsOnly = (Array.isArray(sp.talentsOnly) ? sp.talentsOnly[0] : sp.talentsOnly) === '1';

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  const res = await apiFetchSafe<TalentResponse>(
    `/staff/teaching-talent${qs.toString() ? `?${qs}` : ''}`,
  );

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Teaching and learning talent"
        subtitle="Instructors students rate highly year after year. A talent cleared the threshold in every one of the last three completed academic years — sustained quality, not one good semester. Every evaluated instructor is included, whether or not their courses are mapped to a curriculum."
      />
      {res.ok ? (
        <TeachingTalentClient
          data={res.data}
          initialFilters={{ facultyName, threshold, talentsOnly }}
        />
      ) : (
        <DiagnosticEmptyState surface="teaching talent" error={res.error} />
      )}
    </AuthedAppShell>
  );
}
