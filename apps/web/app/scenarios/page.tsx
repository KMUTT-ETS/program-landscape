import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { ScenariosLibraryClient } from './library-client';
import type { ScenarioListRow, ScenarioTemplate } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Strategic Scenario Planner — KKU' };

export default async function ScenariosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; scenarioType?: string; creator?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const qs = new URLSearchParams({ includeTemplates: 'true' });
  if (sp.status) qs.set('status', sp.status);
  if (sp.scenarioType) qs.set('scenarioType', sp.scenarioType);
  if (sp.creator) qs.set('creator', sp.creator);

  const [scenarios, templates] = await Promise.all([
    apiFetch<ScenarioListRow[]>(`/scenarios?${qs}`).catch(() => [] as ScenarioListRow[]),
    apiFetch<ScenarioTemplate[]>('/scenarios/templates').catch(() => [] as ScenarioTemplate[]),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Strategic Scenario Planner"
        subtitle="Simulate program-portfolio interventions before they become decisions. Assumptions transparent, sensitivity visible, confidence bands drawn."
      />
      <ScenariosLibraryClient
        scenarios={scenarios}
        templates={templates}
        initialFilters={{
          status: sp.status ?? '',
          scenarioType: sp.scenarioType ?? '',
        }}
      />
    </AuthedAppShell>
  );
}
