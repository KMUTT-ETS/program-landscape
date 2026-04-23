import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Button, ConfidenceBadge, PageHeader } from '@kku/ui';
import { ArrowLeft } from 'lucide-react';
import { ReviewClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Extraction — Review' };

export interface AiExtractionDetail {
  id: string;
  sourceEntityType: string;
  sourceEntityId: string;
  extractionKind: string;
  payloadJson: unknown;
  confidence: number;
  methodVersion: string;
  reviewStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
  reasoning: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  aiInference: {
    id: string;
    module: string;
    kind: string | null;
    model: string;
    prompt: string;
    response: string;
    tokensInput: number | null;
    tokensOutput: number | null;
    latencyMs: number | null;
    costEstimateUsd: number | null;
  } | null;
  reviewedBy: { id: string; name: string | null; email: string } | null;
}

export default async function AdminAiExtractionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const { id } = await params;
  const extraction = await apiFetch<AiExtractionDetail | null>(`/ai/extractions/${id}`).catch(
    () => null,
  );
  if (!extraction) notFound();

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={extraction.extractionKind}
        subtitle={`${extraction.sourceEntityType} · ${extraction.sourceEntityId} · ${extraction.methodVersion}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/extraction-review">
                <ArrowLeft className="h-4 w-4" />
                Back to queue
              </Link>
            </Button>
            <ConfidenceBadge value={extraction.confidence} />
            <Badge tone={statusTone(extraction.reviewStatus)}>{extraction.reviewStatus}</Badge>
          </div>
        }
      />
      <ReviewClient extraction={extraction} />
    </AuthedAppShell>
  );
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'APPROVED' || status === 'AUTO_APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING_REVIEW') return 'warning';
  return 'neutral';
}
