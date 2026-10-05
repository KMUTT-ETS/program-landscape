import Link from 'next/link';
import type { Route } from 'next';
import { ChartFrame } from '@kku/ui';
import { buildMarket, type GapMapResult } from '@kku/db';
import { fetchChapter } from './fetch-chapter';
import { ChapterHeader, ChapterUnavailable, UnplottedList } from './chapter-header';
import { AtlasBubble } from './atlas-bubble';
import { AtlasTable } from './atlas-table';

const HEAD = { id: 'market', number: 3, kicker: 'Market', question: 'Are we producing graduates where the jobs are?' };
export const MARKET_BASES = ['all', 'private', 'public'] as const;
export type MarketBasis = (typeof MARKET_BASES)[number];

export async function MarketSection({ scopeQuery, basis }: { scopeQuery: string; basis: MarketBasis }) {
  if (scopeQuery.includes('scope=program')) {
    return (
      <section className="flex flex-col gap-4">
        <ChapterHeader {...HEAD} answer={null} />
        <ChapterUnavailable message="The market map compares fields of study across faculties; it has no single-programme view." />
      </section>
    );
  }
  const res = await fetchChapter<GapMapResult>(`/gap/map?${scopeQuery}&basis=${basis}`);
  if (!res) {
    return (
      <section className="flex flex-col gap-4">
        <ChapterHeader {...HEAD} answer={null} />
        <ChapterUnavailable />
      </section>
    );
  }
  const market = buildMarket(res.data.rows);
  return (
    <section className="flex flex-col gap-4">
      <ChapterHeader {...HEAD} answer={market.answer} />
      <nav aria-label="Demand basis" className="flex gap-2 text-xs">
        {MARKET_BASES.map((b) => (
          <Link
            key={b}
            href={`?basis=${b}#market` as Route}
            aria-current={b === basis ? 'true' : undefined}
            className={b === basis ? 'rounded-md bg-surface-2 px-2 py-1 font-semibold text-text-primary' : 'rounded-md px-2 py-1 text-text-secondary hover:bg-surface-2'}
          >
            {b === 'all' ? 'All adverts' : b === 'private' ? 'Private (JobThai)' : 'Public (job-108)'}
          </Link>
        ))}
      </nav>
      <ChartFrame
        title="Demand vs supply by field of study"
        description="One dot per field (bachelor). X = KKU's share of graduates, Y = share of job adverts, both log. On the diagonal, demand and supply are in balance; above it, under-served. White-space fields (no KKU programme), and fields whose KKU programmes have no graduates yet, sit on the left edge. Size = adverts."
        meta={res.meta}
        height={520}
        chart={<AtlasBubble points={market.points} frame={market.frame} axisXLabel="KKU graduate share" axisYLabel="Job-advert share" width={1120} height={440} />}
        dataTable={<AtlasTable rows={market.points} first="Field" />}
      />
      <UnplottedList items={market.unplotted} noun="fields" />
    </section>
  );
}
