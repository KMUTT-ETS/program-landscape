import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { getBenchmarkingOverview } from '@kku/db';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { BenchmarkingClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Competitive Benchmarking' };

export default async function BenchmarkingPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const overview = await getBenchmarkingOverview();
  // Serialise dates for the client boundary.
  const dto = {
    ...overview,
    generatedAt: overview.generatedAt.toISOString(),
    recentReviews: overview.recentReviews.map((r) => ({ ...r, generatedAt: r.generatedAt.toISOString() })),
  };

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Competitive Benchmarking"
        subtitle={`${dto.hero.programsBenchmarked} of ${dto.hero.totalActivePrograms} active programs benchmarked against globally-ranked peer institutions · ${dto.hero.programsReviewed} with full AI peer review.`}
      />
      <BenchmarkingClient overview={dto} />
    </AuthedAppShell>
  );
}
