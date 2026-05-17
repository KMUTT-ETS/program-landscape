import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { AnalystClient } from '../client';
import type {
  AnalystConversationDto,
  AnalystConversationDetail,
} from '../types';

// ──────────────────────────────────────────────────────────────────────────
// /analyst/dashboards — operational chatbot scoped to /education + /staff.
//
// Same UI shell as the strategic /analyst page, but:
//   - List filtered to `kind=DASHBOARD` so dashboard convos stay separate
//     from strategic Council conversations.
//   - Empty-state starter prompts are operational, not strategic.
//   - Placeholder steers questions toward dashboard data (counts, splits,
//     trends, freshness) rather than scenarios/peers/sunset.
//
// The same /analyst/chat/stream endpoint backs both surfaces — the server
// switches system prompt + tool catalog based on the `kind` field of the
// conversation row.
// ──────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboards Assistant' };

export default async function AnalystDashboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;

  // Filter to DASHBOARD-kind conversations only. If the user has been
  // using /analyst (STRATEGIC) for a while, those rows aren't relevant
  // here — separate history is the contract.
  const conversationsRes = await apiFetchSafe<AnalystConversationDto[]>(
    '/analyst/conversations?kind=DASHBOARD',
  );
  const activeConversation = sp.c
    ? await apiFetch<AnalystConversationDetail>(
        `/analyst/conversations/${sp.c}`,
      ).catch(() => null)
    : null;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Dashboards Assistant"
        subtitle="Ask about anything shown on the Education and Staff dashboards — student counts, recruitment, location, GPA, workforce, compensation, teaching workload, research. Thai or English."
      />
      {!conversationsRes.ok ? (
        <DiagnosticEmptyState
          surface="Dashboards Assistant"
          error={conversationsRes.error}
        />
      ) : (
        <AnalystClient
          conversations={conversationsRes.data}
          activeConversation={activeConversation}
          kind="DASHBOARD"
          basePath="/analyst/dashboards"
          emptyState={<DashboardsEmptyState />}
          placeholder="เช่น มีนักศึกษาที่กำลังศึกษาอยู่กี่คน · How many staff retire within 5 years? · What's the GPA in Faculty of Medicine?"
        />
      )}
    </AuthedAppShell>
  );
}

function DashboardsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <h3 className="text-sm font-semibold text-text-primary">
        Ask about the Education or Staff dashboards
      </h3>
      <p className="max-w-md text-xs leading-relaxed text-text-secondary">
        Grounded in the same materialised cubes the dashboards read from.
        Strategic Council questions (scenarios, peers, sunset) live in{' '}
        <a href="/analyst" className="text-accent-default hover:underline">
          /analyst
        </a>{' '}
        instead.
      </p>
      <div className="flex max-w-md flex-col gap-1 text-left text-xs text-text-tertiary">
        <span>• KKU มีนักศึกษาที่กำลังศึกษาอยู่ทั้งหมดกี่คน แยกตามคณะ</span>
        <span>• Which Thai region sends the most students to Engineering?</span>
        <span>• ค่า GPA เฉลี่ยของคณะแพทยศาสตร์ปีล่าสุดเป็นเท่าไหร่</span>
        <span>• How many academic staff retire within the next 5 years?</span>
        <span>• Which faculty has the heaviest teaching workload?</span>
        <span>• แนวโน้มรายได้ค่าเล่าเรียนของ KKU ในช่วง 5 ปีที่ผ่านมา</span>
      </div>
    </div>
  );
}
