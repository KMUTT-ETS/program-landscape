import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { EmptyState, PageHeader, Section } from '@kku/ui';
import { InboxClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inbox' };

export interface NotificationDto {
  id: string;
  kind: string;
  title: string;
  bodyEn: string | null;
  bodyTh: string | null;
  entityType: string | null;
  entityId: string | null;
  severity: 'low' | 'medium' | 'high';
  readAt: string | null;
  createdAt: string;
}

interface InboxResponse {
  notifications: NotificationDto[];
  unreadCount: number;
}

export default async function InboxPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const data = await apiFetch<InboxResponse>('/notifications').catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Inbox"
        subtitle={
          data
            ? `${data.unreadCount} unread of ${data.notifications.length} total`
            : 'Notifications unavailable'
        }
      />
      <Section title="Notifications">
        {!data || data.notifications.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            description="Subscribe to sectors, programs, or signal types in the Trends Radar — high-impact matches land here automatically."
          />
        ) : (
          <InboxClient initial={data.notifications} />
        )}
      </Section>
    </AuthedAppShell>
  );
}
