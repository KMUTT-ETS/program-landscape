import { ChartFrame } from '@kku/ui';
import type { CapabilityChapter } from '@kku/db';
import { fetchChapter } from './fetch-chapter';
import { ChapterHeader, ChapterUnavailable, UnplottedList } from './chapter-header';
import { AtlasBubble } from './atlas-bubble';
import { AtlasTable } from './atlas-table';

const HEAD = { id: 'capability', number: 4, kicker: 'Capability', question: 'Which faculties earn and publish beyond teaching?' };

export async function CapabilitySection({ scopeQuery }: { scopeQuery: string }) {
  const res = await fetchChapter<CapabilityChapter>(`/landscape/capability?${scopeQuery}`);
  if (!res) {
    return (
      <section className="flex flex-col gap-4">
        <ChapterHeader {...HEAD} answer={null} />
        <ChapterUnavailable />
      </section>
    );
  }
  const { data, meta } = res;
  return (
    <section className="flex flex-col gap-4">
      <ChapterHeader {...HEAD} answer={data.answer} />
      <ChartFrame
        title="Research & grant engine"
        description="By faculty. X = publications per active teaching staff member per year (last 3 complete years). Y = external grant baht per staff member per year (last 3 complete Thai fiscal years, log). Size = active teaching staff. Dashed lines = KKU medians."
        meta={meta}
        height={520}
        chart={<AtlasBubble points={data.points} frame={data.frame} axisXLabel="Publications per staff per year" axisYLabel="Grant ฿ per staff per year" width={1120} height={440} />}
        dataTable={<AtlasTable rows={data.points} first="Faculty" />}
      />
      <UnplottedList items={data.unplotted} noun="faculties" />
    </section>
  );
}
