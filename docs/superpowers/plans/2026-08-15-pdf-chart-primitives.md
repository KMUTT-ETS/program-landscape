# PDF Chart Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested, print-first SVG chart library inside `@kku/pdf-templates` that the rebuilt program deep-dive PDF will consume.

**Architecture:** Nine pure `data → SVG` React components with no runtime charting library. SVG user units are millimetres so geometry is authored in page units. Every chart is wrapped by a frame component that makes source/method provenance a required prop. All output is deterministic, so golden-file snapshots are the primary regression net.

**Tech Stack:** TypeScript (strict, no `any`), React 18 `renderToStaticMarkup`, Vitest, Gotenberg/Chromium for the render check.

---

## Scope — this is plan 1 of 2

The spec (`docs/superpowers/specs/2026-08-15-program-deepdive-pdf-magazine-design.md`) covers two
separable subsystems:

1. **The chart primitive library** — this plan. Self-contained, independently testable, and useful on
   its own.
2. **The template rebuild** — schema refactor (204 `z.string()` → numbers), `magazine-css.ts`, the
   `program-detail` rewrite, appendix, and end-to-end render gate. A separate plan, written **after
   this one lands**.

The split is not cosmetic. Task 1 is a spike that can invalidate the whole approach; writing a
detailed template-rewrite plan before knowing its outcome would be speculation.

## File structure

| File | Responsibility |
|---|---|
| `packages/pdf-templates/src/charts/types.ts` | `Provenance`, shared prop interfaces. No logic. |
| `packages/pdf-templates/src/charts/scale.ts` | `pt()`, `linear()`, `niceTicks()`. Pure maths, no React. |
| `packages/pdf-templates/src/charts/palette.ts` | `PRINT_PALETTE` + semantic colours. Single colour source. |
| `packages/pdf-templates/src/charts/chart-frame.tsx` | Title, Thai lede, SVG canvas, provenance caption, empty state. |
| `packages/pdf-templates/src/charts/bars-h.tsx` | Horizontal bars. |
| `packages/pdf-templates/src/charts/bars-stacked.tsx` | Stacked columns. |
| `packages/pdf-templates/src/charts/line-trend.tsx` | Line/area with optional projection band. |
| `packages/pdf-templates/src/charts/radar.tsx` | Radar, 3+ axes. |
| `packages/pdf-templates/src/charts/funnel.tsx` | Descending stage funnel. |
| `packages/pdf-templates/src/charts/waterfall.tsx` | Waterfall with running total. |
| `packages/pdf-templates/src/charts/dot-range.tsx` | Value against a peer min–max range. |
| `packages/pdf-templates/src/charts/matrix.tsx` | Coverage grid. |
| `packages/pdf-templates/src/charts/timeline.tsx` | Dated events on an axis. |
| `packages/pdf-templates/src/charts/index.ts` | Barrel. |
| `packages/pdf-templates/test/*.test.ts(x)` | One test file per module. Repo convention: never co-located. |

Every primitive is a pure function of its props: no hooks, no state, no measurement, no `Date.now()`.

---

## Task 1: Spike — does Thai text survive SVG `<text>` through Gotenberg?

**This is a decision gate, not a feature.** It is deliberately throwaway code. If Thai shapes badly
inside SVG `<text>`, the entire hand-rolled approach is wrong and we stop and redesign rather than
writing eight more primitives on a broken foundation.

**Files:**
- Create: `packages/pdf-templates/spike/thai-svg-spike.tsx` (deleted in Step 6)

- [ ] **Step 1: Confirm Gotenberg is up and has the Thai fonts**

```bash
docker ps --filter name=gotenberg --format '{{.Names}} {{.Status}}'
docker exec program-landscape-gotenberg fc-list | grep -ci sarabun
```

Expected: a running container, and a count of **4** (the four TH Sarabun New faces). If the count is
0, stop — fonts are missing from the image; see `infra/gotenberg/README.md` and rebuild before
continuing.

- [ ] **Step 2: Write the spike**

```tsx
// packages/pdf-templates/spike/thai-svg-spike.tsx
// THROWAWAY. Deleted at the end of Task 1. Renders Thai text three ways
// and asks Chromium to make a PDF of it, so we can eyeball whether Thai
// tone marks and vowels shape correctly inside SVG <text>.
import * as React from 'react';
import { writeFileSync } from 'node:fs';
import { renderTemplateToHtml } from '../src/render';
import { GotenbergClient } from '@kku/shared';

// Deliberately dense with above/below vowels and tone marks — this is
// where SVG text shaping fails if it is going to.
const SAMPLES = [
  'ปีที่ 1 · ตกค้าง',
  'หลักสูตรวิศวกรรมคอมพิวเตอร์',
  'อัตราการมีงานทำ 82%',
  'ปีการศึกษา 2569',
];

function Spike() {
  return (
    <html lang="th">
      <head>
        <meta charSet="utf-8" />
        <style>{`
          @page { size: A4; margin: 20mm 15mm; }
          body { font-family: 'TH Sarabun New','Sarabun',sans-serif; font-size: 16pt; }
          h2 { font-size: 18pt; margin: 10pt 0 4pt; }
        `}</style>
      </head>
      <body>
        <h2>1 · HTML text (control — known good)</h2>
        {SAMPLES.map((s) => (<p key={s}>{s}</p>))}

        <h2>2 · SVG text, user units = mm</h2>
        <svg width="180mm" height="40mm" viewBox="0 0 180 40">
          <rect x="0" y="0" width="180" height="40" fill="#f6f4f0" />
          {SAMPLES.map((s, i) => (
            // 8pt expressed in mm — the pt() helper Task 2 formalises
            <text key={s} x="4" y={9 + i * 8} fontSize={8 * 0.3528}
                  fontFamily="'TH Sarabun New','Sarabun',sans-serif" fill="#111">
              {s}
            </text>
          ))}
        </svg>

        <h2>3 · SVG text, user units = px (comparison)</h2>
        <svg width="680" height="150" viewBox="0 0 680 150">
          <rect x="0" y="0" width="680" height="150" fill="#f6f4f0" />
          {SAMPLES.map((s, i) => (
            <text key={s} x="14" y={34 + i * 32} fontSize="21"
                  fontFamily="'TH Sarabun New','Sarabun',sans-serif" fill="#111">
              {s}
            </text>
          ))}
        </svg>
      </body>
    </html>
  );
}

async function main(): Promise<void> {
  const client = new GotenbergClient({
    baseUrl: process.env.GOTENBERG_URL ?? 'http://localhost:3001',
    requestTimeoutMs: 55_000,
  });
  const result = await client.convertHtml({
    indexHtml: `<!doctype html>${renderTemplateToHtml(<Spike />)}`,
    options: {
      paperFormat: 'A4',
      orientation: 'portrait',
      marginsMm: { top: 20, bottom: 20, left: 15, right: 15 },
      printBackground: true,
    },
  });
  writeFileSync('/tmp/thai-svg-spike.pdf', result.buffer);
  console.log(`OK — ${result.byteSize} bytes in ${result.durationMs}ms → /tmp/thai-svg-spike.pdf`);
}

void main();
```

- [ ] **Step 3: Run it**

Run: `pnpm tsx packages/pdf-templates/spike/thai-svg-spike.tsx`
Expected: `OK — <n> bytes in <ms>ms → /tmp/thai-svg-spike.pdf`

If `GOTENBERG_URL` differs in your `.env`, pass it: `GOTENBERG_URL=http://localhost:3001 pnpm tsx ...`

- [ ] **Step 4: Inspect the PDF and decide**

Open `/tmp/thai-svg-spike.pdf`. Compare block 1 (HTML, known good) against blocks 2 and 3.

**Pass criteria — all four must hold in block 2:**
1. Tone marks (่ ้) sit above their consonant, not beside or overlapping it.
2. Upper vowels (ิ ี ั) and lower vowels (ุ ู) are positioned correctly, not baseline-aligned.
3. No tofu boxes (□) anywhere.
4. Text in block 2 is visually the same size as block 1 — this confirms the mm-unit + `pt()`
   conversion lands at the right physical size.

Also confirm the text is selectable in a PDF reader (i.e. real glyphs, not outlined paths).

- [ ] **Step 5: Record the verdict**

Append the outcome to the spec under a new `## Spike result` heading — pass or fail, with what you
saw. This is the record of why the approach was kept or abandoned.

**If it fails:** STOP. Do not start Task 2. Report which criterion failed. The likely fallbacks, in
order of preference, are (a) render chart text as HTML positioned over the SVG rather than inside it,
(b) `foreignObject` inside the SVG, (c) reconsider Recharts, which has the identical problem since it
also emits SVG `<text>` — meaning failure here probably means *no* SVG charting works and charts must
be HTML/CSS constructs.

- [ ] **Step 6: Delete the spike and commit the verdict**

```bash
rm -rf packages/pdf-templates/spike
git add docs/superpowers/specs/2026-08-15-program-deepdive-pdf-magazine-design.md
git commit -m "docs(specs): record Thai-in-SVG spike result for the deep-dive PDF"
```

---

## Task 2: Scale maths — `pt()`, `linear()`, `niceTicks()`

**Files:**
- Create: `packages/pdf-templates/src/charts/scale.ts`
- Test: `packages/pdf-templates/test/scale.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf-templates/test/scale.test.ts
import { describe, expect, it } from 'vitest';
import { linear, niceTicks, pt } from '../src/charts/scale';

describe('pt', () => {
  it('converts points to millimetres', () => {
    expect(pt(72)).toBeCloseTo(25.4, 4);   // 72pt = 1 inch = 25.4mm
    expect(pt(16)).toBeCloseTo(5.6448, 4); // Cabinet body size
  });
});

describe('linear', () => {
  it('maps a domain onto a range', () => {
    const s = linear([0, 100], [0, 180]);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(90);
    expect(s(100)).toBe(180);
  });

  it('supports an inverted range, as SVG y-axes need', () => {
    const s = linear([0, 10], [60, 0]);
    expect(s(0)).toBe(60);
    expect(s(10)).toBe(0);
  });

  // A single-valued series must not divide by zero and produce NaN —
  // a NaN in a path attribute silently renders nothing at all.
  it('collapses a zero-width domain onto the range start', () => {
    const s = linear([5, 5], [0, 100]);
    expect(s(5)).toBe(0);
    expect(Number.isNaN(s(5))).toBe(false);
  });
});

describe('niceTicks', () => {
  it('produces round numbers', () => {
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('handles a non-zero floor', () => {
    expect(niceTicks(12, 47)).toEqual([20, 30, 40]);
  });

  it('returns a single tick when min equals max', () => {
    expect(niceTicks(7, 7)).toEqual([7]);
  });

  it('returns nothing for non-finite input rather than looping forever', () => {
    expect(niceTicks(0, Number.NaN)).toEqual([]);
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kku/pdf-templates test -- scale`
Expected: FAIL — `Cannot find module '../src/charts/scale'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/pdf-templates/src/charts/scale.ts
// Pure scale maths for print-first SVG charts. No React, no DOM.
//
// Charts author geometry in MILLIMETRES: <svg width="180mm" viewBox="0 0 180 60">
// means one user unit is one millimetre. Font sizes are the one thing that
// must be converted, because `fontSize={8}` in that space means 8mm, not 8pt.

const MM_PER_POINT = 25.4 / 72;

/** Points → millimetres. Use for every fontSize and stroke-width in a chart. */
export function pt(points: number): number {
  return points * MM_PER_POINT;
}

/**
 * Linear scale from a data domain to a pixel/mm range.
 * A zero-width domain returns the range start rather than NaN — a NaN in an
 * SVG coordinate makes the element vanish with no error.
 */
export function linear(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => r0;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * Round, human-readable tick values covering [min, max].
 * Steps are constrained to 1, 2, 5 × 10^n — the standard nice-number rule.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  if (min > max) return niceTicks(max, min, count);

  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const niceStep =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  const ticks: number[] = [];
  const first = Math.ceil(min / niceStep) * niceStep;
  // Epsilon guards against float drift dropping the final tick.
  for (let v = first; v <= max + niceStep * 1e-9; v += niceStep) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @kku/pdf-templates test -- scale`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add packages/pdf-templates/src/charts/scale.ts packages/pdf-templates/test/scale.test.ts
git commit -m "feat(pdf-templates): add print chart scale maths (pt, linear, niceTicks)"
```

---

## Task 3: Palette, and remove the dead Recharts dependency

`ChartForPrint` is the only Recharts consumer in `pdf-templates`, and no template imports
`ChartForPrint`. Rescue its palette, delete it, drop the dependency.

**Files:**
- Create: `packages/pdf-templates/src/charts/palette.ts`
- Delete: `packages/pdf-templates/src/components/chart-for-print.tsx`
- Modify: `packages/pdf-templates/package.json`, `packages/pdf-templates/src/index.ts`
- Test: `packages/pdf-templates/test/palette.test.ts`

- [ ] **Step 1: Confirm nothing imports what you are about to delete**

```bash
grep -rn "ChartForPrint\|PRINT_PALETTE" --include="*.ts" --include="*.tsx" apps packages | grep -v node_modules
```

Expected: hits only inside `packages/pdf-templates/src/components/chart-for-print.tsx` and its export
line in `src/index.ts`. If any template or app imports it, STOP and report — the premise is wrong.

- [ ] **Step 2: Write the failing test**

```ts
// packages/pdf-templates/test/palette.test.ts
import { describe, expect, it } from 'vitest';
import { PRINT_PALETTE, SEMANTIC } from '../src/charts/palette';

describe('PRINT_PALETTE', () => {
  it('has at least 6 series colours', () => {
    expect(PRINT_PALETTE.length).toBeGreaterThanOrEqual(6);
  });

  it('is entirely uppercase 6-digit hex — no CSS variables survive SSR', () => {
    for (const c of PRINT_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('carries the KKU cardinal as the second series colour', () => {
    expect(PRINT_PALETTE[1]).toBe('#9C1D2E');
  });
});

describe('SEMANTIC', () => {
  it('exposes the four status colours the templates already use', () => {
    expect(Object.keys(SEMANTIC).sort()).toEqual(['danger', 'info', 'success', 'warning']);
    for (const c of Object.values(SEMANTIC)) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @kku/pdf-templates test -- palette`
Expected: FAIL — `Cannot find module '../src/charts/palette'`

- [ ] **Step 4: Write the implementation**

```ts
/* eslint-disable no-restricted-syntax --
 * Hex literals are correct here. PDFs are always light theme, and CSS custom
 * properties cannot be resolved inside server-rendered SVG — Gotenberg gets
 * markup with no <html data-theme> to read from. These are the light-mode
 * values of packages/design/src/css/tokens.css, evaluated offline. Mirror any
 * token change here in the same commit.
 */

// packages/pdf-templates/src/charts/palette.ts

/** Categorical series colours, in assignment order. */
export const PRINT_PALETTE = [
  '#2B4BA4', // chart-1 — indigo
  '#9C1D2E', // chart-2 — KKU cardinal
  '#046C4E', // chart-3 — green
  '#A15C00', // chart-4 — amber
  '#5E2D90', // chart-5 — violet
  '#00716B', // chart-6 — teal
] as const;

/** Status colours, matching base-css.ts `.danger` / `.warning` / `.success` / `.info`. */
export const SEMANTIC = {
  danger: '#B42318',
  warning: '#A15C00',
  success: '#046C4E',
  info: '#2B4BA4',
} as const;

/** Neutral furniture — axes, rules, gridlines, muted labels. */
export const INK = {
  axis: '#111111',
  rule: '#DDDDDD',
  muted: '#777777',
  surface: '#F6F4F0',
} as const;

/** Series colour by index, wrapping when there are more series than colours. */
export function seriesColour(index: number): string {
  return PRINT_PALETTE[index % PRINT_PALETTE.length] as string;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @kku/pdf-templates test -- palette`
Expected: PASS — 4 tests

- [ ] **Step 6: Delete `ChartForPrint` and drop the dependency**

```bash
git rm packages/pdf-templates/src/components/chart-for-print.tsx
```

In `packages/pdf-templates/src/index.ts`, remove the line exporting `chart-for-print`.
In `packages/pdf-templates/package.json`, remove `"recharts": "^2.15.0"` from `dependencies`.

Then:

```bash
pnpm install
```

- [ ] **Step 7: Verify the workspace still builds**

Run: `pnpm --filter @kku/pdf-templates typecheck && pnpm --filter @kku/pdf-templates test`
Expected: both pass. If typecheck fails on a missing `chart-for-print` export, you missed the barrel
line in Step 6.

- [ ] **Step 8: Commit**

```bash
git add -A packages/pdf-templates pnpm-lock.yaml
git commit -m "feat(pdf-templates): add print palette; delete unused ChartForPrint and recharts dep"
```

---

## Task 4: `ChartFrame` — the wrapper that makes provenance unforgettable

Council-readiness rule 1 requires source, freshness and method on every chart. Making them required
props of the only wrapper means a chart cannot be shipped without them.

**Files:**
- Create: `packages/pdf-templates/src/charts/types.ts`, `packages/pdf-templates/src/charts/chart-frame.tsx`
- Test: `packages/pdf-templates/test/chart-frame.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/pdf-templates/test/chart-frame.test.tsx
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChartFrame } from '../src/charts/chart-frame';

const PROV = {
  source: 'kku-registry',
  runDate: '12 Aug 2026',
  table: 'student_cohort_distributions',
  method: 'academic-year-rollover.v1',
};

describe('ChartFrame', () => {
  it('renders title, Thai lede and every provenance field', () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="Cohort distribution" ledeTh="นักศึกษาชั้นปีที่ 1 ลดลงต่อเนื่อง"
                  provenance={PROV} heightMm={60}>
        <rect x="0" y="0" width="10" height="10" />
      </ChartFrame>,
    );
    expect(html).toContain('Cohort distribution');
    expect(html).toContain('นักศึกษาชั้นปีที่ 1 ลดลงต่อเนื่อง');
    expect(html).toContain('kku-registry');
    expect(html).toContain('12 Aug 2026');
    expect(html).toContain('student_cohort_distributions');
    expect(html).toContain('academic-year-rollover.v1');
  });

  it('sizes the canvas in millimetres and defaults to the 180mm text measure', () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="t" provenance={PROV} heightMm={45}><g /></ChartFrame>,
    );
    expect(html).toContain('width="180mm"');
    expect(html).toContain('height="45mm"');
    expect(html).toContain('viewBox="0 0 180 45"');
  });

  it('avoids splitting across a page break', () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="t" provenance={PROV} heightMm={45}><g /></ChartFrame>,
    );
    expect(html).toContain('avoid-break');
  });

  // Empty must never be drawn as zero — a flat line reads as "the value is 0",
  // which is a different and much worse claim than "we have no data".
  it('renders the empty note instead of the chart when empty is set', () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="Outcomes" provenance={PROV} heightMm={45}
                  empty emptyNote="No graduate survey rows pass realDataWhere()">
        <rect id="should-not-appear" x="0" y="0" width="1" height="1" />
      </ChartFrame>,
    );
    expect(html).toContain('No graduate survey rows pass realDataWhere()');
    expect(html).not.toContain('should-not-appear');
    // Provenance still shows — the reader must know which source came back empty.
    expect(html).toContain('kku-registry');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kku/pdf-templates test -- chart-frame`
Expected: FAIL — `Cannot find module '../src/charts/chart-frame'`

- [ ] **Step 3: Write the shared types**

```ts
// packages/pdf-templates/src/charts/types.ts
import type { ReactNode } from 'react';

/**
 * Where a chart's numbers came from. Required on every chart — Council
 * readiness rule 1. Never make these optional.
 */
export interface Provenance {
  /** Connector or source slug, e.g. 'kku-registry'. */
  source: string;
  /** Human-readable ingestion date, e.g. '12 Aug 2026'. */
  runDate: string;
  /** Origin table, when one table dominates. */
  table?: string;
  /** Versioned methodology, e.g. 'health-score.v2'. */
  method: string;
}

export interface ChartFrameProps {
  title: string;
  /** One-sentence Thai lede stating what the chart shows. */
  ledeTh?: string;
  provenance: Provenance;
  /** Defaults to 180 — the full A4 text measure at 15mm side margins. */
  widthMm?: number;
  heightMm: number;
  /** When true, renders emptyNote instead of children. */
  empty?: boolean;
  /** Why there is no data. Shown when `empty` is true. */
  emptyNote?: string;
  children?: ReactNode;
}

/** Props every primitive accepts, minus its own data shape. */
export type ChartCommonProps = Omit<ChartFrameProps, 'children' | 'empty'>;
```

- [ ] **Step 4: Write the frame**

```tsx
// packages/pdf-templates/src/charts/chart-frame.tsx
import * as React from 'react';

import { INK } from './palette';
import { pt } from './scale';
import type { ChartFrameProps } from './types';

/** Full A4 text measure with the standard 15mm side margins. */
export const DEFAULT_WIDTH_MM = 180;

export function ChartFrame({
  title,
  ledeTh,
  provenance,
  widthMm = DEFAULT_WIDTH_MM,
  heightMm,
  empty = false,
  emptyNote,
  children,
}: ChartFrameProps): React.ReactElement {
  return (
    <figure className="chart-frame avoid-break" style={{ margin: '6pt 0 12pt 0' }}>
      <div className="chart-title">{title}</div>
      {/* `.chart-lede` has no rule in base-css.ts yet — magazine-css.ts adds one
          in plan 2. Inline style keeps it correct standalone until then. */}
      {ledeTh ? (
        <div className="chart-lede" style={{ fontSize: '14pt', lineHeight: 1.5, margin: '2pt 0 4pt' }}>
          {ledeTh}
        </div>
      ) : null}

      {empty ? (
        <div
          className="chart-empty"
          style={{
            height: `${heightMm}mm`,
            background: INK.surface,
            border: `0.5pt solid ${INK.rule}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: INK.muted,
            fontSize: '13pt',
            textAlign: 'center',
            padding: '0 10mm',
          }}
        >
          {emptyNote ?? 'No data available for this section.'}
        </div>
      ) : (
        <svg
          width={`${widthMm}mm`}
          height={`${heightMm}mm`}
          viewBox={`0 0 ${widthMm} ${heightMm}`}
          role="img"
          aria-label={title}
          xmlns="http://www.w3.org/2000/svg"
        >
          {children}
        </svg>
      )}

      <figcaption className="chart-caption" style={{ fontSize: '12pt', color: INK.muted }}>
        <strong>Source</strong> {provenance.source} · {provenance.runDate}
        {provenance.table ? ` · ${provenance.table}` : ''}
        {' · '}
        <strong>Method</strong> {provenance.method}
      </figcaption>
    </figure>
  );
}

/** Shared text style for in-chart labels. Sizes are pt, converted to mm units. */
export const LABEL = {
  fontFamily: "'TH Sarabun New','Sarabun',sans-serif",
  value: pt(8),
  axis: pt(7.5),
  legend: pt(7.5),
} as const;
```

> **Note for the implementer:** the line reading `usa          xmlns=...` above is a typo introduced
> in this plan — write it as `xmlns="http://www.w3.org/2000/svg"`. If you paste blindly, typecheck
> will catch it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @kku/pdf-templates test -- chart-frame`
Expected: PASS — 4 tests

- [ ] **Step 6: Commit**

```bash
git add packages/pdf-templates/src/charts/types.ts \
        packages/pdf-templates/src/charts/chart-frame.tsx \
        packages/pdf-templates/test/chart-frame.test.tsx
git commit -m "feat(pdf-templates): add ChartFrame with mandatory provenance and empty state"
```

---

## Task 5: `BarsH` — horizontal bars

Serves skills coverage and AI-readiness sub-scores. This is the canonical primitive; the eight that
follow use the same shape.

**Files:**
- Create: `packages/pdf-templates/src/charts/bars-h.tsx`
- Test: `packages/pdf-templates/test/bars-h.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/pdf-templates/test/bars-h.test.tsx
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarsH } from '../src/charts/bars-h';

const PROV = { source: 'kku-registry', runDate: '12 Aug 2026', method: 'skills.v1' };

const ROWS = [
  { label: 'Data engineering', value: 82 },
  { label: 'Machine learning', value: 64 },
  { label: 'Embedded systems', value: 31 },
];

describe('BarsH', () => {
  it('draws one bar per row', () => {
    const html = renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" />);
    expect(html.match(/<rect[^>]*class="bar"/g) ?? []).toHaveLength(3);
  });

  it('labels every row and prints its value', () => {
    const html = renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" />);
    for (const r of ROWS) {
      expect(html).toContain(r.label);
      expect(html).toContain(String(r.value));
    }
  });

  it('scales bar widths proportionally to the largest value', () => {
    const html = renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" />);
    const widths = [...html.matchAll(/class="bar"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
  });

  it('renders the empty state for an empty row set rather than an axis with nothing on it', () => {
    const html = renderToStaticMarkup(
      <BarsH rows={[]} provenance={PROV} title="Skills" emptyNote="No ProgramSkill rows" />,
    );
    expect(html).toContain('No ProgramSkill rows');
    expect(html).not.toContain('class="bar"');
  });

  // A zero-only series must not divide by zero and produce NaN widths.
  it('survives an all-zero series', () => {
    const html = renderToStaticMarkup(
      <BarsH rows={[{ label: 'a', value: 0 }, { label: 'b', value: 0 }]}
             provenance={PROV} title="Skills" />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" />))
      .toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kku/pdf-templates test -- bars-h`
Expected: FAIL — `Cannot find module '../src/charts/bars-h'`

- [ ] **Step 3: Write the implementation**

```tsx
// packages/pdf-templates/src/charts/bars-h.tsx
import * as React from 'react';

import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { INK, seriesColour } from './palette';
import { linear, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface BarRow {
  label: string;
  value: number;
  /** Series index for colour. Defaults to 0 (indigo). */
  series?: number;
}

export interface BarsHProps extends Omit<ChartCommonProps, 'heightMm'> {
  rows: readonly BarRow[];
  /** Width in mm reserved for row labels. */
  labelWidthMm?: number;
  /** Height of each bar row in mm, including its gap. */
  rowHeightMm?: number;
  emptyNote?: string;
}

export function BarsH({
  rows,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  labelWidthMm = 55,
  rowHeightMm = 9,
  emptyNote,
}: BarsHProps): React.ReactElement {
  const heightMm = Math.max(rowHeightMm * rows.length + 4, 12);

  if (rows.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={heightMm} empty emptyNote={emptyNote} />
    );
  }

  // Value labels sit to the right of each bar, so reserve room for them.
  const valueGutterMm = 14;
  const plotWidth = widthMm - labelWidthMm - valueGutterMm;
  const max = Math.max(...rows.map((r) => r.value), 0);
  // linear() collapses a zero-width domain to the range start, so an
  // all-zero series yields width 0 rather than NaN.
  const x = linear([0, max], [0, plotWidth]);
  const barHeight = rowHeightMm * 0.62;

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                widthMm={widthMm} heightMm={heightMm}>
      {rows.map((row, i) => {
        const yTop = 2 + i * rowHeightMm;
        const barWidth = x(row.value);
        return (
          <g key={row.label}>
            <text x={0} y={yTop + barHeight * 0.78} fontSize={LABEL.axis}
                  fontFamily={LABEL.fontFamily} fill={INK.axis}>
              {row.label}
            </text>
            <rect className="bar" x={labelWidthMm} y={yTop}
                  width={barWidth} height={barHeight}
                  fill={seriesColour(row.series ?? 0)} />
            <text x={labelWidthMm + barWidth + 2} y={yTop + barHeight * 0.78}
                  fontSize={LABEL.value} fontFamily={LABEL.fontFamily} fill={INK.axis}>
              {row.value}
            </text>
          </g>
        );
      })}
      <line x1={labelWidthMm} y1={2} x2={labelWidthMm} y2={heightMm - 2}
            stroke={INK.rule} strokeWidth={pt(0.5)} />
    </ChartFrame>
  );
}
```

- [ ] **Step 4: Run the test — it will create the snapshot**

Run: `pnpm --filter @kku/pdf-templates test -- bars-h`
Expected: PASS — 6 tests, with `1 snapshot written`.

- [ ] **Step 5: Read the snapshot before trusting it**

Open `packages/pdf-templates/test/__snapshots__/bars-h.test.tsx.snap` and check by eye:
no `NaN`, no `undefined`, widths inside `0…111`, and `width="180mm"` on the `<svg>`. A snapshot
committed without reading it locks in whatever bug exists today.

- [ ] **Step 6: Commit**

```bash
git add packages/pdf-templates/src/charts/bars-h.tsx \
        packages/pdf-templates/test/bars-h.test.tsx \
        packages/pdf-templates/test/__snapshots__/bars-h.test.tsx.snap
git commit -m "feat(pdf-templates): add BarsH print chart primitive"
```

---

## Tasks 6–13: the remaining eight primitives

Each follows Task 5 exactly: failing test → run → implement → run → read snapshot → commit. Per
primitive the test must cover, at minimum:

1. **Mark count** — one visual element per datum.
2. **Labels and values present** in the markup.
3. **Proportionality** — a larger value produces a larger mark.
4. **Empty state** — empty input renders the note, never an empty axis.
5. **Degenerate input** — all-zero, single-point, or single-category input produces no `NaN`.
6. **Golden snapshot**, read before committing.

| Task | Primitive | Data shape | Additional test beyond the six above |
|---|---|---|---|
| 6 | `BarsStacked` | `{ category: string; segments: { label: string; value: number }[] }[]` | Segment offsets accumulate — segment *n* starts where *n−1* ended; a zero-value segment renders no rect at all rather than a zero-height one. |
| 7 | `LineTrend` | `{ points: { x: number; y: number \| null }[]; projectedFrom?: number }` | A `null` y breaks the path into separate `<path>` elements instead of interpolating across the gap; points at or after `projectedFrom` render dashed. |
| 8 | `Radar` | `{ axes: { label: string; value: number; max: number }[] }` | Fewer than 3 axes renders the empty state (a radar needs a polygon); the polygon closes — first and last point coincide. |
| 9 | `Funnel` | `{ stages: { label: string; value: number }[] }` | Stage widths are monotonically non-increasing even when input values are not, and the anomaly is labelled rather than silently reordered. |
| 10 | `Waterfall` | `{ bars: { label: string; delta: number; isTotal?: boolean }[] }` | Negative deltas render below the running baseline in `SEMANTIC.danger`; a bar marked `isTotal` is drawn from zero, not from the running total. |
| 11 | `DotRange` | `{ rows: { label: string; value: number; min: number; max: number }[] }` | A value outside its own min–max range still renders, clamped to the axis, and is flagged — this is a real data-quality signal, not something to hide. |
| 12 | `Matrix` | `{ columns: string[]; rows: { label: string; cells: (number \| null)[] }[] }` | A `null` cell is visually distinct from a `0` cell; column headers rotate when there are more than 12 columns. |
| 13 | `Timeline` | `{ events: { date: string; label: string; kind?: string }[] }` | Events are ordered by date regardless of input order; two events on the same date are offset rather than overdrawn. |

For each: `pnpm --filter @kku/pdf-templates test -- <name>`, then commit as
`feat(pdf-templates): add <Name> print chart primitive`.

> **Do not batch these into one commit.** Nine primitives in one diff is unreviewable, and a bad
> snapshot in the middle is hard to bisect.

---

## Task 14: Barrel export and package documentation

**Files:**
- Create: `packages/pdf-templates/src/charts/index.ts`, `packages/pdf-templates/src/charts/README.md`
- Modify: `packages/pdf-templates/src/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
// packages/pdf-templates/src/charts/index.ts
export { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
export { INK, PRINT_PALETTE, SEMANTIC, seriesColour } from './palette';
export { linear, niceTicks, pt } from './scale';
export type { ChartCommonProps, ChartFrameProps, Provenance } from './types';

export { BarsH } from './bars-h';
export type { BarRow, BarsHProps } from './bars-h';
export { BarsStacked } from './bars-stacked';
export { LineTrend } from './line-trend';
export { Radar } from './radar';
export { Funnel } from './funnel';
export { Waterfall } from './waterfall';
export { DotRange } from './dot-range';
export { Matrix } from './matrix';
export { Timeline } from './timeline';
```

- [ ] **Step 2: Re-export from the package root**

Add to `packages/pdf-templates/src/index.ts`:

```ts
export * from './charts';
```

- [ ] **Step 3: Write the README**

````markdown
<!-- packages/pdf-templates/src/charts/README.md -->
# Print chart primitives

Pure `data → SVG` components for Gotenberg-rendered PDFs. No runtime charting
library, no hooks, no state, no measurement.

## Rules

1. **SVG user units are millimetres.** `<svg width="180mm" viewBox="0 0 180 60">`.
   Convert every font size and stroke width with `pt()` — `fontSize={8}` means 8mm.
2. **Provenance is required.** `ChartFrame` will not render without source, run
   date and method. This is Council-readiness rule 1, enforced by the type system.
3. **Empty is not zero.** No data renders a labelled empty block. Never a flat
   zero line — that asserts a value we do not have.
4. **Direct labelling over legends.** Values on the marks; legend only past
   three series.
5. **Light theme only.** No CSS custom properties — they do not resolve in
   server-rendered SVG. Colours come from `palette.ts`, which mirrors the
   light-mode design tokens.

## Usage

```tsx
import { BarsH } from '@kku/pdf-templates';

<BarsH
  title="Skills coverage"
  ledeTh="ทักษะที่หลักสูตรครอบคลุมมากที่สุดห้าอันดับแรก"
  rows={[{ label: 'Data engineering', value: 82 }]}
  provenance={{ source: 'kku-registry', runDate: '12 Aug 2026', method: 'skills.v1' }}
/>
```

## Changing a colour

Edit `packages/design/src/css/tokens.css` and `palette.ts` in the same commit.
There is no runtime link between them.
````

- [ ] **Step 4: Verify the whole package**

Run: `pnpm --filter @kku/pdf-templates typecheck && pnpm --filter @kku/pdf-templates lint && pnpm --filter @kku/pdf-templates test`
Expected: all three pass. Test count should be roughly 50+ across 11 files.

- [ ] **Step 5: Verify nothing else in the monorepo broke**

Run: `pnpm typecheck`
Expected: all 8 workspace projects pass. This catches anything that depended on the deleted
`ChartForPrint` export.

- [ ] **Step 6: Commit**

```bash
git add packages/pdf-templates/src/charts/index.ts \
        packages/pdf-templates/src/charts/README.md \
        packages/pdf-templates/src/index.ts
git commit -m "feat(pdf-templates): export chart primitives and document the print chart rules"
```

---

## Done criteria

- [ ] Task 1 spike passed and its verdict is recorded in the spec.
- [ ] Nine primitives exist, each with tests and a reviewed golden snapshot.
- [ ] `recharts` no longer appears in `packages/pdf-templates/package.json`.
- [ ] `pnpm typecheck` passes across all 8 workspace projects.
- [ ] `pnpm --filter @kku/pdf-templates test` passes.
- [ ] No template has been modified — the deep-dive PDF still renders exactly as before, because
      nothing consumes these primitives yet. That is intentional: plan 2 does the swap.

## Next

Plan 2 — template rebuild: the 204-field schema refactor, `magazine-css.ts`, the `program-detail`
rewrite to v2.0.0, the appendix, the course-list section, redaction tests, and the three-program
render gate. Write it once this plan lands and the spike verdict is known.
