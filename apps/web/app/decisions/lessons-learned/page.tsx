import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, PageHeader } from '@kku/ui';
import Link from 'next/link';
import type { LessonHit } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lessons Learned' };

export default async function LessonsLearnedPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.topic) qs.set('topic', sp.topic);

  const hits = await apiFetch<LessonHit[]>(`/decisions/lessons-learned?${qs}`).catch(
    () => [] as LessonHit[],
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Lessons Learned"
        subtitle="Patterns distilled from post-decision outcome reviews — institutional memory for future scenarios."
      />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/decisions"
            className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2"
          >
            ← Back to decisions
          </Link>
        </div>

        <Card padding="sm">
          <form action="/decisions/lessons-learned" className="flex items-center gap-2">
            <input
              type="search"
              name="topic"
              defaultValue={sp.topic ?? ''}
              placeholder="Search lessons (e.g. synergy, enrollment, merger)"
              className="flex-1 rounded-md border border-default bg-surface-1 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-accent-default px-3 py-2 text-xs font-medium text-accent-fg"
            >
              Search
            </button>
          </form>
        </Card>

        {hits.length === 0 ? (
          <Card padding="lg">
            <p className="text-center text-sm text-text-tertiary">
              No lessons match this search yet. Lessons accumulate as decisions are reviewed 6 months / 1 year / 3 years after their effective date.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {hits.map((h) => (
              <Card key={`${h.decisionId}-${h.horizon}`} padding="md">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{h.horizon.replace('_', ' ')}</Badge>
                  <Badge tone="outline">{h.decisionType}</Badge>
                  <span className="text-xs text-text-tertiary">
                    {new Date(h.generatedAt).toLocaleDateString('en-GB')}
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-text-primary">
                  <Link href={`/decisions/${h.decisionId}`} className="hover:underline">
                    {h.decisionTitle}
                  </Link>
                </h3>
                {h.lessonsTh.length > 0 ? (
                  <ul className="mt-2 ml-4 list-disc space-y-1 text-sm text-text-secondary">
                    {h.lessonsTh.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </AuthedAppShell>
  );
}
