# Deep-Dive PDF Template Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `program-detail` Gotenberg template with a magazine-quality A4 document that consumes the chart primitive library, keeping every existing figure.

**Architecture:** The endpoint, audit decorator, faculty-visibility gate and web route are untouched — the template name stays `program-detail` and only its version moves 1.0.0 → 2.0.0. The schema converts from pre-formatted strings to numbers so charts can compute scales. The body becomes chart-led with a one-sentence Thai lede per section; every exact figure relocates to a tabular appendix rather than being dropped.

**Tech Stack:** TypeScript (strict, no `any`, no `as`), React 18 `renderToStaticMarkup`, Zod, the `@kku/pdf-templates` chart primitives, Gotenberg/Chromium, Vitest.

---

## Prerequisite — plan 1 is complete

`docs/superpowers/plans/2026-08-15-pdf-chart-primitives.md` landed: nine primitives plus
`scale`/`palette`/`layout`/`axis-labels`/`fitLabel`/`ChartFrame`, 127 tests, exported from
`@kku/pdf-templates`. Nothing consumes them yet. This plan is the consumer.

**Read `packages/pdf-templates/src/charts/README.md` before starting.** It carries rules that will
bite you otherwise — mm user units, `pt()` for font sizes, provenance required, empty-is-not-zero,
and the fact that `Sarabun` is not installed in the Gotenberg image.

## Current state, measured

| Fact | Value |
|---|---|
| `templates/program-detail/template.tsx` | 2,160 lines, VERSION 1.0.0, dense tables + hand-rolled `<div>` bars |
| `templates/program-detail/schema.ts` | **204 `z.string()` vs 13 `z.number()`** |
| `apps/api/src/programs/program-detail-data.ts` | 1,074 lines, pre-formats everything for table display |
| `courses` in the schema | **11 references; rendered 0 times** — the one real content gap |
| Measured output (`pdf_generations`, May 2026) | 16–20 pages, 288–343 KB |
| Render time, near-empty page (spike) | **20.7s against a 55s ceiling** |
| Endpoint | `POST /programs/:id/export-detail-pdf` → `templateName: 'program-detail'` |

## Section shapes — decided in the spec, do not re-litigate

| Shape | Sections | Body | Appendix |
|---|---|---|---|
| Chart-led (12) | cohorts, demand funnel, TCAS, recruitment, demographic, outcomes, financials, skills, faculty, health score, peers, AI readiness | lede + chart + provenance | full figures |
| Prose (2) | strategic narrative, lifecycle verdict | editorial text, pull-quote for the verdict | none |
| Reference table (3) | **course list**, trend exposure, council decisions | table in the body — no chart leads them | none |

A table moves to the appendix only when a chart in the body has taken over its interpretive job.

## File structure

| File | Responsibility |
|---|---|
| `packages/pdf-templates/src/styles/magazine-css.ts` | Grid, running heads, folios, section openers, appendix, `.chart-lede`. |
| `packages/pdf-templates/src/templates/program-detail/schema.ts` | Numbers, not display strings. Nullable where data can be absent. |
| `packages/pdf-templates/src/templates/program-detail/sections/*.tsx` | One file per section. The 2,160-line monolith is split — a single file rendering 17 sections is the thing that made the old one unreviewable. |
| `packages/pdf-templates/src/templates/program-detail/appendix.tsx` | Tabular appendix, numbering mirrored from sections (§04 → B.4). |
| `packages/pdf-templates/src/templates/program-detail/template.tsx` | Cover, section sequencing, appendix assembly. Thin. |
| `apps/api/src/programs/program-detail-data.ts` | Emits numbers; formatting moves to the template. |
| `packages/pdf-templates/test/program-detail/*.test.tsx` | Per-section tests + schema round-trip + redaction. |

---

## Task 1: Inventory the schema before changing it

204 fields cannot be converted blind. Produce the worklist first.

**Files:** `docs/superpowers/notes/2026-08-16-program-detail-schema-inventory.md` (create)

- [ ] **Step 1: Extract every field and its current type**

```bash
cd /home/denpong/projects/program-landscape
grep -nE "^\s+[a-zA-Z]+: z\.(string|number|boolean|array|object)" \
  packages/pdf-templates/src/templates/program-detail/schema.ts | tee /tmp/schema-fields.txt
wc -l /tmp/schema-fields.txt
```

- [ ] **Step 2: Classify each field into one of three buckets**

Write the inventory doc with a table: `field path | current type | bucket | notes`.

- **NUMERIC** — a chart or computation needs the value. Converts to `z.number().nullable()`.
  Anything currently holding `"62"`, `"82%"`, `"฿1,240,000"`, `"—"`.
- **DISPLAY** — genuinely a string. Names, verdict labels, narrative prose, methodology versions,
  ISO dates. Stays `z.string()`.
- **AMBIGUOUS** — decide and record why. Example: a year like `"2569"` is display in a heading but
  numeric on an axis; prefer numeric and format at the render site.

- [ ] **Step 3: Count each bucket and sanity-check the ratio**

If NUMERIC comes out under ~80 fields, you have mis-classified — the whole reason for this refactor
is that the schema is overwhelmingly pre-formatted numbers. Re-check before proceeding.

- [ ] **Step 4: Commit the inventory**

```bash
git add docs/superpowers/notes/2026-08-16-program-detail-schema-inventory.md
git commit -m "docs: inventory the program-detail schema ahead of the numeric refactor"
```

---

## Task 2: Convert the schema and the data builder, section by section

**Do not do all 204 at once.** Convert one section per commit, in the order of the section table
above, so each diff is reviewable and a mistake is bisectable.

**Files (per section):**
- Modify: `packages/pdf-templates/src/templates/program-detail/schema.ts`
- Modify: `apps/api/src/programs/program-detail-data.ts`
- Test: `packages/pdf-templates/test/program-detail/schema-round-trip.test.ts`

- [ ] **Step 0: Capture a real payload as the fixture base**

The round-trip test needs a `MINIMAL_VALID_FIXTURE` that parses against the schema as it stands. Do
not hand-write 204 fields — capture one:

```bash
cd /home/denpong/projects/program-landscape
cat > ./capture-fixture-tmp.ts <<'EOF'
import { writeFileSync } from 'node:fs';
import { buildProgramDetailData } from './apps/api/src/programs/program-detail-data';
const programId = process.argv[2];
if (!programId) throw new Error('usage: tsx capture-fixture-tmp.ts <programId>');
void buildProgramDetailData(programId, 'full').then((d) => {
  writeFileSync(
    'packages/pdf-templates/test/program-detail/fixture.json',
    JSON.stringify(d, null, 2),
  );
  console.log('captured');
});
EOF
pnpm tsx ./capture-fixture-tmp.ts <a real KKU-SEQ program id>
rm ./capture-fixture-tmp.ts
```

Import it in the test as `MINIMAL_VALID_FIXTURE`. Check the second argument matches the real
`FacultyVisibility` type before running — read `program-detail-data.ts`'s signature rather than
trusting `'full'` here. Trim the captured JSON to the sections converted so far; it grows as you go.

- [ ] **Step 1: Write the round-trip test first (once, before the first section)**

```ts
// packages/pdf-templates/test/program-detail/schema-round-trip.test.ts
import { describe, expect, it } from 'vitest';
import { ProgramDetailDataSchema } from '../../src/templates/program-detail/schema';

// A minimal fixture that grows as sections convert. Every numeric field must
// accept a number and a null, and must REJECT a pre-formatted string — that
// rejection is the whole point of the refactor.
//
// Build the base fixture by copying the smallest object that currently parses
// against the schema, then override the one field under test. Keep it minimal:
// this file should not become a second copy of the data builder.
function fixtureWithHealthScore(overallScore: unknown): unknown {
  return {
    ...MINIMAL_VALID_FIXTURE,
    healthScore: { ...MINIMAL_VALID_FIXTURE.healthScore, overallScore },
  };
}

describe('ProgramDetailDataSchema', () => {
  it('accepts a number for a converted numeric field', () => {
    expect(ProgramDetailDataSchema.safeParse(fixtureWithHealthScore(62)).success).toBe(true);
  });

  it('accepts null for a numeric field with no data', () => {
    expect(ProgramDetailDataSchema.safeParse(fixtureWithHealthScore(null)).success).toBe(true);
  });

  it('rejects a pre-formatted string where a number is required', () => {
    expect(ProgramDetailDataSchema.safeParse(fixtureWithHealthScore('62')).success).toBe(false);
  });

  it('rejects NaN, which would silently collapse a chart axis', () => {
    expect(ProgramDetailDataSchema.safeParse(fixtureWithHealthScore(Number.NaN)).success)
      .toBe(false);
  });
});
```

Note: `z.number()` accepts `NaN` by default. Use `z.number().finite()` so the third test passes —
this is exactly the guard that stops a collapsed axis reaching Chromium.

- [ ] **Step 2: Per section — convert the schema fields**

Replace `z.string()` with `z.number().finite().nullable()` for every NUMERIC field in that section.
Keep DISPLAY fields as strings.

- [ ] **Step 3: Per section — stop pre-formatting in the builder**

In `program-detail-data.ts`, find where that section's values are built. Remove `.toFixed()`,
`.toLocaleString()`, `%` suffixes, `฿` prefixes and `'—'` fallbacks. Emit the raw number, or `null`
where the source is absent.

**`'—'` becomes `null`, never `0`.** That substitution is the single most dangerous edit in this
task: a `0` asserts a measured value of zero, and this document is used to close programs.

- [ ] **Step 4: Run the round-trip test and the API tests**

```bash
pnpm --filter @kku/pdf-templates test -- schema-round-trip
pnpm --filter api test
```

- [ ] **Step 5: Commit that section**

```bash
git commit -m "refactor(pdf): program-detail <section> schema emits numbers, not display strings"
```

Repeat Steps 2–5 for each section. **The template will not compile mid-way through** — that is
expected and fine; it is rewritten in Task 5.

**Correction, found during batch 1 — `apps/api` typecheck does NOT stay green, and cannot.**
`packages/pdf-templates/package.json` points `main`/`types` at `./src/index.ts`, and that barrel
re-exports `programDetailTemplate` from `template.tsx`. Because `apps/api` imports
`@kku/pdf-templates` source-linked rather than built, `tsc --noEmit` on `apps/api` type-checks the
whole reachable pdf-templates graph — `template.tsx` included. So from the first converted section
until Task 7 rewrites it, **both** `pnpm --filter api typecheck` and
`pnpm --filter @kku/pdf-templates typecheck` are red.

The real constraint is therefore:

> Every typecheck error must be **inside `template.tsx`**. Check with
> `pnpm --filter api typecheck 2>&1 | grep "error TS" | sed -E 's|\(.*||' | sort | uniq -c`
> — one line, `template.tsx`, and nothing else. A single error in any other file means you have
> broken a real consumer and must stop.

`pnpm --filter api test` (runtime, not `tsc`) must stay green throughout — that is the signal that
still means something during this stretch.

---

## Task 3: `magazine-css.ts`

**Files:** Create `packages/pdf-templates/src/styles/magazine-css.ts`;
Test: `packages/pdf-templates/test/program-detail/magazine-css.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { magazineCss } from '../../src/styles/magazine-css';

describe('magazineCss', () => {
  it('defines the chart lede rule that ChartFrame expects', () => {
    expect(magazineCss).toContain('.chart-lede');
  });

  it('keeps the Cabinet 16pt body size — it must not override base-css', () => {
    expect(magazineCss).not.toMatch(/body\s*{[^}]*font-size/);
  });

  it('numbers sections and appendix entries via counters, not hardcoded strings', () => {
    expect(magazineCss).toContain('counter-reset');
    expect(magazineCss).toContain('counter-increment');
  });

  it('keeps a section opener with its first paragraph', () => {
    expect(magazineCss).toContain('break-after: avoid');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL, module not found**

- [ ] **Step 3: Implement**

Rules to provide, at minimum: `.section-opener` (number, rule, title), `.chart-lede`,
`.running-head`, `.folio`, `.appendix-table`, `.pull-quote`, `.stat-block`. Use CSS counters for
section and appendix numbering so renumbering cannot drift. **Do not restate anything `base-css.ts`
already defines** — a review already caught a caption silently overriding it.

- [ ] **Step 4: Run — expect PASS. Then commit**

```bash
git commit -m "feat(pdf-templates): add magazine-css for the deep-dive layout"
```

---

## Task 4: Cover page

**Files:** Create `packages/pdf-templates/src/templates/program-detail/sections/cover.tsx`;
Test: `packages/pdf-templates/test/program-detail/cover.test.tsx`

Renders: cardinal band, Thai program name dominant, English beneath, code and faculty, a three-stat
block (health score, lifecycle verdict, data completeness), then generation date, methodology versions
and data-as-of date.

- [ ] **Step 1: Write the failing test** — assert the Thai name, English name, code, all three stats,
      and that a `null` health score renders as an em dash rather than `0` or `null`.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `feat(pdf-templates): add deep-dive cover page`

---

## Task 5: Section components, one commit each

**Files (per section):** `sections/<name>.tsx` + `test/program-detail/<name>.test.tsx`

Work through the 12 chart-led sections, then the 2 prose, then the 3 reference-table sections.

Per section:

- [ ] **Step 1: Write the failing test.** Assert the section title, the Thai lede, that the expected
      primitive rendered (its distinctive class, e.g. `class="bar"`), and **that absent data renders
      the empty block naming the reason rather than a zero-valued chart**.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.** Import the primitive from `@kku/pdf-templates`. Pass `provenance` built
      from the section's real source, run date and methodology version — never a placeholder.
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `feat(pdf-templates): add <section> section to the deep-dive template`

**The course list is section 3 of the reference-table group and must not be skipped** — it is the one
piece of content the current PDF drops entirely despite receiving the data.

**Empty sections must state why.** `realDataWhere()` returns nothing when `data_sources.mocked = true`
or `ingestion_run_id IS NULL`, which is a provenance problem, not an absence of data. The empty note
must distinguish those cases; a blank section in a Council document is worse than an explained gap.

---

## Task 6: The appendix

**Files:** Create `templates/program-detail/appendix.tsx`;
Test: `test/program-detail/appendix.test.tsx`

- [ ] **Step 1: Write the failing test** — every chart-led section contributes an appendix table;
      appendix numbering mirrors section numbering (§04 → B.4); a value shown in a chart appears
      identically in the appendix.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement.** Reuse the old template's table markup — it is proven, and this is why the
      rewrite is lower-risk than it looks. Tables at 14pt as the current template already uses.
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** — `feat(pdf-templates): add the deep-dive data appendix`

---

## Task 7: Assemble the template and bump to 2.0.0

**Files:** Modify `templates/program-detail/template.tsx`, `version.txt`

- [ ] **Step 1: Rewrite `template.tsx` as a thin assembler** — cover, sections in order, appendix.
      All rendering logic lives in the section files. If this file exceeds ~250 lines, sequencing
      logic has leaked into it; push it back down.
- [ ] **Step 2: Bump `version.txt` 1.0.0 → 2.0.0.** `pdf_generations.template_version` records this,
      so historical exports stay attributable to 1.0.0.
- [ ] **Step 3: Verify the endpoint is untouched**

```bash
git diff --stat apps/api/src/programs/deep-dive.controller.ts
```
Expected: no output. If the controller changed, something is wrong — the whole design rests on the
API surface staying identical.

- [ ] **Step 4: Full typecheck + tests**

```bash
pnpm typecheck && pnpm --filter @kku/pdf-templates test
```

- [ ] **Step 5: Commit** — `feat(pdf-templates): rebuild the program-detail template as v2.0.0`

---

## Task 8: Faculty redaction test

The `COUNCIL` role sees faculty data as aggregates-only, with names stripped at the Prisma `select`.
A name leaking into an SVG label is exactly what a table-era test suite would miss.

**Files:** `test/program-detail/redaction.test.tsx`

- [ ] **Step 1: Write the test** — render the full template with a `COUNCIL`-visibility payload and
      assert no faculty member name appears anywhere in the HTML, including inside `<text>` elements
      and `<title>` tooltips.
- [ ] **Step 2: Run.** If it fails, the leak is real — fix the section, not the test.
- [ ] **Step 3: Commit** — `test(pdf-templates): assert faculty names never leak under COUNCIL visibility`

---

## Task 9: End-to-end render and the timeout question

- [ ] **Step 1: Render a real program through dev Gotenberg**

```bash
docker ps --filter name=gotenberg --format '{{.Names}} {{.Status}}'
pnpm tsx scripts/render-deep-dive.ts <programId>   # write this throwaway; delete after
```

- [ ] **Step 2: Record page count, byte size and wall-clock time.** The old template produced 16–20
      pages; the target is 28–34. **If it lands near 45, stop and report** — the design is not working
      and padding it out is not the fix.

- [ ] **Step 3: Compare the render time against the 55s ceiling.** The spike measured 20.7s for a
      near-empty page, most of it Chromium cold start. If a full document approaches the ceiling,
      raise `GOTENBERG_REQUEST_TIMEOUT_MS` and say so — a render timeout is not retried, so being
      near the limit fails deterministically in production.

- [ ] **Step 4: Rasterise for visual inspection** (no PDF rasteriser is installed; use Gotenberg's own
      screenshot route — same Chromium, same fonts):

```bash
curl -s -X POST http://localhost:3001/forms/chromium/screenshot/html \
  -F "files=@/tmp/deep-dive.html;filename=index.html" -F "format=png" \
  -F "width=1100" -F "emulatedMediaType=print" -o /tmp/deep-dive.png
```
The form file **must** be named `index.html`.

- [ ] **Step 5: Commit any fixes**, then delete the throwaway script.

---

## Task 10: The three-program review gate

"Magazine quality" is subjective and no assertion settles it. This is the gate.

- [ ] **Step 1: Pick three real programs** at different data-completeness levels — one data-rich, one
      middling, and one of the five blanked programs (**0089, 0140, 0182, 0237, 0301**).
- [ ] **Step 2: Render all three.** The sparse one is the real test: magazine layouts fail ugly when
      half the sections are empty.
- [ ] **Step 3: Check each against the design intent** — verdict readable on the cover; every chart
      carries source and method; no empty section is silently blank; page count in the 28–34 range;
      Thai tone marks correct in chart labels.
- [ ] **Step 4: Hand to the user for review before merge.** This step is not automatable and must not
      be skipped.

---

## Done criteria

- [ ] Schema emits numbers; `'—'` became `null`, never `0`.
- [ ] All 17 sections render, **plus the course list**, which the old template dropped.
- [ ] Every figure removed from the body appears in the appendix — nothing lost.
- [ ] Every chart carries source, run date and method.
- [ ] `COUNCIL` redaction test passes.
- [ ] `deep-dive.controller.ts` is byte-identical to before.
- [ ] `pnpm typecheck` passes across all 8 projects.
- [ ] Three real programs rendered and reviewed by a human.

## Deferred (recorded in the spec, not in scope here)

- Repointing `/programs/[id]/print` at the new template.
- The PDF-palette ↔ design-token sync checker.
- Correcting three docs that still name the deleted `ChartForPrint`.
