import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
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

  const data = await apiFetch<UnmatchedResponse>('/admin/registry-mapping/unmatched').catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Registry mapping triage"
        subtitle="Programs that the auto-seed couldn't pair with a kku-registry tuple. Each pairing creates one RegistryProgramMapping row, which lets the kku-finance + kku-registry connectors compute tuition revenue + enrolment for that program."
      />
      {data ? (
        <RegistryMappingClient
          totalUnmatched={data.totalUnmatched}
          fixtureSize={data.fixtureSize}
          fixtureLoaded={data.fixtureLoaded}
          initialPrograms={data.programs}
        />
      ) : (
        <div className="rounded-md border border-border-default bg-surface-1 p-6 text-text-secondary">
          Unable to load unmatched-program data. Check that <code className="font-mono">data_sources:configure</code>{' '}
          permission is granted on your role.
        </div>
      )}
    </AuthedAppShell>
  );
}
