import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader, Section } from '@kku/ui';
import { TrendsClient } from '../../client';
import type { TrendsFeedResponse } from '../../types';

export const dynamic = 'force-dynamic';

// Region-preset pages. The real region-tagging needs TrendSignal.tags
// (prompt 14). Until then, each region page applies a keyword search
// that's *close* to the intended slice.

const REGION_PRESETS: Record<string, { label: string; keyword: string; note: string }> = {
  global: { label: 'Global', keyword: '', note: 'All signals' },
  thailand: { label: 'Thailand', keyword: 'Thai', note: 'Thailand-specific signals' },
  northeast: {
    label: 'Northeast Thailand',
    keyword: 'Northeast',
    note: 'KKU\'s differentiator region — Isaan, Khon Kaen, Mekong-basin tilt',
  },
  mekong: {
    label: 'Greater Mekong Subregion',
    keyword: 'Mekong',
    note: 'Laos / Myanmar / Cambodia / Thailand regional',
  },
};

export default async function RegionTrendsPage({
  params,
}: {
  params: Promise<{ region: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const { region } = await params;
  const preset = REGION_PRESETS[region] ?? REGION_PRESETS.global;
  const qs = new URLSearchParams();
  if (preset?.keyword) qs.set('search', preset.keyword);
  qs.set('windowDays', '365');
  qs.set('limit', '50');

  const feed = await apiFetch<TrendsFeedResponse>(`/trends?${qs}`).catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={`Regional trends · ${preset?.label ?? region}`}
        subtitle={preset?.note ?? 'Region-scoped trend board.'}
      />
      {feed ? (
        <TrendsClient
          feed={feed}
          initialFilters={{
            signalType: '',
            windowDays: '365',
            minImpactScore: '0',
            search: preset?.keyword ?? '',
          }}
        />
      ) : (
        <Section title="Unavailable">
          <Card>
            <p className="text-sm text-text-tertiary">Regional trends feed unavailable.</p>
          </Card>
        </Section>
      )}
    </AuthedAppShell>
  );
}
