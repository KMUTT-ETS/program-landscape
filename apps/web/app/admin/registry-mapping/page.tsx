import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { RegistryMappingClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Registry mapping triage' };

interface UnmatchedResponse {
  totalUnmatched: number;
  fixtureSize: number;
  fixtureLoaded: boolean;
  programs: Array<{
    programId: string;
    code: string;
    nameTh: string;
    nameEn: string;
    level: string;
    levelTh: string;
    majors: string[];
    sequenceNoFromSheet: number | null;
    faculty: { id: string; nameTh: string; nameEn: string };
    candidates: Array<{
      facultyName: string;
      programName: string;
      level: string | null;
      major: string | null;
      score: number;
      facultyMatchesProgramFaculty: boolean;
      currentlyMappedTo: {
        programId: string;
        programCode: string;
        programNameTh: string;
      } | null;
    }>;
  }>;
}

export default async function RegistryMappingPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const dataRes = await apiFetchSafe<UnmatchedResponse>('/admin/registry-mapping/unmatched');

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Registry mapping triage"
        subtitle="Programs that the auto-seed couldn't pair with a kku-registry tuple. Each pairing creates one RegistryProgramMapping row, which lets the kku-finance + kku-registry connectors compute tuition revenue + enrolment for that program."
      />
      {dataRes.ok ? (
        <RegistryMappingClient
          totalUnmatched={dataRes.data.totalUnmatched}
          fixtureSize={dataRes.data.fixtureSize}
          fixtureLoaded={dataRes.data.fixtureLoaded}
          initialPrograms={dataRes.data.programs}
        />
      ) : (
        <DiagnosticEmptyState surface="registry mapping triage" error={dataRes.error} />
      )}
    </AuthedAppShell>
  );
}
