import { ChartFrame, PortfolioTreemap, type TreemapGroup } from '@kku/ui';
import { round1, type ShapeChapter } from '@kku/db';
import { HEALTH_DANGER_BELOW, HEALTH_HEALTHY_FROM } from '@kku/shared/health/zones';
import { fetchChapter } from './fetch-chapter';
import { ChapterHeader, ChapterUnavailable, UnplottedList } from './chapter-header';
import { AtlasTable } from './atlas-table';

const HEAD = { id: 'shape', number: 1, kicker: 'Shape', question: 'What do we have, and where is it concentrated?' };

export async function ShapeSection({ scopeQuery, children }: { scopeQuery: string; children: React.ReactNode }) {
  const res = await fetchChapter<ShapeChapter>(`/landscape/shape?${scopeQuery}`);
  if (!res) {
    return (
      <section className="flex flex-col gap-4">
        <ChapterHeader {...HEAD} answer={null} />
        <ChapterUnavailable />
        {children}
      </section>
    );
  }
  const { data, meta } = res;
  const nodes: TreemapGroup[] = data.faculties.map((f) => ({
    id: f.id,
    label: f.label,
    sublabel: f.sublabel,
    value: f.value,
    children: f.children.map((c) => ({
      id: c.id,
      label: c.label,
      sublabel: c.sublabel,
      value: c.value,
      tone: c.tone,
      href: c.href,
      hatched: c.health === null,
    })),
  }));
  return (
    <section className="flex flex-col gap-4">
      <ChapterHeader {...HEAD} answer={data.answer} />
      <ChartFrame
        title="Portfolio treemap"
        description={`Faculty → programme. Area = currently active students; colour = health score (< ${HEALTH_DANGER_BELOW} danger, ${HEALTH_DANGER_BELOW}–${HEALTH_HEALTHY_FROM} needs attention, ≥ ${HEALTH_HEALTHY_FROM} healthy; hatched = no score). Click a faculty to zoom in, a programme to open its Deep-Dive.`}
        meta={meta}
        height={470}
        chart={<PortfolioTreemap nodes={nodes} height={420} unit="active students" emptyLabel="No programme in this scope has active-student data." />}
        dataTable={
          <AtlasTable
            rows={data.faculties.flatMap((f) =>
              f.children.map((c) => ({
                id: c.id,
                label: c.label,
                values: { Faculty: f.sublabel || f.label, Code: c.sublabel, 'Active students': c.value, 'Health score': c.health === null ? null : round1(c.health) },
              })),
            )}
          />
        }
      />
      <UnplottedList items={data.unplotted} />
      {children}
    </section>
  );
}
