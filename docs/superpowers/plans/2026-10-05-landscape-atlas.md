# Landscape Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/dashboards/executive-landscape` into a five-chapter "landscape atlas" (Shape, Position, Market, Capability, Future) with seven new portfolio visuals.

**Architecture:** Pure shaping functions in `packages/db/src/landscape-atlas/` turn per-programme / per-faculty inputs into plot-ready points (0–100 plot space, split lines, "listed, not plotted" lists, a deterministic answer sentence). A `read.ts` in the same folder runs the queries. A new NestJS `LandscapeModule` serves four chapters (`/landscape/{shape,position,capability,future}`), scope-clamped and cached 5 minutes; Market reuses `/gap/map`. The page renders each chapter in its own `<Suspense>` with `ChartFrame` around every new visual, using an extended `BubbleMatrix`, a new inline-SVG `PortfolioTreemap` and a new `ScoreGrid` from `@kku/ui`.

**Tech Stack:** TypeScript strict, Prisma (`$queryRawUnsafe` + Zod-validated rows), NestJS, Next.js 14 App Router (server components), React inline SVG, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-landscape-atlas-design.md` (read it first; decisions D1–D8).

---

## Ground rules for every task

- **No `any`.** Zod-validate every raw SQL result.
- **Colours come from tokens.** In `packages/ui` use `useChartPalette()` (`positive`, `warning`, `negative`, `neutral`, `grid`, `axis`, `text`). In web pages, only these border-colour classes emit CSS: `border-subtle`, `border-default`, `border-strong` (NOT `border-border-*`). Spacing utilities are half-scale (`p-4` = 8px); copy class names from the existing page rather than guessing pixel sizes.
- **Missing is never 0.** Anything a chart cannot place goes into an `unplotted` list with a reason.
- **Run tests from the package directory** with the commands given. `pnpm --filter <pkg> exec vitest run <file>` is the form used throughout.
- **Commit with a message file** (the repo's Bash guard blocks some `-m` strings): write the message to a scratch file and `git commit -F <file>`. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Dev servers:** `nest start --watch` does NOT reload on `packages/*` edits. Restart the api after Tasks 1–8 before any manual check (find PIDs with `ss -ltnp | grep -E ':3000|:4000'`; never `pkill -f "pnpm dev"`).

## File structure

**Create**
- `packages/db/src/landscape-atlas/types.ts` — version, split constants, shared point/answer types.
- `packages/db/src/landscape-atlas/scales.ts` — plot-space scales, ticks, bands, mean/median.
- `packages/db/src/landscape-atlas/shape.ts` — treemap builder + answer.
- `packages/db/src/landscape-atlas/position.ts` — growth–share + health × risk builders + answer.
- `packages/db/src/landscape-atlas/market.ts` — gap-map → diagonal points + answer.
- `packages/db/src/landscape-atlas/capability.ts` — research & grant engine builder + answer.
- `packages/db/src/landscape-atlas/future.ts` — scorecard + sector coverage builders + answer.
- `packages/db/src/landscape-atlas/read.ts` — scope resolver, readers, `aiReadinessByProgram`.
- `packages/db/src/landscape-atlas/index.ts` — barrel.
- `packages/db/test/landscape-atlas-scales.test.ts`, `-shape.test.ts`, `-position.test.ts`, `-market.test.ts`, `-capability.test.ts`, `-future.test.ts`.
- `apps/api/src/landscape/landscape.service.ts`, `landscape.controller.ts`, `landscape.module.ts`.
- `apps/api/test/landscape-controller.test.ts`.
- `packages/ui/src/viz/portfolio-treemap.tsx`, `packages/ui/src/viz/score-grid.tsx`.
- `packages/ui/test/bubble-matrix.test.ts`, `portfolio-treemap.test.ts`, `score-grid.test.ts`.
- `apps/web/app/dashboards/executive-landscape/chapters/` — `fetch-chapter.ts`, `chapter-header.tsx`, `atlas-bubble.tsx`, `atlas-table.tsx`, `shape-section.tsx`, `position-section.tsx`, `market-section.tsx`, `capability-section.tsx`, `future-section.tsx`.
- `docs/methodologies/landscape-atlas.md`.

**Modify**
- `packages/db/src/index.ts` — export the atlas.
- `packages/ui/src/viz/bubble-matrix.tsx` — `split`, `diagonal`, ticks, per-bubble `tone`.
- `packages/ui/src/viz/index.ts` — export the two new components.
- `apps/api/src/app.module.ts` — register `LandscapeModule`.
- `apps/web/app/dashboards/executive-landscape/page.tsx` — atlas layout.
- `docs/methodologies/README.md` — one row.

---

### Task 1: Atlas types and scales

**Files:**
- Create: `packages/db/src/landscape-atlas/types.ts`, `packages/db/src/landscape-atlas/scales.ts`
- Test: `packages/db/test/landscape-atlas-scales.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/landscape-atlas-scales.test.ts
import { describe, expect, it } from 'vitest';
import { healthTone, linearPos, logPos, logTicks, meanOf, median } from '../src/landscape-atlas/scales';

describe('linearPos', () => {
  it('maps the domain to 0–100 and clamps outside it', () => {
    expect(linearPos(5, 0, 10)).toBe(50);
    expect(linearPos(-1, 0, 10)).toBe(0);
    expect(linearPos(11, 0, 10)).toBe(100);
  });
  it('returns 50 for a degenerate domain', () => {
    expect(linearPos(3, 4, 4)).toBe(50);
  });
});

describe('logPos', () => {
  it('maps geometric midpoints to 50', () => {
    expect(logPos(10, 1, 100)).toBeCloseTo(50, 6);
  });
  it('puts zero and negative values at 0 instead of throwing', () => {
    expect(logPos(0, 1, 100)).toBe(0);
    expect(logPos(-3, 1, 100)).toBe(0);
  });
});

describe('logTicks', () => {
  it('emits 1-2-5 ticks inside the domain only', () => {
    const t = logTicks(0.5, 30, (v) => String(v));
    expect(t.map((x) => x.label)).toEqual(['0.5', '1', '2', '5', '10', '20']);
  });
  it('is empty for an invalid domain', () => {
    expect(logTicks(0, 10, String)).toEqual([]);
  });
});

describe('healthTone', () => {
  it('uses the health-score bands: <40 / 40–65 / ≥65, null neutral', () => {
    expect(healthTone(null)).toBe('neutral');
    expect(healthTone(39.9)).toBe('negative');
    expect(healthTone(40)).toBe('warning');
    expect(healthTone(64.9)).toBe('warning');
    expect(healthTone(65)).toBe('positive');
  });
});

describe('median / meanOf', () => {
  it('median handles empty, odd and even lists', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('meanOf ignores nulls and returns null when nothing is present', () => {
    expect(meanOf([null, null])).toBeNull();
    expect(meanOf([10, null, 20])).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-scales.test.ts`
Expected: FAIL — cannot resolve `../src/landscape-atlas/scales`.

- [ ] **Step 3: Write `types.ts`**

```ts
// packages/db/src/landscape-atlas/types.ts
// Landscape atlas — the Executive Landscape's five chapters.
// Spec: docs/superpowers/specs/2026-10-05-landscape-atlas-design.md
// Methodology: docs/methodologies/landscape-atlas.md

export const LANDSCAPE_ATLAS_VERSION = 'landscape-atlas.v1';

/** Split lines (spec D6) — each reuses a threshold the methodology already uses. */
export const APPLICATIONS_PER_SEAT_SPLIT = 1;
export const ENROLMENT_CHANGE_SPLIT_PCT = 0;
/** "Healthy" band of the health score starts here. */
export const HEALTH_SPLIT = 65;
/** KKU ERM: a matrix score of 10 or more is HIGH. */
export const RISK_MATRIX_SPLIT = 10;
/** Health score bands: < 40 danger, 40–65 needs attention, ≥ 65 healthy. */
export const HEALTH_DANGER_BELOW = 40;

/** Answer-line thresholds. */
export const SMALL_PROGRAMME_STUDENTS = 15;
export const GRANT_ANSWER_THRESHOLD_THB = 1_000_000;
export const SECTOR_THIN_PROGRAMMES = 15;

export type Tone = 'positive' | 'warning' | 'negative' | 'neutral';

/** One mark on a bubble chart, already in 0–100 plot space. */
export interface AtlasPoint {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  size: number;
  tone: Tone;
  href?: string;
  /** Raw values for the "show data" table, in display order. */
  values: Record<string, number | string | null>;
}

/** Something a chart could not place, and why. Never drawn as 0. */
export interface Unplotted {
  id: string;
  label: string;
  reason: string;
}

/** The one-line answer under a chapter heading. */
export interface ChapterAnswer {
  figure: string | null;
  sentence: string;
}

export const NO_ANSWER: ChapterAnswer = {
  figure: null,
  sentence: 'Not enough data to summarise this chapter.',
};

export interface PlotTick {
  at: number;
  label: string;
}

/** Guides for a bubble chart, in 0–100 plot space. */
export interface PlotFrame {
  split: { x: number; y: number } | null;
  diagonal: boolean;
  xTicks: PlotTick[];
  yTicks: PlotTick[];
}
```

- [ ] **Step 4: Write `scales.ts`**

```ts
// packages/db/src/landscape-atlas/scales.ts
import { HEALTH_DANGER_BELOW, HEALTH_SPLIT, type PlotTick, type Tone } from './types';

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Linear position of `v` in [min, max], as 0–100. */
export function linearPos(v: number, min: number, max: number): number {
  if (!(max > min)) return 50;
  return clamp01((v - min) / (max - min)) * 100;
}

/** Log position of `v` in [min, max], as 0–100. Non-positive values sit at 0. */
export function logPos(v: number, min: number, max: number): number {
  if (!(v > 0) || !(min > 0) || !(max > min)) return 0;
  return clamp01((Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 100;
}

/** 1-2-5 ticks inside [min, max] for a log axis. */
export function logTicks(min: number, max: number, format: (v: number) => string): PlotTick[] {
  if (!(min > 0) || !(max > min)) return [];
  const out: PlotTick[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(12));
      if (v >= min && v <= max) out.push({ at: logPos(v, min, max), label: format(v) });
    }
  }
  return out;
}

/** Health-score band as a tone; null (no score) is neutral. */
export function healthTone(score: number | null): Tone {
  if (score === null) return 'neutral';
  if (score < HEALTH_DANGER_BELOW) return 'negative';
  if (score < HEALTH_SPLIT) return 'warning';
  return 'positive';
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Mean of the values that are present; null when none are. */
export function meanOf(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** A share (0–1) as a percentage label. */
export function pctLabel(share: number): string {
  return `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`;
}

/** Thai baht, short: ฿850k, ฿1.2M, ฿14M. */
export function thbShort(v: number): string {
  if (v >= 1_000_000) return `฿${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  return `฿${Math.round(v / 1000)}k`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-scales.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/landscape-atlas/types.ts packages/db/src/landscape-atlas/scales.ts packages/db/test/landscape-atlas-scales.test.ts
git commit -F <msg-file>   # "feat(db): landscape atlas types and scales"
```

---

### Task 2: Shape chapter builder (treemap)

**Files:**
- Create: `packages/db/src/landscape-atlas/shape.ts`
- Test: `packages/db/test/landscape-atlas-shape.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/landscape-atlas-shape.test.ts
import { describe, expect, it } from 'vitest';
import { buildShape, type ShapeProgrammeInput } from '../src/landscape-atlas/shape';

const row = (over: Partial<ShapeProgrammeInput>): ShapeProgrammeInput => ({
  programId: 'p',
  code: 'KKU-SEQ-0001',
  nameTh: 'หลักสูตร',
  nameEn: 'Programme',
  level: 'BACHELOR',
  facultyId: 'f1',
  facultyCode: 'F1',
  facultyNameTh: 'คณะหนึ่ง',
  facultyNameEn: 'Faculty One',
  activeStudents: 100,
  health: 70,
  ...over,
});

describe('buildShape', () => {
  it('nests programmes under faculties, largest faculty first, with health tones', () => {
    const out = buildShape(
      [
        row({ programId: 'a', facultyId: 'f1', activeStudents: 50, health: 30 }),
        row({ programId: 'b', facultyId: 'f2', facultyNameTh: 'คณะสอง', activeStudents: 400, health: null }),
        row({ programId: 'c', facultyId: 'f1', activeStudents: 10, health: 66 }),
      ],
      '2026-10-05T00:00:00.000Z',
    );
    expect(out.faculties.map((f) => f.id)).toEqual(['f2', 'f1']);
    const f1 = out.faculties[1]!;
    expect(f1.value).toBe(60);
    expect(f1.children.map((c) => [c.id, c.tone])).toEqual([
      ['a', 'negative'],
      ['c', 'positive'],
    ]);
    expect(out.faculties[0]!.children[0]!.tone).toBe('neutral');
    expect(out.faculties[0]!.children[0]!.href).toBe('/programs/b');
    expect(out.totalStudents).toBe(460);
  });

  it('lists programmes with no or zero active students instead of drawing them', () => {
    const out = buildShape(
      [row({ programId: 'a', activeStudents: null }), row({ programId: 'b', activeStudents: 0 }), row({ programId: 'c' })],
      'x',
    );
    expect(out.unplotted).toEqual([
      { id: 'a', label: 'หลักสูตร', reason: 'No active-student data' },
      { id: 'b', label: 'หลักสูตร', reason: 'No active students' },
    ]);
    expect(out.faculties[0]!.children.map((c) => c.id)).toEqual(['c']);
  });

  it('answers with the top-5 faculty share and the count of small programmes', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row({ programId: `p${i}`, facultyId: `f${i}`, activeStudents: i === 0 ? 400 : i === 6 ? 10 : 100 }),
    );
    const out = buildShape(rows, 'x');
    // total 400 + 5×100 + 10 = 910; top five = 400 + 4×100 = 800 → 88%
    expect(out.answer.figure).toBe('88%');
    expect(out.answer.sentence).toBe(
      '88% of active students are in the 5 largest of 7 faculties; 1 programme has fewer than 15 active students.',
    );
    expect(out.smallProgrammes).toBe(1);
  });

  it('says all students are in the faculties shown when there are five or fewer', () => {
    const out = buildShape([row({ programId: 'a', activeStudents: 1200 })], 'x');
    expect(out.answer.figure).toBe('1,200');
    expect(out.answer.sentence).toBe(
      'All 1,200 active students are in the 1 faculty shown; 0 programmes have fewer than 15 active students.',
    );
  });

  it('falls back to the neutral answer with no students at all', () => {
    expect(buildShape([], 'x').answer).toEqual({ figure: null, sentence: 'Not enough data to summarise this chapter.' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-shape.test.ts`
Expected: FAIL — cannot resolve `../src/landscape-atlas/shape`.

- [ ] **Step 3: Write `shape.ts`**

```ts
// packages/db/src/landscape-atlas/shape.ts
import { healthTone } from './scales';
import {
  LANDSCAPE_ATLAS_VERSION,
  NO_ANSWER,
  SMALL_PROGRAMME_STUDENTS,
  type ChapterAnswer,
  type Tone,
  type Unplotted,
} from './types';

export interface ShapeProgrammeInput {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  facultyId: string;
  facultyCode: string;
  facultyNameTh: string;
  facultyNameEn: string;
  /** Currently active students (student_cohort_distributions); null = no data. */
  activeStudents: number | null;
  /** Overall health score; null = not scored. */
  health: number | null;
}

export interface TreemapProgramme {
  id: string;
  label: string;
  sublabel: string;
  value: number;
  health: number | null;
  tone: Tone;
  href: string;
}

export interface TreemapFaculty {
  id: string;
  label: string;
  sublabel: string;
  value: number;
  children: TreemapProgramme[];
}

export interface ShapeChapter {
  version: typeof LANDSCAPE_ATLAS_VERSION;
  computedAt: string;
  faculties: TreemapFaculty[];
  totalStudents: number;
  smallProgrammes: number;
  unplotted: Unplotted[];
  answer: ChapterAnswer;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildShape(rows: readonly ShapeProgrammeInput[], computedAt: string): ShapeChapter {
  const unplotted: Unplotted[] = [];
  const byFaculty = new Map<string, TreemapFaculty>();
  for (const r of rows) {
    if (r.activeStudents === null) {
      unplotted.push({ id: r.programId, label: r.nameTh, reason: 'No active-student data' });
      continue;
    }
    if (r.activeStudents <= 0) {
      unplotted.push({ id: r.programId, label: r.nameTh, reason: 'No active students' });
      continue;
    }
    let f = byFaculty.get(r.facultyId);
    if (!f) {
      f = { id: r.facultyId, label: r.facultyNameTh, sublabel: r.facultyNameEn, value: 0, children: [] };
      byFaculty.set(r.facultyId, f);
    }
    f.value += r.activeStudents;
    f.children.push({
      id: r.programId,
      label: r.nameTh,
      sublabel: r.code,
      value: r.activeStudents,
      health: r.health,
      tone: healthTone(r.health),
      href: `/programs/${r.programId}`,
    });
  }
  const faculties = [...byFaculty.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  for (const f of faculties) f.children.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const totalStudents = faculties.reduce((s, f) => s + f.value, 0);
  const smallProgrammes = faculties.reduce(
    (s, f) => s + f.children.filter((c) => c.value < SMALL_PROGRAMME_STUDENTS).length,
    0,
  );
  return {
    version: LANDSCAPE_ATLAS_VERSION,
    computedAt,
    faculties,
    totalStudents,
    smallProgrammes,
    unplotted,
    answer: shapeAnswer(faculties, totalStudents, smallProgrammes),
  };
}

function shapeAnswer(faculties: TreemapFaculty[], total: number, small: number): ChapterAnswer {
  if (total <= 0) return NO_ANSWER;
  const smallText = `${small} ${plural(small, 'programme has', 'programmes have')} fewer than ${SMALL_PROGRAMME_STUDENTS} active students.`;
  if (faculties.length <= 5) {
    const n = faculties.length;
    return {
      figure: total.toLocaleString('en-US'),
      sentence: `All ${total.toLocaleString('en-US')} active students are in the ${n} ${plural(n, 'faculty', 'faculties')} shown; ${smallText}`,
    };
  }
  const top = faculties.slice(0, 5).reduce((s, f) => s + f.value, 0);
  const share = Math.round((top / total) * 100);
  return {
    figure: `${share}%`,
    sentence: `${share}% of active students are in the 5 largest of ${faculties.length} faculties; ${smallText}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-shape.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** — `feat(db): landscape atlas shape chapter (treemap)`

---

### Task 3: Position chapter builders (growth–share, health × risk)

**Files:**
- Create: `packages/db/src/landscape-atlas/position.ts`
- Test: `packages/db/test/landscape-atlas-position.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/landscape-atlas-position.test.ts
import { describe, expect, it } from 'vitest';
import {
  actionQuadrant,
  buildGrowthShare,
  buildHealthRisk,
  buildPosition,
  growthQuadrant,
  type GrowthShareInput,
  type HealthRiskInput,
} from '../src/landscape-atlas/position';

const gs = (over: Partial<GrowthShareInput>): GrowthShareInput => ({
  programId: 'p',
  code: 'C',
  nameTh: 'ท',
  nameEn: 'E',
  facultyCode: 'F',
  applications: 300,
  seats: 100,
  tcasYearBe: 2568,
  enrolmentChangePct: 10,
  activeStudents: 200,
  contributionPerStudentThb: 5000,
  ...over,
});

const hr = (over: Partial<HealthRiskInput>): HealthRiskInput => ({
  programId: 'p',
  code: 'C',
  nameTh: 'ท',
  nameEn: 'E',
  facultyCode: 'F',
  health: 70,
  riskMatrixScore: 6,
  riskLevel: 'MODERATE',
  activeStudents: 100,
  ...over,
});

describe('growthQuadrant (split at 1.0 applications per seat and 0 % change)', () => {
  it('assigns the four quadrants with the split lines inclusive on the strong side', () => {
    expect(growthQuadrant(1, 0.1)).toBe('star');
    expect(growthQuadrant(1, 0)).toBe('cash-cow');
    expect(growthQuadrant(0.99, 5)).toBe('question');
    expect(growthQuadrant(0.99, 0)).toBe('dog');
  });
});

describe('actionQuadrant (split at health 65 and KKU risk 10)', () => {
  it('assigns the four quadrants at the exact split values', () => {
    expect(actionQuadrant(64.9, 10)).toBe('act-now');
    expect(actionQuadrant(65, 10)).toBe('watch');
    expect(actionQuadrant(64.9, 9)).toBe('fix-quietly');
    expect(actionQuadrant(65, 9)).toBe('protect');
  });
});

describe('buildGrowthShare', () => {
  it('lists programmes it cannot place, with the reason', () => {
    const out = buildGrowthShare([
      gs({ programId: 'a', applications: null }),
      gs({ programId: 'b', seats: 0 }),
      gs({ programId: 'c', applications: 0 }),
      gs({ programId: 'd', enrolmentChangePct: null }),
      gs({ programId: 'e' }),
    ]);
    expect(out.unplotted.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'No TCAS data'],
      ['b', 'No TCAS seats (quota 0)'],
      ['c', 'No TCAS applications'],
      ['d', 'No enrolment three years ago'],
    ]);
    expect(out.points.map((p) => p.id)).toEqual(['e']);
  });

  it('places the split at 1.0 and 0 %, counts quadrants, colours by contribution', () => {
    const out = buildGrowthShare([
      gs({ programId: 'star', applications: 400, seats: 100, enrolmentChangePct: 20, contributionPerStudentThb: 100 }),
      gs({ programId: 'dog', applications: 50, seats: 100, enrolmentChangePct: -30, contributionPerStudentThb: -100 }),
      gs({ programId: 'q', applications: 80, seats: 100, enrolmentChangePct: 5, contributionPerStudentThb: null }),
    ]);
    expect(out.counts).toEqual({ star: 1, 'cash-cow': 0, question: 1, dog: 1 });
    const star = out.points.find((p) => p.id === 'star')!;
    const dog = out.points.find((p) => p.id === 'dog')!;
    expect(star.x).toBeGreaterThan(out.frame.split!.x);
    expect(dog.x).toBeLessThan(out.frame.split!.x);
    expect(star.y).toBeGreaterThan(out.frame.split!.y);
    expect([star.tone, dog.tone, out.points.find((p) => p.id === 'q')!.tone]).toEqual(['positive', 'negative', 'neutral']);
  });

  it('clamps extreme enrolment growth to the axis instead of squashing the chart', () => {
    const out = buildGrowthShare([gs({ programId: 'a', enrolmentChangePct: 900 }), gs({ programId: 'b', enrolmentChangePct: 0 })]);
    expect(out.points.find((p) => p.id === 'a')!.y).toBe(100);
    expect(out.points.find((p) => p.id === 'a')!.values['Enrolment change (3 yr, %)']).toBe(900);
  });
});

describe('buildHealthRisk', () => {
  it('lists NEEDS_DATA risk and missing health, plots the rest with risk-level tones', () => {
    const out = buildHealthRisk([
      hr({ programId: 'a', riskLevel: 'NEEDS_DATA', riskMatrixScore: null }),
      hr({ programId: 'b', health: null }),
      hr({ programId: 'c', health: 50, riskMatrixScore: 16, riskLevel: 'VERY_HIGH' }),
      hr({ programId: 'd', health: 80, riskMatrixScore: 2, riskLevel: 'LOW' }),
    ]);
    expect(out.unplotted.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'Risk needs data'],
      ['b', 'No health score'],
    ]);
    expect(out.counts).toEqual({ 'act-now': 1, watch: 0, 'fix-quietly': 0, protect: 1 });
    expect(out.points.map((p) => p.tone)).toEqual(['negative', 'positive']);
    expect(out.frame.split).toEqual({ x: 65, y: 37.5 });
  });
});

describe('buildPosition answer', () => {
  it('leads with "act now" and adds the Dogs', () => {
    const out = buildPosition(
      buildGrowthShare([gs({ programId: 'dog', applications: 10, enrolmentChangePct: -5 })]),
      buildHealthRisk([hr({ programId: 'x', health: 40, riskMatrixScore: 12, riskLevel: 'HIGH' })]),
      'now',
    );
    expect(out.answer).toEqual({
      figure: '1',
      sentence:
        '1 bachelor programme sits in "act now" (health below 65 and KKU risk score 10 or more); 1 is a Dog on the growth–share matrix.',
    });
  });

  it('falls back when neither chart has a point', () => {
    expect(buildPosition(buildGrowthShare([]), buildHealthRisk([]), 'now').answer.figure).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-position.test.ts`
Expected: FAIL — cannot resolve `../src/landscape-atlas/position`.

- [ ] **Step 3: Write `position.ts`**

```ts
// packages/db/src/landscape-atlas/position.ts
import type { KkuRiskLevel } from '@prisma/client';
import { linearPos, logPos, logTicks, round1 } from './scales';
import {
  APPLICATIONS_PER_SEAT_SPLIT,
  ENROLMENT_CHANGE_SPLIT_PCT,
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
  /** TCAS applications in the latest entry year, all rounds summed. */
  applications: number | null;
  /** TCAS seats (quota) in the same year. */
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
  MODERATE: 'neutral',
  HIGH: 'warning',
  VERY_HIGH: 'negative',
};

const riskPos = (score: number) => linearPos(score, 1, 25);

export function buildHealthRisk(rows: readonly HealthRiskInput[]): QuadrantChart<ActionQuadrant> {
  const unplotted: Unplotted[] = [];
  const counts: Record<ActionQuadrant, number> = { 'act-now': 0, watch: 0, 'fix-quietly': 0, protect: 0 };
  const points: Array<AtlasPoint & { quadrant: ActionQuadrant }> = [];
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
    points.push({
      id: r.programId,
      label: r.nameTh,
      sublabel: r.facultyCode,
      x: linearPos(r.health, 0, 100),
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
  return {
    points,
    unplotted,
    counts,
    frame: {
      split: { x: HEALTH_SPLIT, y: riskPos(RISK_MATRIX_SPLIT) },
      diagonal: false,
      xTicks: [0, 40, 65, 100].map((v) => ({ at: v, label: String(v) })),
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
    const head = `${n} bachelor ${n === 1 ? 'programme sits' : 'programmes sit'} in "act now" (health below 65 and KKU risk score 10 or more)`;
    return { figure: String(n), sentence: gs.points.length > 0 ? `${head}; ${dogText}` : `${head}.` };
  }
  if (gs.points.length > 0) {
    return {
      figure: String(dogs),
      sentence: `${dogs} bachelor ${dogs === 1 ? 'programme is a Dog' : 'programmes are Dogs'}: fewer applications than seats and enrolment not growing.`,
    };
  }
  return NO_ANSWER;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-position.test.ts`
Expected: PASS (8 tests). `KkuRiskLevel` is the Prisma enum (`LOW | MODERATE | HIGH | VERY_HIGH | NEEDS_DATA`), imported from `@prisma/client` as `risk-scoring.ts` does.

- [ ] **Step 5: Commit** — `feat(db): landscape atlas position chapter`

---

### Task 4: Market builder (demand vs supply diagonal)

**Files:**
- Create: `packages/db/src/landscape-atlas/market.ts`
- Test: `packages/db/test/landscape-atlas-market.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/landscape-atlas-market.test.ts
import { describe, expect, it } from 'vitest';
import { buildMarket, type MarketRowInput } from '../src/landscape-atlas/market';

const r = (over: Partial<MarketRowInput>): MarketRowInput => ({
  slug: 's',
  nameTh: 'สาขา',
  nameEn: 'Field',
  postings: 100,
  demandShare: 0.05,
  supplyShare: 0.05,
  verdict: 'served',
  ...over,
});

describe('buildMarket', () => {
  it('puts white-space fields on the left rail and the rest on a shared log scale', () => {
    const out = buildMarket([
      r({ slug: 'ws', verdict: 'white-space', supplyShare: 0, demandShare: 0.02 }),
      r({ slug: 'eq', demandShare: 0.04, supplyShare: 0.04 }),
    ]);
    const ws = out.points.find((p) => p.id === 'ws')!;
    const eq = out.points.find((p) => p.id === 'eq')!;
    expect(ws.onRail).toBe(true);
    expect(ws.x).toBe(0);
    // Same domain on both axes, so a balanced field sits on the diagonal.
    expect(eq.x).toBeCloseTo(eq.y, 6);
    expect(out.frame.diagonal).toBe(true);
    expect(out.frame.split).toBeNull();
  });

  it('lists supply-unknown, too-few-postings and zero-demand fields', () => {
    const out = buildMarket([
      r({ slug: 'a', verdict: 'supply-unknown' }),
      r({ slug: 'b', verdict: 'too-few-postings' }),
      r({ slug: 'c', demandShare: 0 }),
    ]);
    expect(out.unplotted.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'KKU supply unknown (no graduate figure)'],
      ['b', 'Too few job adverts'],
      ['c', 'No job adverts'],
    ]);
    expect(out.points).toEqual([]);
  });

  it('answers with under-served and white-space counts', () => {
    const out = buildMarket([
      r({ slug: 'u1', verdict: 'under-served' }),
      r({ slug: 'u2', verdict: 'under-served' }),
      r({ slug: 'w', verdict: 'white-space', supplyShare: 0 }),
      r({ slug: 'o', verdict: 'over-served' }),
    ]);
    expect(out.answer).toEqual({
      figure: '3',
      sentence: '2 fields are under-served and 1 is white space (no KKU programme); 1 is over-served.',
    });
    expect(out.counts['under-served']).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-market.test.ts`
Expected: FAIL — cannot resolve `../src/landscape-atlas/market`.

- [ ] **Step 3: Write `market.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-market.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** — `feat(db): landscape atlas market chapter (gap-map diagonal)`

---

### Task 5: Capability builder (research & grant engine)

**Files:**
- Create: `packages/db/src/landscape-atlas/capability.ts`
- Test: `packages/db/test/landscape-atlas-capability.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/landscape-atlas-capability.test.ts
import { describe, expect, it } from 'vitest';
import { buildCapability, type CapabilityInput } from '../src/landscape-atlas/capability';

const f = (over: Partial<CapabilityInput>): CapabilityInput => ({
  facultyId: 'f',
  code: 'F',
  nameTh: 'คณะ',
  nameEn: 'Faculty',
  activeStaff: 100,
  publications3y: 300,
  grantBahtPerStaffPerYear: 500_000,
  ...over,
});

describe('buildCapability', () => {
  it('computes publications per staff per year over three years', () => {
    const out = buildCapability([f({ facultyId: 'a', activeStaff: 10, publications3y: 60 })], 'now');
    expect(out.points[0]!.values['Publications per staff per year']).toBe(2);
  });

  it('lists faculties with no staff or unsynced grants', () => {
    const out = buildCapability(
      [f({ facultyId: 'a', activeStaff: 0 }), f({ facultyId: 'b', grantBahtPerStaffPerYear: null }), f({ facultyId: 'c' })],
      'now',
    );
    expect(out.unplotted.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'No active teaching staff'],
      ['b', 'Grant data not synced'],
    ]);
  });

  it('puts a zero-grant faculty on the floor of the log axis, not off the chart', () => {
    const out = buildCapability([f({ facultyId: 'a', grantBahtPerStaffPerYear: 0 }), f({ facultyId: 'b' })], 'now');
    expect(out.points.find((p) => p.id === 'a')!.y).toBe(0);
  });

  it('tones by the KKU medians and answers with faculties at ฿1M+ per staff', () => {
    const out = buildCapability(
      [
        f({ facultyId: 'hi', publications3y: 900, grantBahtPerStaffPerYear: 2_000_000 }),
        f({ facultyId: 'mid', publications3y: 300, grantBahtPerStaffPerYear: 400_000 }),
        f({ facultyId: 'lo', publications3y: 30, grantBahtPerStaffPerYear: 50_000 }),
      ],
      'now',
    );
    expect(out.points.map((p) => [p.id, p.tone])).toEqual([
      ['hi', 'positive'],
      ['mid', 'positive'],
      ['lo', 'negative'],
    ]);
    expect(out.answer).toEqual({
      figure: '1',
      sentence: '1 of 3 faculties brings in ฿1M or more in external grants per teaching staff member a year.',
    });
  });
});
```

Note on the tone test: "mid" sits exactly on both medians, and the rule is `>=` median → positive.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-capability.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write `capability.ts`**

```ts
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
            sentence: `${rich} of ${ok.length} ${ok.length === 1 ? 'faculty' : 'faculties'} ${rich === 1 ? 'brings' : 'bring'} in ฿1M or more in external grants per teaching staff member a year.`,
          },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-capability.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** — `feat(db): landscape atlas capability chapter`

---

### Task 6: Future builders (scorecard, sector coverage)

**Files:**
- Create: `packages/db/src/landscape-atlas/future.ts`
- Test: `packages/db/test/landscape-atlas-future.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/landscape-atlas-future.test.ts
import { describe, expect, it } from 'vitest';
import { buildCoverage, buildFuture, buildScorecard, type ScorecardInput } from '../src/landscape-atlas/future';

const s = (over: Partial<ScorecardInput>): ScorecardInput => ({
  facultyId: 'f',
  code: 'F',
  nameTh: 'คณะ',
  nameEn: 'Faculty',
  aiReadiness: 50,
  dq: 50,
  dqStudents: 100,
  relevance: 50,
  ...over,
});

describe('buildScorecard', () => {
  it('averages only present columns, sorts by mean, and puts all-blank rows last', () => {
    const out = buildScorecard([
      s({ facultyId: 'blank', aiReadiness: null, dq: null, relevance: null }),
      s({ facultyId: 'lo', aiReadiness: 20, dq: null, relevance: 40 }),
      s({ facultyId: 'hi', aiReadiness: 90, dq: 80, relevance: 70 }),
    ]);
    expect(out.rows.map((r) => [r.id, r.mean, r.present])).toEqual([
      ['hi', 80, 3],
      ['lo', 30, 2],
      ['blank', null, 0],
    ]);
    expect(out.rows[1]!.cells).toEqual([20, null, 40]);
    expect(out.columns).toEqual(['AI readiness', 'Digital intelligence (DQ)', 'Relevance']);
  });

  it('names the lowest faculties that have at least 2 of 3 measures', () => {
    const out = buildScorecard([
      s({ facultyId: 'a', nameEn: 'A', aiReadiness: 90, dq: 90, relevance: 90 }),
      s({ facultyId: 'b', nameEn: 'B', aiReadiness: 10, dq: 10, relevance: null }),
      s({ facultyId: 'c', nameEn: 'C', aiReadiness: 5, dq: null, relevance: null }),
    ]);
    expect(out.note).toBe('Lowest on the measures available: B, A.');
  });
});

describe('buildCoverage', () => {
  it('counts programmes per faculty × sector, blank = not mapped, flags empty and thin sectors', () => {
    const out = buildCoverage({
      faculties: [{ id: 'f1', code: 'F1', nameTh: 'ก', nameEn: 'One' }],
      sectors: [
        { id: 's1', code: 'DIG', nameTh: 'ดิจิทัล', nameEn: 'Digital economy' },
        { id: 's2', code: 'GRN', nameTh: 'สีเขียว', nameEn: 'Green economy' },
      ],
      counts: [{ facultyId: 'f1', sectorId: 's1', programmes: 20 }],
    });
    expect(out.rows[0]!.cells).toEqual([20, null]);
    expect(out.columns.map((c) => [c.id, c.total])).toEqual([
      ['s1', 20],
      ['s2', 0],
    ]);
    expect(out.unmappedSectors).toEqual(['Green economy']);
    expect(out.thinSectors).toEqual(['Green economy']);
  });
});

describe('buildFuture answer', () => {
  it('reports thin sectors and names the unmapped ones', () => {
    const out = buildFuture(
      [],
      {
        faculties: [],
        sectors: [
          { id: 's1', code: 'A', nameTh: 'ก', nameEn: 'Digital economy' },
          { id: 's2', code: 'B', nameTh: 'ข', nameEn: 'Green economy' },
        ],
        counts: [],
      },
      'now',
    );
    expect(out.answer).toEqual({
      figure: '2 of 2',
      sentence:
        '2 of 2 national strategic sectors are fed by fewer than 15 programmes; Digital economy, Green economy by none we can map.',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-future.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write `future.ts`**

```ts
// packages/db/src/landscape-atlas/future.ts
import { meanOf, round1 } from './scales';
import { LANDSCAPE_ATLAS_VERSION, NO_ANSWER, SECTOR_THIN_PROGRAMMES, type ChapterAnswer } from './types';

// ── Future-fit scorecard (spec 4.6, D8: three columns) ───────────────

export const SCORECARD_COLUMNS = ['AI readiness', 'Digital intelligence (DQ)', 'Relevance'] as const;

export interface ScorecardInput {
  facultyId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  /** Mean of programmes' programAiReadiness().overallScore; null = none scored. */
  aiReadiness: number | null;
  /** dqCompetencyByScope(...).rawMean; null = no scored students. */
  dq: number | null;
  dqStudents: number;
  /** Mean of programmes' health relevance dimension. */
  relevance: number | null;
}

export interface ScorecardRow {
  id: string;
  label: string;
  sublabel: string;
  cells: Array<number | null>;
  mean: number | null;
  present: number;
  dqStudents: number;
}

export interface Scorecard {
  columns: string[];
  rows: ScorecardRow[];
  /** Plain sentence naming the weakest faculties, or null. */
  note: string | null;
}

export function buildScorecard(inputs: readonly ScorecardInput[]): Scorecard {
  const rows: ScorecardRow[] = inputs.map((r) => {
    const cells = [r.aiReadiness, r.dq, r.relevance].map((v) => (v === null ? null : round1(v)));
    const mean = meanOf(cells);
    return {
      id: r.facultyId,
      label: r.nameTh,
      sublabel: r.nameEn,
      cells,
      mean: mean === null ? null : round1(mean),
      present: cells.filter((c) => c !== null).length,
      dqStudents: r.dqStudents,
    };
  });
  rows.sort((a, b) => {
    if (a.mean === null && b.mean === null) return a.label.localeCompare(b.label);
    if (a.mean === null) return 1;
    if (b.mean === null) return -1;
    return b.mean - a.mean || a.label.localeCompare(b.label);
  });
  const eligible = rows.filter((r) => r.present >= 2);
  const lowest = eligible.slice(-3).reverse();
  return {
    columns: [...SCORECARD_COLUMNS],
    rows,
    note: lowest.length ? `Lowest on the measures available: ${lowest.map((r) => r.sublabel || r.label).join(', ')}.` : null,
  };
}

// ── National-strategy coverage (spec 4.7) ────────────────────────────

export interface CoverageInput {
  faculties: Array<{ id: string; code: string; nameTh: string; nameEn: string }>;
  sectors: Array<{ id: string; code: string; nameTh: string; nameEn: string }>;
  counts: Array<{ facultyId: string; sectorId: string; programmes: number }>;
}

export interface CoverageGrid {
  columns: Array<{ id: string; label: string; total: number }>;
  rows: Array<{ id: string; label: string; sublabel: string; cells: Array<number | null> }>;
  unmappedSectors: string[];
  thinSectors: string[];
}

export function buildCoverage(input: CoverageInput): CoverageGrid {
  const key = (f: string, s: string) => `${f}|${s}`;
  const count = new Map(input.counts.map((c) => [key(c.facultyId, c.sectorId), c.programmes]));
  const columns = input.sectors.map((s) => ({
    id: s.id,
    label: s.nameEn,
    total: input.counts.filter((c) => c.sectorId === s.id).reduce((a, c) => a + c.programmes, 0),
  }));
  const rows = input.faculties.map((f) => ({
    id: f.id,
    label: f.nameTh,
    sublabel: f.nameEn,
    cells: input.sectors.map((s) => count.get(key(f.id, s.id)) ?? null),
  }));
  return {
    columns,
    rows,
    unmappedSectors: columns.filter((c) => c.total === 0).map((c) => c.label),
    thinSectors: columns.filter((c) => c.total < SECTOR_THIN_PROGRAMMES).map((c) => c.label),
  };
}

// ── Chapter ───────────────────────────────────────────────────────────

export interface FutureChapter {
  version: typeof LANDSCAPE_ATLAS_VERSION;
  computedAt: string;
  scorecard: Scorecard;
  coverage: CoverageGrid;
  answer: ChapterAnswer;
}

export function buildFuture(scorecard: readonly ScorecardInput[], coverage: CoverageInput, computedAt: string): FutureChapter {
  const grid = buildCoverage(coverage);
  const n = grid.columns.length;
  const thin = grid.thinSectors.length;
  const answer: ChapterAnswer =
    n === 0
      ? NO_ANSWER
      : {
          figure: `${thin} of ${n}`,
          sentence:
            `${thin} of ${n} national strategic sectors ${thin === 1 ? 'is' : 'are'} fed by fewer than ${SECTOR_THIN_PROGRAMMES} programmes` +
            (grid.unmappedSectors.length ? `; ${grid.unmappedSectors.join(', ')} by none we can map.` : '.'),
        };
  return { version: LANDSCAPE_ATLAS_VERSION, computedAt, scorecard: buildScorecard(scorecard), coverage: grid, answer };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-future.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** — `feat(db): landscape atlas future chapter (scorecard, sector coverage)`

---

### Task 7: Readers, scope resolver, barrel exports

**Files:**
- Create: `packages/db/src/landscape-atlas/read.ts`, `packages/db/src/landscape-atlas/index.ts`
- Modify: `packages/db/src/index.ts` (add one export line after `export * from './program-overlap';`)

No unit test: these are I/O. They are exercised by the dev smoke check in Step 4 and by the API in Task 8.

- [ ] **Step 1: Write `read.ts`**

```ts
// packages/db/src/landscape-atlas/read.ts
// The atlas's only I/O. Every raw query's rows are Zod-validated; every
// metric table is read through realDataSqlUnsafe / realDataWhere.
import { z } from 'zod';
import { prisma } from '../index';
import { realDataSqlUnsafe, realDataWhere } from '../data-quality';
import { getProgramScoreIndex } from '../health-score';
import { listPortfolioRisk } from '../risk-scoring';
import { grantAward } from '../grant-award';
import { dqCompetencyByScope } from '../student-dq';
import { programAiReadiness } from '../program-deep-dive';
import { scopeProgramIds } from '../gap-map';
import { meanOf } from './scales';
import { buildShape, type ShapeChapter } from './shape';
import { buildGrowthShare, buildHealthRisk, buildPosition, type PositionChapter } from './position';
import { buildCapability, type CapabilityChapter, type CapabilityInput } from './capability';
import { buildFuture, type FutureChapter, type ScorecardInput } from './future';

export type AtlasScopeLevel = 'university' | 'faculty' | 'department' | 'program';

export interface AtlasScope {
  level: AtlasScopeLevel;
  id: string | null;
  /** null = whole university; [] = a scope with no programmes. */
  programIds: string[] | null;
}

export async function resolveAtlasScope(level: AtlasScopeLevel, id: string | null): Promise<AtlasScope> {
  if (level === 'university' || !id) return { level: 'university', id: null, programIds: null };
  if (level === 'program') return { level, id, programIds: [id] };
  return { level, id, programIds: (await scopeProgramIds(level, id)) ?? [] };
}

/** Canonical ACTIVE programmes in scope; $1 is the programIds array or null. */
const IN_SCOPE = `p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
  AND ($1::text[] IS NULL OR p.id = ANY($1::text[]))`;

const isEmpty = (s: AtlasScope) => s.programIds !== null && s.programIds.length === 0;
const nowIso = () => new Date().toISOString();

// ── Shape ─────────────────────────────────────────────────────────────

const ShapeRow = z.object({
  programId: z.string(),
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string(),
  level: z.string(),
  facultyId: z.string(),
  facultyCode: z.string(),
  facultyNameTh: z.string(),
  facultyNameEn: z.string().nullable(),
  activeStudents: z.number().nullable(),
});

const ACTIVE_STUDENTS_CTE = `SELECT sc.program_id, SUM(sc.student_count)::int AS students
  FROM student_cohort_distributions sc
  WHERE ${realDataSqlUnsafe('sc')}
  GROUP BY sc.program_id`;

export async function readShape(scope: AtlasScope): Promise<ShapeChapter> {
  if (isEmpty(scope)) return buildShape([], nowIso());
  const raw = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT p.id AS "programId", p.code, p.name_th AS "nameTh",
            COALESCE(NULLIF(TRIM(p.name_en), ''), p.name_th) AS "nameEn", p.level::text AS level,
            f.id AS "facultyId", f.code AS "facultyCode", f.name_th AS "facultyNameTh", f.name_en AS "facultyNameEn",
            st.students AS "activeStudents"
     FROM programs p
     JOIN faculties f ON f.id = p.faculty_id
     LEFT JOIN (${ACTIVE_STUDENTS_CTE}) st ON st.program_id = p.id
     WHERE ${IN_SCOPE}`,
    scope.programIds,
  );
  const rows = z.array(ShapeRow).parse(raw);
  const index = await getProgramScoreIndex();
  return buildShape(
    rows.map((r) => ({ ...r, facultyNameEn: r.facultyNameEn ?? '', health: index.get(r.programId)?.overall ?? null })),
    nowIso(),
  );
}

// ── Position (bachelor) ───────────────────────────────────────────────

const PositionRow = z.object({
  programId: z.string(),
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string(),
  facultyCode: z.string(),
  applications: z.number().nullable(),
  seats: z.number().nullable(),
  tcasYearBe: z.number().nullable(),
  enrolmentChangePct: z.number().nullable(),
  activeStudents: z.number().nullable(),
  netContributionThb: z.number().nullable(),
});

export async function readPosition(scope: AtlasScope): Promise<PositionChapter> {
  if (isEmpty(scope)) return buildPosition(buildGrowthShare([]), buildHealthRisk([]), nowIso());
  const raw = await prisma.$queryRawUnsafe<unknown[]>(
    `WITH tcas AS (
       SELECT ts.program_id, ts.entry_year_be, SUM(ts.applicants)::int AS applications, SUM(ts.quota)::int AS seats
       FROM tcas_admission_stats ts
       WHERE ts.program_id IS NOT NULL AND ${realDataSqlUnsafe('ts')}
       GROUP BY ts.program_id, ts.entry_year_be
     ), latest_tcas AS (
       SELECT DISTINCT ON (program_id) program_id, entry_year_be, applications, seats
       FROM tcas ORDER BY program_id, entry_year_be DESC
     ), latest_em AS (
       SELECT program_id, MAX(academic_year) AS max_year
       FROM enrollment_metrics em0 WHERE ${realDataSqlUnsafe('em0')}
       GROUP BY program_id
     )
     SELECT p.id AS "programId", p.code, p.name_th AS "nameTh",
            COALESCE(NULLIF(TRIM(p.name_en), ''), p.name_th) AS "nameEn", f.code AS "facultyCode",
            lt.applications, lt.seats, lt.entry_year_be AS "tcasYearBe",
            CASE WHEN old_em.enrolled > 0 THEN
              ROUND(((now_em.enrolled::numeric - old_em.enrolled::numeric) / old_em.enrolled) * 100, 1)::float8
            END AS "enrolmentChangePct",
            st.students AS "activeStudents",
            fm.net_contribution::float8 AS "netContributionThb"
     FROM programs p
     JOIN faculties f ON f.id = p.faculty_id
     LEFT JOIN latest_tcas lt ON lt.program_id = p.id
     LEFT JOIN latest_em l ON l.program_id = p.id
     LEFT JOIN enrollment_metrics now_em
       ON now_em.program_id = p.id AND now_em.academic_year = l.max_year AND ${realDataSqlUnsafe('now_em')}
     LEFT JOIN enrollment_metrics old_em
       ON old_em.program_id = p.id AND old_em.academic_year = l.max_year - 3 AND ${realDataSqlUnsafe('old_em')}
     LEFT JOIN (${ACTIVE_STUDENTS_CTE}) st ON st.program_id = p.id
     LEFT JOIN LATERAL (
       SELECT fm1.net_contribution FROM financial_metrics fm1
       WHERE fm1.program_id = p.id AND ${realDataSqlUnsafe('fm1')}
       ORDER BY fm1.fiscal_year DESC LIMIT 1
     ) fm ON true
     WHERE p.level = 'BACHELOR' AND ${IN_SCOPE}`,
    scope.programIds,
  );
  const rows = z.array(PositionRow).parse(raw);
  const index = await getProgramScoreIndex();
  const risk = await listPortfolioRisk(scope.programIds ? { programIds: scope.programIds } : undefined);
  const riskById = new Map(risk.map((r) => [r.programId, r]));
  const gs = buildGrowthShare(
    rows.map((r) => ({
      ...r,
      contributionPerStudentThb:
        r.netContributionThb === null || !r.activeStudents ? null : r.netContributionThb / r.activeStudents,
    })),
  );
  const hr = buildHealthRisk(
    rows.map((r) => {
      const rk = riskById.get(r.programId);
      return {
        programId: r.programId,
        code: r.code,
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        facultyCode: r.facultyCode,
        health: index.get(r.programId)?.overall ?? null,
        riskMatrixScore: rk?.kkuMatrixScore ?? null,
        riskLevel: rk?.kkuRiskLevel ?? 'NEEDS_DATA',
        activeStudents: r.activeStudents,
      };
    }),
  );
  return buildPosition(gs, hr, nowIso());
}

// ── Capability (by faculty) ───────────────────────────────────────────

const StaffRow = z.object({
  facultyId: z.string(),
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string().nullable(),
  memberIds: z.array(z.string()),
});

export async function readCapability(scope: AtlasScope): Promise<CapabilityChapter> {
  if (isEmpty(scope)) return buildCapability([], nowIso());
  const raw = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT f.id AS "facultyId", f.code, f.name_th AS "nameTh", f.name_en AS "nameEn",
            ARRAY_AGG(DISTINCT fm.id) AS "memberIds"
     FROM programs p
     JOIN faculties f ON f.id = p.faculty_id
     JOIN program_faculties pf ON pf.program_id = p.id
     JOIN faculty_members fm ON fm.id = pf.faculty_member_id AND fm.is_active
     WHERE ${IN_SCOPE}
     GROUP BY f.id, f.code, f.name_th, f.name_en`,
    scope.programIds,
  );
  const faculties = z.array(StaffRow).parse(raw);
  const year = new Date().getUTCFullYear();
  const inputs: CapabilityInput[] = [];
  for (const f of faculties) {
    const [publications3y, award] = await Promise.all([
      prisma.researchOutput.count({
        where: { facultyMemberId: { in: f.memberIds }, year: { gte: year - 3, lte: year - 1 }, ...realDataWhere() },
      }),
      grantAward(f.memberIds),
    ]);
    const perStaff = award.raw['bahtPerStaffPerYear'];
    inputs.push({
      facultyId: f.facultyId,
      code: f.code,
      nameTh: f.nameTh,
      nameEn: f.nameEn ?? '',
      activeStaff: f.memberIds.length,
      publications3y,
      grantBahtPerStaffPerYear: award.points === null || typeof perStaff !== 'number' ? null : perStaff,
    });
  }
  return buildCapability(inputs, nowIso());
}

// ── Future (by faculty) ───────────────────────────────────────────────

const FacultyProgrammeRow = z.object({
  programId: z.string(),
  facultyId: z.string(),
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string().nullable(),
});
const CoverageRow = z.object({ facultyId: z.string(), sectorId: z.string(), programmes: z.number() });

/**
 * programAiReadiness() per programme, bounded concurrency. It is computed on
 * read (six queries, no AI call) and nothing stores it. A programme with no
 * extracted skills has no readiness — the function would otherwise return its
 * defaults — so it is left out; so is one whose computation throws.
 */
export async function aiReadinessByProgram(ids: readonly string[], concurrency = 8): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += concurrency) {
    const slice = ids.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async (id) => {
        try {
          const r = await programAiReadiness(id);
          const b = r.skillBreakdown;
          return b.aiNative + b.aiAugmented + b.aiDisplaceable + b.neutral === 0 ? null : ([id, r.overallScore] as const);
        } catch (err) {
          console.error(`[landscape-atlas] AI readiness failed for ${id}`, err);
          return null;
        }
      }),
    );
    for (const r of results) if (r) out.set(r[0], r[1]);
  }
  return out;
}

export async function readFuture(scope: AtlasScope): Promise<FutureChapter> {
  const sectors = await prisma.sector.findMany({
    select: { id: true, code: true, nameTh: true, nameEn: true },
    orderBy: { code: 'asc' },
  });
  if (isEmpty(scope)) return buildFuture([], { faculties: [], sectors, counts: [] }, nowIso());
  const programmes = z.array(FacultyProgrammeRow).parse(
    await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT p.id AS "programId", f.id AS "facultyId", f.code, f.name_th AS "nameTh", f.name_en AS "nameEn"
       FROM programs p JOIN faculties f ON f.id = p.faculty_id
       WHERE ${IN_SCOPE}`,
      scope.programIds,
    ),
  );
  const counts = z.array(CoverageRow).parse(
    await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT p.faculty_id AS "facultyId", ss.sector_id AS "sectorId", COUNT(DISTINCT p.id)::int AS programmes
       FROM programs p
       JOIN program_skills ps ON ps.program_id = p.id
       JOIN skill_sectors ss ON ss.skill_id = ps.skill_id
       WHERE ${IN_SCOPE}
       GROUP BY p.faculty_id, ss.sector_id`,
      scope.programIds,
    ),
  );
  const index = await getProgramScoreIndex();
  const ai = await aiReadinessByProgram(programmes.map((p) => p.programId));

  const faculties = new Map<string, { id: string; code: string; nameTh: string; nameEn: string; programIds: string[] }>();
  for (const p of programmes) {
    const f = faculties.get(p.facultyId) ?? { id: p.facultyId, code: p.code, nameTh: p.nameTh, nameEn: p.nameEn ?? '', programIds: [] };
    f.programIds.push(p.programId);
    faculties.set(p.facultyId, f);
  }

  // DQ is a scope rollup (never a mean of programme scores). A programme or
  // department scope reads its own scope; otherwise each faculty is read.
  const narrow = (scope.level === 'program' || scope.level === 'department') && scope.id;
  const scorecard: ScorecardInput[] = [];
  for (const f of faculties.values()) {
    const dq = narrow
      ? await dqCompetencyByScope({ scope: scope.level as 'program' | 'department', scopeId: scope.id! })
      : await dqCompetencyByScope({ scope: 'faculty', scopeId: f.id });
    scorecard.push({
      facultyId: f.id,
      code: f.code,
      nameTh: f.nameTh,
      nameEn: f.nameEn,
      aiReadiness: meanOf(f.programIds.map((id) => ai.get(id) ?? null)),
      dq: dq.rawMean,
      dqStudents: dq.scoredStudents,
      relevance: meanOf(f.programIds.map((id) => index.get(id)?.dimensions.relevance.score ?? null)),
    });
  }
  return buildFuture(
    scorecard,
    {
      faculties: [...faculties.values()].map(({ id, code, nameTh, nameEn }) => ({ id, code, nameTh, nameEn })),
      sectors,
      counts,
    },
    nowIso(),
  );
}
```

- [ ] **Step 2: Write `index.ts` and export it**

```ts
// packages/db/src/landscape-atlas/index.ts
export * from './types';
export * from './scales';
export * from './shape';
export * from './position';
export * from './market';
export * from './capability';
export * from './future';
export * from './read';
```

In `packages/db/src/index.ts`, after `export * from './program-overlap';` add:

```ts
export * from './landscape-atlas';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kku/db exec tsc --noEmit`
Expected: no errors. Likely fix if it fails: a barrel name collision (rename the atlas symbol, never the existing one).

- [ ] **Step 4: Smoke-check the readers against the dev database**

Write `<scratchpad>/atlas-smoke.ts`:

```ts
import { readShape, readPosition, readCapability, readFuture, resolveAtlasScope, prisma } from '@kku/db';
const uni = await resolveAtlasScope('university', null);
const t0 = Date.now();
const [shape, position, capability, future] = await Promise.all([readShape(uni), readPosition(uni), readCapability(uni), readFuture(uni)]);
console.log('ms', Date.now() - t0);
console.log('shape', shape.faculties.length, shape.totalStudents, shape.unplotted.length, shape.answer);
console.log('position', position.growthShare.points.length, position.growthShare.unplotted.length, position.healthRisk.points.length, position.answer);
console.log('capability', capability.points.length, capability.unplotted.length, capability.answer);
console.log('future', future.scorecard.rows.length, future.coverage.columns.map((c) => `${c.label}:${c.total}`).join(' '), future.answer);
await prisma.$disconnect();
```

Run: `cd packages/db && npx tsx <scratchpad>/atlas-smoke.ts`
Expected (dev, roughly): shape ≈ 24 faculties and ≈ 35,676 students; position ≈ 79 growth–share points of 102 bachelor programmes; capability ≈ 20+ faculties; future 8 sector columns with Green economy at 0. Record the timings; if the whole run exceeds ~30 s, note it for Task 8 (cache covers repeat views).

- [ ] **Step 5: Commit** — `feat(db): landscape atlas readers and scope resolver`

---

### Task 8: API module `/landscape`

**Files:**
- Create: `apps/api/src/landscape/landscape.service.ts`, `landscape.controller.ts`, `landscape.module.ts`
- Modify: `apps/api/src/app.module.ts` (import + add `LandscapeModule` to `imports` right after `GapModule`)
- Test: `apps/api/test/landscape-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/landscape-controller.test.ts
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVENANCE_META } from '../src/common/decorators';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import type { CacheService } from '../src/common/cache.service';

const mocks = vi.hoisted(() => ({ clampScopeForUser: vi.fn() }));
vi.mock('../src/common/scope-guards', async () => {
  const actual = await vi.importActual<typeof import('../src/common/scope-guards')>('../src/common/scope-guards');
  return { ...actual, clampScopeForUser: mocks.clampScopeForUser };
});

const { LandscapeController, ScopeQuery } = await import('../src/landscape/landscape.controller');
const { LandscapeService } = await import('../src/landscape/landscape.service');
const { LANDSCAPE_ATLAS_VERSION } = await import('@kku/db');

const user = { userId: 'u1', role: 'FACULTY_USER', facultyId: 'f1', departmentId: null, programId: null, email: 'x@kku.ac.th', name: null } as never;
const chapter = (name: string) => ({ version: LANDSCAPE_ATLAS_VERSION, computedAt: '2026-10-05T00:00:00.000Z', name });

function fakeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  };
}

beforeEach(() => {
  mocks.clampScopeForUser.mockReset();
});

describe('ScopeQuery', () => {
  it('defaults to university and accepts program scope', () => {
    const pipe = new ZodValidationPipe(ScopeQuery);
    expect(pipe.transform({}, {} as never)).toEqual({ scope: 'university' });
    expect(pipe.transform({ scope: 'program', scopeId: 'p1' }, {} as never)).toEqual({ scope: 'program', scopeId: 'p1' });
    expect(() => pipe.transform({ scope: 'campus' }, {} as never)).toThrow();
  });
});

describe('LandscapeController', () => {
  it('clamps the requested scope and passes the clamped one to the service', async () => {
    mocks.clampScopeForUser.mockResolvedValue({ scope: 'program', scopeId: 'p9' });
    const readers = {
      shape: vi.fn(async () => chapter('shape')),
      position: vi.fn(async () => chapter('position')),
      capability: vi.fn(async () => chapter('capability')),
      future: vi.fn(async () => chapter('future')),
    };
    const svc = new LandscapeService(fakeCache() as unknown as CacheService, readers as never);
    const ctl = new LandscapeController(svc);
    const res = await ctl.shape(user, { scope: 'university' });
    expect(mocks.clampScopeForUser).toHaveBeenCalledWith('university', null, user);
    expect(readers.shape).toHaveBeenCalledWith({ level: 'program', id: 'p9', programIds: ['p9'] });
    expect(res.meta).toEqual({ freshnessDate: '2026-10-05T00:00:00.000Z', scope: { level: 'program', id: 'p9' } });
  });

  it('stamps every chapter route with the atlas methodology version', () => {
    for (const m of ['shape', 'position', 'capability', 'future'] as const) {
      const meta = Reflect.getMetadata(PROVENANCE_META, LandscapeController.prototype[m]) as { methodologyVersion: string };
      expect(meta.methodologyVersion).toBe(LANDSCAPE_ATLAS_VERSION);
    }
  });
});

describe('LandscapeService cache', () => {
  it('caches per chapter and scope, and never serves one scope to another', async () => {
    const cache = fakeCache();
    const readers = {
      shape: vi.fn(async () => chapter('shape')),
      position: vi.fn(async () => chapter('position')),
      capability: vi.fn(async () => chapter('capability')),
      future: vi.fn(async () => chapter('future')),
    };
    const svc = new LandscapeService(cache as unknown as CacheService, readers as never);
    const a = { level: 'program' as const, id: 'a', programIds: ['a'] };
    const b = { level: 'program' as const, id: 'b', programIds: ['b'] };
    await svc.shape(a);
    await svc.shape(a);
    await svc.shape(b);
    await svc.position(a);
    expect(readers.shape).toHaveBeenCalledTimes(2);
    expect(readers.position).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run test/landscape-controller.test.ts`
Expected: FAIL — cannot resolve `../src/landscape/landscape.controller`.

- [ ] **Step 3: Write `landscape.service.ts`**

```ts
// apps/api/src/landscape/landscape.service.ts
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  LANDSCAPE_ATLAS_VERSION,
  readCapability,
  readFuture,
  readPosition,
  readShape,
  type AtlasScope,
  type CapabilityChapter,
  type FutureChapter,
  type PositionChapter,
  type ShapeChapter,
} from '@kku/db';
import { CacheService } from '../common/cache.service';

// Each chapter is several aggregate queries (Future also computes AI readiness
// per programme), and a Council session opens the same page within minutes,
// so chapters are cached for five minutes per chapter + scope. The version is
// in the key so a methodology bump never serves a stale shape.
export const LANDSCAPE_CACHE_NS = 'landscape:atlas';
export const LANDSCAPE_TTL_SECONDS = 300;
export const LANDSCAPE_READERS = Symbol('LANDSCAPE_READERS');

export interface LandscapeReaders {
  shape(scope: AtlasScope): Promise<ShapeChapter>;
  position(scope: AtlasScope): Promise<PositionChapter>;
  capability(scope: AtlasScope): Promise<CapabilityChapter>;
  future(scope: AtlasScope): Promise<FutureChapter>;
}

type Chapter = keyof LandscapeReaders;

@Injectable()
export class LandscapeService {
  private readonly readers: LandscapeReaders;

  constructor(
    private readonly cache: CacheService,
    @Optional() @Inject(LANDSCAPE_READERS) readers?: LandscapeReaders,
  ) {
    this.readers = readers ?? { shape: readShape, position: readPosition, capability: readCapability, future: readFuture };
  }

  private async cached<T>(chapter: Chapter, scope: AtlasScope, read: () => Promise<T>): Promise<T> {
    const key = CacheService.keyOf(LANDSCAPE_CACHE_NS, {
      chapter,
      level: scope.level,
      id: scope.id,
      version: LANDSCAPE_ATLAS_VERSION,
    });
    const hit = await this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await read();
    await this.cache.set(key, value, LANDSCAPE_TTL_SECONDS);
    return value;
  }

  shape(scope: AtlasScope): Promise<ShapeChapter> {
    return this.cached('shape', scope, () => this.readers.shape(scope));
  }
  position(scope: AtlasScope): Promise<PositionChapter> {
    return this.cached('position', scope, () => this.readers.position(scope));
  }
  capability(scope: AtlasScope): Promise<CapabilityChapter> {
    return this.cached('capability', scope, () => this.readers.capability(scope));
  }
  future(scope: AtlasScope): Promise<FutureChapter> {
    return this.cached('future', scope, () => this.readers.future(scope));
  }
}
```

- [ ] **Step 4: Write `landscape.controller.ts`**

```ts
// apps/api/src/landscape/landscape.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { LANDSCAPE_ATLAS_VERSION, resolveAtlasScope, type AtlasScope } from '@kku/db';
import type { ApiMeta, SessionUser } from '@kku/shared';
import { AuthSession, Authorized, Provenance, ZodValidationPipe, clampScopeForUser } from '../common';
import { LandscapeService } from './landscape.service';

export const ScopeQuery = z.object({
  scope: z.enum(['university', 'faculty', 'department', 'program']).default('university'),
  scopeId: z.string().min(1).optional(),
});
type ScopeQueryT = z.infer<typeof ScopeQuery>;

const src = (id: string, name: string) => ({ id, name });
const ENROLMENT = src('student_cohort_distributions', 'KKU Registry · currently active students');
const HEALTH = src('health_score', 'KKU health score (health-score.v5.4)');

const ATLAS_CAVEATS = [
  'Charts list what they cannot place, with the reason; a missing value is never drawn as 0.',
  'Answer lines are computed from the data by fixed rules; no AI wrote them.',
];

@Controller('/landscape')
export class LandscapeController {
  constructor(private readonly landscape: LandscapeService) {}

  private async scope(q: ScopeQueryT, user: SessionUser): Promise<AtlasScope> {
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    return resolveAtlasScope(eff.scope, eff.scopeId);
  }

  private envelope<T extends { computedAt: string }>(data: T, scope: AtlasScope): { data: T; meta: Partial<ApiMeta> } {
    return { data, meta: { freshnessDate: data.computedAt, scope: { level: scope.level, id: scope.id } } };
  }

  @Get('shape')
  @Authorized('programs:read:all')
  @Provenance({ sources: [ENROLMENT, HEALTH], methodologyVersion: LANDSCAPE_ATLAS_VERSION, caveats: ATLAS_CAVEATS })
  async shape(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(ScopeQuery)) q: ScopeQueryT) {
    const s = await this.scope(q, user);
    return this.envelope(await this.landscape.shape(s), s);
  }

  @Get('position')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      src('tcas_admission_stats', 'TCAS admission statistics (applications and seats)'),
      src('enrollment_metrics', 'KKU Registry · enrolment by year'),
      src('financial_metrics', 'KKU Finance · net contribution'),
      src('risk_assessments', 'Risk Management · KKU 5×5 matrix'),
      ENROLMENT,
      HEALTH,
    ],
    methodologyVersion: LANDSCAPE_ATLAS_VERSION,
    caveats: [
      ...ATLAS_CAVEATS,
      'Bachelor programmes only: TCAS and the risk register cover bachelor programmes.',
      'TCAS round 3 only (part of admissions, not all of it); each course code is counted once per entry year.',
    ],
  })
  async position(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(ScopeQuery)) q: ScopeQueryT) {
    const s = await this.scope(q, user);
    return this.envelope(await this.landscape.position(s), s);
  }

  @Get('capability')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      src('research_outputs', 'KKU Publications mirror (Scopus, PubMed)'),
      src('research_service_projects', 'KKU research & academic-service grants'),
      src('faculty_members', 'KKU HR · active teaching staff'),
    ],
    methodologyVersion: LANDSCAPE_ATLAS_VERSION,
    caveats: [
      ...ATLAS_CAVEATS,
      'Grants are a lower bound: about 30% of co-investigator ids match no HR record.',
      'A project counts for every faculty with a member on it, so faculty figures sum to more than the KKU total.',
    ],
  })
  async capability(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(ScopeQuery)) q: ScopeQueryT) {
    const s = await this.scope(q, user);
    return this.envelope(await this.landscape.capability(s), s);
  }

  @Get('future')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      src('ai_readiness', 'AI readiness (deterministic, per programme)'),
      src('dq', 'Digital intelligence (DQ) assessments'),
      HEALTH,
      src('program_skills', 'Skills extracted from curricula, mapped to national strategic sectors'),
    ],
    methodologyVersion: LANDSCAPE_ATLAS_VERSION,
    caveats: [
      ...ATLAS_CAVEATS,
      'Sector coverage depends on skills extracted from curriculum PDFs; an empty cell means "not mapped", not "no capacity".',
    ],
  })
  async future(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(ScopeQuery)) q: ScopeQueryT) {
    const s = await this.scope(q, user);
    return this.envelope(await this.landscape.future(s), s);
  }
}
```

If `clampScopeForUser`'s return type names its scope union differently, cast via `eff.scope as AtlasScopeLevel` after checking the four values match.

- [ ] **Step 5: Write `landscape.module.ts` and register it**

```ts
// apps/api/src/landscape/landscape.module.ts
import { Module } from '@nestjs/common';
import { CacheService } from '../common/cache.service';
import { LandscapeController } from './landscape.controller';
import { LandscapeService } from './landscape.service';

// CacheService is re-provided rather than imported from AppModule (circular);
// same shape as GapModule.
@Module({
  controllers: [LandscapeController],
  providers: [LandscapeService, CacheService],
})
export class LandscapeModule {}
```

In `apps/api/src/app.module.ts`: add `import { LandscapeModule } from './landscape/landscape.module';` beside the `GapModule` import, and `LandscapeModule,` on the line after `GapModule,` in the `imports` array.

- [ ] **Step 6: Run the test and typecheck**

Run: `pnpm --filter api exec vitest run test/landscape-controller.test.ts && pnpm --filter api exec tsc --noEmit`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 7: Restart the api and smoke the endpoints**

Restart the dev api (PIDs from `ss -ltnp | grep :4000`). The endpoints need a session; check them through the page in Task 13 instead of curl.

- [ ] **Step 8: Commit** — `feat(api): /landscape chapters (shape, position, capability, future)`

---

### Task 9: `BubbleMatrix` — split, diagonal, ticks, tone

**Files:**
- Modify: `packages/ui/src/viz/bubble-matrix.tsx`
- Test: `packages/ui/test/bubble-matrix.test.ts`

Existing callers pass none of the new props; their output must not change except that the cross-hairs now follow zoom/pan like the bubbles (they were static, so at zoom > 1 they no longer marked the 50/50 split).

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/test/bubble-matrix.test.ts
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BubbleMatrix } from '../src/viz/bubble-matrix';

const bubbles = [{ id: 'a', label: 'ก', x: 20, y: 80, size: 10, color: 1 }];
const base = { bubbles, axisXLabel: 'X', axisYLabel: 'Y', width: 400, height: 300 };
const dashed = (html: string) => (html.match(/stroke-dasharray="3 3"/g) ?? []).length;

describe('BubbleMatrix guides', () => {
  it('keeps the 50/50 cross-hairs by default', () => {
    expect(dashed(renderToStaticMarkup(createElement(BubbleMatrix, base)))).toBe(2);
  });
  it('hides the cross-hairs when split is null', () => {
    expect(dashed(renderToStaticMarkup(createElement(BubbleMatrix, { ...base, split: null })))).toBe(0);
  });
  it('moves the cross-hairs to the given split', () => {
    // plot: M.left 60, W = 400 - 60 - 40 = 300 → x at 25% = 60 + 75 = 135
    const html = renderToStaticMarkup(createElement(BubbleMatrix, { ...base, split: { x: 25, y: 50 } }));
    expect(html).toContain('x1="135"');
  });
  it('draws the diagonal and the ticks when asked', () => {
    const html = renderToStaticMarkup(
      createElement(BubbleMatrix, {
        ...base,
        split: null,
        diagonal: true,
        xTicks: [{ at: 50, label: '1×' }],
        yTicks: [{ at: 0, label: '-50%' }],
      }),
    );
    expect(html).toContain('data-guide="diagonal"');
    expect(html).toContain('>1×<');
    expect(html).toContain('>-50%<');
  });
  it('uses the bubble tone over the diverging colour', () => {
    const html = renderToStaticMarkup(
      createElement(BubbleMatrix, { ...base, bubbles: [{ ...bubbles[0]!, color: 1, tone: 'warning' as const }] }),
    );
    expect(html).toContain('data-tone="warning"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/ui exec vitest run test/bubble-matrix.test.ts`
Expected: FAIL on the split / diagonal / tone cases.

- [ ] **Step 3: Edit `bubble-matrix.tsx`**

1. Extend the types:

```ts
export type BubbleTone = 'positive' | 'warning' | 'negative' | 'neutral';

export interface Bubble {
  id: string;
  label: string;
  x: number;            // 0-100
  y: number;            // 0-100
  size: number;         // arbitrary; normalised internally
  color: number;        // arbitrary; negative → negative-tone, positive → positive-tone
  /** Categorical tone; overrides `color` when set. */
  tone?: BubbleTone;
  dataCompletenessPct?: number;
}

export interface BubbleTick {
  /** Position in 0-100 plot space. */
  at: number;
  label: string;
}
```

and add to `BubbleMatrixProps`:

```ts
  /** Cross-hair position in 0-100 plot space. Default 50/50; null hides it. */
  split?: { x: number; y: number } | null;
  /** Draw the y = x diagonal (bottom-left → top-right). */
  diagonal?: boolean;
  xTicks?: BubbleTick[];
  yTicks?: BubbleTick[];
```

2. Destructure `split = { x: 50, y: 50 }, diagonal = false, xTicks = [], yTicks = []` in the component signature.

3. Replace `colorFor`:

```ts
  const colorFor = (b: Bubble) => {
    if (b.tone) return palette[b.tone];
    if (b.color > 0) return palette.positive;
    if (b.color < 0) return palette.negative;
    return palette.neutral;
  };
```

and add `data-tone={b.tone ?? (b.color > 0 ? 'positive' : b.color < 0 ? 'negative' : 'neutral')}` to the bubble `<circle>`.

4. Delete `const quadrantX = …` / `const quadrantY = …` and add, after `bubblePositions`:

```ts
  // Plot-space (0-100) → screen, with the same zoom/pan transform as the
  // bubbles, so guides stay on the values they mark when zoomed.
  const toScreenX = (p: number) => pan.x + (M.left + (p / 100) * W) * zoom + M.left * (1 - zoom);
  const toScreenY = (p: number) => pan.y + (M.top + H - (p / 100) * H) * zoom + M.top * (1 - zoom);
  const inX = (px: number) => px >= M.left - 0.5 && px <= M.left + W + 0.5;
  const inY = (py: number) => py >= M.top - 0.5 && py <= M.top + H + 0.5;
```

5. Replace the two "quadrant cross-hairs" `<line>` elements with a guide group placed inside the bubble `clipPath` group, before the bubbles:

```tsx
          {split && (
            <>
              <line
                x1={toScreenX(split.x)} x2={toScreenX(split.x)} y1={M.top} y2={M.top + H}
                stroke={palette.grid} strokeDasharray="3 3"
              />
              <line
                x1={M.left} x2={M.left + W} y1={toScreenY(split.y)} y2={toScreenY(split.y)}
                stroke={palette.grid} strokeDasharray="3 3"
              />
            </>
          )}
          {diagonal && (
            <line
              data-guide="diagonal"
              x1={toScreenX(0)} y1={toScreenY(0)} x2={toScreenX(100)} y2={toScreenY(100)}
              stroke={palette.axis} strokeOpacity={0.5}
            />
          )}
```

Note: the guides must sit inside the `<g clipPath=…>` but before `bubblePositions.map`, so bubbles stay on top. The default-split test expects `x1="135"` only when `split.x` = 25 with width 400 — check the arithmetic against the `M` constants (left 60, right 40).

6. After the axis-label `<text>` elements (outside the clip group), add the ticks:

```tsx
        {xTicks.map((t) => {
          const px = toScreenX(t.at);
          return inX(px) ? (
            <text key={`xt-${t.at}`} x={px} y={M.top + H + 14} textAnchor="middle" fontSize={9} fill={palette.axis}>
              {t.label}
            </text>
          ) : null;
        })}
        {yTicks.map((t) => {
          const py = toScreenY(t.at);
          return inY(py) ? (
            <text key={`yt-${t.at}`} x={M.left - 6} y={py + 3} textAnchor="end" fontSize={9} fill={palette.axis}>
              {t.label}
            </text>
          ) : null;
        })}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kku/ui exec vitest run test/bubble-matrix.test.ts && pnpm --filter @kku/ui exec tsc --noEmit`
Expected: PASS (5 tests), no type errors. Also run `pnpm --filter web exec tsc --noEmit` — `StrategicMatrixHero` and the cockpit must still compile unchanged.

- [ ] **Step 5: Commit** — `feat(ui): BubbleMatrix split, diagonal, ticks and categorical tone`

---

### Task 10: `PortfolioTreemap`

**Files:**
- Create: `packages/ui/src/viz/portfolio-treemap.tsx`
- Modify: `packages/ui/src/viz/index.ts` (add `export * from './portfolio-treemap';`)
- Test: `packages/ui/test/portfolio-treemap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/test/portfolio-treemap.test.ts
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortfolioTreemap, squarify } from '../src/viz/portfolio-treemap';

describe('squarify', () => {
  const rect = { x: 0, y: 0, w: 100, h: 50 };
  it('gives every value an area proportional to it and stays inside the rect', () => {
    const out = squarify([60, 30, 10], rect);
    const area = out.map((r) => r.w * r.h);
    expect(area[0]! / area[1]!).toBeCloseTo(2, 5);
    expect(area.reduce((a, b) => a + b, 0)).toBeCloseTo(5000, 5);
    for (const r of out) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(50 + 1e-6);
    }
  });
  it('keeps input order and gives zero values zero area', () => {
    const out = squarify([0, 5], rect);
    expect(out[0]!.w * out[0]!.h).toBe(0);
    expect(out[1]!.w * out[1]!.h).toBeCloseTo(5000, 5);
  });
  it('returns empty rects for an empty or zero total', () => {
    expect(squarify([], rect)).toEqual([]);
    expect(squarify([0, 0], rect).every((r) => r.w === 0)).toBe(true);
  });
});

describe('PortfolioTreemap', () => {
  const nodes = [
    {
      id: 'f1', label: 'คณะแพทยศาสตร์', sublabel: 'Medicine', value: 300,
      children: [
        { id: 'p1', label: 'แพทยศาสตรบัณฑิต', sublabel: 'KKU-SEQ-0001', value: 200, tone: 'positive' as const, href: '/programs/p1' },
        { id: 'p2', label: 'กายภาพบำบัด', sublabel: 'KKU-SEQ-0002', value: 100, tone: 'neutral' as const, href: '/programs/p2', hatched: true },
      ],
    },
  ];
  it('renders faculty and programme labels with links to the Deep-Dive', () => {
    const html = renderToStaticMarkup(createElement(PortfolioTreemap, { nodes, height: 400 }));
    expect(html).toContain('คณะแพทยศาสตร์');
    expect(html).toContain('href="/programs/p1"');
    expect(html).toContain('data-hatched="true"');
  });
  it('renders the empty state with no nodes', () => {
    const html = renderToStaticMarkup(createElement(PortfolioTreemap, { nodes: [], height: 400, emptyLabel: 'Nothing to show.' }));
    expect(html).toContain('Nothing to show.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/ui exec vitest run test/portfolio-treemap.test.ts`
Expected: FAIL — cannot resolve `../src/viz/portfolio-treemap`.

- [ ] **Step 3: Write `portfolio-treemap.tsx`**

```tsx
'use client';

import * as React from 'react';
import { useChartPalette } from './chart-theme';

// Faculty → programme treemap. Inline SVG (Recharts' Treemap renders nothing
// during server rendering) with a pure squarified layout, so the geometry is
// testable on its own. Area = the value the caller supplies (active students
// on the Executive Landscape); fill = a categorical tone; `hatched` marks a
// programme with no score so a missing score never reads as a colour.

export type TreemapTone = 'positive' | 'warning' | 'negative' | 'neutral';

export interface TreemapLeaf {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  tone: TreemapTone;
  href?: string;
  hatched?: boolean;
}

export interface TreemapGroup {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  children: TreemapLeaf[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap layout. Returns one rect per value, in input order. */
export function squarify(values: readonly number[], rect: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  const items = values
    .map((v, i) => ({ i, area: Math.max(0, v) * scale }))
    .filter((d) => d.area > 0)
    .sort((a, b) => b.area - a.area);
  let free: Rect = { ...rect };

  const worst = (row: typeof items, side: number): number => {
    const s = row.reduce((a, d) => a + d.area, 0);
    const max = Math.max(...row.map((d) => d.area));
    const min = Math.min(...row.map((d) => d.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  const place = (row: typeof items) => {
    const s = row.reduce((a, d) => a + d.area, 0);
    if (free.w >= free.h) {
      const colW = s / free.h;
      let y = free.y;
      for (const d of row) {
        const h = d.area / colW;
        out[d.i] = { x: free.x, y, w: colW, h };
        y += h;
      }
      free = { x: free.x + colW, y: free.y, w: Math.max(0, free.w - colW), h: free.h };
    } else {
      const rowH = s / free.w;
      let x = free.x;
      for (const d of row) {
        const w = d.area / rowH;
        out[d.i] = { x, y: free.y, w, h: rowH };
        x += w;
      }
      free = { x: free.x, y: free.y + rowH, w: free.w, h: Math.max(0, free.h - rowH) };
    }
  };

  let row: typeof items = [];
  for (const d of items) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, d], side) <= worst(row, side)) {
      row.push(d);
    } else {
      place(row);
      row = [d];
    }
  }
  if (row.length) place(row);
  return out;
}

const VIEW_W = 1000;
const HEADER = 18;
const PAD = 2;

function truncate(text: string, px: number): string {
  const max = Math.max(0, Math.floor(px / 7));
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export interface PortfolioTreemapProps {
  nodes: TreemapGroup[];
  height?: number;
  emptyLabel?: string;
  /** Unit for tooltips, e.g. "active students". */
  unit?: string;
}

export function PortfolioTreemap({ nodes, height = 420, emptyLabel = 'No data to show.', unit = 'students' }: PortfolioTreemapProps) {
  const palette = useChartPalette();
  const [focus, setFocus] = React.useState<string | null>(null);
  const hatchId = React.useId();
  if (nodes.length === 0) {
    return <p className="text-sm text-text-tertiary">{emptyLabel}</p>;
  }
  const shown = focus ? nodes.filter((n) => n.id === focus) : nodes;
  const groupRects = squarify(shown.map((n) => n.value), { x: 0, y: 0, w: VIEW_W, h: height });
  const fill = (t: TreemapTone) => palette[t];

  return (
    <div className="flex flex-col gap-2">
      {focus && (
        <button type="button" className="self-start text-xs text-accent-default hover:underline" onClick={() => setFocus(null)}>
          ← All faculties
        </button>
      )}
      <svg viewBox={`0 0 ${VIEW_W} ${height}`} width="100%" role="img" aria-label="Portfolio treemap: faculties and their programmes, sized by students">
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={palette.axis} strokeOpacity={0.45} strokeWidth="2" />
          </pattern>
        </defs>
        {shown.map((g, gi) => {
          const r = groupRects[gi]!;
          if (r.w <= 0 || r.h <= 0) return null;
          const inner: Rect = { x: r.x + PAD, y: r.y + HEADER, w: Math.max(0, r.w - 2 * PAD), h: Math.max(0, r.h - HEADER - PAD) };
          const leafRects = squarify(g.children.map((c) => c.value), inner);
          return (
            <g key={g.id}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={palette.grid} />
              <g
                role="button"
                tabIndex={0}
                aria-label={`${g.label}: ${g.value.toLocaleString('en-US')} ${unit}. Zoom in.`}
                onClick={() => setFocus(focus ? null : g.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setFocus(focus ? null : g.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                <rect x={r.x} y={r.y} width={r.w} height={HEADER} fill="transparent" />
                {r.w > 40 && (
                  <text x={r.x + 4} y={r.y + 13} fontSize={11} fontWeight={600} fill={palette.text}>
                    {truncate(`${g.label} · ${g.value.toLocaleString('en-US')}`, r.w - 8)}
                  </text>
                )}
              </g>
              {g.children.map((c, ci) => {
                const lr = leafRects[ci]!;
                if (lr.w <= 0 || lr.h <= 0) return null;
                const body = (
                  <g data-hatched={c.hatched ? 'true' : undefined}>
                    <title>{`${c.label}${c.sublabel ? ` (${c.sublabel})` : ''}: ${c.value.toLocaleString('en-US')} ${unit}`}</title>
                    <rect x={lr.x} y={lr.y} width={lr.w} height={lr.h} fill={fill(c.tone)} fillOpacity={0.8} stroke={palette.grid} strokeWidth={1} />
                    {c.hatched && <rect x={lr.x} y={lr.y} width={lr.w} height={lr.h} fill={`url(#${hatchId})`} />}
                    {lr.w > 60 && lr.h > 20 && (
                      <text x={lr.x + 4} y={lr.y + 14} fontSize={10} fill={palette.text}>
                        {truncate(c.label, lr.w - 8)}
                      </text>
                    )}
                  </g>
                );
                return c.href ? (
                  <a key={c.id} href={c.href} aria-label={`${c.label}: ${c.value.toLocaleString('en-US')} ${unit}`}>
                    {body}
                  </a>
                ) : (
                  <React.Fragment key={c.id}>{body}</React.Fragment>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

Leaf text uses `palette.text` over a tinted fill at 80% opacity; if contrast is poor in either theme during Task 13's screenshot check, switch the label fill to `palette.axis` and lower `fillOpacity` to 0.6 rather than hard-coding a colour.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kku/ui exec vitest run test/portfolio-treemap.test.ts && pnpm --filter @kku/ui exec tsc --noEmit`
Expected: PASS (5 tests), no type errors.

- [ ] **Step 5: Commit** — `feat(ui): PortfolioTreemap with squarified layout`

---

### Task 11: `ScoreGrid`

**Files:**
- Create: `packages/ui/src/viz/score-grid.tsx`
- Modify: `packages/ui/src/viz/index.ts` (add `export * from './score-grid';`)
- Test: `packages/ui/test/score-grid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/test/score-grid.test.ts
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoreGrid } from '../src/viz/score-grid';

describe('ScoreGrid', () => {
  it('score mode: bands cells and renders a dash with "No data" for null', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['A', 'B'],
        mode: 'score',
        rows: [{ id: 'r1', label: 'คณะ', cells: [30, null] }],
      }),
    );
    expect(html).toContain('bg-danger-subtle');
    expect(html).toContain('title="No data"');
    expect(html).toContain('—');
  });

  it('count mode: blank cell reads "not mapped", counts are shaded', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['S1', 'S2'],
        mode: 'count',
        rows: [{ id: 'r1', label: 'คณะ', cells: [12, null] }],
      }),
    );
    expect(html).toContain('title="Not mapped"');
    expect(html).toContain('>12<');
    expect(html).toContain('oklch(var(--color-data-positive)');
  });

  it('wraps a row with detail in a <details> element', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['A'],
        mode: 'score',
        rows: [{ id: 'r1', label: 'คณะ', cells: [70], detail: createElement('p', null, 'radar here') }],
      }),
    );
    expect(html).toContain('<details');
    expect(html).toContain('radar here');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/ui exec vitest run test/score-grid.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write `score-grid.tsx`**

```tsx
import * as React from 'react';
import { cn } from '../lib/cn';

// Rows × columns of shaded cells. Two modes:
//   score — 0-100, banded like the health heatmap (< 40 / 40-65 / ≥ 65);
//   count — non-negative counts, shaded by size relative to the largest cell.
// A null cell is never 0: "—" / "No data" in score mode, "·" / "Not mapped"
// in count mode. A row with `detail` becomes a <details> row, so the detail
// opens without JavaScript and from the keyboard.

export interface ScoreGridRow {
  id: string;
  label: string;
  sublabel?: string;
  cells: Array<number | null>;
  /** Right-hand summary, e.g. a mean. */
  trailing?: string;
  detail?: React.ReactNode;
}

export interface ScoreGridProps {
  columns: string[];
  rows: ScoreGridRow[];
  mode: 'score' | 'count';
  trailingLabel?: string;
  emptyLabel?: string;
  className?: string;
}

function scoreClass(v: number): string {
  if (v < 40) return 'bg-danger-subtle text-danger';
  if (v < 65) return 'bg-warning-subtle text-warning';
  return 'bg-success-subtle text-success';
}

export function ScoreGrid({ columns, rows, mode, trailingLabel, emptyLabel = 'No data to show.', className }: ScoreGridProps) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">{emptyLabel}</p>;
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.filter((c): c is number => c !== null)));
  const template = `minmax(180px, 1.6fr) repeat(${columns.length}, minmax(64px, 1fr))${trailingLabel ? ' minmax(64px, auto)' : ''}`;

  const cell = (v: number | null, i: number) => {
    if (v === null) {
      return mode === 'score' ? (
        <span key={i} title="No data" className="py-1 text-center text-text-tertiary">—</span>
      ) : (
        <span key={i} title="Not mapped" className="py-1 text-center text-text-tertiary">·</span>
      );
    }
    if (mode === 'score') {
      return (
        <span key={i} className={cn('rounded-sm py-1 text-center font-tabular', scoreClass(v))}>
          {v.toFixed(0)}
        </span>
      );
    }
    const alpha = (0.12 + 0.6 * (v / max)).toFixed(2);
    return (
      <span
        key={i}
        className="rounded-sm py-1 text-center font-tabular text-text-primary"
        style={{ backgroundColor: `oklch(var(--color-data-positive) / ${alpha})` }}
      >
        {v}
      </span>
    );
  };

  const line = (r: ScoreGridRow) => (
    <div className="grid items-center gap-1 px-2 py-1 text-xs" style={{ gridTemplateColumns: template }}>
      <span className="min-w-0">
        <span className="block truncate text-text-primary">{r.label}</span>
        {r.sublabel && <span className="block truncate text-[10px] text-text-tertiary">{r.sublabel}</span>}
      </span>
      {r.cells.map(cell)}
      {trailingLabel && <span className="text-right font-tabular text-text-secondary">{r.trailing ?? '—'}</span>}
    </div>
  );

  return (
    <div className={cn('flex flex-col overflow-x-auto rounded-lg border border-default', className)}>
      <div
        className="grid gap-1 border-b border-subtle bg-surface-2 px-2 py-2 text-[10px] uppercase tracking-wide text-text-tertiary"
        style={{ gridTemplateColumns: template }}
      >
        <span />
        {columns.map((c) => (
          <span key={c} className="text-center">{c}</span>
        ))}
        {trailingLabel && <span className="text-right">{trailingLabel}</span>}
      </div>
      {rows.map((r) =>
        r.detail ? (
          <details key={r.id} className="border-b border-subtle last:border-b-0">
            <summary className="cursor-pointer list-none hover:bg-surface-2">{line(r)}</summary>
            <div className="px-4 py-2">{r.detail}</div>
          </details>
        ) : (
          <div key={r.id} className="border-b border-subtle last:border-b-0">{line(r)}</div>
        ),
      )}
    </div>
  );
}
```

`bg-danger-subtle` / `bg-warning-subtle` / `bg-success-subtle` and `text-danger` / `text-warning` / `text-success` are the classes `heatmap.tsx` already uses. `border-default` and `border-subtle` are the border colours that emit CSS.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kku/ui exec vitest run test/score-grid.test.ts && pnpm --filter @kku/ui exec tsc --noEmit`
Expected: PASS (3 tests), no type errors.

- [ ] **Step 5: Commit** — `feat(ui): ScoreGrid for scorecards and coverage grids`

---

### Task 12: Chapter building blocks in the web app

**Files (all under `apps/web/app/dashboards/executive-landscape/chapters/`):**
- Create: `fetch-chapter.ts`, `chapter-header.tsx`, `atlas-bubble.tsx`, `atlas-table.tsx`

- [ ] **Step 1: `fetch-chapter.ts`**

```ts
import type { ApiMeta } from '@kku/shared';
import { apiFetchEnvelope } from '@/lib/api-client';

/** A chapter's data + envelope meta, or null when the endpoint fails. The
 *  failure is logged server-side and the chapter renders its own fallback,
 *  so one slow or broken chapter never breaks the page. */
export async function fetchChapter<T>(path: string): Promise<{ data: T; meta: ApiMeta } | null> {
  try {
    const env = await apiFetchEnvelope<T>(path);
    return env.error === null ? { data: env.data, meta: env.meta } : null;
  } catch (err) {
    console.error(`[executive-landscape] ${path} failed`, err);
    return null;
  }
}
```

- [ ] **Step 2: `chapter-header.tsx`**

```tsx
import type { ChapterAnswer } from '@kku/db';

export function ChapterHeader({
  id,
  number,
  kicker,
  question,
  answer,
}: {
  id: string;
  number: number;
  kicker: string;
  question: string;
  answer: ChapterAnswer | null;
}) {
  return (
    <header id={id} className="scroll-mt-[5rem] border-t-2 border-strong pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        Chapter {number} · {kicker}
      </p>
      <h2 className="mt-1 text-lg font-semibold text-text-primary">{question}</h2>
      {answer && (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-tabular text-3xl font-semibold text-text-primary">{answer.figure ?? '—'}</span>
          <span className="text-sm text-text-secondary">{answer.sentence}</span>
        </p>
      )}
    </header>
  );
}

export function ChapterUnavailable({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-default bg-surface-1 p-4 text-sm text-text-secondary">
      {message ?? 'This chapter could not load. Reload the page to try again.'}
    </div>
  );
}

export function ChapterSkeleton({ id, number, kicker }: { id: string; number: number; kicker: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p id={id} className="scroll-mt-[5rem] border-t-2 border-strong pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        Chapter {number} · {kicker}
      </p>
      <div className="h-[18rem] animate-shimmer rounded-lg bg-surface-2" aria-hidden />
    </div>
  );
}

/** "Listed, not plotted" — what a chart could not place, with reasons. */
export function UnplottedList({ items, noun = 'programmes' }: { items: Array<{ id: string; label: string; reason: string }>; noun?: string }) {
  if (items.length === 0) return null;
  return (
    <details className="text-xs text-text-tertiary">
      <summary className="cursor-pointer">
        {items.length} {noun} not plotted
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((u) => (
          <li key={u.id}>
            {u.label} — {u.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 3: `atlas-bubble.tsx`** (client wrapper: functions cannot cross the server → client boundary)

```tsx
'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { BubbleMatrix, type Bubble, type BubbleMatrixProps } from '@kku/ui';
import type { AtlasPoint, PlotFrame } from '@kku/db';

export function AtlasBubble({
  points,
  frame,
  axisXLabel,
  axisYLabel,
  quadrantLabels,
  width = 560,
  height = 400,
}: {
  points: AtlasPoint[];
  frame: PlotFrame;
  axisXLabel: string;
  axisYLabel: string;
  quadrantLabels?: BubbleMatrixProps['quadrantLabels'];
  width?: number;
  height?: number;
}) {
  const router = useRouter();
  const hrefById = new Map(points.map((p) => [p.id, p.href]));
  const bubbles: Bubble[] = points.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y, size: p.size, color: 0, tone: p.tone }));
  return (
    <div className="overflow-x-auto">
      <BubbleMatrix
        bubbles={bubbles}
        axisXLabel={axisXLabel}
        axisYLabel={axisYLabel}
        split={frame.split}
        diagonal={frame.diagonal}
        xTicks={frame.xTicks}
        yTicks={frame.yTicks}
        quadrantLabels={quadrantLabels}
        width={width}
        height={height}
        onBubbleClick={(b) => {
          const href = hrefById.get(b.id);
          if (href) router.push(href as Route);
        }}
      />
    </div>
  );
}
```

`import type` from `@kku/db` is erased at build, so the client bundle does not pull Prisma.

- [ ] **Step 4: `atlas-table.tsx`** (the "show data" table)

```tsx
export function AtlasTable({
  rows,
  first = 'Programme',
}: {
  rows: Array<{ id: string; label: string; values: Record<string, number | string | null> }>;
  first?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">No rows.</p>;
  const keys = Object.keys(rows[0]!.values);
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-surface-2 text-text-tertiary">
        <tr>
          <th className="px-2 py-1 text-left">{first}</th>
          {keys.map((k) => (
            <th key={k} className="px-2 py-1 text-right">{k}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-subtle">
            <td className="px-2 py-1 text-text-primary">{r.label}</td>
            {keys.map((k) => (
              <td key={k} className="px-2 py-1 text-right font-tabular text-text-secondary">
                {r.values[k] === null ? '—' : typeof r.values[k] === 'number' ? (r.values[k] as number).toLocaleString('en-US') : r.values[k]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors. If `BubbleMatrixProps` / `Bubble` are not re-exported from `@kku/ui`'s root, check `packages/ui/src/index.ts` re-exports `./viz` (it does for `BubbleMatrix`).

Commit — `feat(web): landscape atlas chapter building blocks`

---

### Task 13: Chapter sections and the page restructure

**Files:**
- Create (under `chapters/`): `shape-section.tsx`, `position-section.tsx`, `market-section.tsx`, `capability-section.tsx`, `future-section.tsx`
- Modify: `apps/web/app/dashboards/executive-landscape/page.tsx`

- [ ] **Step 1: `shape-section.tsx`**

```tsx
import { ChartFrame, PortfolioTreemap, type TreemapGroup } from '@kku/ui';
import type { ShapeChapter } from '@kku/db';
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
        description="Faculty → programme. Area = currently active students; colour = health score (< 40 danger, 40–65 needs attention, ≥ 65 healthy; hatched = no score). Click a faculty to zoom in, a programme to open its Deep-Dive."
        meta={meta}
        height={470}
        chart={<PortfolioTreemap nodes={nodes} height={420} unit="active students" emptyLabel="No programme in this scope has active-student data." />}
        dataTable={
          <AtlasTable
            rows={data.faculties.flatMap((f) =>
              f.children.map((c) => ({
                id: c.id,
                label: c.label,
                values: { Faculty: f.sublabel || f.label, Code: c.sublabel, 'Active students': c.value, 'Health score': c.health },
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
```

- [ ] **Step 2: `position-section.tsx`**

```tsx
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
```

- [ ] **Step 3: `market-section.tsx`** (reuses `/gap/map`)

```tsx
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
```

- [ ] **Step 4: `capability-section.tsx`**

```tsx
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
```

- [ ] **Step 5: `future-section.tsx`**

```tsx
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
```

- [ ] **Step 6: Restructure `page.tsx`**

Make these edits to `apps/web/app/dashboards/executive-landscape/page.tsx`:

1. **Imports.** Remove `StrategicMatrixHero`, the `CockpitMatrix` type import and `apiFetch`. Add:

```ts
import { Suspense } from 'react';
import { SectionRail, type RailItem } from '@/components/evidence';
import { ChapterSkeleton } from './chapters/chapter-header';
import { ShapeSection } from './chapters/shape-section';
import { PositionSection } from './chapters/position-section';
import { MarketSection, MARKET_BASES, type MarketBasis } from './chapters/market-section';
import { CapabilitySection } from './chapters/capability-section';
import { FutureSection } from './chapters/future-section';
```

2. **Signature:** `export default async function ExecutiveLandscapePage({ searchParams }: { searchParams: { basis?: string } }) {` and, after the scope code, `const basis: MarketBasis = (MARKET_BASES as readonly string[]).includes(searchParams.basis ?? '') ? (searchParams.basis as MarketBasis) : 'all';`

3. **Rename** `matrixQuery` → `scopeQuery` (same value). Delete the `strategicMatrix` fetch.

4. **Rail items** (before `return`):

```ts
  const railItems: RailItem[] = [
    { href: '#attention', label: 'Needs attention' },
    { href: '#shape', marker: '1', label: 'Shape' },
    { href: '#position', marker: '2', label: 'Position' },
    { href: '#market', marker: '3', label: 'Market' },
    { href: '#capability', marker: '4', label: 'Capability' },
    { href: '#future', marker: '5', label: 'Future' },
  ];
```

5. **JSX.** Keep the header, hero stats, intake-policy note and pulse strip exactly as they are. Replace everything from the `{/* HERO — BCG-style Strategic Matrix … */}` block down to (not including) the footer "Coverage & data quality" card with:

```tsx
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="hidden lg:block">
            <SectionRail label="Chapters" items={railItems} />
          </div>
          <div className="flex min-w-0 flex-col gap-10">
            <section id="attention" className="scroll-mt-[5rem] grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card padding="md">
                <AlertColumn tone="urgent" alerts={overview.urgent} title="Urgent review" emptyHint="No programs in the urgent-review window." />
              </Card>
              <Card padding="md">
                <AlertColumn tone="momentum" alerts={overview.momentum} title="Momentum (3-yr enrolment growth)" emptyHint="No high-growth programs detected in the 3-yr window." />
              </Card>
            </section>

            <Suspense fallback={<ChapterSkeleton id="shape" number={1} kicker="Shape" />}>
              <ShapeSection scopeQuery={scopeQuery}>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {/* the existing "Health score · by faculty" PanelFrame, unchanged */}
                  {/* the existing "Demographic mix" Card, unchanged */}
                </div>
              </ShapeSection>
            </Suspense>

            <Suspense fallback={<ChapterSkeleton id="position" number={2} kicker="Position" />}>
              <PositionSection scopeQuery={scopeQuery}>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {/* the existing "Lifecycle verdict" PanelFrame, unchanged */}
                  {/* the existing "Curriculum modernity verdict" PanelFrame, rendered when modernityCounts is set */}
                </div>
              </PositionSection>
            </Suspense>

            <Suspense fallback={<ChapterSkeleton id="market" number={3} kicker="Market" />}>
              <MarketSection scopeQuery={scopeQuery} basis={basis} />
            </Suspense>

            <Suspense fallback={<ChapterSkeleton id="capability" number={4} kicker="Capability" />}>
              <CapabilitySection scopeQuery={scopeQuery} />
            </Suspense>

            <Suspense fallback={<ChapterSkeleton id="future" number={5} kicker="Future" />}>
              <FutureSection scopeQuery={scopeQuery} />
            </Suspense>
          </div>
        </div>
```

Move the four existing panels into the marked slots by cutting their JSX from the old layout — do not rewrite them. The four `{/* … */}` lines above are placement markers for that move, not code to keep; delete them once the panels are in place. The old "RISK + MOMENTUM" grid is now the `#attention` section; delete the old copy.

6. **Footer card:** delete the `Matrix coverage` `<Stat>` (it read `strategicMatrix`). Keep the other three stats and the methodology/scope line; add `landscape-atlas.v1` after the overview version: `Methodology version: {overview.methodologyVersion} · landscape-atlas.v1`.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter web exec tsc --noEmit && npx eslint apps/web/app/dashboards/executive-landscape packages/ui/src/viz/portfolio-treemap.tsx packages/ui/src/viz/score-grid.tsx packages/ui/src/viz/bubble-matrix.tsx packages/db/src/landscape-atlas apps/api/src/landscape`
Expected: no errors (in particular no hard-coded-colour lint errors).

- [ ] **Step 8: Check the page on dev with headless Chromium**

Restart the api and web dev servers (Tasks 1–11 changed `packages/*`). Write `<scratchpad>/atlas-shots.mjs`:

```js
import { chromium } from '/home/denpong/projects/program-landscape/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs';
const OUT = process.argv[2];
const b = await chromium.launch();
const boot = await b.newContext({ viewport: { width: 1500, height: 1000 } });
const bp = await boot.newPage();
await bp.goto('http://localhost:3000/signin', { waitUntil: 'domcontentloaded' });
await bp.waitForTimeout(4000);
await bp.click('form button[type=submit]');
await bp.waitForFunction(() => !location.pathname.startsWith('/signin'), null, { timeout: 60000 });
const state = await boot.storageState();
await boot.close();
for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, storageState: state });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('http://localhost:3000/dashboards/executive-landscape', { waitUntil: 'networkidle', timeout: 180000 });
  for (const id of ['shape', 'position', 'market', 'capability', 'future']) {
    await p.locator(`#${id}`).scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/atlas-${id}-${theme}.png` });
  }
  const body = await p.locator('main').innerText();
  console.log(theme, 'console errors:', errors.length, '| unavailable chapters:', (body.match(/could not load/g) ?? []).length, '| cuid-like ids on screen:', (body.match(/\bc[a-z0-9]{24}\b/g) ?? []).length);
  await ctx.close();
}
await b.close();
```

Run: `node <scratchpad>/atlas-shots.mjs <scratchpad>` and look at all ten screenshots.
Expected: every chapter renders (no "could not load"), 0 console errors, 0 cuid-like ids on screen, treemap labels legible in both themes, guides and quadrant labels visible, the diagonal present on the Market chart. Fix anything that is not, then re-run.

- [ ] **Step 9: Commit** — `feat(web): Executive Landscape becomes a chaptered landscape atlas`

---

### Task 14: Methodology documentation

**Files:**
- Create: `docs/methodologies/landscape-atlas.md`
- Modify: `docs/methodologies/README.md` (one row in the "Implemented" table, after `program-overlap-recommendation`)

- [ ] **Step 1: Write `docs/methodologies/landscape-atlas.md`**

```markdown
# Landscape atlas — `landscape-atlas.v1`

| Version | Date | Change |
|---|---|---|
| `landscape-atlas.v1` | 2026-10-05 | First version: five chapters, seven visuals on the Executive Landscape. |

**Where:** `/dashboards/executive-landscape`. **Code:** `packages/db/src/landscape-atlas/`
(builders are pure; `read.ts` is the only I/O). **API:** `GET /api/v1/landscape/{shape,position,capability,future}`;
Market reuses `GET /api/v1/gap/map`. **Spec:** `docs/superpowers/specs/2026-10-05-landscape-atlas-design.md`.

The atlas composes existing measures; it introduces no new score. Its own rules are the
axis definitions, the split lines, the "listed, not plotted" rule and the answer lines below.

## Rules that apply everywhere

- **Missing is never 0.** A programme or faculty a chart cannot place is listed beneath it with the reason.
- **Answer lines are computed by fixed rules**, never by AI.
- **Scope** is clamped server-side (`clampScopeForUser`); a programme-level user sees their programme.
- **Freshness** on each chapter is the time it was computed; results are cached 5 minutes per chapter and scope.

## Chapter 1 · Shape — portfolio treemap
- Faculty → programme. **Area** = currently active students, `SUM(student_cohort_distributions.student_count)` (rows passing `realDataWhere()`).
- **Colour** = overall health score bands: < 40 danger, 40–65 needs attention, ≥ 65 healthy; hatched = no score.
- **Not drawn:** no active-student data; zero active students.
- **Answer:** share of active students in the 5 largest faculties; programmes with fewer than 15 active students.

## Chapter 2 · Position (bachelor programmes)
**Growth–share matrix.**
- X = TCAS round-3 applications ÷ round-3 seats in the latest entry year with data (log). **Split 1.0.** Linked TCAS rows hold round 3 only, which is part of admissions, not all of it. In 2568 round 3 is split into 3.1 and 3.2 rows carrying the same figures, so each course code is counted once per year, then course codes are summed.
- Y = 3-year enrolment change, % (latest year vs three years earlier, `enrollment_metrics`), axis clamped to −100…+200 % (table keeps the raw value). **Split 0 %** (0 counts as not growing).
- Size = active students; colour = net contribution ÷ active students.
- Quadrants: Star (≥ 1.0, growing), Cash cow (≥ 1.0, not growing), Question (< 1.0, growing), Dog (< 1.0, not growing).
- Not plotted: no TCAS rows; quota 0; zero applications; no enrolment three years earlier.

**Health × risk action map.**
- X = overall health score, **split 65** (the "healthy" band). Y = KKU 5×5 risk matrix score 1–25, **split 10** (start of HIGH).
- Act now (< 65, ≥ 10), Watch (≥ 65, ≥ 10), Fix quietly (< 65, < 10), Protect (≥ 65, < 10). Colour = KKU risk level.
- Not plotted: risk NEEDS_DATA; no health score.

**Answer:** programmes in Act now, plus the number of Dogs.

## Chapter 3 · Market — demand vs supply diagonal
- One dot per field of study from `gap-map.v2` (bachelor universe, default thresholds, demand basis selectable).
- X = KKU graduate share, Y = job-advert share, **same log domain on both axes**, so the diagonal is demand = supply.
- White-space fields (no KKU programme) sit on the left edge. Not plotted: supply-unknown, too-few-postings, zero adverts.
- **Answer:** under-served + white-space fields, and over-served fields.

## Chapter 4 · Capability — research & grant engine (by faculty)
- Staff = distinct active `faculty_members` linked to the faculty's canonical programmes (as the health score's Capability).
- X = `research_outputs` (passing `realDataWhere()`) in the last 3 complete calendar years ÷ 3 ÷ staff.
- Y = `grantAward(staff).raw.bahtPerStaffPerYear` — last 3 complete Thai fiscal years; a project counts for every faculty with a member on it; budgets never split. Log axis with a ฿10k floor.
- Guides at the KKU medians. Not plotted: no active staff; grants source never synced.
- **Caveat:** about 30 % of co-investigator ids match no HR record, so grants are a lower bound.
- **Answer:** faculties at ฿1M or more per staff member a year.

## Chapter 5 · Future
**Future-fit scorecard** — three columns (automation resilience dropped, see below):
- AI readiness = mean of the faculty's programmes' `programAiReadiness().overallScore`, excluding programmes with no extracted skills.
- Digital intelligence = `dqCompetencyByScope(faculty).rawMean` (respondent-weighted, never a mean of programme scores).
- Relevance = mean of the programmes' health relevance dimension.
- Row mean over present columns only; rows with no column sort last.

**National-strategy coverage:** faculties × the 8 `sectors`; a cell counts the faculty's programmes with at least one
`program_skills` row whose skill maps to the sector (`skill_sectors`). Empty = "not mapped", not "no capacity".

**Answer:** sectors fed by fewer than 15 programmes, naming any with none mapped.

**Why there is no automation-resilience column (D8):** only 537 of 4,372 skills carry an automation-risk tag (22 HIGH),
so the share of high-risk skills has median 0 and max 0.14 across programmes; the column would read 86–100 for every
faculty. AI readiness already carries a skill-resilience sub-score that classifies every skill.

## Known limits
- Position covers bachelor programmes only (TCAS and the risk register are bachelor-only).
- Sector coverage depends on skills extracted from curriculum PDFs.
- The Cockpit's Strategic Matrix still uses stand-in axes; this atlas does not change it.
```

- [ ] **Step 2: Add the README row**

In `docs/methodologies/README.md`, after the `program-overlap-recommendation` row, add:

```markdown
| `landscape-atlas` | Executive Landscape (five chapters) | `landscape-atlas.v1` | [landscape-atlas.md](./landscape-atlas.md) |
```

- [ ] **Step 3: Commit** — `docs: landscape-atlas.v1 methodology`

---

### Task 15: Full verification

- [ ] **Step 1: Run every affected test suite**

Run:
```bash
pnpm --filter @kku/db exec vitest run test/landscape-atlas-*.test.ts
pnpm --filter @kku/ui test
pnpm --filter api exec vitest run test/landscape-controller.test.ts test/gap-controller.test.ts
```
Expected: all pass. Compare the `@kku/ui` file and test counts with the run before Task 9 (3 new files, 13 new tests) so a dropped file cannot hide behind a green line.

- [ ] **Step 2: Typecheck all four packages**

Run: `pnpm --filter @kku/db exec tsc --noEmit && pnpm --filter @kku/ui exec tsc --noEmit && pnpm --filter api exec tsc --noEmit && pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Re-run the screenshot check from Task 13 Step 8** and confirm the same expectations. Also load the page as a faculty-scoped user if one exists on dev (`SELECT email FROM users WHERE role = 'FACULTY_USER' LIMIT 1`) by signing in with that email on the dev sign-in form; every chapter should show only that faculty.

- [ ] **Step 4: Update the project status** — add a "Landscape atlas" bullet under *Recent decisions* in `CLAUDE.md` (what shipped, `landscape-atlas.v1`, D8, NOT deployed) and commit — `docs: landscape atlas status`.
```
