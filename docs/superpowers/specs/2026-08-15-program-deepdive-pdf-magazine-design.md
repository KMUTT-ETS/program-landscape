# Program deep-dive PDF — magazine-quality A4 rebuild

> Date: 2026-08-15 · Status: draft for review
> Replaces the `program-detail` Gotenberg template behind `POST /programs/:id/export-detail-pdf`.

## Context

`/programs/[id]` currently has **three** renderings of the same program, which have drifted:

| Surface | Size | Graphics |
|---|---|---|
| Web deep-dive — `apps/web/app/programs/[id]/client.tsx` | 4,072 lines · 18 sections | `FunnelPipeline`, `RadarChartSmall` (Recharts), `Waterfall` (SVG), CSS bars |
| Print view — `apps/web/app/programs/[id]/print/page.tsx` | 2,675 lines | **none** — 0 SVG, 0 chart components |
| Export PDF — `packages/pdf-templates/.../program-detail` | 2,160 lines · 17 sections · v1.0.0 | hand-rolled `HBars` / `VBars` / `StackBar` `<div>`s |

The PDF's own header comment calls it *"the analyst working document, NOT a Council-facing brief."*
Measured output from `pdf_generations` (May 2026): **16–20 pages, 288–343 KB**.

Content coverage is nearly complete already — the gap is fidelity and design, with one real omission
(see *Course list*, below).

Relevant existing constraints, all of which carry over:

- `baseCss` — A4, 20/15mm margins, TH Sarabun New, `word-break: keep-all`, light theme only.
- All PDFs render through Gotenberg. Never in-process (CLAUDE.md, non-negotiable).
- Council-readiness rule 1: **provenance on every chart** — source, freshness, method.
- `COUNCIL` role sees faculty data as aggregates-only; names are stripped at the Prisma `select`.

## Decisions

| # | Decision | Chosen |
|---|---|---|
| 1 | Purpose | **Same analyst working document** — same audience, same exhaustive content, magazine-grade layout and real charts. Nothing may be cut. |
| 2 | Type scale | **16pt, single column.** The Cabinet Resolution (7 Sep 2010) body size in `base-css.ts` is kept. Magazine quality must come from structure, charts and white space — not from type size. |
| 3 | Document architecture | **Editorial front, data appendix back.** Chart-led body with a one-sentence Thai lede per section; every exact figure relocated to a tabular appendix. Lossless. Target **28–34 pages**. |
| 4 | Print view (`/programs/[id]/print`) | **Left alone** for this project. Repointing it at the new template is a follow-up (see *Deferred*). |
| 5 | Chart technology | **Print-first hand-rolled SVG primitives.** No runtime charting library. |

### Why hand-rolled SVG over Recharts

Recharts covers 6 of the 9 needed chart types natively; waterfall, matrix and timeline would be
hand-rolled regardless. Magazine quality lives in exactly what Recharts' defaults fight — direct
labelling instead of legends, hairline rules, deliberate tick counts, captions locked to the mark.
Hand-rolled primitives are also deterministic, so golden-file tests are trivial. And the approach is
already idiomatic here: `Waterfall`, `coverage-matrix`, `tornado` and `thailand-map` in
`packages/ui` are all hand-rolled SVG, as are the current PDF's bars.

A hybrid (Recharts where native, hand-rolled elsewhere) was rejected: two visual idioms in one
document — different tick logic, different label placement, different optical weight — is what makes
a document read as assembled rather than designed.

Screenshotting the live web charts headlessly was rejected: it puts raster into a document intended
for A4 print and adds a browser dependency alongside Gotenberg.

## Page architecture

**Cover.** Cardinal band, Thai program name dominant, English beneath, code and faculty. Then a
three-stat block — health score, lifecycle verdict, data completeness — so an analyst working
through 30 of these can triage without turning a page. Foot: generation date, methodology versions,
data-as-of date.

**Section pages.** Large section number in cardinal, title, rule, then a one-sentence Thai lede
stating what the chart shows, then the chart, then the provenance caption. The number is the
navigation device.

**Running heads and folios.** Program code and section on every page, so a page photocopied out of
context stays attributable.

**Appendix.** Mirrors section numbering (§ 04 → Appendix B.4) so the chart → exact-figure round trip
is mechanical. Tables at 14pt, as the current template already uses.

**Not every section is chart-led, and that is deliberate.** Three shapes exist:

| Shape | Sections | Body treatment | Appendix |
|---|---|---|---|
| Chart-led | cohorts, demand funnel, TCAS, recruitment, demographic, outcomes, financials, skills, faculty, health score, peers, AI readiness | lede + chart + provenance | full figures |
| Prose | strategic narrative, lifecycle verdict | editorial text page, pull-quote for the verdict | none |
| Reference table | **course list**, trend exposure, council decisions | table or list **in the body** — there is no chart to lead with, and burying a curriculum in an appendix would be perverse | none (already complete in body) |

The rule: a table moves to the appendix only when a chart in the body has replaced its
*interpretive* job. A course list has no such chart, so it stays where the reader expects it.

## Chart primitives

Nine pure `data → SVG` components in `packages/pdf-templates/src/charts/`. No hooks, no state, no
measurement, no library.

| Primitive | Serves |
|---|---|
| `BarsH` | skills coverage, AI-readiness sub-scores |
| `BarsStacked` | cohort distribution, TCAS rounds 1–4 |
| `LineTrend` | demographic projection, outcomes over time |
| `Radar` | health-score dimensions (5 axes) |
| `Funnel` | demand funnel, recruitment funnel |
| `Waterfall` | financials — revenue → cost → margin |
| `DotRange` | TCAS3 score against peer range |
| `Matrix` | peer skill-coverage grid |
| `Timeline` | council decision history |

Shared contract — provenance is required, not optional:

```ts
interface PrintChartProps {
  widthMm?: number;          // default 180 — the full text measure
  heightMm: number;
  title: string;
  ledeTh?: string;
  provenance: {              // required — the primitive cannot render without it
    source: string;          // e.g. 'kku-registry'
    runDate: string;
    table?: string;
    method: string;          // e.g. 'health-score.v2'
  };
  emptyNote?: string;        // rendered when data is absent
}
```

Three rules baked into the primitives:

- **SVG user units are millimetres.** `<svg width="180mm" height="60mm" viewBox="0 0 180 60">` —
  geometry is authored in page units, so a chart can never be mis-scaled. Font sizes must therefore
  be converted: `pt(n) => n * 0.3528`. That helper is the only arithmetic to remember and it gets a
  unit test.
- **Empty ≠ zero.** No data renders a labelled empty block, never a flat zero line — the same rule
  `health-score` already follows for null dimensions. This is the difference between "we don't know"
  and "it's bad."
- **Direct labelling over legends.** Values on the marks; a legend only past three series. Hairline
  axes at 0.5pt; gridlines only where reading a value off the axis is genuinely necessary.

The `dataviz` skill is to be loaded before the first line of chart code — colour ramps, mark specs
and accessibility checks belong there rather than being improvised.

## Code structure

```
packages/pdf-templates/src/
  charts/                    NEW
    scale.ts                 linear scale, nice ticks, pt() helper
    palette.ts               PRINT_PALETTE, rescued from chart-for-print
    caption.tsx              title + lede + provenance
    bars-h.tsx  bars-stacked.tsx  line-trend.tsx  radar.tsx  funnel.tsx
    waterfall.tsx  dot-range.tsx  matrix.tsx  timeline.tsx
    index.ts
  components/
    chart-for-print.tsx      DELETED → drops the recharts dependency
  styles/
    base-css.ts              unchanged — 16pt stays
    magazine-css.ts          NEW — grid, running heads, folios, section openers, appendix
  templates/program-detail/
    schema.ts                strings → numbers
    template.tsx             rewritten
    version.txt              1.0.0 → 2.0.0
```

**`ChartForPrint` is deleted.** It is the only consumer of Recharts in `pdf-templates`, and no
template uses it — so `recharts@^2.15.0` comes out of that package's dependencies. Its
`PRINT_PALETTE` is kept as the single colour source; it is already synced to the light-mode design
tokens.

**Replace in place, bump the major version.** The endpoint keeps passing
`templateName: 'program-detail'`, so the API, the `@AuditLog` decorator, the faculty-visibility gate
and the web route are untouched. `pdf_generations.template_version` already records which template
version produced each PDF, so historical exports stay attributable to 1.0.0 and rollback is a git
revert — rather than a parallel dead template inviting drift.

**The old template is refactored, not discarded.** Its dense table markup is what the appendix
needs; most of those 2,160 lines move to the back of the document rather than being rewritten. This
materially lowers the risk of the rewrite.

## Data flow

Unchanged end to end:

```
POST /programs/:id/export-detail-pdf        auth · @AuditLog · faculty visibility
  → buildProgramDetailData(programId, facultyVisibility)      apps/api/.../program-detail-data.ts
  → PdfService.generateAndPersist({ templateName: 'program-detail', data, scope })
  → renderTemplateToHtml → Gotenberg → MinIO → signed URL
```

### The schema refactor (main work item)

`schema.ts` is **204 `z.string()` against 13 `z.number()`** — nearly everything is pre-formatted for
table display inside `program-detail-data.ts` (1,074 lines). Charts need numbers: an axis cannot be
derived from `"62%"`.

- Numeric fields move to `z.number().nullable()`; formatting relocates into the template.
- Missing values become `null` instead of `"—"`, which is what allows the primitives to honour
  empty-≠-zero rather than plotting a fabricated floor.
- Display-only strings (names, verdict labels, narrative prose) stay strings.

### Course list — the one real content gap

`courses` appears **11 times in `schema.ts` and zero times in `template.tsx`**. The course list is
assembled, passed across the boundary, and silently dropped. Rendering it closes "all contents"
literally, and costs nothing on the data side. Per the section-shape table above it renders as a
reference table **in the body**, not in the appendix.

## Error handling

- **Zod at the template boundary** stays the gate — `PDF_TEMPLATE_DATA_INVALID`, non-retryable. With
  numbers replacing strings this matters more: a `NaN` or stray `null` must fail loudly there rather
  than render a chart with a collapsed axis.
- **Empty sections state their reason.** Given the `realDataWhere()` footgun already documented in
  CLAUDE.md — a section reads empty because `data_sources.mocked = true` or `ingestion_run_id IS
  NULL`, not because data is absent — the empty block says which. A blank page in a Council-adjacent
  document is worse than an explained gap.
- **Faculty redaction is now a chart concern.** The faculty-capability chart receives already-redacted
  data under `COUNCIL` visibility; a name leaking into an SVG label is exactly what a table-era test
  suite would miss.
- **Render timeout must be re-measured.** Page count roughly doubles and ~20 SVG charts arrive with
  it. The existing policy retries `PDF_UPSTREAM_UNAVAILABLE` once but never retries a render timeout,
  so being near the ceiling fails deterministically.

## Testing

`pdf-templates` currently has **zero tests**; `vitest` is already a devDependency.

1. **Golden-file snapshots per primitive** — deterministic SVG from pure functions. This is what makes
   hand-rolling defensible rather than risky.
2. **Scale and `pt()` unit tests** — nice-tick selection, all-zero series, single data point, negative
   values in the waterfall.
3. **Schema round-trip** — real `buildProgramDetailData` output parses against the new schema.
4. **Empty-state tests** — every section, empty input, renders its block and never a zero-line chart.
5. **Redaction test** — a `COUNCIL` payload yields no faculty name anywhere in the rendered HTML.
6. **End-to-end smoke** — render a real program through dev Gotenberg; assert page count in range and
   non-trivial byte size.

### Verifying the quality claim

"Magazine quality" is subjective and no assertion settles it. The gate is: render **three real
programs at different data-completeness levels** — data-rich, middling, and one of the five blanked
programs (0089, 0140, 0182, 0237, 0301). The sparse one is the real test, because magazine layouts
fail ugly when half the sections are empty. Human review of those three before merge. If page count
lands near 45 rather than 28–34, the design is not working and gets adjusted rather than shipped.

## Risks

- **Thai text inside SVG `<text>` is an unproven path in this app.** SVG text does not inherit the
  same shaping and fallback behaviour as HTML text, and Thai tone marks are precisely where that
  shows. **Task one is a spike:** one chart, Thai labels, real mm units, through Gotenberg — before
  the other eight primitives are written. If Thai shapes badly, the primitive approach needs
  rethinking, and that must surface on day one, not day nine.
- **Schema refactor breadth.** 204 fields is a large diff across a 1,074-line builder; it should land
  as its own reviewable commit ahead of the template rewrite.
- **Page-count drift.** Mitigated by the three-program review gate above.

## Rollout

No migration, no feature flag — single endpoint, version-stamped output. Work stops at commit-ready;
building a release bundle is a separate, explicitly-requested step.

## Deferred

- **Repoint `/programs/[id]/print` at the new template** (option C from brainstorming). It would make
  the print view a true WYSIWYG preview and delete 2,675 lines of drifting duplicate, but
  `buildProgramDetailData` lives in `apps/api` while the print page assembles its own payloads, so it
  needs a real refactor to share. Revisit once the template has proven itself.
- **Retire the print view entirely** — the cheaper alternative to the above, if the browser preview
  turns out to be unused.
