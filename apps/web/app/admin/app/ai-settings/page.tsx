import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isSuperGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Button, Card } from '@kku/ui';
import { ArrowLeft, CircleDollarSign, Settings2 } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI settings — Admin' };

// ─────────────────────────────────────────────────────────────────────────
// AI settings — Phase 3 placeholder.
//
// URL reserved at IA-restructure time (Phase 1, 2026-05-12). The full
// implementation will land in Phase 3 with:
//   - Per-task model picker (override gemini-3.1-pro-preview / 2.5-pro
//     / etc. per methodVersion; stored in DB, read by AiService at
//     dispatch time)
//   - "Fetch latest available models" via provider APIs (Anthropic
//     /v1/models is stable; Gemini best-effort)
//   - Picker behaviour: new runs use the new model; existing
//     assessments stamped with the old model get a "stale" banner.
//     NEVER auto-re-runs (user fires that themselves).
//   - AI cost dashboard consolidated here (currently at /admin/ai-cost)
//
// Until then, the existing /admin/ai-cost stays the source of truth
// for cost; this page just sets expectations.
// ─────────────────────────────────────────────────────────────────────────

export default async function AdminAiSettingsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isSuperGrade(user.role)) redirect('/no-access');

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
          <Badge tone="info">Phase 3</Badge>
        </div>

        <header className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-default/30 bg-accent-default/10 text-accent-default">
            <Settings2 className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-medium tracking-tight">AI settings</h1>
            <p className="mt-1 max-w-[640px] text-sm text-text-secondary">
              Per-task model picker and consolidated cost dashboard. URL reserved at IA-restructure time; full implementation ships in Phase 3.
            </p>
          </div>
        </header>

        <Card>
          <h2 className="text-sm font-semibold">What lands in Phase 3</h2>
          <ul className="mt-3 ml-5 list-disc text-sm text-text-secondary [&>li]:mt-1">
            <li>
              <strong>Per-task model picker.</strong> Override the default
              model for any methodVersion (program-digest.v1,
              program-pedagogy.v1, demand-match.v2, …). Stored in DB,
              read by AiService at dispatch time.
            </li>
            <li>
              <strong>Latest-models fetch.</strong> "Refresh model list"
              button hits the provider APIs (Anthropic
              <code>/v1/models</code> is stable; Gemini best-effort)
              so the picker always shows what's currently available.
            </li>
            <li>
              <strong>Picker behaviour.</strong> When you change a
              model: new runs use the new model; existing assessments
              stamped with the old model are marked <em>stale</em> in
              the UI but never auto-re-run.
            </li>
            <li>
              <strong>Consolidated cost dashboard.</strong> Per-user,
              per-module spend over 7 / 30 days (currently at{' '}
              <Link
                href="/admin/ai-cost"
                className="text-accent-default hover:underline"
              >
                /admin/ai-cost
              </Link>
              ) moves here.
            </li>
          </ul>
        </Card>

        <Card tone="quiet">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                For now: AI cost dashboard
              </h3>
              <p className="mt-1 text-xs text-text-tertiary">
                The existing cost surface is still the source of truth until Phase 3 ships.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/ai-cost">
                <CircleDollarSign className="h-3.5 w-3.5" aria-hidden />
                Open /admin/ai-cost
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </AuthedAppShell>
  );
}
