// packages/db/src/landscape-atlas/capability.ts
import { linearPos, logPos, logTicks, median, round1, thbShort } from './scales';
import {
  GRANT_ANSWER_THRESHOLD_THB,
  LANDSCAPE_ATLAS_VERSION,
  NO_ANSWER,
  type AtlasPoint,
  type ChapterAnswer,
  type PlotFrame,
  type Tone,
  type Unplotted,
} from './types';

export interface CapabilityInput {
  facultyId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  /** Distinct active staff linked to the faculty's canonical programmes. */
  activeStaff: number;
  /** research_outputs passing realDataWhere(), last 3 complete calendar years. */
  publications3y: number;
  /** grantAward(memberIds).raw.bahtPerStaffPerYear; null = source not synced. */
  grantBahtPerStaffPerYear: number | null;
}

export interface CapabilityChapter {
  version: typeof LANDSCAPE_ATLAS_VERSION;
  computedAt: string;
  points: AtlasPoint[];
  frame: PlotFrame;
  unplotted: Unplotted[];
  medians: { publications: number | null; grant: number | null };
  answer: ChapterAnswer;
}

/** Grants below this sit on the floor of the log axis. */
export const GRANT_AXIS_FLOOR_THB = 10_000;
const YEARS = 3;

export function buildCapability(rows: readonly CapabilityInput[], computedAt: string): CapabilityChapter {
  const unplotted: Unplotted[] = [];
  const ok: Array<{ r: CapabilityInput; pubs: number; grant: number }> = [];
  for (const r of rows) {
    if (r.activeStaff <= 0) unplotted.push({ id: r.facultyId, label: r.nameTh, reason: 'No active teaching staff' });
    else if (r.grantBahtPerStaffPerYear === null) unplotted.push({ id: r.facultyId, label: r.nameTh, reason: 'Grant data not synced' });
    else ok.push({ r, pubs: r.publications3y / YEARS / r.activeStaff, grant: r.grantBahtPerStaffPerYear });
  }
  const mPubs = median(ok.map((o) => o.pubs));
  const mGrant = median(ok.map((o) => o.grant));
  const xMax = Math.max(1, ...ok.map((o) => o.pubs)) * 1.1;
  const yMax = Math.max(GRANT_AXIS_FLOOR_THB * 10, ...ok.map((o) => o.grant)) * 1.5;
  const yPos = (g: number) => (g < GRANT_AXIS_FLOOR_THB ? 0 : logPos(g, GRANT_AXIS_FLOOR_THB, yMax));
  const tone = (pubs: number, grant: number): Tone => {
    if (mPubs === null || mGrant === null) return 'neutral';
    const hiP = pubs >= mPubs;
    const hiG = grant >= mGrant;
    if (hiP && hiG) return 'positive';
    if (!hiP && !hiG) return 'negative';
    return 'neutral';
  };
  const points: AtlasPoint[] = ok.map(({ r, pubs, grant }) => ({
    id: r.facultyId,
    label: r.nameTh,
    sublabel: r.nameEn,
    x: linearPos(pubs, 0, xMax),
    y: yPos(grant),
    size: r.activeStaff,
    tone: tone(pubs, grant),
    values: {
      Faculty: r.nameEn,
      'Publications per staff per year': round1(pubs),
      'Grant ฿ per staff per year': Math.round(grant),
      'Active teaching staff': r.activeStaff,
    },
  }));
  const rich = ok.filter((o) => o.grant >= GRANT_ANSWER_THRESHOLD_THB).length;
  return {
    version: LANDSCAPE_ATLAS_VERSION,
    computedAt,
    points,
    unplotted,
    medians: { publications: mPubs, grant: mGrant },
    frame: {
      split:
        mPubs === null || mGrant === null ? null : { x: linearPos(mPubs, 0, xMax), y: yPos(mGrant) },
      diagonal: false,
      xTicks: [0, xMax / 2, xMax].map((v) => ({ at: linearPos(v, 0, xMax), label: v.toFixed(1) })),
      yTicks: logTicks(GRANT_AXIS_FLOOR_THB, yMax, thbShort),
    },
    answer:
      ok.length === 0
        ? NO_ANSWER
        : {
            figure: String(rich),
            sentence: `of ${ok.length} ${ok.length === 1 ? 'faculty' : 'faculties'} ${rich === 1 ? 'brings' : 'bring'} in ฿1M or more in external grants per teaching staff member a year.`,
          },
  };
}
