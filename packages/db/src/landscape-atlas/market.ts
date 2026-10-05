// packages/db/src/landscape-atlas/market.ts
// Pure: the Market chapter reuses GET /gap/map (scoped, cached, provenance
// already done) and only reshapes its rows for the diagonal.
import type { GapMapRow } from '../gap-map';
import { GAP_VERDICTS, type GapVerdict } from '../gap-map-rules';
import { logPos, logTicks, pctLabel } from './scales';
import { LANDSCAPE_ATLAS_VERSION, NO_ANSWER, type AtlasPoint, type ChapterAnswer, type PlotFrame, type Tone, type Unplotted } from './types';

export type MarketRowInput = Pick<GapMapRow, 'slug' | 'nameTh' | 'nameEn' | 'postings' | 'demandShare' | 'supplyShare' | 'verdict'>;

type PlottedVerdict = 'white-space' | 'under-served' | 'served' | 'over-served';

const TONE: Record<PlottedVerdict, Tone> = {
  'white-space': 'negative',
  'under-served': 'warning',
  served: 'positive',
  'over-served': 'neutral',
};

export interface MarketChapter {
  version: typeof LANDSCAPE_ATLAS_VERSION;
  points: Array<AtlasPoint & { verdict: PlottedVerdict; onRail: boolean }>;
  frame: PlotFrame;
  unplotted: Unplotted[];
  counts: Record<GapVerdict, number>;
  answer: ChapterAnswer;
}

const isPlotted = (v: GapVerdict): v is PlottedVerdict =>
  v === 'white-space' || v === 'under-served' || v === 'served' || v === 'over-served';

export function buildMarket(rows: readonly MarketRowInput[]): MarketChapter {
  const counts = Object.fromEntries(GAP_VERDICTS.map((v) => [v, 0])) as Record<GapVerdict, number>;
  const unplotted: Unplotted[] = [];
  const plot: Array<MarketRowInput & { verdict: PlottedVerdict }> = [];
  for (const row of rows) {
    counts[row.verdict]++;
    const u = (reason: string) => unplotted.push({ id: row.slug, label: row.nameTh, reason });
    if (row.verdict === 'supply-unknown') u('KKU supply unknown (no graduate figure)');
    else if (row.verdict === 'too-few-postings') u('Too few job adverts');
    else if (!(row.demandShare > 0)) u('No job adverts');
    else if (isPlotted(row.verdict)) plot.push({ ...row, verdict: row.verdict });
  }
  const positives = [
    ...plot.map((p) => p.demandShare),
    ...plot.filter((p) => p.verdict !== 'white-space' && p.supplyShare > 0).map((p) => p.supplyShare),
  ];
  const min = positives.length ? Math.min(...positives) / 1.5 : 0.001;
  const max = positives.length ? Math.max(...positives) * 1.5 : 1;
  const points = plot.map((p) => {
    const onRail = p.verdict === 'white-space' || !(p.supplyShare > 0);
    return {
      id: p.slug,
      label: p.nameTh,
      sublabel: p.nameEn,
      x: onRail ? 0 : logPos(p.supplyShare, min, max),
      y: logPos(p.demandShare, min, max),
      size: p.postings,
      tone: TONE[p.verdict],
      verdict: p.verdict,
      onRail,
      values: {
        'Job-advert share': pctLabel(p.demandShare),
        'KKU graduate share': p.supplyShare > 0 ? pctLabel(p.supplyShare) : 'none',
        Adverts: p.postings,
        Verdict: p.verdict,
      },
    };
  });
  return {
    version: LANDSCAPE_ATLAS_VERSION,
    points,
    unplotted,
    counts,
    frame: {
      split: null,
      diagonal: true,
      xTicks: logTicks(min, max, pctLabel),
      yTicks: logTicks(min, max, pctLabel),
    },
    answer: marketAnswer(rows.length, counts),
  };
}

function marketAnswer(total: number, c: Record<GapVerdict, number>): ChapterAnswer {
  if (total === 0) return NO_ANSWER;
  const under = c['under-served'];
  const ws = c['white-space'];
  const over = c['over-served'];
  const fields = (n: number) => `${n} ${n === 1 ? 'field is' : 'fields are'}`;
  const isAre = (n: number) => `${n} ${n === 1 ? 'is' : 'are'}`;
  return {
    figure: String(under + ws),
    sentence: `${fields(under)} under-served and ${isAre(ws)} white space (no KKU programme); ${isAre(over)} over-served.`,
  };
}
