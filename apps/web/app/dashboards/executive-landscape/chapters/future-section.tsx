import { ChartFrame, ScoreGrid, type ScoreGridRow } from '@kku/ui';
import type { FutureChapter, ScorecardNode } from '@kku/db';
import { fetchChapter } from './fetch-chapter';
import { ChapterHeader, ChapterUnavailable } from './chapter-header';
import { AtlasTable } from './atlas-table';

const HEAD = {
  id: 'future',
  number: 5,
  kicker: 'Future',
  question: "Is the portfolio ready for AI and Thailand's strategic industries?",
};

const KIND_LABEL: Record<ScorecardNode['kind'], string> = {
  faculty: 'Faculty',
  level: 'Level',
  programme: 'Programme',
  total: 'Total',
};

const trailing = (n: ScorecardNode) => (n.mean === null ? '—' : `${n.mean.toFixed(0)} (${n.present}/3)`);

function toGridRow(n: ScorecardNode): ScoreGridRow {
  return {
    id: n.id,
    label: n.label,
    sublabel: n.sublabel,
    cells: n.cells,
    trailing: trailing(n),
    href: n.href,
    children: n.children.length ? n.children.map(toGridRow) : undefined,
  };
}

/** Every node, depth-first; a level row carries its faculty's name so the flat table reads on its own. */
function flatten(nodes: ScorecardNode[], parent?: ScorecardNode): Array<{ node: ScorecardNode; label: string }> {
  return nodes.flatMap((n) => [
    { node: n, label: n.kind === 'level' && parent ? `${parent.sublabel || parent.label} › ${n.label}` : n.label },
    ...flatten(n.children, n),
  ]);
}

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
        description="Faculties sorted by the mean of the measures available. Open a faculty for its degree levels, and a level for its programmes; a programme name opens its deep-dive. AI readiness and relevance on every row are means over the programmes beneath it. DQ exists for bachelor students only: a programme shows its own score, a faculty and its Bachelor row show the faculty's respondent-weighted score, other levels have none. The last row averages every programme in scope. A dash means no data, never 0."
        meta={meta}
        height={640}
        chart={
          <div className="flex h-full flex-col">
            <ScoreGrid
              className="min-h-0 flex-1 overflow-y-auto"
              columns={sc.columns}
              mode="score"
              trailingLabel="Mean"
              rows={sc.rows.map(toGridRow)}
              total={{ ...toGridRow(sc.total), children: undefined }}
            />
            {sc.note && <p className="mt-2 shrink-0 text-xs text-text-tertiary">{sc.note}</p>}
          </div>
        }
        dataTable={
          <AtlasTable
            first="Row"
            rows={[...flatten(sc.rows), { node: sc.total, label: sc.total.label }].map(({ node: n, label }) => ({
              id: `${n.kind}:${n.id}`,
              label,
              values: {
                Kind: KIND_LABEL[n.kind],
                'AI readiness': n.cells[0] ?? null,
                'DQ score': n.cells[1] ?? null,
                'DQ scored students': n.dqStudents,
                Relevance: n.cells[2] ?? null,
                Mean: n.mean,
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
