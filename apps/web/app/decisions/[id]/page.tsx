import { redirect, notFound } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, PageHeader } from '@kku/ui';
import { DecisionDetailClient } from './detail-client';
import type { DecisionDetail, DecisionStatus } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Decision' };

const STATUS_TONE: Record<DecisionStatus, 'neutral' | 'outline' | 'warning' | 'success' | 'danger' | 'accent'> = {
  PROPOSED: 'outline',
  COUNCIL_REVIEWED: 'warning',
  APPROVED: 'accent',
  IN_IMPLEMENTATION: 'warning',
  IMPLEMENTED: 'success',
  COMPLETED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
  ARCHIVED: 'outline',
};

export default async function DecisionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const { id } = await params;
  const sp = await searchParams;

  const decision = await apiFetch<DecisionDetail>(`/decisions/${id}`).catch(() => null);
  if (!decision) notFound();

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={decision.title}
        subtitle={`${decision.decisionType}${decision.councilSessionRef ? ' · ' + decision.councilSessionRef : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[decision.status]}>{decision.status.replace('_', ' ')}</Badge>
            {decision.version > 1 ? <Badge tone="neutral">v{decision.version}</Badge> : null}
          </div>
        }
      />
      <DecisionDetailClient
        decision={decision}
        initialTab={(sp.tab as 'overview' | 'milestones' | 'approvers' | 'outcomes' | 'discussion') ?? 'overview'}
        userRole={user.role}
        userId={user.userId}
      />
    </AuthedAppShell>
  );
}
