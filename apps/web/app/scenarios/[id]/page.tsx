import { redirect, notFound } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, PageHeader } from '@kku/ui';
import { ScenarioEditorClient } from './editor-client';
import type { ScenarioDetail } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Scenario' };

export default async function ScenarioEditorPage({
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
  const tab = (sp.tab ?? 'setup') as 'setup' | 'assumptions' | 'simulation' | 'comparison' | 'discussion';

  const scenario = await apiFetch<ScenarioDetail>(`/scenarios/${id}`).catch(() => null);
  if (!scenario) notFound();

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={scenario.name}
        subtitle={scenario.descriptionTh ?? scenario.descriptionEn ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="outline">{scenario.scenarioType}</Badge>
            <Badge tone={scenario.workflowStatus === 'DECIDED' ? 'success' : scenario.workflowStatus === 'COUNCIL_REVIEWED' ? 'warning' : 'neutral'}>
              {scenario.workflowStatus}
            </Badge>
          </div>
        }
      />
      <ScenarioEditorClient scenario={scenario} initialTab={tab} userRole={user.role} />
    </AuthedAppShell>
  );
}
