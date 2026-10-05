import { ChartFrame, RadarChartSmall, ScoreGrid } from '@kku/ui';
import type { FutureChapter } from '@kku/db';
import { fetchChapter } from './fetch-chapter';
import { ChapterHeader, ChapterUnavailable } from './chapter-header';
import { AtlasTable } from './atlas-table';

const HEAD = {
  id: 'future',
  number: 5,
  kicker: 'Future',
  question: "Is the portfolio ready for AI and Thailand's strategic industries?",
};

export async function FutureSection({ scopeQuery }: { scopeQuery: string }) {
  const res = await fetchChapter<FutureChapter>(`/landscape/future?${scopeQuery}`);
  if (!res) {
    return (
      <section className="flex flex-col gap-4">
        <ChapterHeader {...HEAD} answer={null} />
        <ChapterUnavailable />
      </section>
    );
  }
  const { data, meta } = res;
  const sc = data.scorecard;
  const cov = data.coverage;
  return (
    <section className="flex flex-col gap-4">
      <ChapterHeader {...HEAD} answer={data.answer} />
      <ChartFrame
        title="Future-fit scorecard"
        description="By faculty, sorted by the mean of the measures available. AI readiness and relevance are means over the faculty's programmes; DQ is the faculty's respondent-weighted score. A dash means no data, never 0. Open a row for its radar."
        meta={meta}
        height={560}
        chart={
          <div className="h-full overflow-y-auto">
            <ScoreGrid
              columns={sc.columns}
              mode="score"
              trailingLabel="Mean"
              rows={sc.rows.map((r) => ({
                id: r.id,
                label: r.label,
                sublabel: r.sublabel,
                cells: r.cells,
                trailing: r.mean === null ? '—' : `${r.mean.toFixed(0)} (${r.present}/3)`,
                detail: (
                  <RadarChartSmall
                    points={sc.columns.map((label, i) => ({ label, value: r.cells[i] ?? null }))}
                    seriesLabel={r.sublabel || r.label}
                  />
                ),
              }))}
            />
            {sc.note && <p className="mt-2 text-xs text-text-tertiary">{sc.note}</p>}
          </div>
        }
        dataTable={
          <AtlasTable
            first="Faculty"
            rows={sc.rows.map((r) => ({
              id: r.id,
              label: r.label,
              values: {
                'AI readiness': r.cells[0] ?? null,
                'DQ score': r.cells[1] ?? null,
                'DQ scored students': r.dqStudents,
                Relevance: r.cells[2] ?? null,
                Mean: r.mean,
              },
            }))}
          />
        }
      />
      <ChartFrame
        title="National-strategy coverage"
        description={`Faculties × Thailand's 8 strategic sectors (BCG + S-curve). Each cell = programmes whose taught skills feed the sector. "·" = not mapped, which is not the same as no capacity.${cov.unmappedSectors.length ? ` No programme maps to: ${cov.unmappedSectors.join(', ')}.` : ''}`}
        meta={meta}
        height={560}
        chart={
          <div className="h-full overflow-y-auto">
            <ScoreGrid
              columns={cov.columns.map((c) => `${c.label} (${c.total})`)}
              mode="count"
              rows={cov.rows}
            />
          </div>
        }
        dataTable={
          <AtlasTable
            first="Faculty"
            rows={cov.rows.map((r) => ({
              id: r.id,
              label: r.label,
              values: Object.fromEntries(cov.columns.map((c, i) => [c.label, r.cells[i] ?? null])),
            }))}
          />
        }
      />
    </section>
  );
}
