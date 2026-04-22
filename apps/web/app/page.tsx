import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/top-bar';
import type { MeResponse, SessionUser, FacultyDto } from '@kku/shared';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await auth();
  if (!session?.user || !(session.user as SessionUser).userId) {
    redirect('/signin');
  }
  const user = session.user as SessionUser;

  // Live API call — demonstrates JWT forwarding and envelope unwrapping.
  const [me, faculties] = await Promise.all([
    apiFetch<MeResponse>('/me').catch(() => null),
    apiFetch<FacultyDto[]>('/faculties').catch(() => []),
  ]);

  return (
    <div className="min-h-screen">
      <TopBar user={user} />
      <div className="grid min-h-[calc(100vh-57px)] grid-cols-[220px_1fr]">
        <nav className="border-r border-border bg-surface-raised p-4 text-sm">
          <div className="mb-3 text-xs uppercase tracking-wide text-fg-subtle">
            Modules
          </div>
          <ul className="flex flex-col gap-1 text-fg-muted">
            <li className="rounded-sm bg-surface-muted px-3 py-2 text-fg">Home</li>
            <li className="px-3 py-2">Portfolio Cockpit — prompt 05</li>
            <li className="px-3 py-2">Program Deep-Dive — prompt 06</li>
            <li className="px-3 py-2">Trends Radar — prompt 07</li>
            <li className="px-3 py-2">Gap Analyzer — prompt 08</li>
            <li className="px-3 py-2">Scenario Planner — prompt 09</li>
            <li className="px-3 py-2">Benchmarking — prompt 10</li>
            <li className="px-3 py-2">AI Analyst — prompt 11</li>
            <li className="px-3 py-2">Decision Workspace — prompt 12</li>
          </ul>
        </nav>

        <main className="p-6">
          <h1 className="mb-1 text-xl font-semibold text-fg">
            Welcome, {user.name ?? user.email}
          </h1>
          <p className="mb-6 text-sm text-fg-muted">
            Shell for prompt 02. The modules will fill in as we go.
          </p>

          <section className="mb-6 rounded-md border border-border bg-surface-raised p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg">Your access</h2>
            {me ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <dt className="text-fg-muted">Role</dt>
                <dd className="text-fg">{me.role}</dd>
                <dt className="text-fg-muted">Theme preference</dt>
                <dd className="text-fg">{me.themePreference}</dd>
                <dt className="text-fg-muted">Own faculty ID</dt>
                <dd className="text-fg">
                  {me.scopeAccess.ownFacultyId ?? '—'}
                </dd>
                <dt className="text-fg-muted">Own department ID</dt>
                <dd className="text-fg">
                  {me.scopeAccess.ownDepartmentId ?? '—'}
                </dd>
                <dt className="text-fg-muted">Permissions</dt>
                <dd className="text-fg">
                  <span className="font-tabular">{me.permissions.length}</span>{' '}
                  granted
                </dd>
              </dl>
            ) : (
              <p className="text-sm text-fg-muted">/me unavailable</p>
            )}
          </section>

          <section className="rounded-md border border-border bg-surface-raised p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg">
              Faculties (live from /api/v1/faculties)
            </h2>
            {faculties.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No faculties returned — is the API running on port 4000?
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {faculties.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-sm border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <span className="font-tabular text-fg-muted">{f.code}</span>{' '}
                    <span className="text-fg">{f.nameEn}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-8 text-xs text-fg-subtle">
            KPI grid placeholder — shadcn card grid lands in prompt 02b, data
            wiring in prompts 05+.
          </p>
        </main>
      </div>
    </div>
  );
}
