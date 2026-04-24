import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { AnalystClient } from './client';
import type {
  AnalystBriefTemplate,
  AnalystConversationDto,
  AnalystConversationDetail,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Analyst' };

export default async function AnalystPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;

  const [conversations, briefs, activeConversation] = await Promise.all([
    apiFetch<AnalystConversationDto[]>('/analyst/conversations').catch(
      () => [] as AnalystConversationDto[],
    ),
    apiFetch<AnalystBriefTemplate[]>('/analyst/brief-templates').catch(
      () => [] as AnalystBriefTemplate[],
    ),
    sp.c
      ? apiFetch<AnalystConversationDetail>(`/analyst/conversations/${sp.c}`).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="AI Analyst"
        subtitle="Ask strategic questions in Thai or English — grounded in KKU data, cited, with confidence labels."
      />
      <AnalystClient
        conversations={conversations}
        briefs={briefs}
        activeConversation={activeConversation}
      />
    </AuthedAppShell>
  );
}
