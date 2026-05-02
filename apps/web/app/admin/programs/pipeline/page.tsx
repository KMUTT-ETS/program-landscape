import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader, Section } from '@kku/ui';
import { PipelineClient, type PipelineStats } from './client';

// Curriculum-pipeline control surface. The list at /admin/programs has
// search + per-program detail; this page is the operational dashboard:
// what's missing a PDF, what needs digesting, what's pending review.
// Bulk-run + bulk-approve drive the program-digest.v1 pipeline.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Curriculum pipeline — Admin' };

export default async function CurriculumPipelinePage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const stats = await apiFetch<PipelineStats>('/admin/programs/pipeline/stats').catch(
    () =>
      ({
        programsTotal: 0,
        withPdf: 0,
        missingPdf: 0,
        digested: 0,
        needDigest: 0,
        pendingReview: 0,
        approved: 0,
      }) satisfies PipelineStats,
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Programs"
        title="Curriculum pipeline"
        subtitle="Drive the analyse-the-landscape workflow: link curriculum PDFs, run program-digest.v1, approve digests so they materialise into ProgramSkill rows + recruitment summaries."
      />
      <Section>
        <PipelineClient initialStats={stats} />
      </Section>
    </AuthedAppShell>
  );
}
