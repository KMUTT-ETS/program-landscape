# Developer manual site — design

**Date:** 2026-10-15 · **Branch:** `feat/docs-site` (from `develop`) · **Status:** approved in brainstorming, awaiting spec review

## 1. Intent

**Reader:** a developer or small team at another (Thai) university adopting Program Landscape — fork, configure institution identity, wire their own data sources, deploy. Not KKU's own onboarding, not end users, not API consumers.

**Outcome:** the adopter path that today lives in one long file (`docs/adopters/README.md`, 21 chapters) plus the ~84 reference docs it points at becomes a browsable, searchable, offline site with a clear reading order.

**Decisions taken (user):**

| # | Decision |
|---|---|
| D1 | Audience: adopting institutions' developers (option B). |
| D2 | Local only: built from the repo and served locally; nothing is published or hosted. |
| D3 | English only for now. The Thai adopter guide stays a Markdown file in the repo. |
| D4 | Curated path; existing docs render **in place** — `docs/` remains the single source of truth, no hand-maintained copies. Working documents are excluded. |
| D5 | Tool: VitePress, plus two generated reference pages (pnpm scripts, environment variables). |

**Success criteria:**

- `pnpm docs:build` produces a static site from a clean checkout with no DB, Docker or `.env`.
- Every curated doc is reachable from the sidebar in adopter-journey order; local full-text search works offline.
- A renamed/deleted source doc, a dead internal link, a doc missing from the sidebar, or a retired product name fails the build.
- No hand-written doc content is duplicated.

## 2. Architecture

New workspace package `apps/docs-site` (unscoped, matched by the existing `apps/*` workspace glob). Not part of `pnpm dev`, not containerised, not in the release bundle.

```
apps/docs-site/
  package.json              # vitepress (exact pinned version), tsx, vitest, rimraf
  .vitepress/
    config.ts               # srcDir, srcExclude, nav, local search, markdown plugin
    sidebar.ts              # the curated adopter path — single source of ordering
    theme/index.ts          # default theme + custom.css (fonts, accent)
    theme/custom.css
  scripts/
    gather.ts               # pre-build step (§4)
    check-site.ts           # post-build checks (§5)
  src/
    link-plugin.ts          # markdown-it link rewriting (§3.4)
  test/                     # vitest (§6)
```

- **`srcDir`** = repo `docs/` (via `path.join`, relative to the config file).
- **`srcExclude`**: `superpowers/**`, `hardening/**`, `design/**`, `data-sources/_template.md`, `user-manual.md`, `guides/council-th.md`, `guides/executive.md`, `guides/analyst.md`, `adopters/README.th.md`.
- **Gather output** lives in `docs/_generated/` (gitignored). Not a dot-directory, because VitePress's file glob skips dot-directories.
- **Root scripts:** `docs:dev` (gather → `vitepress dev`), `docs:build` (gather → `vitepress build` → check-site), `docs:preview` (`vitepress preview`). Build output: `apps/docs-site/dist/` (gitignored).
- **Theme:** VitePress default theme (light/dark, follows system preference). `custom.css` sets the IBM Plex Sans Thai / Plex Mono font stack and an accent colour through VitePress's CSS variables. That one file carries an eslint-ignore comment with the reason: VitePress variables need literal values, and the no-hex rule targets app UI.
- Cross-platform: Node + tsx only, `path.join` for paths, `rimraf` for deletion; no shell commands.

## 3. Content

### 3.1 Landing page

New `docs/index.md` (VitePress `layout: home`) — the only new hand-written prose. One paragraph on what the platform is, one line on the CC BY-NC-SA 4.0 obligations linking to Licensing, and four entry cards: **Start**, **Adapt your data**, **Run it**, **Reference**.

### 3.2 Sidebar (adopter journey)

Order follows the adopter guide's chapter 20 ("suggested order of work"). Defined once in `sidebar.ts`.

1. **Start here** — Adopter guide (`adopters/README.md`), Licensing, Fresh checkout setup (`guides/fresh-checkout-setup.md`), Architecture, Evaluation pipeline, Project contract & decision log (gathered `CLAUDE.md`)
2. **Data integration** — Ingestion framework (`data-sources.md`), Source catalogue (`data-sources/README.md`), Per-source specs (collapsed group over `data-sources/*.md`), Connector session template (gathered), Migration policy, DB indexes, Dev database safety
3. **Documents & PDFs** — PDF ingestion, PDF generation, Gotenberg fonts (gathered `infra/gotenberg/README.md`), MarkItDown
4. **AI layer** — AI governance, Prompt standard, Evaluation & accuracy (`methodologies/ai-extraction-accuracy.md`), Trend monitors, Dashboard chatbot tests
5. **Methodologies** — `methodologies/README.md`, then each methodology page (the Thai lifecycle companion `program-health-and-lifecycle.th.md` is listed beside its English page as "(Thai)")
6. **UI & branding** — Design system, Profile page, Glossary TH–EN
7. **Auth, security & privacy** — KKU SSO, RBAC, Security review, PDPA, DSAR workflow
8. **Deploy & operate** — Deployment (gathered `DEPLOYMENT.md`), Production infrastructure, Network integration, Backup & DR, Admin runbook, Readiness checklist, Rollout plan, Security policy (gathered `SECURITY.md`)
9. **Integrations** — Staff Profile API
10. **Reference** — pnpm scripts (generated), Environment variables (generated), README (gathered)

`acknowledgements/jobthai.md` goes under Data integration beside the JobThai source spec.

### 3.3 Gathered and generated pages

**Gathered** (copied by `gather.ts` from outside `docs/`): `README.md`, `DEPLOYMENT.md`, `CLAUDE.md`, `SECURITY.md`, `prompts/14-integration-session-template.md`, `infra/gotenberg/README.md`. Each copy gets a banner as its first line: *"Generated from `<repo path>` — edit the source, not this page."* Relative links inside a copy are rewritten so they still resolve from the new location.

**Generated:**

- `_generated/scripts.md` — every root `package.json` script grouped by name prefix (`db:`, `programs:`, `research:`, …; no prefix → "General"), as a table of name → command. No hand-written descriptions.
- `_generated/env.md` — parsed from `.env.example`: key, example value and the comment block directly above it, grouped by the file's own section-header comments. Any key matching `/SECRET|PASSWORD|KEY|TOKEN/i` is emitted with an empty value regardless of what the file holds.

The generated pages contain only what is already in the repo; they introduce no new data.

### 3.4 Link handling (`link-plugin.ts`)

- Link to a gathered file (e.g. `../DEPLOYMENT.md`, `../../prompts/14-…md`) → rewritten to its `_generated/` site route.
- Link to any other path outside `docs/` (source code, configs) → rendered as inline code of the repo path with a "source file" marker, not a hyperlink. The repo is private and the site is local, so there is nothing to link to.
- In-page anchors and external `http(s)` links → unchanged.

### 3.5 Source-doc fixes made as part of this work

- The 5 prose occurrences of a bare `<Tag>` outside code (in `guides/admin-runbook.md`, `dsar-workflow.md`, `data-sources/_template.md`, `dashboard-chatbot-tests.md`, `ai-governance.md`) are wrapped in backticks — VitePress compiles Markdown through Vue. Markdown `html` stays enabled so intentional `<details>`/`<br>` keep working.
- The dead link `methodologies/README.md` → `./benchmarking.md` is fixed: pointed at the right doc if one exists, otherwise removed.

## 4. Build flow

`gather.ts` → `vitepress build` → `check-site.ts`

**`gather.ts`:**

1. Clears `docs/_generated/` (rimraf).
2. Copies the gathered files with banner + link rewrite.
3. Writes `scripts.md` and `env.md`.

It is deterministic (sorted output, no timestamps). It exits non-zero, naming the path, if a gathered source file is missing, if `.env.example` cannot be read, or if `package.json` has no `scripts`.

**`vitepress build`** runs with `ignoreDeadLinks: false`, so dead internal links fail the build.

## 5. Post-build checks (`check-site.ts`)

- **Sidebar coverage:** every rendered page appears in the sidebar and every sidebar entry exists. The per-source group is glob-matched (`data-sources/*.md`), so adding a source spec needs no sidebar edit. Any other new doc in `docs/` must either get a sidebar entry or be added to `srcExclude`, otherwise the build fails.
- **Retired names:** the build fails if rendered HTML contains *Curriculum Compass*, *ทักษทัศน์* or *KKU Curriculum Landscape*. The gathered `CLAUDE.md` is allowlisted, because it records them deliberately.

## 6. Testing

Vitest in `apps/docs-site/test/`, picked up by the normal `pnpm test` recursion:

- `gather.test.ts` (temp-dir fixtures):
  - Banner and copy, and link rewrite inside gathered files.
  - Script grouping by prefix.
  - `.env.example` sections and comments, and secret-value blanking.
  - Missing source → error.
  - Two runs produce byte-identical output.
- `link-plugin.test.ts`:
  - A gathered-file link becomes its site route.
  - A source path becomes code rendering.
  - Anchors and external links are left unchanged.
- `check-site.test.ts`:
  - A page not in the sidebar fails.
  - A sidebar entry without a page fails.
  - A retired name outside the allowlist fails; the allowlisted page passes.

Manual smoke test, recorded in the PR or merge note: `pnpm docs:build` passes from a clean worktree; search finds `realDataWhere`; the adopter guide's 21-chapter anchors work; dark mode toggles; a gathered page shows its banner.

`docs:build` is **not** added to `pnpm check` or CI in this iteration.

## 7. Implementation workflow

- Implementation runs in the existing worktree `../program-landscape-docs-site` on branch `feat/docs-site` (branched from `develop` at `3861e08c`). The main checkout stays on `develop`.
- `pnpm install` runs inside the worktree; only `apps/docs-site` gains dependencies.
- No DB, Docker or `.env` needed.
- Conventional commits: `feat(docs-site): …` for the package, `docs: …` for source-doc fixes.
- At the end, the user chooses merge to `develop`, PR, or keep the branch; the worktree is then removed.

## 8. Out of scope

Hosting or publishing; a Thai site; versioned docs per release; API reference generated from NestJS controllers; inclusion in the release bundle; a CI job for the site; a scrubbed public subset. None of these needs a redesign to add later.
