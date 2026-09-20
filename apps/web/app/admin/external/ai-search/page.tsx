import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Button } from '@kku/ui';
import { ArrowLeft, Globe2 } from 'lucide-react';
import { AiSearchClient, type ExternalAiSourceRow } from './client';
import { Job108SettingsPanel } from './job108-settings-client';
import type { Job108SettingsView } from '@/lib/actions/job108-settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI search & synthesis — Admin' };

export default async function AdminAiSearchPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  let sources: ExternalAiSourceRow[] = [];
  let loadError: string | null = null;
  try {
    sources = await apiFetch<ExternalAiSourceRow[]>('/admin/external-ai-sources');
  } catch (e) {
    loadError = (e as Error).message;
  }

  let job108Settings: Job108SettingsView | null = null;
  let job108LoadError: string | null = null;
  try {
    job108Settings = await apiFetch<Job108SettingsView>('/admin/job108-settings');
  } catch (e) {
    job108LoadError = (e as Error).message;
  }

  return (
    <AuthedAppShell user={user}>
      <div className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin">
                <ArrowLeft className="size-icon-sm" aria-hidden /> Admin
              </Link>
            </Button>
            <span className="text-xs uppercase tracking-wide text-text-tertiary">
              External data · AI search & synthesis
            </span>
          </div>
          <Badge tone="info">Phase 5</Badge>
        </div>

        <header className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-default/30 bg-accent-default/10 text-accent-default">
            <Globe2 className="size-icon-xl" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-medium tracking-tight">AI search & synthesis</h1>
            <p className="mt-1 max-w-[720px] text-sm text-text-secondary">
              External intelligence feeds (WEF, IMD, BOI, World Bank, MHESI, OECD, ASEAN, Google News). URL-list sources enumerate explicit URLs; web-search sources query a search provider. Every fetched item is AI-summarised into the existing <code className="rounded bg-surface-2 px-1">trend_signals</code> table consumed by the analyst, deep-dive, and cockpit briefs.
            </p>
          </div>
        </header>

        {loadError ? (
          <div className="rounded-lg border border-danger-default/30 bg-danger-default/5 p-4 text-sm text-danger-default">
            Could not load sources: {loadError}
          </div>
        ) : (
          <AiSearchClient initial={sources} />
        )}

        {job108LoadError ? (
          <div className="rounded-lg border border-danger-default/30 bg-danger-default/5 p-4 text-sm text-danger-default">
            Could not load Job-108 settings: {job108LoadError}
          </div>
        ) : job108Settings ? (
          <Job108SettingsPanel initial={job108Settings} />
        ) : null}
      </div>
    </AuthedAppShell>
  );
}
