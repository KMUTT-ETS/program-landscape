// packages/db/src/landscape-atlas/position.ts
import type { KkuRiskLevel } from '@prisma/client';
import { linearPos, logPos, logTicks, round1 } from './scales';
import {
  APPLICATIONS_PER_SEAT_SPLIT,
  ENROLMENT_CHANGE_SPLIT_PCT,
  HEALTH_DANGER_BELOW,
  HEALTH_SPLIT,
  LANDSCAPE_ATLAS_VERSION,
  NO_ANSWER,
  RISK_MATRIX_SPLIT,
  type AtlasPoint,
  type ChapterAnswer,
  type PlotFrame,
  type Tone,
  type Unplotted,
} from './types';

// ── Growth–share ───────────────────────────────────────────────────────

export interface GrowthShareInput {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  facultyCode: string;
  /** TCAS applications: round 3, latest entry year; each course code counted once (3.1/3.2 are the same round). */
  applications: number | null;
  /** TCAS seats (quota): round 3, same year; each course code counted once (3.1/3.2 are the same round). */
  seats: number | null;
  tcasYearBe: number | null;
  /** 3-year enrolment change, % (same rule as dashboard-overview). */
  enrolmentChangePct: number | null;
  activeStudents: number | null;
  contributionPerStudentThb: number | null;
}

export type GrowthQuadrant = 'star' | 'cash-cow' | 'question' | 'dog';

export function growthQuadrant(applicationsPerSeat: number, changePct: number): GrowthQuadrant {
  const strong = applicationsPerSeat >= APPLICATIONS_PER_SEAT_SPLIT;
  const growing = changePct > ENROLMENT_CHANGE_SPLIT_PCT;
  if (strong) return growing ? 'star' : 'cash-cow';
  return growing ? 'question' : 'dog';
}

export interface QuadrantChart<Q extends string> {
  points: Array<AtlasPoint & { quadrant: Q }>;
  frame: PlotFrame;
  unplotted: Unplotted[];
  counts: Record<Q, number>;
}

/** Enrolment change is clamped to this range on the axis (raw value kept in the table). */
const CHANGE_AXIS_MIN = -100;
const CHANGE_AXIS_MAX = 200;
const clampChange = (c: number) => Math.max(CHANGE_AXIS_MIN, Math.min(CHANGE_AXIS_MAX, c));

function contributionTone(v: number | null): Tone {
  if (v === null || v === 0) return 'neutral';
  return v > 0 ? 'positive' : 'negative';
}

export function buildGrowthShare(rows: readonly GrowthShareInput[]): QuadrantChart<GrowthQuadrant> {
  const unplotted: Unplotted[] = [];
  const ok: Array<{ r: GrowthShareInput; ratio: number; change: number }> = [];
  for (const r of rows) {
    const u = (reason: string) => unplotted.push({ id: r.programId, label: r.nameTh, reason });
    if (r.applications === null || r.seats === null) u('No TCAS data');
    else if (r.seats <= 0) u('No TCAS seats (quota 0)');
    else if (r.applications <= 0) u('No TCAS applications');
    else if (r.enrolmentChangePct === null) u('No enrolment three years ago');
    else ok.push({ r, ratio: r.applications / r.seats, change: r.enrolmentChangePct });
  }
  const ratios = ok.map((o) => o.ratio);
  const xMin = Math.min(APPLICATIONS_PER_SEAT_SPLIT, ...ratios) / 1.2;
  const xMax = Math.max(APPLICATIONS_PER_SEAT_SPLIT, ...ratios) * 1.2;
  const changes = ok.map((o) => clampChange(o.change));
  const yMin = Math.min(-50, ...changes);
  const yMax = Math.max(50, ...changes);
  const counts: Record<GrowthQuadrant, number> = { star: 0, 'cash-cow': 0, question: 0, dog: 0 };
  const points = ok.map(({ r, ratio, change }) => {
    const quadrant = growthQuadrant(ratio, change);
    counts[quadrant]++;
    return {
      id: r.programId,
      label: r.nameTh,
      sublabel: r.facultyCode,
      x: logPos(ratio, xMin, xMax),
      y: linearPos(clampChange(change), yMin, yMax),
      size: r.activeStudents ?? 0,
      tone: contributionTone(r.contributionPerStudentThb),
      href: `/programs/${r.programId}`,
      quadrant,
      values: {
        Code: r.code,
        'Applications per seat': round1(ratio),
        'Enrolment change (3 yr, %)': change,
        'Active students': r.activeStudents,
        'Net contribution per student (THB)':
          r.contributionPerStudentThb === null ? null : Math.round(r.contributionPerStudentThb),
        'TCAS entry year (BE)': r.tcasYearBe,
      },
    };
  });
  const sign = (v: number) => (v > 0 ? '+' : '');
  return {
    points,
    unplotted,
    counts,
    frame: {
      split: { x: logPos(APPLICATIONS_PER_SEAT_SPLIT, xMin, xMax), y: linearPos(ENROLMENT_CHANGE_SPLIT_PCT, yMin, yMax) },
      diagonal: false,
      xTicks: logTicks(xMin, xMax, (v) => `${v}×`),
      yTicks: [yMin, 0, yMax].map((v) => ({ at: linearPos(v, yMin, yMax), label: `${sign(v)}${Math.round(v)}%` })),
    },
  };
}

// ── Health × risk ─────────────────────────────────────────────────────

export interface HealthRiskInput {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  facultyCode: string;
  health: number | null;
  /** KKU 5×5 matrix score, 1–25. */
  riskMatrixScore: number | null;
  riskLevel: KkuRiskLevel;
  activeStudents: number | null;
}

export type ActionQuadrant = 'act-now' | 'watch' | 'fix-quietly' | 'protect';

export function actionQuadrant(health: number, riskMatrixScore: number): ActionQuadrant {
  const healthy = health >= HEALTH_SPLIT;
  const highRisk = riskMatrixScore >= RISK_MATRIX_SPLIT;
  if (healthy) return highRisk ? 'watch' : 'protect';
  return highRisk ? 'act-now' : 'fix-quietly';
}

const RISK_TONE: Record<Exclude<KkuRiskLevel, 'NEEDS_DATA'>, Tone> = {
  LOW: 'positive',
  MODERATE: 'warning',
  HIGH: 'negative',
  VERY_HIGH: 'negative',
};

const riskPos = (score: number) => linearPos(score, 1, 25);

export function buildHealthRisk(rows: readonly HealthRiskInput[]): QuadrantChart<ActionQuadrant> {
  const unplotted: Unplotted[] = [];
  const counts: Record<ActionQuadrant, number> = { 'act-now': 0, watch: 0, 'fix-quietly': 0, protect: 0 };
  const points: Array<AtlasPoint & { quadrant: ActionQuadrant }> = [];
  const healths: number[] = [];
  for (const r of rows) {
    if (r.riskMatrixScore === null || r.riskLevel === 'NEEDS_DATA') {
      unplotted.push({ id: r.programId, label: r.nameTh, reason: 'Risk needs data' });
      continue;
    }
    if (r.health === null) {
      unplotted.push({ id: r.programId, label: r.nameTh, reason: 'No health score' });
      continue;
    }
    const quadrant = actionQuadrant(r.health, r.riskMatrixScore);
    counts[quadrant]++;
    healths.push(r.health);
    points.push({
      id: r.programId,
      label: r.nameTh,
      sublabel: r.facultyCode,
      x: r.health,
      y: riskPos(r.riskMatrixScore),
      size: r.activeStudents ?? 0,
      tone: RISK_TONE[r.riskLevel],
      href: `/programs/${r.programId}`,
      quadrant,
      values: {
        Code: r.code,
        'Health score': round1(r.health),
        'KKU risk score (1–25)': r.riskMatrixScore,
        'Risk level': r.riskLevel,
        'Active students': r.activeStudents,
      },
    });
  }
  const xMax = 100;
  const lowest = healths.length ? Math.min(...healths) : null;
  const xMin = lowest === null ? 0 : Math.max(0, Math.min(HEALTH_SPLIT - 10, Math.floor((lowest - 5) / 5) * 5));
  for (const p of points) p.x = linearPos(p.x, xMin, xMax);
  const tickValues = [...new Set([xMin, ...(HEALTH_DANGER_BELOW >= xMin ? [HEALTH_DANGER_BELOW] : []), HEALTH_SPLIT, xMax])].sort((a, b) => a - b);
  return {
    points,
    unplotted,
    counts,
    frame: {
      split: { x: linearPos(HEALTH_SPLIT, xMin, xMax), y: riskPos(RISK_MATRIX_SPLIT) },
      diagonal: false,
      xTicks: tickValues.map((v) => ({ at: linearPos(v, xMin, xMax), label: String(v) })),
      yTicks: [1, 5, 10, 16, 25].map((v) => ({ at: riskPos(v), label: String(v) })),
    },
  };
}

// ── Chapter ───────────────────────────────────────────────────────────

export interface PositionChapter {
  version: typeof LANDSCAPE_ATLAS_VERSION;
  computedAt: string;
  growthShare: QuadrantChart<GrowthQuadrant>;
  healthRisk: QuadrantChart<ActionQuadrant>;
  answer: ChapterAnswer;
}

export function buildPosition(
  growthShare: QuadrantChart<GrowthQuadrant>,
  healthRisk: QuadrantChart<ActionQuadrant>,
  computedAt: string,
): PositionChapter {
  return {
    version: LANDSCAPE_ATLAS_VERSION,
    computedAt,
    growthShare,
    healthRisk,
    answer: positionAnswer(growthShare, healthRisk),
  };
}

function positionAnswer(gs: QuadrantChart<GrowthQuadrant>, hr: QuadrantChart<ActionQuadrant>): ChapterAnswer {
  const dogs = gs.counts.dog;
  const dogText = `${dogs} ${dogs === 1 ? 'is a Dog' : 'are Dogs'} on the growth–share matrix.`;
  if (hr.points.length > 0) {
    const n = hr.counts['act-now'];
    const head = `bachelor ${n === 1 ? 'programme sits' : 'programmes sit'} in "act now" (health below 65 and KKU risk score 10 or more)`;
    return { figure: String(n), sentence: gs.points.length > 0 ? `${head}; ${dogText}` : `${head}.` };
  }
  if (gs.points.length > 0) {
    return {
      figure: String(dogs),
      sentence: `bachelor ${dogs === 1 ? 'programme is a Dog' : 'programmes are Dogs'}: fewer applications than seats and enrolment not growing.`,
    };
  }
  return NO_ANSWER;
}
