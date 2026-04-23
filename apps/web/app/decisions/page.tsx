import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { DecisionsLibraryClient } from './library-client';
import type { DecisionListRow } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Decision Workspace — KKU' };

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; decisionType?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '50' });
  if (sp.status) qs.set('status', sp.status);
  if (sp.decisionType) qs.set('decisionType', sp.decisionType);

  const decisions = await apiFetch<DecisionListRow[]>(`/decisions?${qs}`).catch(
    () => [] as DecisionListRow[],
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Decision Workspace"
        subtitle="Council decisions captured with context, approved with audit trail, tracked to outcome."
      />
      <DecisionsLibraryClient
        decisions={decisions}
        initialFilters={{
          status: sp.status ?? '',
          decisionType: sp.decisionType ?? '',
        }}
      />
    </AuthedAppShell>
  );
}
