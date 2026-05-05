import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import { QueuesClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Queues — Admin' };

export default async function QueuesPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const canManage = user.role === 'ADMIN';

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Queues"
        title="Job queues"
        subtitle="Live state of every BullMQ queue — what's running, what's waiting, and what's failed. Retry, remove, clean, pause, or resume any queue from here."
      />
      <Card padding="none" tone="quiet">
        <QueuesClient canManage={canManage} />
      </Card>
    </AuthedAppShell>
  );
}
