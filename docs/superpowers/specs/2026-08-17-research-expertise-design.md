# Program research expertise — deep-dive feature

> Date: 2026-08-17 · Status: draft for review
> Requested by the user: analyse the last 10 years of the program roster's publications with an LLM,
> present the program's demonstrated expertise, and make strong recommendations with example actions.

## Feasibility (measured 2026-08-17, dev DB)

**The data is ready.** No schema change is needed to reach publications from a program:
`Program → ProgramFaculty → FacultyMember → ResearchOutput`.

| fact | value |
|---|---|
| Programs with a curated roster | **252 / 301** (median 11 members) |
| Programs with ≥10 papers in the last 10y | **246** |
| Median distinct papers per program (10y) | **212** · max 2,899 (KKU-SEQ-0252) |
| Row→paper duplication (roster co-authors) | ~2.3× — e.g. KKU-SEQ-0065: 588 rows → **259 papers** |
| Field coverage (10y rows) | title 100% · venue **98.6%** · year/citations/type 100% · quartile **30.9%** · CiteScore percentile where quartile exists |
| Author-match quality | 99.6% (post-backfill) · all rows pass `realDataWhere()` |
| Signal check | KKU-SEQ-0065's top-cited titles instantly read as a sustainable/recycled-concrete group — titles alone carry thematic signal |

**Limits designed around, not ignored:**

1. **No abstracts.** Titles + venues support *thematic* expertise claims; they do not support claims
   about methodological depth or findings. The prompt forbids the latter explicitly.
2. **Dedup mandatory** — by `doi ?? openalexId ?? scopusId ?? pmid ?? normalised title`.
3. **Quartile on ~31% only** — enrichment where present; absence must never read as low quality.
4. **Volume outliers** — a selection strategy bounds LLM context (below).
5. **~55 programs** thin or roster-less → explained empty states (`no-roster` / `thin`), matching
   the deep-dive's empty-state discipline.
6. **The roster is itself AI-extracted** (`program-faculty.v1`) — provenance states that the
   analysis covers *the curated roster's* publications; roster errors propagate and the caveat
   says so.

## Decisions (settled with the user)

1. **Recommendation lanes: all three** — curriculum & teaching, program positioning & recruitment,
   research strategy. The output groups actions by lane.
2. **Engine: single LLM call over a smart selection** (Approach A). Dedup → score
   (recency × citations × quartile-when-present) → top ~150 titles+venues verbatim, plus a
   **deterministic stats block** computed in code: papers/year, top venues by frequency, quartile
   mix, roster size, and an explicit "N further papers not shown". The stats block prevents
   over-generalising from the visible top-N. Two-stage map-reduce is a recorded refinement for the
   mega-programs, not the start.
3. Everything follows the conventions this repo already runs on: pre-computed pipeline phase, own
   table, deep-dive fan-out endpoint, section component, English-only per `docs/prompt-standard.md`,
   **conformant from birth** (the ratchet admits no new allowlist entries).

## Components

### 1. Data assembly — `packages/db/src/program-research-expertise.ts`

Pure, testable helper `assembleResearchExpertiseInput(programId)`:

- Roster fetch; `readiness: 'ok' | 'thin' | 'no-roster'` (`thin` = <10 distinct papers in 10y —
  below that, theme claims would be numerology).
- 10-year window relative to the current year (not hardcoded 2016).
- Dedup by external-ID-else-title; keep per-paper: title, venue, year, citations, quartile,
  contributing roster count.
- Score: `recencyWeight(year) × log(citations+2) × quartileBoost` (exact form in the plan; the
  *ordering* is what matters, and ties break toward recent).
- Output: `topPapers` (≤150), `stats` (papersPerYear, topVenues≤15 with counts, quartile mix,
  totalDistinct, rosterSize, notShownCount), `readiness`.

### 2. The prompt — `program-research-expertise.v1`

`packages/shared/src/ai/prompts/program-research-expertise.ts`, conformant from birth: English rule,
`CONFIDENCE RUBRIC` verbatim, `BANNED PHRASES` block, `// CHANNEL MANIFEST` (consumed: roster
publications, stats; omitted-with-reason: abstracts — not stored; teaching evaluations — different
question; peer review — separate section).

Grounding rules with teeth:

- Every theme cites its paper count and **2–3 verbatim example titles from the input** — a theme
  the model cannot evidence with titles it was shown does not exist.
- Titles-only input is stated in-prompt; claims about findings, methods, or quality beyond
  citations/quartile are forbidden.
- Quartile absence is "not assessed", never "low".
- Trend labels (`rising`/`steady`/`fading`) must follow from the per-year counts in the stats
  block, not vibes.
- Recommendations must be actionable by a university and name a horizon in months; each cites the
  theme(s) it builds on.

Output schema (Zod):

```
themes[]           { name, paperCount, exampleTitles[2..3], yearSpan, trend, evidenceNote }
recommendations    { curriculum[], positioning[], research[] }   // each { action, rationale, horizonMonths, themeRefs[] }
caveats[]          strings (must include the roster-provenance caveat verbatim from a constant)
confidence         0..1 — clamped by a deterministic ceiling (below)
```

Deterministic confidence ceiling (same pattern as the narrative clamp): from `readiness`,
`totalDistinct`, and roster coverage — e.g. `ok`+200 papers ceils at 1.0; `ok`+30 papers ceils
lower; `thin` ceils ≤0.5. Exact bands in the plan; enforced in the runner, not trusted to the model.
Banned-tell lint + single retry: reuse `lintBannedTells` exactly as the narrative runner does.

### 3. Storage — `ProgramResearchExpertise`

New table (additive migration): `programId` (FK, indexed), `payloadJson`, `methodVersion`,
`inputStatsJson` (the deterministic stats block — kept so the UI can render numbers without
re-deriving and so drift between input and claims is auditable), `generatedAt`, `aiInferenceId`.
Regeneration inserts a new row; latest-by-generatedAt wins; history retained (the
`program_ai_readiness_assessments` pattern).

### 4. Pipeline + ops

- New phase in `programs-pipeline.ts` after faculty extraction (roster must exist) and before the
  strategic narrative (which may later cite expertise themes — recorded as a future channel for
  narrative v3, not wired now).
- `pnpm expertise:generate --only <code> | --limit N | --all` — same shape as
  `narratives:regenerate`, refuses to run bare.
- Full-run cost ≈ 250 × ~$0.02–0.04 ≈ **$5–10** (Pro-class; this is synthesis, not extraction).
  Every bulk run is gated on the user's go.

### 5. Surfaces

- API: `GET /programs/:id/research-expertise` on the deep-dive controller, `@Provenance` reading
  the **version constant** (never a literal — a hardcoded provenance version already bit us once),
  sources naming kku-research + the roster provenance.
- Deep-dive: new section in `client.tsx` — themes with counts + example titles, lane-grouped
  recommendations, caveats, `<ConfidenceBadge>` + `<FreshnessBadge>`, explained empty states for
  `no-roster` ("no curated roster — run programs:extract-faculty") and `thin`.
- PDF: follow-on task — a reference-table-shape section (no chart) using the v2 section-component
  pattern, plus its appendix exemption (content already complete in body).

## Testing

- Assembly helper: dedup (the 588→259 case as a fixture shape), scoring order, window arithmetic,
  readiness verdicts, stats correctness — pure-function tests in `packages/db/test/`.
- Prompt builder: conformance markers, verbatim-title requirement present, all-null/thin inputs
  render explained, fixture snapshot — in `packages/shared/test/`; ratchet entry NOT added (the
  file must conform from birth).
- Ceiling clamp bands; lint wiring (reuse existing lint tests as the pattern).
- One gated live smoke on 3 programs (rich / median / thin) reviewed by the user before any bulk
  run — the same gate pattern that caught the narrative's silent-drop bug.

## Risks

- **Theme hallucination from thin evidence** — the verbatim-example-titles requirement is the main
  control; the `thin` readiness floor is the second.
- **Recommendation overreach** ("hire 5 professors") — actionability + horizon + themeRefs rules;
  the 3-program gate is where we calibrate tone before bulk.
- **Roster quality propagates** — stated caveat; roster fixes are a separate workstream.
- **Mega-programs under-represented by top-150** — stats block mitigates; two-stage engine is the
  recorded upgrade path if the gate shows it matters.

## Deferred

- OpenAlex abstract enrichment (abstracts exist upstream as inverted indexes — a connector change
  that would materially upgrade the signal).
- Embedding-based clustering; department/faculty-level rollups; narrative-v3 citing expertise
  themes; PDF section can trail the web section by one task.
