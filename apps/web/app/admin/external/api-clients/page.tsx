import { redirect } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { can, type SessionUser } from '@kku/shared';
import type { ApiClientSummary } from '@kku/db';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { ApiClientsClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API clients — Admin' };

export default async function AdminApiClientsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!can(user, 'api_clients:admin')) redirect('/no-access');

  // Mirrors the API's own gate (api-clients.controller.ts): until the KKU
  // proxy address is pinned in nginx, every request appears to come from the
  // proxy, so a per-client allowlist would either block everyone or no one.
  const ipAllowlistEnabled = process.env.API_CLIENT_IP_ALLOWLIST === 'enabled';

  let clients: ApiClientSummary[] = [];
  let loadError: string | null = null;
  try {
    clients = await apiFetch<ApiClientSummary[]>('/admin/api-clients');
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <AuthedAppShell user={user}>
      <div className="flex flex-col gap-6">
        <AdminBackNav current="API clients" />

        <header className="flex items-start gap-4">
          <div className="flex h-[3rem] w-[3rem] shrink-0 items-center justify-center rounded-2xl border border-[oklch(var(--color-accent-default)/0.3)] bg-accent-default/10 text-accent-default">
            <KeyRound className="size-icon-xl" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-medium tracking-tight">API clients</h1>
            <p className="mt-1 max-w-[720px] text-sm text-text-secondary">
              Other KKU systems call{' '}
              <code className="rounded bg-surface-2 px-1">POST /api/v1/external/staff-profile</code> with a key
              issued here. Keys are shown once.
            </p>
          </div>
        </header>

        <ApiClientsClient initial={clients} loadError={loadError} ipAllowlistEnabled={ipAllowlistEnabled} />
      </div>
    </AuthedAppShell>
  );
}
