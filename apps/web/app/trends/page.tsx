import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { TrendsClient } from './client';
import type { TrendsFeedResponse } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Future Trends Radar — KKU' };

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{
    signalType?: string;
    windowDays?: string;
    minImpactScore?: string;
    search?: string;
  }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.signalType) qs.set('signalType', sp.signalType);
  qs.set('windowDays', sp.windowDays ?? '90');
  if (sp.minImpactScore) qs.set('minImpactScore', sp.minImpactScore);
  if (sp.search) qs.set('search', sp.search);
  qs.set('limit', '50');

  const feed = await apiFetch<TrendsFeedResponse>(`/trends?${qs}`).catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Future Trends Radar"
        subtitle="Curated signals from policy, research, market, tech, and news — linked to KKU programs and skills."
      />
      {feed ? (
        <TrendsClient
          feed={feed}
          initialFilters={{
            signalType: sp.signalType ?? '',
            windowDays: sp.windowDays ?? '90',
            minImpactScore: sp.minImpactScore ?? '0',
            search: sp.search ?? '',
          }}
        />
      ) : (
        <p className="text-sm text-text-tertiary">Trends feed unavailable.</p>
      )}
    </AuthedAppShell>
  );
}
