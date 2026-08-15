# Print chart primitives

Nine pure `data → SVG` React components for Gotenberg-rendered PDFs. No runtime charting
library, no hooks, no state, no measurement, no `Date.now()`. Every primitive is a pure
function of its props — same input, same output, which is what makes the golden-file
snapshots in `test/__snapshots__/` a meaningful regression net.

`BarsH`, `BarsStacked`, `LineTrend`, `Radar`, `Funnel`, `Waterfall`, `DotRange`, `Matrix`,
`Timeline` — plus the shared `ChartFrame` wrapper and the `scale.ts` / `palette.ts` /
`fit-label.ts` support modules.

## Rules a future contributor must not violate

1. **SVG user units are millimetres.** `<svg width="180mm" viewBox="0 0 180 60">` means one
   user unit is one millimetre. Convert every font size and stroke width with `pt()` —
   `fontSize={8}` inside one of these charts means **8mm**, not 8pt.

2. **Provenance is required.** `ChartFrame` will not render without `source`, `runDate` and
   `method` — this is Council-readiness rule 1, enforced by the type system, not a lint rule
   that can be silenced. Never make these props optional.

3. **Empty is not zero.** No data renders `ChartFrame`'s labelled empty block, never a flat
   zero-valued bar, line, or cell. A `null` value (unknown) and a `0` value (confirmed zero)
   must render distinctly wherever a primitive can represent both — see `Radar`'s hollow
   "no data" marker and `Matrix`'s hatched null cell for the pattern to follow.

4. **Never fabricate or hide a number.** Anomalies (a funnel stage that grew, a value outside
   its peer range, a stacked category that disagrees on segment order) are marked with a
   visible warning treatment and rendered at their true position — never corrected, silently
   reordered, clamped, or sorted away. The one documented exception to "never reorder" is
   `Timeline`: unlike `Funnel`, a timeline's order *is* its date, so sorting there is the
   honest rendering, not a distortion.

5. **Fail loudly on impossible layout.** A negative or zero-width/height SVG shape renders
   nothing — silently — which reads to a Council viewer as "the value is zero," a materially
   different and worse claim than "this chart is misconfigured." Every primitive throws a
   `RangeError` naming the offending props (e.g. `labelWidthMm` eating the whole plot width)
   instead of letting that happen.

6. **`fitLabel` for every caller-supplied categorical label.** SVG `<text>` does not wrap, and
   this package only renders through `renderToStaticMarkup` — there is no text measurement
   available at render time. Truncating with an ellipsis is rejected: a shortened Thai program
   name with no hover to recover the full string can misattribute a bar to the wrong program in
   a printed, decision-driving document. `fitLabel` squeezes text to fit a fixed column via
   `textLength` + `lengthAdjust="spacingAndGlyphs"`, bounded so it's never squeezed past ~85%
   of its natural width — past that bound it throws, telling the caller to widen the column.
   Numbers we generate ourselves (`niceTicks()` output, computed percentages) skip `fitLabel` —
   it exists for arbitrary caller text, not our own bounded output.

7. **Light theme only — no CSS custom properties.** PDFs are always light theme, and CSS
   custom properties cannot be resolved inside server-rendered SVG: Gotenberg receives markup
   with no `<html data-theme>` to read from. Every colour in a chart comes from `palette.ts`,
   which hand-mirrors the light-mode values of `packages/design/src/css/tokens.css`. There is
   **no runtime link** between the two files — change both in the same commit, or the print
   palette silently drifts from the app's design tokens.

8. **Pin `'TH Sarabun New'`, never fall back to `'Sarabun'`.** `Sarabun` is not installed in the
   Gotenberg image; when it's listed as a fallback, Chromium silently substitutes a different,
   larger, bolder face, breaking every layout calculation sized against TH Sarabun New's actual
   (narrower, lower-x-height) metrics. `ChartFrame`'s `LABEL.fontFamily` is the canonical stack
   (`"'TH Sarabun New','Noto Sans Thai',sans-serif"`) — reuse it, don't hand-roll a new one.

## Usage

```tsx
import { BarsH } from '@kku/pdf-templates';

<BarsH
  title="Skills coverage"
  ledeTh="ทักษะที่หลักสูตรครอบคลุมมากที่สุดห้าอันดับแรก"
  rows={[
    { label: 'Data engineering', value: 82 },
    { label: 'Machine learning', value: 64 },
  ]}
  provenance={{ source: 'kku-registry', runDate: '12 Aug 2026', method: 'skills.v1' }}
/>;
```

Every primitive follows the same shape: required `title` + `provenance`, optional `ledeTh`
(a one-sentence Thai lede), a primitive-specific data prop (`rows`, `stages`, `bars`, `axes`,
`categories`, `events`, `columns`+`rows`…), and an `emptyNote` used only when the data prop is
empty.

## Adding a tenth primitive

Read `bars-h.tsx` first — it's the canonical shape every other primitive follows — then pick
the sibling closest to your new chart's data shape. Write the failing test before the
implementation; read the golden snapshot before committing it (no `NaN`, no `undefined`,
sane-looking coordinates). Re-export the component and its types from `index.ts` — check what
the new file actually exports, don't assume.

## Changing a colour

Edit `packages/design/src/css/tokens.css` **and** `palette.ts` in the same commit — see rule 7
above. There is no runtime link between them to catch a missed one.

## Sizing for real KKU data

Every primitive's numeric layout props (`labelWidthMm`, `columnWidthMm`, `labelHeightMm`, …)
ship with a default tuned for SHORT labels — abbreviations, single English words, skill names.
None of the defaults are tuned to real KKU strings, which run much longer: full bilingual
program names, Thai TCAS round names, full milestone sentences. Passing real data at a
primitive's default can throw a `RangeError` from `fitLabel`'s 85% squeeze floor (rule 6/rule 5
above) — that is the primitive doing its job, not a bug, but it is worth knowing the actual
numbers up front rather than discovering them one throw at a time:

- **`BarsH.labelWidthMm`** (default 55mm) — a full Thai program name (e.g. "หลักสูตร
  วิทยาศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์และปัญญาประดิษฐ์ (หลักสูตรนานาชาติ)") throws at the
  default; **~100mm** works.
- **`Timeline.labelWidthMm`** (default 60mm) — a realistic Thai milestone description (e.g.
  "เสนอสภามหาวิทยาลัยพิจารณาอนุมัติหลักสูตร") throws at the default; **~90mm** works. The
  rendered text also includes the formatted date prefix ("15 Aug 2026 · "), which eats into the
  same budget.
- **`BarsStacked.labelHeightMm`** / **`Waterfall.labelHeightMm`** (default 9mm) — these only
  matter once a category/bar label is long enough to rotate (see `needsRotatedLabels` in
  `axis-labels.ts`); the diagonal budget a rotated label gets is derived directly from this
  value. A realistic Thai TCAS round name (e.g. "รอบที่ 1 : แฟ้มสะสมผลงาน (Portfolio)") needs
  **~34mm** here once rotated.

None of these defaults were changed to fix the numbers above — that would silently reflow every
existing chart already calling these primitives at their defaults. Widen the relevant prop
explicitly when a caller knows it is labelling full KKU program names, Thai round names, or full
milestone sentences, rather than discovering the throw in production.
