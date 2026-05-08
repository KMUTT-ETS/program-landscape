import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { RisksPortfolioClient } from './portfolio-client';
import type { PortfolioResponse } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Risk Management' };

export default async function RisksPage({
  searchParams,
}: {
  searchParams: Promise<{ erm?: string; faculty?: string; l?: string; i?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  // Always fetch all rows — filtering happens client-side now so the
  // ERM-level filter (`?erm=HIGH`) and the cell filter (`?l=4&i=3`) can
  // both narrow the same dataset without round-tripping. Faculty stays
  // server-side because it's a DB-level filter (cheaper than fetching
  // all 297 program rows when only 1 faculty is needed).
  const qs = new URLSearchParams({ level: 'BACHELOR' });
  if (sp.faculty) qs.set('facultyId', sp.faculty);

  const portfolio = await apiFetch<PortfolioResponse>(`/risks/portfolio?${qs}`).catch(() => null);

  // Parse L × I cell filter — bounded to 1..5; ignores invalid values.
  const lParsed = sp.l ? Number.parseInt(sp.l, 10) : null;
  const iParsed = sp.i ? Number.parseInt(sp.i, 10) : null;
  const cellL = lParsed != null && lParsed >= 1 && lParsed <= 5 ? lParsed : null;
  const cellI = iParsed != null && iParsed >= 1 && iParsed <= 5 ? iParsed : null;

  // Validate ERM filter against the enum.
  const validErm: Array<'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'> = [
    'NEEDS_DATA',
    'LOW',
    'MODERATE',
    'HIGH',
    'VERY_HIGH',
  ];
  const ermFilter = sp.erm && (validErm as string[]).includes(sp.erm)
    ? (sp.erm as 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH')
    : null;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Risk Management"
        subtitle="Likelihood × impact scoring of every undergraduate program. Driven by recruitment data, AI-disruption exposure, and the demographic ceiling. Recommendations are program-specific, not categories."
      />
      {portfolio ? (
        <RisksPortfolioClient
          portfolio={portfolio}
          initialFilters={{
            erm: ermFilter,
            faculty: sp.faculty ?? '',
            cellL,
            cellI,
          }}
        />
      ) : (
        <div className="rounded-md border border-border-default bg-surface-1 p-8 text-center text-text-secondary">
          ไม่สามารถโหลดข้อมูลความเสี่ยงได้ — โปรดตรวจสอบสิทธิ์การเข้าถึง หรือเรียกใช้ <code>pnpm risks:assess --all --no-ai</code> เพื่อสร้างข้อมูลแรก
        </div>
      )}
    </AuthedAppShell>
  );
}
