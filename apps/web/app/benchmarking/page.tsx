import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { BenchmarkingClient } from './client';
import type {
  PeerSetDto,
  PortfolioComparisonResponse,
  SubjectLeadershipResponse,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Competitive Benchmarking' };

export default async function BenchmarkingPage({
  searchParams,
}: {
  searchParams: Promise<{ peerSetId?: string; subjectArea?: string; view?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const view = (sp.view ?? 'portfolio') as 'portfolio' | 'subjects';
  const subjectArea = sp.subjectArea ?? 'Computer Science';

  const peerSets = await apiFetch<PeerSetDto[]>('/benchmarking/peer-sets').catch(
    () => [] as PeerSetDto[],
  );
  const peerSetId = sp.peerSetId ?? peerSets[0]?.id ?? null;

  const [portfolio, subjects] = await Promise.all([
    peerSetId
      ? apiFetch<PortfolioComparisonResponse>(`/benchmarking/portfolio?peerSetId=${peerSetId}`).catch(() => null)
      : Promise.resolve(null),
    apiFetch<SubjectLeadershipResponse>(
      `/benchmarking/subjects?subjectArea=${encodeURIComponent(subjectArea)}`,
    ).catch(() => null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Competitive Benchmarking"
        subtitle="KKU positioned against Thai, ASEAN, and global peers — at portfolio, subject, and program level."
      />
      <BenchmarkingClient
        peerSets={peerSets}
        initialFilters={{
          peerSetId: peerSetId ?? '',
          subjectArea,
          view,
        }}
        portfolio={portfolio}
        subjects={subjects}
      />
    </AuthedAppShell>
  );
}
