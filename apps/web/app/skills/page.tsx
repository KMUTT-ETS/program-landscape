import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader, Section } from '@kku/ui';
import { SkillsExplorer } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Skills' };

export interface SkillNode {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  category: string | null;
  taxonomySource: string;
  parentSkillId: string | null;
  programCount: number;
  courseCount: number;
  jobCount: number;
  coveredAtScope?: boolean;
}

// Scope-aware skill tree. Reads the current scope from ?scope=… & scopeId=…
// on the page URL — the top-bar ScopeSelector writes there and the page
// reloads. Server-renders the initial tree to feel snappy.
export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; scopeId?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const scope = sp.scope ?? 'university';
  const scopeId = sp.scopeId ?? '';

  const qs = new URLSearchParams({ scope, ...(scopeId ? { scopeId } : {}) });

  const tree = await apiFetch<SkillNode[]>(`/skills/tree?${qs}`).catch(
    () => [] as SkillNode[],
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Skills"
        subtitle={`Taxonomy coverage at ${scope === 'university' ? 'University' : `${scope} / ${scopeId || 'no id'}`}. Pick a skill to see which programs cover it and where demand is.`}
      />
      <Section title="Taxonomy">
        <SkillsExplorer initialTree={tree} scope={scope} scopeId={scopeId} />
      </Section>
    </AuthedAppShell>
  );
}
