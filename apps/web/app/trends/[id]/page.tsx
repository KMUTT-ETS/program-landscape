import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Button, Card, PageHeader, Section } from '@kku/ui';
import { ArrowLeft } from 'lucide-react';
import { MarkReviewedButton } from './mark-reviewed';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trend Signal' };

interface TrendDetail {
  signal: {
    id: string;
    title: string;
    signalType: string;
    summaryTh: string | null;
    summaryEn: string | null;
    sourceUrl: string | null;
    detectedDate: string;
    impactScore: number;
    affectedProgramIds: string[];
    affectedSkillIds: string[];
    aiInferenceId: string | null;
  };
  aiInference: {
    id: string;
    model: string;
    prompt: string;
    response: string;
    confidence: number | null;
    latencyMs: number | null;
  } | null;
  programs: Array<{ id: string; code: string; nameEn: string; nameTh: string }>;
  skills: Array<{ id: string; nameEn: string; nameTh: string }>;
  annotations: Array<{
    id: string;
    kind: string;
    bodyEn: string | null;
    bodyTh: string | null;
    author: string;
    createdAt: string;
  }>;
}

export default async function TrendSignalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const { id } = await params;

  const detail = await apiFetch<TrendDetail | null>(`/trends/${id}`).catch(() => null);
  if (!detail) notFound();

  const s = detail.signal;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={s.title}
        subtitle={`${s.signalType} · detected ${new Date(s.detectedDate).toLocaleDateString()} · impact ${Math.round(s.impactScore * 100)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/trends">
                <ArrowLeft className="h-4 w-4" />
                Back to feed
              </Link>
            </Button>
            <MarkReviewedButton signalId={id} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3">
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Summary</h3>
            {s.summaryTh && (
              <p className="text-sm leading-relaxed" lang="th">
                {s.summaryTh}
              </p>
            )}
            {s.summaryEn && (
              <p className="mt-3 text-sm text-text-secondary">{s.summaryEn}</p>
            )}
            {s.sourceUrl && (
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs text-accent underline"
              >
                Source ↗
              </a>
            )}
          </Card>

          {detail.aiInference && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold">AI analysis</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-text-tertiary">Model</dt>
                <dd className="font-mono">{detail.aiInference.model}</dd>
                <dt className="text-text-tertiary">Confidence</dt>
                <dd className="font-tabular">
                  {detail.aiInference.confidence !== null
                    ? detail.aiInference.confidence.toFixed(2)
                    : '—'}
                </dd>
                <dt className="text-text-tertiary">Latency</dt>
                <dd className="font-tabular">
                  {detail.aiInference.latencyMs
                    ? `${(detail.aiInference.latencyMs / 1000).toFixed(2)}s`
                    : '—'}
                </dd>
              </dl>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-accent">
                  Show reasoning
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded border border-border-default bg-surface-0 p-2 text-xs">
                  {detail.aiInference.response}
                </pre>
              </details>
            </Card>
          )}

          {detail.annotations.length > 0 && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold">
                Annotations ({detail.annotations.length})
              </h3>
              <ul className="flex flex-col gap-2 text-sm">
                {detail.annotations.map((a) => (
                  <li key={a.id} className="border-b border-border-subtle pb-2 last:border-0">
                    <div className="text-xs text-text-tertiary">
                      {a.kind} · {a.author} · {new Date(a.createdAt).toLocaleString()}
                    </div>
                    {a.bodyEn && <div className="mt-1">{a.bodyEn}</div>}
                    {a.bodyTh && (
                      <div className="mt-1" lang="th">
                        {a.bodyTh}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Card>
            <h4 className="mb-2 text-sm font-semibold">
              Affected programs ({detail.programs.length})
            </h4>
            {detail.programs.length === 0 ? (
              <p className="text-sm text-text-tertiary">None directly linked.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {detail.programs.map((p) => (
                  <li key={p.id}>
                    <Link href={`/programs/${p.id}`} className="text-accent underline">
                      {p.code} · {p.nameEn}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h4 className="mb-2 text-sm font-semibold">
              Affected skills ({detail.skills.length})
            </h4>
            {detail.skills.length === 0 ? (
              <p className="text-sm text-text-tertiary">No skill links yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {detail.skills.map((sk) => (
                  <li key={sk.id}>
                    <Link href="/skills" className="text-accent underline">
                      {sk.nameEn}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h4 className="mb-2 text-sm font-semibold">Actions</h4>
            <ul className="flex flex-col gap-2 text-sm">
              <li>
                <Badge tone="neutral">
                  "Add to scenario" lands with Scenario Planner (prompt 09)
                </Badge>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <Section title="Related">
        <p className="text-sm text-text-tertiary">
          Related-signal suggestion (vector similarity over titles + summaries) lands with the
          Benchmarking module's similarity infra (prompt 10). Until then, filter the main feed by
          signalType + date window.
        </p>
      </Section>
    </AuthedAppShell>
  );
}
