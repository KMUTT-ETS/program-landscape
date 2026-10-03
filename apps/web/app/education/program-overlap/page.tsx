import { redirect } from 'next/navigation';
import {
  canSeeProgramAwareDashboards,
  isUniversityWide,
  type ApiMeta,
  type SessionUser,
} from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchEnvelope, type ApiFetchError } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { EducationBackLink } from '../back-link';
import { ProgramOverlapClient, type FacultyOption } from './client';
import {
  DEFAULT_THRESHOLD,
  OVERLAP_LAYERS,
  OVERLAP_LEVELS,
  THRESHOLD_OPTIONS,
  type OverlapFilters,
  type OverlapMatrixResponse,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program overlap — Education' };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// apiFetchEnvelope throws a plain Error carrying only the envelope's error
// code; DiagnosticEmptyState wants a categorised ApiFetchError. Same mapping
// as /staff/grants.
function toFetchError(err: unknown): ApiFetchError {
  const code = (err as { code?: string }).code ?? null;
  const e = new Error((err as Error).message) as ApiFetchError;
  e.status = null;
  e.code = code;
  e.category =
    code === 'UNAUTHORIZED'
      ? 'auth'
      : code === 'FORBIDDEN'
        ? 'permission'
        : code === 'NOT_FOUND'
          ? 'notFound'
          : err instanceof TypeError
            ? 'network'
            : 'unknown';
  return e;
}

// /education/program-overlap — program-overlap.v1 overlap network + ranked
// pair list (spec §10.1). Faculty-grain and not program-aware: the API guards it like
// /education/recruitment (assertCanSeeFacultyDashboards + faculty clamp); a
// PROGRAM_USER lands on their programme's faculty.
export default async function ProgramOverlapPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const role = user.effectiveRole ?? user.role;
  if (!canSeeProgramAwareDashboards(role)) redirect('/no-access');

  const sp = await searchParams;
  const levelRaw = one(sp.level);
  const layerRaw = one(sp.layer);
  const thresholdRaw = Number(one(sp.threshold));
  const filters: OverlapFilters = {
    level: OVERLAP_LEVELS.find((l) => l.value === levelRaw)?.value ?? 'BACHELOR',
    layer: OVERLAP_LAYERS.find((l) => l.value === layerRaw)?.value ?? 'index',
    facultyId: one(sp.facultyId) || null,
    threshold: THRESHOLD_OPTIONS.find((t) => t === thresholdRaw) ?? DEFAULT_THRESHOLD,
    node: one(sp.node) || null,
    pair: one(sp.pair) || null,
  };

  // The measure (layer) is applied client-side: every cell carries all of
  // them, so the API takes no layer.
  const qs = new URLSearchParams({ level: filters.level });
  if (filters.facultyId) qs.set('facultyId', filters.facultyId);

  let data: OverlapMatrixResponse | null = null;
  let meta: ApiMeta | null = null;
  let error: ApiFetchError | null = null;
  try {
    const env = await apiFetchEnvelope<OverlapMatrixResponse>(`/education/program-overlap?${qs}`);
    data = env.data;
    meta = env.meta;
  } catch (e) {
    error = toFetchError(e);
  }

  // Scoped users are clamped to their faculty server-side, so only
  // university-wide roles get a faculty picker.
  const canPickFaculty = isUniversityWide(role);
  const faculties: FacultyOption[] = canPickFaculty
    ? await apiFetch<Array<{ id: string; code: string; nameEn: string | null; nameTh: string }>>(
        '/faculties?hasPrograms=true',
      )
        .then((rows) => rows.map((f) => ({ id: f.id, label: f.nameEn ?? f.nameTh, code: f.code })))
        .catch((): FacultyOption[] => [])
    : [];

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Program overlap"
        subtitle="Same-level programmes compared on their major courses — courses shared by code and equivalent course content. The network shows only programmes that overlap; the list ranks the pairs. PLO alignment and market similarity are context in each pair's evidence. Every suggested action is for review, not a decision."
      />
      {data && meta ? (
        <ProgramOverlapClient
          data={data}
          meta={meta}
          filters={filters}
          faculties={faculties}
          canPickFaculty={canPickFaculty}
          emptyState={
            data.runId === null ? (
              <DiagnosticEmptyState
                surface="program overlap"
                error={null}
                emptyMessage="No overlap analysis has run yet. Run pnpm programs:overlap --apply."
              />
            ) : null
          }
        />
      ) : (
        <DiagnosticEmptyState surface="program overlap" error={error} />
      )}
    </AuthedAppShell>
  );
}
