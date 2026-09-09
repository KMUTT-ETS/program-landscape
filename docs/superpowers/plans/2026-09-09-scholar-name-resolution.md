# Scholar name resolution — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual paste-a-URL binding step with a single "Sync Google Scholar" button that resolves the profile from the user's English full name, records the id it finds, and uses that id on every later sync.

**Architecture:** The transport gains a stealth branch; a new pure unit turns parsed search output into a resolution decision; the runner's binding gate becomes the search branch. Nothing else about the feature changes — the merge is still additive-only, the ledgers still work the same way.

**Spec:** `docs/superpowers/specs/2026-09-09-scholar-name-resolution-design.md`

**Reference implementation:** `~/projects/mhesi-program-review` — `src/lib/external/scrapingbee.ts` (transport, parsers, four-case resolution), `scholar-profile.ts` (binding store). **READ ONLY. Do not modify that repo.** It has run this in production; where it and this plan disagree, raise it rather than choosing silently.

---

## Task 1: Transport — stealth for searches, plain for profiles

**Files:** `packages/shared/src/scholar/scrapingbee.ts`, `packages/shared/test/scholar-scrapingbee.test.ts`.

- [ ] **Step 1: Branch the flags.** Profile pages (`/citations?user=`) keep `custom_google` only at 15 credits. Searches (`/scholar?q=`) additionally send `stealth_proxy=true` at 75. Do NOT set `country_code` — measured 2/4 success with `th` versus 7/7 without.
- [ ] **Step 2: Export the cost constants** so the estimator cannot drift: the existing `GOOGLE_PAGE_CREDIT_COST = 15` for profile pages, plus a new search-cost constant at 75. Comment both with the measurement date and that `Spb-Cost` is authoritative per call.
- [ ] **Step 3: Surface the real reason on a 500.** ScrapingBee's 500 body carries `reason` ("Server responded with 403") and `help` (Google's block page) — the generic "please try again" is the least useful part of it. The client already truncates non-2xx bodies into the error; make sure those two fields survive that truncation.
- [ ] **Step 4: Tests** — assert on the **outgoing URL** that a search carries both flags and a profile page carries only `custom_google`; assert no `country_code` on either. Mutation-test both (a guard that does not fail under mutation is decoration).
- [ ] **Step 5: Commit** — `feat(scholar): stealth proxy for searches, plain for profiles`

---

## Task 2: Name matching — title-aware, initial-tolerant (pure)

**Files:** `packages/shared/src/scholar/name-match.ts` + its test.

- [ ] **Step 1: Strip title patterns BEFORE character normalisation** — `A/P`, `Asst. Prof.`, `Assoc. Prof.`, `Prof. Dr.`. This ordering is load-bearing: normalising first splits `A/P` into `["a","p"]`, which the matcher then reads as initials against the real given name.
- [ ] **Step 2: Drop noise tokens** — `ap dr prof assoc asst associate assistant professor lecturer ms mr mrs miss sir madam phd msc bsc ma ba`.
- [ ] **Step 3: The rule.** Surname (last token) must match exactly. Each preceding Scholar token must equal the query token, or be a single-character prefix of it **in either direction**.
- [ ] **Step 4: Tests.** These cases specifically, because they are the ones that decide whether this is better or worse than what it replaces:
  - `Geoffrey E Hinton` ↔ `Geoffrey Everest Hinton` → **match** (our current matcher refuses this; our own review called it the most common real variant)
  - `Wei L Zhang` ↔ `Wei Q Zhang` → **refuse** (conflicting initials — the mis-attribution case)
  - `Asst. Prof. Somchai Jaidee` ↔ `Somchai Jaidee` → **match**
  - `A/P Lim Wei` ↔ `Lim Wei` → **match** (proves the strip-before-normalise ordering)
  - Different surnames → **refuse**, whatever the given names do
  Mutation-test the surname-equality rule and the strip ordering.
- [ ] **Step 5:** Decide whether this replaces `personNamesMatch` everywhere or only for Scholar-name comparison. `personNamesMatch` also gates `resolveScholarFacultyMember` (user → FacultyMember), which is a different question — a staff record is not a Scholar profile. **State which you chose and why.**
- [ ] **Step 6: Commit** — `feat(scholar): title-aware, initial-tolerant name matching`

---

## Task 3: Profile-cluster + search-hit parsing (pure)

**Files:** new parser module beside `packages/shared/src/scholar/parse.ts`; tests with committed fixtures.

- [ ] **Step 1: Capture fixtures first.** Real responses for: a search with a profile cluster, a search with none, a search whose authors are plain text (not hyperlinked — this happens and produces zero extractable ids), and a multi-card cluster. **These cost 75 credits each — capture once, commit, and test against the files thereafter.** Scrub nothing but do check for PII before committing.
- [ ] **Step 2: Parse the profile cluster.** Primary selector: an `h4` containing "user profile", then `/citations?user=` links within that row. Fallback: any `/citations?user=` anchor **not** inside a `.gs_a` byline — Scholar sometimes inlines a single card without the header. Return `{ authorId, name, affiliation? }`.
- [ ] **Step 3: Parse search hits** — title, authors, year, venue, link. Keep the raw row count separately from the filtered one: **truncation is judged on the raw count**, so a full page that filters down to three rows is still truncated.
- [ ] **Step 4: `cheerio` is approved — install it** (operator decision, 2026-09-09), so parse the way the reference does rather than hand-rolling a second HTML parser. **One constraint that still binds:** `@kku/shared`'s barrel is reachable from Next client components, and cheerio is a large server-only dependency. Keep it off any path a client component imports at runtime — a separate subpath export, not the barrel — and verify with a web typecheck plus a check that nothing client-side pulls it transitively. `parseScholarProfileUrl` already lives on a client-safe subpath (`@kku/shared/scholar/parse`); do not add cheerio to that module.
- [ ] **Step 5: Tests** against the committed fixtures, including the plain-text-authors case returning zero ids **without throwing**.
- [ ] **Step 6: Commit** — `feat(scholar): profile-cluster and search-hit parsers`

---

## Task 4: The four-case resolution decision (pure)

**Files:** new module in `packages/shared/src/scholar/`; test.

- [ ] **Step 1: A pure function** over `{ profileCards, searchHits, searchPageWasFull, queryName }` returning a discriminated decision: `use-profile(authorId)` / `use-articles` / `probe-without-as-vis` / `disambiguate(candidateIds)`. **No network, no Prisma.**
- [ ] **Step 2: The four cases**, exactly as the spec sets out — (a) no card, (b) one card matching, (c) one card **not** matching (alias path: drop the article results, they may be namesakes), (d) several cards, cap 3.
- [ ] **Step 2a: A fifth case the reference leaves on the table — byline links.** `parseSearchHits` must also return the per-author `/citations?user=` anchors inside each `div.gs_a` byline. The reference parses these and never uses them; for our names they may be the primary signal. Measured on a real KKU professor: **no profile cluster at all**, but a byline anchor gave the correct author id (verified by fetching the profile — right person, right faculty). So case (a) checks byline links for one whose anchor text matches the query **before** falling back to the probe, which saves 75 credits. Byline text is abbreviated (`P Chindaprasirt`) — that is what the initial-tolerant matcher from Task 2 is for. **A byline link whose anchor does NOT match the query is a co-author, not the subject; using it is the mis-attribution error this design exists to prevent.** This rests on one measured case: verify against the Task 3 fixtures, and keep the probe as the fallback.
- [ ] **Step 3: Case (a) probes only when the search page came back FULL**, and only after the byline check has found nothing.** A short page means Scholar returned everything it had and the count is already trustworthy; probing then spends 75 credits per person per run to confirm what is already known.
- [ ] **Step 4: Tests** for all four, plus: the alias path must **not** return article results, and the probe must **not** be requested on a short page. Mutation-test both.
- [ ] **Step 5: Commit** — `feat(scholar): four-case profile resolution`

---

## Task 5: Wire it into the runner

**Files:** `packages/db/src/scholar-fetch.ts` and its test.

- [ ] **Step 1: `SCHOLAR_NEEDS_BINDING` becomes the search branch**, not a terminal refusal. Bound → profile fetch, unchanged. Unbound → search → resolve → record → fetch.
- [ ] **Step 2: Record the resolved id through the existing `bindScholarProfile` write** so the audit trail is unchanged — but a machine-resolved binding is **not** a human assertion. Record which name was searched and which card won, so a wrong binding is explicable afterwards. Raise how you want to distinguish the two in the audit record before implementing.
- [ ] **Step 3: The no-delete invariant still holds** — `grep -nE "delete|deleteMany" packages/db/src/scholar-fetch.ts` must produce no output. CI enforces this (`scholar-no-delete` in `pr.yml`).
- [ ] **Step 4: Credits are the summed real `Spb-Cost`**, never pages × a constant — a search and a profile page now cost different amounts, so this matters more than before.
- [ ] **Step 5: Quota.** A search that resolves nothing costs 75 credits and produces no data. Existing posture: only `SUCCEEDED`/`PARTIAL` consume the allowance. **Decide and justify** — it is repeatable by a confused user, and it is not free.
- [ ] **Step 6: Tests** — bound path unchanged; unbound path searches, records, then fetches; a search resolving nothing does not record a binding; a failed search writes no `ResearchOutput`. Mutation-test the no-record-on-failure case.
- [ ] **Step 7: Commit** — `feat(scholar): resolve the profile from the name instead of refusing`

---

## Task 6: One button, and re-price the console

**Files:** `apps/web/app/profile/scholar-panel.tsx`, `apps/web/src/lib/scholar-status.ts`, `apps/api/src/scholar/scholar.service.ts`, `apps/web/app/admin/scholar/*`, and the tests that currently assert the old prices.

- [ ] **Step 1: One "Sync Google Scholar" button.** The `unbound` panel state stops opening a picker on first paint; it just syncs. Keep the paste field as a **manual override**, behind a "wrong person?" affordance, for correcting a bad resolution.
- [ ] **Step 2: Re-price the estimator.** An unbound target is no longer 0 — it is `SEARCH_COST + pages × PAGE_COST`. **Fix the tests that currently lock in 0**; they were correct for the old design and are wrong for this one.
- [ ] **Step 3: The console's three gates stay three**, but "not linked" changes meaning — it now costs *more*, not nothing. Re-word the dialog so an operator reads the real shape of the spend.
- [ ] **Step 4: Read every changed string back as rendered.** Adjacent numbers and text run together in this codebase — it has produced a defect in three consecutive tasks.
- [ ] **Step 5: Commit** — `feat(scholar): a single sync button, and honest bulk pricing`

---

## Task 7: Correct the record

**Files:** `docs/superpowers/specs/2026-09-08-google-scholar-on-demand-design.md`, `docs/superpowers/plans/2026-09-08-google-scholar-fetch.md`, `CLAUDE.md`, `handoff.md`.

- [ ] **Step 1:** All four assert that no name-search path exists and that binding must be by pasted URL. Correct each, pointing at the new spec. **Do not delete the walled-endpoint finding** — `view_op=search_authors` really is walled, that was re-verified, and someone will otherwise retest it.
- [ ] **Step 2:** Record the distinction that caused the error: the conclusion was drawn from one endpoint and generalised to all of them, and the probe that would have caught it timed out before running. A timed-out probe is not a negative result.
- [ ] **Step 3: Commit** — `docs(scholar): correct the no-name-search claim`

---

## Final verification

- [ ] `pnpm --filter @kku/shared exec vitest run` · `@kku/db` · `web` · `api` — all pass
- [ ] `tsc --noEmit` clean in every touched package
- [ ] `grep -rnE "delete|deleteMany" packages/db/src/scholar-fetch.ts` — **no output**
- [ ] Migration linter clean (no migration is expected — raise it if you think one is needed)
- [ ] Manual: sync a real staff member end to end, confirm the resolved id is correct and recorded
- [ ] Manual: sync someone with no Scholar profile, confirm it degrades honestly and records no binding
