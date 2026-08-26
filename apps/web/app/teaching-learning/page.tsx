import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import {
  TeachingLearningOverviewClient,
  type FacultyOverviewResponse,
} from './client';

// Teaching & Learning — AUN-QA readiness overview.
//
// The API clamps the programme list to the caller's scope exactly as the
// sibling faculty-aware dashboards do: a FACULTY_USER sees their own
// faculty, a university-wide role sees every programme. This page adds no
// scope logic of its own beyond the role gate below.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching & Learning' };

export default async function TeachingLearningOverviewPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const role = user.effectiveRole ?? user.role;
  if (!canSeeProgramAwareDashboards(role)) redirect('/no-access');

  const res = await apiFetchSafe<FacultyOverviewResponse>('/aunqa/faculty-overview');

  return (
    <AuthedAppShell user={user}>
      {/* The subtitle carries the framing in plain words, not a footnote:
          a dean glancing at a "no evidence" row must read it as a gap in
          OUR data, never as a judgement on the programme. */}
      <PageHeader
        title="Teaching & Learning"
        subtitle="How much of each programme's AUN-QA evidence this platform can already show, so you can sequence which programmes to put forward for assessment. Every figure describes our data, not the programme: “no evidence yet” means we cannot yet show that programme's evidence, not that it teaches badly. The platform awards no AUN-QA rating — assessors do that."
      />
      {res.ok ? (
        <TeachingLearningOverviewClient data={res.data} />
      ) : (
        <DiagnosticEmptyState surface="AUN-QA readiness" error={res.error} />
      )}
    </AuthedAppShell>
  );
}
