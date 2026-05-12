import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isSuperGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Button } from '@kku/ui';
import { ArrowLeft, Settings2 } from 'lucide-react';
import { AiSettingsClient, type AiSettingsResponse } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI settings — Admin' };

export default async function AdminAiSettingsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isSuperGrade(user.role)) redirect('/no-access');

  let data: AiSettingsResponse | null = null;
  let loadError: string | null = null;
  try {
    data = await apiFetch<AiSettingsResponse>('/admin/ai-settings');
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <AuthedAppShell user={user}>
      <div className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Admin
              </Link>
            </Button>
            <span className="text-xs uppercase tracking-wide text-text-tertiary">
              Application · AI settings
            </span>
          </div>
          <Badge tone="info">Super-admin only</Badge>
        </div>

        <header className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-default/30 bg-accent-default/10 text-accent-default">
            <Settings2 className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-medium tracking-tight">AI settings</h1>
            <p className="mt-1 max-w-[720px] text-sm text-text-secondary">
              Per-method model overrides. Changes take effect within ~60 seconds; new AI calls use the new model, existing assessments stamped with the old model are left as-is (re-run manually from the program pipeline page if needed).
            </p>
          </div>
        </header>

        {loadError ? (
          <div className="rounded-lg border border-danger-default/30 bg-danger-default/5 p-4 text-sm text-danger-default">
            Could not load AI settings: {loadError}
          </div>
        ) : data ? (
          <AiSettingsClient initial={data} />
        ) : null}
      </div>
    </AuthedAppShell>
  );
}
