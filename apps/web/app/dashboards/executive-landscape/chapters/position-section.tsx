import { ChartFrame } from '@kku/ui';
import type { PositionChapter } from '@kku/db';
import { fetchChapter } from './fetch-chapter';
import { ChapterHeader, ChapterUnavailable, UnplottedList } from './chapter-header';
import { AtlasBubble } from './atlas-bubble';
import { AtlasTable } from './atlas-table';

const HEAD = {
  id: 'position',
  number: 2,
  kicker: 'Position (bachelor programmes)',
  question: 'Which programmes do we grow, keep, fix or exit?',
};

export async function PositionSection({ scopeQuery, children }: { scopeQuery: string; children: React.ReactNode }) {
  const res = await fetchChapter<PositionChapter>(`/landscape/position?${scopeQuery}`);
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
  const gs = data.growthShare;
  const hr = data.healthRisk;
  return (
    <section className="flex flex-col gap-4">
      <ChapterHeader {...HEAD} answer={data.answer} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <ChartFrame
            title="Growth–share matrix"
            description={`X = TCAS round-3 applications per seat, latest entry year (log; split at 1.0). Y = 3-year enrolment change (split at 0%). Size = active students; colour = net contribution per student. Stars ${gs.counts.star} · Cash cows ${gs.counts['cash-cow']} · Questions ${gs.counts.question} · Dogs ${gs.counts.dog}.`}
            meta={meta}
            height={500}
            chart={
              <AtlasBubble
                points={gs.points}
                maxRadius={16}
                frame={gs.frame}
                axisXLabel="Applications per seat"
                axisYLabel="Enrolment change, 3 yr"
                quadrantLabels={{
                  topRight: { label: 'STAR', tone: 'positive' },
                  bottomRight: { label: 'CASH COW', tone: 'neutral' },
                  topLeft: { label: 'QUESTION', tone: 'neutral' },
                  bottomLeft: { label: 'DOG', tone: 'negative' },
                }}
              />
            }
            dataTable={<AtlasTable rows={gs.points} />}
          />
          <UnplottedList items={gs.unplotted} />
        </div>
        <div className="flex flex-col gap-2">
          <ChartFrame
            title="Health × risk action map"
            description={`X = health score (split at 65, "healthy"). Y = KKU risk matrix score 1–25 (split at 10, start of HIGH). Size = active students; colour = risk level. Act now ${hr.counts['act-now']} · Watch ${hr.counts.watch} · Fix quietly ${hr.counts['fix-quietly']} · Protect ${hr.counts.protect}.`}
            meta={meta}
            height={500}
            chart={
              <AtlasBubble
                points={hr.points}
                maxRadius={16}
                frame={hr.frame}
                axisXLabel="Health score"
                axisYLabel="KKU risk score"
                quadrantLabels={{
                  topLeft: { label: 'ACT NOW', tone: 'negative' },
                  topRight: { label: 'WATCH', tone: 'neutral' },
                  bottomLeft: { label: 'FIX QUIETLY', tone: 'neutral' },
                  bottomRight: { label: 'PROTECT', tone: 'positive' },
                }}
              />
            }
            dataTable={<AtlasTable rows={hr.points} />}
          />
          <UnplottedList items={hr.unplotted} />
        </div>
      </div>
      {children}
    </section>
  );
}
