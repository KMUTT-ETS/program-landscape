# Docs site reorganisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the adopter docs site (`apps/docs-site`) so it follows the adopter's path instead of the codebase. The work removes KKU-only and internal pages, gives Thai its own locale, and splits the 16,000-word adopter guide into task-sized pages in English and Thai.

**Architecture:** VitePress 1.6.4 still renders `docs/` in place. The site has one sidebar per locale, organised into six reader-ordered groups that match six top-nav entries. Thai twins move from `x.th.md` to `docs/th/x.md`, which gives a real `th` locale with a language switcher. `check-site.ts` keeps enforcing coverage, twins and retired names, and adds a page-shape rule for tutorials, guides and workshop pages.

**Tech Stack:** VitePress 1.6.4, TypeScript, Vitest, tsx.

**Spec:** the review in the previous session (2026-11-07), summarised under *Decisions* below. Owner decisions on 2026-11-07:
1. Stop publishing `CLAUDE.md`.
2. Remove KKU-only pages from the site.
3. Split the adopter guide in English and Thai now.

## Decisions

- **Removed from the site** (added to `EXCLUDED`, files stay in the repo): `auth/kku-sso.md`, `deployment/kku-network-integration.md`, `production-infrastructure.md`, `rollout-plan.md`, `dashboard-chatbot-tests.md`, `acknowledgements/jobthai.md`, `guides/admin-runbook.md` (written "for KKU IT operations").
- **No longer gathered:** `CLAUDE.md` (`project-contract`) and `DEPLOYMENT.md` (`deployment`, KKU's on-prem runbook). Links to them render as repository links through the existing `classifyLink` fallback. The adopter's deploy page becomes the new `guides/deploy.md`, split from §16 of the adopter guide.
- **Deleted stubs ("moved" pages):** `tutorials/workshop.md` + `.th.md`, `guides/fresh-checkout-setup.md`, `methodologies/program-health-and-lifecycle.md` + `.th.md`. Inbound links are retargeted to the page each stub pointed to.
- **One sidebar per locale, not one per path.** Concept pages live at the docs root (`/architecture`, `/ai-governance`, …), and VitePress per-path sidebars key on a path prefix, so a "Concepts" sidebar is impossible without moving files. Six groups in one sidebar, matched by six nav entries, gives the same reading order.
- **Thai locale by moving files, not by `rewrites`.** VitePress resolves relative links against the *rewritten* path, which would break every `./x.th.md` link. Twins move to `docs/th/<same path>`. `i18nRouting: false` sends the switcher to the Thai home page, and each page's existing top-of-page twin link handles page-to-page switching.
- **Data-source tiers come from the catalogue**, `packages/shared/src/ingestion/catalog.ts`, not from front matter:
  - `deprecated: true` → *Deprecated*.
  - `isKkuExample(slug)` → *Per-institution (KKU examples)*.
  - anything else → *Public and national*.

  A slug with no catalogue entry falls into *Public and national*.
- **Status badges dropped (YAGNI).** With KKU pages gone, the only status a reader needs is "deprecated", and the data-source grouping carries that.
- **Page shape** reuses the convention already in `tutorials/getting-started.md`:
  - English: a `**Outcome.**` paragraph in the first 20 lines and a `## Next step` heading.
  - Thai: `**ผลลัพธ์**` and `## ขั้นต่อไป`.
  - Applies to pages under `tutorials/`, `guides/` and `workshop/` (and their `th/` twins), except `README.md`, `workshop/troubleshooting.md` and `workshop/facilitator.md`.
- **Old adopter-guide anchors** cannot be redirected without JavaScript. The new hub `adopters/README.md` carries a "Where did section N go?" table instead.
- **Out of scope:** workshop sessions 4–5 (waiting on the owner's storyline decision). The Workshop sidebar shows a non-link item "Sessions 4–5: in preparation".

## Split map for `docs/adopters/README.md` (and its Thai twin)

| § | New page | Sidebar group |
|---|---|---|
| 1, 3, Attribution, old-section table | `adopters/README.md` (hub, ≤ 1,500 words) | Start |
| 2 | one paragraph in the hub; anything not already in `licensing.md` moves there | Start |
| 4 | `guides/upstream-fixes.md` | Guides |
| 5 | merged into `tutorials/getting-started.md`; only content it lacks is added | Tutorials |
| 6 | `adopters/codebase-layout.md` | Start |
| 7 | `guides/configuration.md` | Guides |
| 8 | `adopters/data-tiers.md` | Concepts |
| 9 | `guides/write-a-connector.md` | Guides |
| 10 | `guides/curriculum-pdfs-and-ai-digest.md` | Guides |
| 11 | `guides/rebrand.md` | Guides |
| 12 | `guides/adapt-a-methodology.md` | Guides |
| 13 | `guides/configure-ai.md` | Guides |
| 14 | `adopters/traps.md` | Reference |
| 15 | `guides/testing-and-ci.md` | Guides |
| 16 | `guides/deploy.md` (`.tar.zst`, not `.tar.gz`) | Guides |
| 17 | `adopters/pdpa-and-governance.md` | Concepts |
| 18 | `guides/extend-with-claude-code.md` | Guides |
| 19, 20 | `adopters/scope-and-effort.md` | Start |
| 21 | deleted (the sidebar replaces it) | — |

Each Thai counterpart lives at `th/<same path>`.

## Global Constraints

- English-only UI labels, except Thai sidebar and nav labels inside the `th` locale.
- Never write the retired names *Curriculum Compass*, *ทักษทัศน์* or *KKU Curriculum Landscape*, except on the routes in `RETIRED_NAME_ALLOWLIST`.
- Use `path.join()` for paths and `rimraf`, not `rm -rf`, in scripts. Use the `git rm` / `git mv` CLI only for file moves.
- Thai twins mirror English structure exactly: same count of `##`/`###` headings and identical fenced code blocks (`checkTwinPair`).
- Commit messages: conventional (`docs:`, `feat(docs-site):`, `test(docs-site):`), ending with the `Co-Authored-By` line.
- `pnpm docs:build` must pass at the end of every task, except Task 4, which is committed together with Task 5 (the Thai twin check fails in between).

## Review Focus

1. **A relative link in a moved Thai page still points at the old `.th.md` sibling.** The reader expects it to land on the Thai page. VitePress's dead-link check catches missing `.md` targets, so Task 2 runs the build and greps for `.th.md` until both are clean.
2. **An English page links to an adopter-guide anchor that has moved** (`adopters/README.md#9-the-connector-contract…`). The reader expects to land on the topic, but VitePress does not check anchors. Task 4 greps every `adopters/README(.th)?.md#` link in `docs/`, `apps/` and `packages/` and retargets each one.
3. **A rendered page links to a page that is now excluded** (for example `../auth/kku-sso.md`). The reader expects a working link, not a 404. `classifyLink` already turns it into a repository link, and the manifest test in Task 1 pins that behaviour.
4. **A new data-source spec has no catalogue entry.** It must still appear in the sidebar (coverage check). `dataSourceTier` returns `'public'` for unknown slugs, and Task 3 tests it.
5. **The Thai home `/th/` is not in any sidebar.** Like `/`, it must not count as missing. Task 2 tests `checkSidebarCoverage` with both routes.

---

### Task 1: Take KKU-only and internal pages off the site

**Files:**
- Modify: `apps/docs-site/src/manifest.ts`, `apps/docs-site/.vitepress/sidebar.ts`, `docs/index.md`
- Delete: `docs/tutorials/workshop.md`, `docs/tutorials/workshop.th.md`, `docs/guides/fresh-checkout-setup.md`, `docs/methodologies/program-health-and-lifecycle.md`, `docs/methodologies/program-health-and-lifecycle.th.md`
- Test: `apps/docs-site/test/manifest.test.ts`, `apps/docs-site/test/tutorial-commands.test.ts`

**Interfaces:**
- Produces: `EXCLUDED` gains the seven pages listed under *Decisions*. `GATHERED` loses the `CLAUDE.md` and `DEPLOYMENT.md` entries. `RETIRED_NAME_ALLOWLIST` loses `/_generated/project-contract`. `BILINGUAL_PAGES` loses `tutorials/workshop.md`.

- [ ] **Step 1: Write the failing tests** in `manifest.test.ts`:

```ts
it('keeps KKU-only pages off the site', () => {
  for (const p of ['auth/kku-sso.md', 'deployment/kku-network-integration.md', 'production-infrastructure.md',
    'rollout-plan.md', 'dashboard-chatbot-tests.md', 'acknowledgements/jobthai.md', 'guides/admin-runbook.md']) {
    expect(isExcluded(p)).toBe(true);
  }
});
it('does not publish the project contract or KKU runbook', () => {
  expect(GATHERED.map((g) => g.source)).not.toContain('CLAUDE.md');
  expect(GATHERED.map((g) => g.source)).not.toContain('DEPLOYMENT.md');
});
```

Add to `link-plugin.test.ts`: `classifyLink('../auth/kku-sso.md', <repo>/docs/adopters/README.md, repo)` returns `{ kind: 'repo-path', repoRel: 'docs/auth/kku-sso.md' }`.

- [ ] **Step 2: Run** `pnpm --filter docs-site test`. Expected: the two new manifest tests FAIL. The link-plugin test already passes, which is fine because it pins existing behaviour.
- [ ] **Step 3: Edit `manifest.ts`** as described under Interfaces.
- [ ] **Step 4: Delete the five stub files.** For each one, first read where it points. Then retarget every inbound link: `grep -rn "tutorials/workshop\(\.th\)\?\.md\|fresh-checkout-setup\|program-health-and-lifecycle" docs apps packages --include=*.md --include=*.ts --include=*.tsx`, ignoring `docs/superpowers/`. Drop `'workshop'` from `REQUIRED_PAGES` in `tutorial-commands.test.ts`.
- [ ] **Step 5: Remove the sidebar entries** for every excluded or deleted page in `sidebar.ts`. Point the "Run it" card in `docs/index.md` at `/backup-dr` for now (Task 4 retargets it to `/guides/deploy`).
- [ ] **Step 6: Run** `pnpm --filter docs-site test && pnpm docs:build`. Expected: PASS, with `docs-site check: N pages, sidebar complete, no retired names`. If a retired-name problem appears on a page that recorded the names deliberately, add that page's route to the allowlist.
- [ ] **Step 7: Commit** `docs: take KKU-only pages, CLAUDE.md and the KKU runbook off the adopter site`.

### Task 2: Thai locale under `docs/th/`

**Files:**
- Move: every `docs/**/*.th.md` (except files removed in Task 1) → `docs/th/<same dir>/<name>.md`, using `git mv`
- Create: `docs/th/index.md` (Thai home: hero with Thai name/tagline and actions linking `/th/adopters/README` and `/th/tutorials/getting-started`)
- Modify: `apps/docs-site/src/manifest.ts`, `apps/docs-site/src/check-site.ts`, `apps/docs-site/scripts/check-site.ts`, `apps/docs-site/.vitepress/config.ts`, `apps/docs-site/.vitepress/sidebar.ts`, `apps/docs-site/test/tutorial-commands.test.ts`
- Test: `apps/docs-site/test/check-site.test.ts`, `apps/docs-site/test/manifest.test.ts`

**Interfaces:**
- Produces:
  - `THAI_DIR = 'th'`.
  - `twinOf(enRel: string): string`, now `'adopters/README.md' → 'th/adopters/README.md'`.
  - `checkTwinPair(enRel, en, th)` resolves link targets: the English page must, in its first 30 lines, link to a path that resolves (relative to `enRel`'s dir) to `twinOf(enRel)`, and the Thai page must link to a path that resolves back to `enRel`.
  - `checkSidebarCoverage` ignores `/` and `/th/`.
  - `buildThaiSidebar(docsDir: string): DefaultTheme.SidebarItem[]` in `sidebar.ts`.
  - `NEW_TAB_DOC_PREFIXES` gains `'th/workshop/'`.

- [ ] **Step 1: Write the failing tests:**
  - `twinOf('tutorials/getting-started.md') === 'th/tutorials/getting-started.md'`.
  - `checkTwinPair('tutorials/a.md', '# A\n[ไทย](../th/tutorials/a.md)', '# A\n[English](../../tutorials/a.md)')` returns `[]`.
  - The same call with the Thai page linking `../../tutorials/b.md` (same folder, wrong page) returns one `bilingual-twin` problem containing `must link back`.
  - `checkSidebarCoverage(['/', '/th/', '/a'], ['/a'])` returns `[]`.
- [ ] **Step 2: Run** `pnpm --filter docs-site test`. Expected: those tests FAIL.
- [ ] **Step 3: Implement** the Interfaces changes. In `check-site.ts`, `linksTo` gets a `fromRel` and a `toRel` parameter and resolves each markdown link target with `path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), target))`, stripping `#…`.
- [ ] **Step 4: Move the files** with `git mv`. Then fix the relative links inside the moved files and in every page that linked to a `.th.md` file. Check with `grep -rn '\.th\.md' docs apps packages --include=*.md --include=*.ts --include=*.tsx | grep -v superpowers`; expected: no hits. Rewrite each twin banner so it links the moved path (English: `../th/<dir>/<name>.md`; Thai: back up to the English file).
- [ ] **Step 5: Configure the locale.** In `config.ts`, set `locales: { root: { label: 'English', lang: 'en' }, th: { label: 'ไทย', lang: 'th', link: '/th/', themeConfig: { nav: <Thai nav>, sidebar: buildThaiSidebar(docsDir) } } }` and `i18nRouting: false`. Until Task 3, `buildThaiSidebar` returns one group `{ text: 'ภาษาไทย', items: [...] }` listing every Thai page, and the English sidebar drops its Thai entries. `scripts/check-site.ts` collects links from both sidebars. Update the `.th.md` filter in `tutorial-commands.test.ts` to skip `docs/th/`, and add `docs/th/workshop/*` to its page list so the Thai commands are checked too.
- [ ] **Step 6: Run** `pnpm --filter docs-site test && pnpm docs:build`. Expected: PASS. Then run `pnpm --filter docs-site site:preview` (or open the dist HTML) and check that `/th/tutorials/getting-started.html` renders with the language switcher.
- [ ] **Step 7: Commit** `feat(docs-site): give Thai its own locale under docs/th/`.

### Task 3: Six reader-ordered groups and data sources by tier

**Files:**
- Create: `apps/docs-site/src/data-source-tier.ts`
- Modify: `apps/docs-site/.vitepress/sidebar.ts`, `apps/docs-site/.vitepress/config.ts`, `docs/workshop/README.md`, `docs/th/workshop/README.md`, `apps/docs-site/tsconfig.json` (only if it rejects the catalogue import)
- Test: `apps/docs-site/test/sidebar.test.ts`

**Interfaces:**
- Consumes: `SOURCE_CATALOG`, `isKkuExample` from `../../../packages/shared/src/ingestion/catalog` (relative import; the file imports only types).
- Produces:
  - `type DataSourceTier = 'public' | 'institution' | 'deprecated'`.
  - `dataSourceTier(slug: string): DataSourceTier`.
  - `dataSourceGroups(docsDir: string): DefaultTheme.SidebarItem[]`. It returns the collapsed groups *Public and national*, *Per-institution (KKU examples)* and *Deprecated*, in that order, omits empty groups, and replaces `dataSourceItems`.
  - The sidebar group order is **Start, Tutorials, Workshop, Guides, Concepts, Reference**, with contents as listed in the split map plus the existing pages assigned as follows:
    - **Start:** `/adopters/README`, `/licensing`, `/adopters/scope-and-effort` (from Task 4), `/architecture`, `/adopters/codebase-layout` (Task 4).
    - **Tutorials:** overview, getting started, `/guides/windows-wsl2`, Program Deep-Dive, adapt the registrar connector.
    - **Workshop:** overview, before the day, sessions 1–3, `{ text: 'Sessions 4–5: in preparation' }`, session 6, troubleshooting, facilitator.
    - **Guides:** `/data-import`, Task 4 guide pages, `/_generated/connector-session-template`, `/backup-dr`, `/integrations/staff-profile-api`, `/dev-database-safety`, `/migration-policy`.
    - **Concepts:** `/adopters/data-tiers`, `/data-sources`, `/evaluation-pipeline`, `/readiness-checklist`, `/adopters/pdpa-and-governance`, `/pdpa`, `/dsar-workflow`, `/security-review`, `/ai-governance`, `/prompt-standard`, `/methodologies/ai-extraction-accuracy`, `/trend-monitors`, `/pdf-ingestion`, `/pdf-generation`, `/markitdown`, `/profile-page`, plus *Methodologies* (collapsed).
    - **Reference:** scripts, env, `/data-sources/README` plus `dataSourceGroups`, `/auth/rbac`, `/adopters/deep-dive-data-map`, `/design-system`, `/glossary-th-en`, `/adopters/traps` (Task 4), `/db-indexes`, `/_generated/gotenberg-fonts`, `/_generated/security-policy`, `/_generated/readme`.
  - Pages that Task 4 creates are added to the sidebar in Task 4, not here. Nav: `Start → /adopters/README`, `Tutorials → /tutorials/README`, `Workshop → /workshop/README`, `Guides → /data-import`, `Concepts → /data-sources`, `Reference → /_generated/scripts`. The Thai sidebar uses the same six groups with Thai labels (เริ่มต้น, บทเรียน, เวิร์กช็อป, คู่มือปฏิบัติ, แนวคิด, อ้างอิง) and only Thai pages. Empty groups are omitted.

- [ ] **Step 1: Write the failing tests** in `sidebar.test.ts`:
  - `dataSourceTier('jobsdb') === 'deprecated'`.
  - `dataSourceTier('kku-hr') === 'institution'`.
  - `dataSourceTier('tcas') === 'public'`.
  - `dataSourceTier('no-such-source') === 'public'`.
  - `dataSourceGroups(tmpDocs)` with spec files `tcas.md`, `kku-hr.md`, `jobsdb.md`, `README.md`, `_template.md` returns three groups whose `items` are `[tcas]`, `[kku-hr]` and `[jobsdb]`.
  - `buildSidebar(realDocsDir).map((g) => g.text)` equals `['Start', 'Tutorials', 'Workshop', 'Guides', 'Concepts', 'Reference']`.
- [ ] **Step 2: Run** `pnpm --filter docs-site test`. Expected: FAIL.
- [ ] **Step 3: Implement** `data-source-tier.ts` and the regrouped `buildSidebar` / `buildThaiSidebar` and nav.
- [ ] **Step 4:** Add one sentence, in both languages, to the workshop overview: sessions 4 and 5 are in preparation and the day jumps from session 3 to session 6.
- [ ] **Step 5: Run** `pnpm --filter docs-site test && pnpm --filter docs-site typecheck && pnpm docs:build`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(docs-site): reader-ordered sidebar and data sources grouped by tier`.

### Task 4: Split the English adopter guide

**Files:**
- Create: the 15 pages in the split map (English)
- Modify: `docs/adopters/README.md` (becomes the hub), `docs/tutorials/getting-started.md`, `docs/licensing.md`, `docs/index.md`, `apps/docs-site/.vitepress/sidebar.ts`, `apps/docs-site/src/manifest.ts` (`RETIRED_NAME_ALLOWLIST`: replace `/adopters/README` with the route holding §11 "The name", i.e. `/guides/rebrand`)
- Test: `pnpm docs:build` (coverage, dead links, retired names)

**Interfaces:**
- Produces: the routes in the split map. Every new page opens with `# Title`, then an `**Outcome.**` paragraph (one or two sentences), and ends with `## Next step` linking the next page in its sidebar group. This is the Task 6 shape, so Task 6 has nothing to do for these pages.

- [ ] **Step 1: Move each section** in the split map into its page **verbatim**. Then edit only for standalone reading: drop "§N" cross-references in favour of page links, and promote `###` to `##` where the section heading becomes the page title. Fix `.tar.gz (~2.5 GB)` to `.tar.zst` in `guides/deploy.md`, and replace its "see DEPLOYMENT.md" pointers with a line saying the KKU runbook is in the repository as `DEPLOYMENT.md`.
- [ ] **Step 2: Rewrite `adopters/README.md` as the hub.** It keeps §1 and §3, a one-paragraph licence summary linking `licensing.md`, a "Choose your path" list (*evaluate* → scope and effort; *install* → getting started; *load data* → data tiers, import spreadsheets; *run in production* → deploy), the Attribution section, and a table **"Where did section N go?"** mapping old §1–§21 to the new pages.
- [ ] **Step 3: Retarget inbound anchors.** Run `grep -rnoE 'adopters/README\.md#[^)]*' docs apps packages --include=*.md --include=*.ts --include=*.tsx | grep -v superpowers`. Point each hit at its new page and heading. Expected: the grep returns only links to anchors that still exist in the hub.
- [ ] **Step 4:** Point the "Run it" card in `docs/index.md` at `/guides/deploy` and the hero's second action at `/tutorials/getting-started`. Add every new route to the English sidebar in its group, in split-map order.
- [ ] **Step 5: Run** `pnpm docs:build`. Expected: PASS. The bilingual check will flag `adopters/README.md` heading drift against the still-unsplit Thai guide; that is expected until Task 5. If you want a green build in between, run Tasks 4 and 5 in one branch and commit only after Task 5.
- [ ] **Step 6: Commit** `docs: split the adopter guide into task-sized pages` (with Task 5 if you are keeping the build green).

### Task 5: Split the Thai adopter guide to match

**Files:**
- Create: `docs/th/<path>` for each of the 15 pages in the split map
- Modify: `docs/th/adopters/README.md`, `docs/th/tutorials/getting-started.md`, `apps/docs-site/src/manifest.ts` (`BILINGUAL_PAGES` gains the 15 English paths; `RETIRED_NAME_ALLOWLIST` gets `/th/guides/rebrand` in place of the old Thai route), `apps/docs-site/.vitepress/sidebar.ts` (Thai sidebar entries)
- Test: `pnpm docs:build` (`bilingual-twin` checks)

**Interfaces:**
- Consumes: the English pages from Task 4. Each Thai page has the same `##`/`###` headings count and the same fenced code blocks, opens with `**ผลลัพธ์**`, ends with `## ขั้นต่อไป`, and links its English twin near the top (and the English page links back).

- [ ] **Step 1: Map each section of the current Thai guide** to the same page as its English section, and move it. Where the Thai guide has no counterpart for an English heading or code block (it is about 9,700 words against 16,300), translate the missing part from the English page. Thai analysis prose keeps the existing Thai register (ท่าน); code blocks are copied byte for byte from English.
- [ ] **Step 2: Add** the 15 English paths to `BILINGUAL_PAGES` and the Thai routes to `buildThaiSidebar`.
- [ ] **Step 3: Run** `pnpm docs:build`. Expected: PASS, with no `bilingual-twin` problems.
- [ ] **Step 4: Commit** `docs(th): split the Thai adopter guide to mirror the English pages`.

### Task 6: Enforce page shape on tutorials, guides and workshop pages

**Files:**
- Modify: `apps/docs-site/src/check-site.ts`, `apps/docs-site/src/manifest.ts`, `apps/docs-site/scripts/check-site.ts`, and the pages that fail the new check (expected: the workshop pages, `guides/windows-wsl2.md`, `tutorials/program-deep-dive.md`, `tutorials/adapt-the-registrar-connector.md`, and their Thai twins)
- Test: `apps/docs-site/test/check-site.test.ts`

**Interfaces:**
- Produces:
  - `ProblemKind` gains `'page-shape'`.
  - `needsPageShape(docsRel: string): boolean` in `manifest.ts`: after stripping a leading `th/`, the path starts with `tutorials/`, `guides/` or `workshop/`, and is not `README.md`, `workshop/troubleshooting.md` or `workshop/facilitator.md`.
  - `checkPageShape(docsRel: string, md: string): SiteProblem[]` in `check-site.ts`. For English, it requires a line starting `**Outcome.**` within the first 20 lines and a line exactly `## Next step`. For Thai (`th/`), it requires `**ผลลัพธ์**` and `## ขั้นต่อไป`. Each missing part produces one problem naming the page and the missing marker.

- [ ] **Step 1: Write the failing tests:**
  - `needsPageShape('guides/deploy.md') === true`.
  - `needsPageShape('th/workshop/troubleshooting.md') === false`.
  - `needsPageShape('tutorials/README.md') === false`.
  - `needsPageShape('architecture.md') === false`.
  - `checkPageShape('guides/x.md', '# X\n\n**Outcome.** You can.\n\n## Next step\n')` returns `[]`.
  - `checkPageShape('guides/x.md', '# X\n')` returns 2 problems.
  - `checkPageShape('th/guides/x.md', '# X\n\n**ผลลัพธ์** ได้\n\n## ขั้นต่อไป\n')` returns `[]`.
- [ ] **Step 2: Run** `pnpm --filter docs-site test`. Expected: FAIL.
- [ ] **Step 3: Implement**, and call `checkPageShape` from `scripts/check-site.ts` for every rendered page where `needsPageShape` is true.
- [ ] **Step 4: Run** `pnpm docs:build` and fix each reported page.
  - Workshop pages turn `## Goal` into an `**Outcome.**` paragraph. Do this in both twins, so the heading counts stay equal.
  - Add a `## Next step` section that links the next page in the sidebar.
  - Thai twins get the same edits.
- [ ] **Step 5: Run** `pnpm --filter docs-site test && pnpm docs:build`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(docs-site): every tutorial, guide and workshop page states its outcome and next step`.

### Task 7: Update the contract and verify end to end

**Files:**
- Modify: `CLAUDE.md` ("Documentation site" section), `docs/workshop/02-architecture-and-source.md` + Thai twin (they link `project-contract`)

- [ ] **Step 1:** In `CLAUDE.md`'s "Documentation site" section, add three lines:
  - Thai twins live at `docs/th/<same path>` and are listed in `BILINGUAL_PAGES`.
  - `CLAUDE.md`, `DEPLOYMENT.md` and KKU-only pages are deliberately not rendered.
  - Tutorial, guide and workshop pages need `**Outcome.**` and `## Next step`.
- [ ] **Step 2:** Retarget the workshop session 2 links to `project-contract` at the repository file. A relative link to `../../CLAUDE.md` now renders as a repository link.
- [ ] **Step 3: Run** `pnpm --filter docs-site test && pnpm --filter docs-site typecheck && pnpm docs:build`. Expected: PASS. Then run `grep -rl 'KMITL_SKILL_MAPPING_SECRET_KEY\|SCRAPINGBEE_API_KEY' apps/docs-site/dist`. Expected: no output, which proves the contract is no longer published.
- [ ] **Step 4: Commit** `docs: record the new docs-site layout in the project contract`.
