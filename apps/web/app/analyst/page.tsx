import { orgShortNamesForRequest } from '@/lib/branding';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { AnalystClient } from './client';
import type {
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
  const org = await orgShortNamesForRequest();

  const sp = await searchParams;

  // Conversations is the canary — if THAT fails (auth/permission/server)
  // the user can't do anything useful, so surface the diagnostic.
  // activeConversation is optional.
  const conversationsRes =
    await apiFetchSafe<AnalystConversationDto[]>('/analyst/conversations');
  const activeConversation = sp.c
    ? await apiFetch<AnalystConversationDetail>(
        `/analyst/conversations/${sp.c}`,
      ).catch(() => null)
    : null;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="AI Analyst"
        subtitle={`Ask strategic questions in Thai or English — grounded in ${org.en} data, cited, with confidence labels.`}
      />
      {!conversationsRes.ok ? (
        <DiagnosticEmptyState surface="AI analyst" error={conversationsRes.error} />
      ) : (
        <AnalystClient
          conversations={conversationsRes.data}
          activeConversation={activeConversation}
        />
      )}
    </AuthedAppShell>
  );
}
