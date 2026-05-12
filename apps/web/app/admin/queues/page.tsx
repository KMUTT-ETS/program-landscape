import { redirect } from 'next/navigation';
import { isAdminGrade, isSuperGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { Card, PageHeader } from '@kku/ui';
import { QueuesClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Queues — Admin' };

export default async function QueuesPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  // Read-only is open to ANALYST + any admin-grade. Manage actions
  // (pause/resume/clean/retry) are super-grade only — SYSTEM_ADMIN
  // doesn't carry queues:manage per ROLE_PERMISSIONS.
  if (!isAdminGrade(user.role)) redirect('/no-access');

  const canManage = isSuperGrade(user.role);

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Job queues" />
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
