# Prompt audit — all 28 prompts vs `docs/prompt-standard.md`

> Read-only audit. Zero API spend. Companion to
> `docs/superpowers/specs/2026-08-16-prompt-standard-audit-design.md` and
> `docs/superpowers/plans/2026-08-16-prompt-standard-audit.md` (Task 3). Every prompt file in
> `packages/shared/src/ai/prompts/` (28 files, plus `index.ts` which is a pure re-export barrel —
> confirmed it hides nothing) was read in full, and its single call site was located via
> `grep -rn "build<Name>Messages"` across `apps/` and `packages/`.

## Summary

**Verdict counts: 15 REWRITE / 13 TOUCH / 0 LEAVE** (28 total, matches file count).

LEAVE is empty by construction, not by omission: the standard's markers (`CHANNEL MANIFEST`,
`CONFIDENCE RUBRIC`, a `BANNED PHRASES`/tell-ban header) exist in **zero** of the 28 files today —
expected, since the standard landed this session and the conformance ratchet starts fully
allowlisted. "LEAVE" is reserved for prompts that are either already conformant or so narrow the
standard barely applies; every prompt here needs at least the mechanical rubric+manifest addition,
which is the TOUCH floor. None were narrow enough to skip that floor.

### Recommended final Thai exemption list

The standard (`docs/prompt-standard.md ## Language`) ships with three exemptions and one open
candidate. This audit resolves the candidate and finds one exemption needs a scope note:

1. **`recruitmentSummaryTh` in `program-digest`** — unchanged. Marketing copy for prospective
   students; the field is the product.
2. **`nameTh`-class extraction fields** — unchanged, and now enumerated: `programNameTh` /
   `degreeNameTh` / course `nameTh` (program-digest, program-courses-extract), staff `nameTh`
   (program-faculty-extraction), skill `nameTh` (program-skills-detailed, course-skill-extraction,
   job-posting-skill-extraction, skill-name-normaliser's `canonicalNameTh`), `facultyNameTh` /
   `programNameTh` (graduate-employment-survey), `careerLabel` (career-kmitl-mapping, which echoes
   the program's own Thai career string verbatim, not model-generated analysis).
3. **`evaluation-question-translate`'s entire output** — unchanged; this prompt's job is
   translation and its output (`questionTextEn`) is already English, making it the one prompt
   already conformant on language by construction.
4. **NEW — `expertiseKeywordsTh` in `expertise-narrative` — ADD to the list.** Consuming surface:
   the profile page's Thai keyword chips, parallel array to the required `expertiseKeywordsEn`.
   This is a UI display list, not analysis prose. **`narrativeTh` (the 80–160 word paragraph) is
   explicitly NOT exempt** — it is full analysis content with no data-label character, and
   `narrativeEn` already exists as a required parallel field, so the fix is mechanical: drop or
   demote `narrativeTh`.

**Distinct from the exemption list:** verbatim `evidenceQuote` fields (program-digest,
program-skills-detailed, program-pedagogy, course-skill-extraction, risk-assessment) are not a
language exemption — they're a structural extraction requirement ("quote the source in the
source's language," per the Grounding + Extraction-addendum rules) and were already correctly
specified as verbatim/untranslated in every prompt that uses them. No change needed there; flagging
so a future reader doesn't conflate "verbatim quote in Thai" with "unexempted Thai analysis."

### The five discovery findings — status after reading all 28

1. **`program-strategic-narrative.v1` has never seen an employment rate.** Confirmed by reading
   both the prompt (`ProgramStrategicNarrativeInput` has no outcomes/demand-match/trend/risk/cohort
   fields) and its sole caller, `packages/db/src/program-strategic-narrative-run.ts:71-89` — the
   `Promise.all` fetches exactly 8 signals (health, aiReadiness, lifecycle, tcas, financials,
   demand, demographic, peerReview) and nothing else. This is Task 4 of the same plan; the audit
   doesn't re-do that work, just confirms the gap and ranks it REWRITE #1.
2. **Confidence is self-reported, not calibrated — confirmed universally.** Every one of the 28
   files ships a bare `confidence: z.number().min(0).max(1)` with at most an informal, per-prompt
   description in the system prompt (e.g. risk-assessment's "0.4-0.6 when data is sparse, 0.9+ when
   confident" — reasonable but not the standard's exact band text, and not present as a literal
   block the conformance test can grep for). Zero prompts carry the `CONFIDENCE RUBRIC` block.
3. **Doc drift confirmed:** `docs/evaluation-pipeline.md` §6 said 22; there are 28 real prompts (29
   files with `index.ts`). Fixed in this commit (see below for the exact framing used).
4. **Version-convention drift — confirmed, both cases:**
   - `program-courses-extract.v2.3` uses patch-style versioning (`v2` → `v2.1` → `v2.2` → `v2.3`),
     the only prompt in the estate that does. Per the standard, regularise at the next behaviour
     bump (jump straight to `v3`) — no rename-only commit needed now.
   - `decision-review.ts` exports `DECISION_REVIEW_VERSION = 'outcome-review.v1'` — file/constant
     name says "decision-review", the version string says "outcome-review". Also confirmed the
     pipeline doc already flags this ("`decision-review.v?` (`outcome-review.v1` per methodology
     doc)"). No behaviour change needed to regularise; do it at the next bump (either rename the
     file to `outcome-review.ts` or rename the constant to `decision-review.v1` — the audit doesn't
     pick which, that's a Task-4-style decision for whoever bumps it).
5. **Zero eval coverage for pipeline prompts — confirmed.** No `*.test.ts` file under
   `packages/shared/test/` exercises any of these 28 builders today (the builder-test pattern from
   plan Task 4 doesn't exist yet for any prompt). `pnpm ai:eval`'s 25 gold questions are
   analyst-chat-only, a separate surface (`analyst-system.v1`, out of scope per the spec's Deferred
   section).

### New findings (not in the spec's five)

6. **No dead prompts.** Every one of the 28 `build<Name>Messages` functions has exactly one
   non-test call site in `apps/` or `packages/`. Nothing in this estate is unused scaffolding —
   there was no "ask before declaring dead" case to raise.
7. **`risk-assessment.v3`'s comment says "Companion to risk-management.v2"** — this is NOT a
   missing prompt file. `risk-management.v2` refers to the deterministic rule engine in
   `packages/db/src/risk-measure-rules.ts` (confirmed via grep — the string appears in
   `apps/ingestion/src/scripts/risks-assess.ts` as a code-comment version tag, not in any prompt
   file). Worth a doc note so a future search for `risk-management.ts` in `prompts/` doesn't waste
   time — it will never be found there.
8. **The Thai-language material gap is far larger than "one candidate field."** The design spec
   named `expertise-narrative`'s keyword array as the only open candidate; reading all 28 files
   found that **11 more prompts** have non-exempt Thai-primary or Thai-only analysis output:
   `risk-assessment` (fully Thai), `decision-review` (Thai narrative required, English optional),
   `gap-insights`/`scenario-insights`/`benchmarking-insights` (fully Thai across all 3+5+4 modes),
   `trend-signal-analysis`/`trend-document-ingest`/`external-feed-summary` (bilingual TH/EN required
   on most fields, with `rationaleTh` carrying **no English mirror at all** in the first two),
   `policy-doc-analysis` (`summaryTh` explicitly instructed as "Thai primary... not a translation"),
   `program-pedagogy` (`narrativeTh` required alongside `narrativeEn` — the one prompt that already
   does full bilingual mirroring correctly, which is the pattern the others should have used instead
   of Thai-only). This is the single largest driver of the REWRITE count landing at 15 rather than
   the ~13 the plan's sanity check anticipated.
9. **`program-peer-selection.v1` explicitly invites fabrication.** Its system prompt says: *"If you
   don't know the exact name, write a defensible estimate based on naming conventions"* for
   `peerProgramName`, with no `estimated` flag on the output field. This is a direct tension with
   Grounding rule 2 ("missing input is never guessed") — the rule's carve-out (world knowledge
   permitted where the job is external context, but must be *marked* as context) is not honoured:
   a guessed name renders identically to a known one downstream in `program-peer-review`'s peer
   list. Promoted from "classification, mechanical TOUCH" to REWRITE for this reason — it sits
   upstream of `program-peer-review`, which is itself Council-affecting.
10. **The three AI-panel narrative prompts (`gap-insights`, `scenario-insights`,
    `benchmarking-insights`) are cheap REWRITE targets, not expensive ones.** They're invoked
    on-demand from UI "generate" buttons, not pre-computed per-program — there is no stored corpus
    to bulk-regenerate and no lifecycle-verdict blast radius. Their REWRITE classification is driven
    entirely by the language + rubric + tell-ban gaps, not by data or cost. Worth surfacing because
    the plan's worklist puts them after the "big 3" purely by narrative-vs-verdict category, but on
    a cost/effort basis they're closer to the TOUCH end and could be fast wins done in parallel.
11. **`program-ai-readiness.v4`'s rule 2 example list plus `program-peer-review.v4`'s
    content-modernity/gap rubric both instruct the model to reason from "your knowledge of what
    peers teach"** — this is legitimate per Grounding rule 4 (world knowledge permitted where the
    job is external context) but neither prompt's OUTPUT schema marks which claims are
    training-knowledge vs snapshot-grounded. A Council reader can't currently tell "KKU's AI score is
    62" (snapshot-grounded) from "NUS teaches computational fluid dynamics in year 2" (training-data
    recall, unverified, possibly stale) apart in the rendered text. Flagged as a grounding gap on
    both rows below, not just a language gap.

---

## Worklist

### REWRITE (15) — priority order: Council-affecting verdict prompts, then narrative, then rest

| # | Prompt | Version | Category | One-line reason |
|---|---|---|---|---|
| 1 | `program-peer-review` | v4 | Verdict | Drives lifecycle drivers 5+6 directly; no rubric/manifest/tell-ban; ambiguous language (`subjectBenchmarkSummary` comment says "Plain Thai or English"); peer-curriculum claims from training knowledge not flagged as such in output. |
| 2 | `program-ai-readiness` | v4 | Verdict | Feeds Risk L2 + lifecycle driver 1 + is consumed BY peer-review; already English but no rubric/manifest/tell-ban; missing outcomes/trend/KMITL-demand channels; peer-institution AI claims not flagged as training-knowledge. |
| 3 | `risk-assessment` | v3 | Verdict | Fully Thai (not exempt) on a Council risk narrative + measures; no rubric/manifest/tell-ban; missing graduate-outcomes and trend-signal channels despite being otherwise the best-wired prompt in the estate. |
| 4 | `program-pedagogy` | v1.1 | Verdict | Feeds health-score `pedagogical_fit` driver (portfolio-wide); `narrativeTh` not exempt despite `narrativeEn` already existing in parallel — the cheapest language fix in the REWRITE set; no rubric/manifest/tell-ban; doesn't cross-reference teaching evaluations. |
| 5 | `decision-review` (exports `outcome-review.v1`) | v1 | Verdict | `narrativeTh` required, `narrativeEn` optional — wrong default; missing rubric/manifest/tell-ban, missing the mandatory "what would change this verdict" line; low blast radius (few rows) but highest per-row Council sensitivity (accountability record). |
| 6 | `program-strategic-narrative` | v1 | Narrative | Largest single gap in the estate (finding 1) — no outcomes/demand-match/trend/risk/cohort channels at all; already scoped for rewrite in Task 4 of the parent plan. Listed here for completeness of the audit. |
| 7 | `gap-insights` | v1 | Narrative | Fully Thai across all 3 modes (strategic-top-5 / program-skills-to-add / sector-brief); Council-facing; no rubric/manifest/tell-ban. On-demand, not stored — cheap to fix (finding 10). |
| 8 | `scenario-insights` | v1 | Narrative | Fully Thai across all 5 modes incl. devils-advocate; feeds Decision Workspace; no rubric/manifest/tell-ban; `identify-risks` mode doesn't reference existing `RiskAssessment` rows for affected programs. On-demand, cheap to fix. |
| 9 | `benchmarking-insights` | v1 | Narrative | Fully Thai across all 4 modes; no rubric/manifest/tell-ban; doesn't reference graduate outcomes or KMITL demand when arguing curriculum gaps. On-demand, cheap to fix. |
| 10 | `expertise-narrative` | v2 | Narrative | `narrativeTh` (full paragraph) not exempt — only the keyword array is (finding, exemption list above); otherwise the most standard-adjacent narrative prompt already (has an informal tell-ban against marketing language). |
| 11 | `trend-signal-analysis` | v3 | Narrative | Bilingual fields not on the exemption list; `rationaleTh` has no English mirror at all; doesn't cross-reference the affected program's own `programSkills` when asserting immediate/emerging role fit — relies on model's general knowledge of "what such a program teaches" ungrounded. |
| 12 | `trend-document-ingest` | v1 | Narrative | Same bilingual-not-exempt issue; `rationaleTh` again has no English mirror; feeds the same downstream `trend-signal-analysis` pass. |
| 13 | `external-feed-summary` | v1 | Narrative | Bilingual not exempt; title language is explicitly "Thai OR English, whichever fits" — non-deterministic language choice is itself a standard violation. |
| 14 | `policy-doc-analysis` | v1 | Extraction | `summaryTh` explicitly instructed as Thai-primary "not a translation" — not exempt (this is an analysis summary of policy impact, not a data label); no rubric/manifest. |
| 15 | `program-peer-selection` | v1 | Classification | Explicit "write a defensible estimate" instruction invites fabricated peer program names with no estimated-flag (finding 9); feeds `program-peer-review`, so this is upstream of the #1 REWRITE item and should land first or alongside it. |

### TOUCH (13) — mechanical: add rubric + manifest + English line, no input changes

| # | Prompt | Version | Category | One-line reason |
|---|---|---|---|---|
| 16 | `program-digest` | v2 | Extraction | `recruitmentSummaryTh` + `nameTh` fields exempt; `caveats` array is Thai in practice (system prompt instructs Thai) — flip to English; otherwise sound. |
| 17 | `program-courses-extract` | v2.3 | Extraction | Already narrow, structural; `caveats` Thai→English; patch-style version to regularise at next bump (finding 4). |
| 18 | `program-faculty-extraction` | v1 | Extraction | `nameTh`/`qualifications`/`specialization` are data-label/verbatim, exempt; `reasoning` field is Thai in practice — flip to English. |
| 19 | `program-skills-detailed` | v2 | Extraction | Same pattern as #18 — `reasoning` field Thai→English; skill/PLO fields exempt or verbatim. |
| 20 | `course-skill-extraction` | v1 (`course-skills.v1`) | Extraction | Already fully English; only needs rubric+manifest. |
| 21 | `job-posting-skill-extraction` | v1 (`job-posting-skills.v1`) | Extraction | Already fully English; only needs rubric+manifest. |
| 22 | `graduate-employment-survey` | v1 | Extraction | Already fully English (facultyNameTh/programNameTh are exempt data labels); only needs rubric+manifest. |
| 23 | `imd-rankings-extract` | v1 (`imd-rankings.v1`) | Extraction | Already fully English; only needs rubric+manifest. |
| 24 | `career-kmitl-mapping` | v1 | Classification | `careerLabel` is an exempt echo of program data; `reasoning` field is Thai in practice — flip to English. |
| 25 | `demand-skill-match` | v2 | Classification | No real narrative field beyond exempt verbatim `evidenceQuote`; system-prompt instructions are bilingual but output is language-neutral already; needs rubric+manifest. |
| 26 | `skill-name-normaliser` | v1 | Classification | Already fully English; already HAS an explicit abstain path (`AMBIGUOUS`) — the addendum's best-conformant classification prompt in the estate; just needs rubric+manifest. |
| 27 | `pdf-classify` | v1 | Classification | Already fully English; `OTHER` functions as a de facto abstain (addendum prefers an explicit `"unmatched"` + reason — worth aligning at the mechanical pass); needs rubric+manifest. |
| 28 | `evaluation-question-translate` | v1 | Translation utility (exempt by design) | Output IS English by construction (translating Thai→English) — the one prompt already conformant on language; still needs the formal rubric+manifest markers to pass the ratchet. |

### LEAVE (0)

None. See Summary for why the bar isn't met by any prompt today.

---

## Notes per prompt

**`program-peer-review.v4`** — Beyond the table row: this prompt's `contentModernity` +
`contentGaps` verdict leans entirely on "your knowledge of what world-tier peers (MIT, Imperial,
NUS, NTU, etc.) actually teach" (system prompt, CONTENT-GAP IDENTIFICATION section). That's a
legitimate use of Grounding rule 4 (external context is the job here), but the output schema has no
field distinguishing "grounded in KKU's own snapshot" from "recalled from training data about a
named peer." A rewrite should add a lightweight marker (e.g. a `groundedIn: 'kku-snapshot' |
'peer-knowledge'` tag on `contentGaps` entries) so Council readers and the conformance/eval harness
can tell the two apart. This is the same issue as finding 11, called out here because this prompt is
REWRITE priority #1.

**`risk-assessment.v3`** — Genuinely the best-wired prompt in the estate on data channels (KRI
breaches, rule-derived candidate measures, AI-readiness deep-dive, TCAS funnel, peer distinctiveness,
whitespace skills, sector outlook all arrive as first-class inputs). The gap is almost entirely
language + missing-marker mechanics, not grounding. Worth noting as the "what good channel wiring
looks like" reference for whoever rewrites the other verdict prompts.

**`program-pedagogy.v1.1`** — Already does correct bilingual mirroring (`narrativeTh` +
`narrativeEn` both required, same content). The fix here is narrower than the other REWRITEs: either
drop `narrativeTh` or make it explicitly secondary/optional, keep `narrativeEn` as canonical. Also:
`disciplineFitScore` comparisons cite "expected pedagogy for this discipline" from the model's own
domain knowledge (the rubric table baked into the system prompt) — this is appropriately treated as
a fixed rubric, not an ungrounded claim, so no additional marking is needed there (unlike peer-review
above, the comparison anchor is the prompt's own stated table, not free-recall).

**`decision-review`** — Lowest blast radius of any REWRITE (per session-log history, only a handful
of `DecisionOutcomeReview` rows exist as of the last recorded prompt-12 session — one pre-filled
sample noted, plus whatever 6mo/1yr/3yr horizons have fired since). Cheap to regenerate in full once
rewritten; the priority here is correctness of the next reviews going out, not backfill volume.

**`trend-signal-analysis.v3` / `trend-document-ingest.v1`** — Both should be rewritten together:
`trend-document-ingest` drafts a signal, then the runner immediately re-runs
`trend-signal-analysis` on it (per `trend-document-ingest.ts`'s own header comment), so a language
mismatch between the two (one says "Thai primary," the other requires strict TH/EN pairs) will
otherwise just be re-introduced on every document upload.

---

## Blast radius (approximate — read-only audit, no live DB queries run)

Counts below come from `CLAUDE.md`'s session log (last confirmed figures), not a fresh query — flag
as approximate. All costs are order-of-magnitude (calls × rough token count), not pricing.

| Prompt | Stored rows / regen scope | Downstream consumers | Cost order of magnitude |
|---|---|---|---|
| `program-strategic-narrative` | ~228 programs w/ digests (`program_strategic_narratives`, 1 row/program) | Deep-Dive header brief only (informational, not a lifecycle driver) | ~$5–15 full portfolio (Pro model, few-KB snapshot in, ~1-2K tokens out) |
| `program-peer-review` | Subset of programs with peer selections run (order ~200) | **Lifecycle drivers 5+6 directly**; Deep-Dive Peer Comparison; feeds `program-ai-readiness`'s gap citations | ~$15–25 full backfill (richest input snapshot: skills+courses+PLOs+peers) — highest-stakes regen, needs the 3-program gate |
| `program-ai-readiness` | ~228 programs (order) | Risk L2; lifecycle driver 1; consumed by `program-peer-review`'s AI-readiness block | ~$10–20 full backfill |
| `risk-assessment` | Per-program `RiskAssessment` rows (order ~228, wherever the pipeline has run) | Risk dashboard, Decision Workspace risk narratives, Council risk briefs — not itself a lifecycle driver | ~$10–20 full backfill |
| `program-pedagogy` | ~228 programs w/ PDFs | health-score `pedagogical_fit` relevance driver — portfolio-wide health-score shift on regen | ~$35–90 full backfill (largest single-call context: full PDF text, 30–150K tokens in per program) — most expensive REWRITE to bulk-regenerate |
| `decision-review` | Handful of rows (fires only at 6mo/1yr/3yr decision horizons) | Council accountability record, lessons-learned search page | Negligible (<$1 total at current volume) |
| `gap-insights` / `scenario-insights` / `benchmarking-insights` | **None stored** — on-demand "generate" endpoints | `/gap-analysis`, `/scenarios`, `/benchmarking` AI panels; scenario `identify-risks` feeds Decision Workspace risk framing | No bulk backfill; cost is per future user click |
| `trend-signal-analysis` | One row per `TrendSignal` (29 seeded + real ingested since — dozens, growing) | `/trends` radar affected-programs/roles, `newInitiatives` white-space list | ~$1–5 to re-run existing signal backlog |
| `trend-document-ingest` | Not itself stored (drafts, then re-analyzed) | Re-run only on future document uploads | Negligible |
| `external-feed-summary` | One `TrendSignal` per fetched item, volume depends on monitor cadence (currently monitors are stubs returning "nothing new" per prompt-07 session notes) | `/trends` radar | Currently near-zero (monitors not real yet) |
| `policy-doc-analysis` | One `PolicyDocument` row per ingested policy PDF (modest count, <50 estimated) | Policy impact assessment, suggested-programs review queue | <$5 full backfill |
| `program-peer-selection` | ~228 programs (order) | Feeds `program-peer-review`'s candidate peer list directly — regenerating shifts WHICH peers get reviewed, so should move in lockstep with #1 | ~$3–8 full backfill |
| `expertise-narrative` | Per-`FacultyMember` on first profile view (auto-fires) — could be up to ~3,800 rows theoretically, realistically far fewer (only visited profiles) | Profile page only — not Council-facing | Cheap per-call; no bulk trigger exists today (fires lazily) |
| All 13 TOUCH prompts | Varies (extraction/classification prompts run per-document or per-batch, not bulk-backfilled by nature) | Feed materialisation pipelines (ProgramSkill, JobPostingSkill, CourseSkill, etc.) | No forced bulk regen — TOUCH changes (rubric/manifest/English line) don't change output shape, so existing rows don't need to be redone; new runs simply carry the new markers |

---

## Pipeline-doc fix

`docs/evaluation-pipeline.md` §6 updated: heading "The 22 AI prompts" → "The 28 AI prompts", with a
clarifying line that the directory holds 29 files (28 prompt builders + one `index.ts` barrel that
re-exports all of them, confirmed to hide nothing). The four category tables (6.1–6.4) are rewritten
to list all 28 with their real current versions, in the same table format as before. See the diff in
`docs/evaluation-pipeline.md` for the exact content — table format preserved, prose outside §6
untouched.
