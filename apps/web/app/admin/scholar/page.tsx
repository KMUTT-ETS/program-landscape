import { redirect } from 'next/navigation';
import { can, type SessionUser } from '@kku/shared';
import {
  SCHOLAR_NEEDS_BINDING,
  loadScholarConsoleRoster,
  type ScholarConsoleRow as DbScholarConsoleRow,
  type ScholarConsoleRun as DbScholarConsoleRun,
} from '@kku/db';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { PageHeader } from '@kku/ui';
import { listScholarRunsAction } from '@/lib/actions/scholar-admin';
import { scholarBulkMaxTargets } from '@/lib/scholar-admin-config';
import type {
  ScholarConsoleRow,
  ScholarConsoleRun,
  ScholarLedger,
} from '@/lib/scholar-admin';
import { ScholarConsoleClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Google Scholar — Admin' };

// The admin Google Scholar console.
//
// THIS IS THE ONE PAGE IN THE PRODUCT WHERE A SINGLE CLICK CAN SPEND FOUR
// FIGURES OF SCRAPINGBEE CREDITS. Every Google page costs 15, a bulk run can
// name up to SCHOLAR_BULK_MAX_TARGETS people, and a prolific researcher's
// profile is several pages. The console is therefore built around one rule:
// nothing is enqueued until a number has been put in front of the operator.
// `decideScholarBulkGate` in `src/lib/scholar-admin.ts` enforces it, and the
// confirmation dialog is the only thing that produces the priced preview the
// gate demands.
//
// The roster comes from Prisma rather than the API because the API has no
// staff-roster endpoint — see the note at the top of
// `packages/db/src/scholar-console.ts`. `apps/web/app/admin/users` is the
// precedent. The run LEDGER does come from the API, via `GET /scholar/runs`.
//
// The permission gate is `can(user, 'scholar:admin')`, not `isAdminGrade()`.
// The two happen to cover the same roles today, and asking the permission
// directly means they stay correct if that ever stops being true.

export default async function AdminScholarPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!can(user, 'scholar:admin')) redirect('/no-access');

  const [roster, ledgerResult] = await Promise.all([
    loadScholarConsoleRoster(),
    listScholarRunsAction({ limit: 50 }),
  ]);

  const ledger: ScholarLedger | null = ledgerResult.ok ? ledgerResult.ledger : null;
  const ledgerError = ledgerResult.ok ? null : ledgerResult.message;

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Google Scholar" />
      <PageHeader
        eyebrow="Admin · Google Scholar"
        title="Scholar fetch console"
        subtitle={
          'Pull a staff member’s Google Scholar publication record on demand. ' +
          'Scholar papers are added to the research record; nothing already there is removed. ' +
          'Every page fetched from Google costs ScrapingBee credits, so a fetch is priced before it is sent.'
        }
      />
      <ScholarConsoleClient
        rows={roster.rows.map(toClientRow)}
        faculties={roster.faculties}
        departments={roster.departments}
        totals={roster.totals}
        maxTargets={scholarBulkMaxTargets()}
        initialLedger={ledger}
        ledgerError={ledgerError}
      />
    </AuthedAppShell>
  );
}

/**
 * Cross the server/client boundary: `Date` to ISO string, and the
 * machine-readable `needs-binding:` prefix off the error sentence and onto a
 * boolean.
 *
 * The prefix is stripped HERE rather than in the component so that
 * `SCHOLAR_NEEDS_BINDING` — which lives in `@kku/db`, and reaches Prisma
 * through the barrel — never has to be named in the browser bundle. The
 * ledger's server action does the same thing to the same field for the same
 * reason.
 */
function toClientRow(row: DbScholarConsoleRow): ScholarConsoleRow {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    staff: row.staff,
    profileBound: row.profileBound,
    scholarProfileId: row.scholarProfileId,
    scholarBoundAt: row.scholarBoundAt?.toISOString() ?? null,
    papersFromScholar: row.papersFromScholar,
    papersFromLibrary: row.papersFromLibrary,
    lastRun: row.lastRun ? toClientRun(row.lastRun) : null,
  };
}

function toClientRun(run: DbScholarConsoleRun): ScholarConsoleRun {
  const prefix = `${SCHOLAR_NEEDS_BINDING}:`;
  const raw = run.errorText ?? '';
  const needsBinding = raw.startsWith(prefix);
  const stripped = (needsBinding ? raw.slice(prefix.length) : raw).trim();
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    papersFound: run.papersFound,
    papersInserted: run.papersInserted,
    citationsUpdated: run.citationsUpdated,
    creditsUsed: run.creditsUsed,
    errorText: stripped.length > 0 ? stripped : null,
    needsBinding,
  };
}
