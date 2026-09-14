import { redirect } from 'next/navigation';
import { can, type SessionUser } from '@kku/shared';
import { prisma, RAW_RETENTION_DAYS, USAGE_WINDOWS } from '@kku/db';
import { PageHeader } from '@kku/ui';
import type { ApiMeta, ApiSuccess } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchEnvelope } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { UsageClient } from './client';
import { mergeCaveats, pageCaveats, resolveUsageParams } from './types';
import type {
  ActionUsageT,
  Enveloped,
  FacultyUsageT,
  ModuleUsageT,
  ProgramUsageT,
  RoleUsageT,
  UsageSummaryT,
  UserUsageT,
} from './types';

// ─────────────────────────────────────────────────────────────────────────
// /usage — who uses which parts of the platform.
//
// Two audiences, two permissions. The aggregates answer a leadership
// question and carry no names, so UNIVERSITY_USER holds
// `usage:read:aggregate` alongside the admin grades. The access log and the
// two drill-downs name individuals, so they need `usage:read:detail`, which
// only the admin grades have. Both checks go through `can()` — the same
// function the api's @Authorized uses, so the page cannot show a section the
// api would then refuse to fill.
//
// Every figure is computed at read time, so the api reports no
// `freshnessDate`; the page stamps its own render time instead, which is what
// the FreshnessBadge on the summary band shows.
// ─────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Platform usage — Program Landscape' };

export default async function UsagePage({
  searchParams,
}: {
  searchParams: { days?: string; excludeAdmins?: string; facultyId?: string; q?: string };
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!can(user, 'usage:read:aggregate')) redirect('/no-access');
  const canSeeDetail = can(user, 'usage:read:detail');

  // `detailDays` narrows for the two drill-down panels, which read raw
  // page_views and are refused past RAW_RETENTION_DAYS. `facultyId` and `q`
  // each narrow exactly one card — the by-programme list and the access log —
  // so every other figure stays whole-window and the filtered card can be read
  // against an unchanged baseline.
  const { days, excludeAdmins, detailDays, facultyId, q } = resolveUsageParams(
    searchParams,
    USAGE_WINDOWS,
    RAW_RETENTION_DAYS,
  );
  const qs = `days=${days}&excludeAdmins=${excludeAdmins}`;

  // The drawer's caveats depend on the controls above, so they are built here
  // rather than held as a module constant — see `pageCaveats`.
  const caveats = pageCaveats({ rawRetentionDays: RAW_RETENTION_DAYS, excludeAdmins });
  const withPageCaveats = (meta: ApiMeta): ApiMeta => ({
    ...meta,
    caveats: mergeCaveats(meta.caveats ?? [], caveats),
  });

  // One failed section must not blank the page — each falls back to null and
  // renders its own "unavailable" line. `apiFetchEnvelope` THROWS on an error
  // envelope, so the catch is the whole failure path; anything it returns is
  // the success arm of the union, which is what the assertion says — testing
  // `envelope.error` here would be a branch that can never be taken.
  const get = async <T,>(path: string): Promise<Enveloped<T> | null> => {
    try {
      const envelope = (await apiFetchEnvelope<T>(path)) as ApiSuccess<T>;
      return { data: envelope.data, meta: withPageCaveats(envelope.meta) };
    } catch {
      return null;
    }
  };

  const [summary, modules, programs, roles, faculties, actions, users, facultyOptions] =
    await Promise.all([
      get<UsageSummaryT>(`/usage/summary?${qs}`),
      get<ModuleUsageT[]>(`/usage/modules?${qs}`),
      get<ProgramUsageT[]>(
        `/usage/programs?${qs}${facultyId ? `&facultyId=${encodeURIComponent(facultyId)}` : ''}`,
      ),
      get<RoleUsageT[]>(`/usage/roles?${qs}`),
      get<FacultyUsageT[]>(`/usage/faculties?${qs}`),
      get<ActionUsageT[]>(`/usage/actions?${qs}`),
      canSeeDetail
        ? get<UserUsageT[]>(`/usage/users?${qs}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
        : Promise.resolve(null),
      // Read straight from the catalogue rather than through the api: the
      // filter's options are not a usage figure, and /usage has no endpoint
      // that lists faculties. Same source as /admin/users' faculty picker.
      prisma.faculty.findMany({
        where: { kind: 'ACADEMIC' },
        select: { id: true, nameEn: true, nameTh: true },
        orderBy: { nameEn: 'asc' },
      }),
    ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Platform usage"
        subtitle={
          canSeeDetail
            ? 'Who opens which parts of the platform. Aggregates for leadership; the per-person access log is admin-only.'
            : 'Who opens which parts of the platform. Aggregate counts only — no individual is named on this page.'
        }
      />
      <UsageClient
        data={{
          days,
          excludeAdmins,
          facultyId,
          q,
          facultyOptions,
          canSeeDetail,
          detailDays,
          computedAt: new Date().toISOString(),
          summary,
          modules,
          programs,
          roles,
          faculties,
          actions,
          users,
        }}
      />
    </AuthedAppShell>
  );
}
