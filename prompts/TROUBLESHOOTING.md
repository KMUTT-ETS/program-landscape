# TROUBLESHOOTING — Common Issues During Long Claude Code Projects

A reference for when things go sideways. Save this in `prompts/` and consult when stuck.

---

## Claude lost track of project conventions

**Symptom:** Claude introduces hardcoded colors, uses `any`, forgets to add provenance, skips audit logging, or otherwise violates rules in CLAUDE.md.

**Cause:** Long conversation context drifted; CLAUDE.md not re-read; or the rule wasn't explicit enough.

**Fix:**
1. Stop the session immediately
2. Tell Claude: "Re-read CLAUDE.md. You just violated [specific rule]. Revert and redo following the rule."
3. If the rule needs to be more explicit, add it to CLAUDE.md "What NOT to do"
4. Start new sessions with: "Read CLAUDE.md and confirm you've understood the no-`any` rule, the provenance requirement, and the audit logging requirement before doing anything."

---

## Claude wants to install something I don't want

**Symptom:** Claude proposes a new charting library, a new ORM, a state management lib that wasn't in the stack.

**Fix:**
1. "Stop. Our stack is defined in CLAUDE.md. Use [chosen tech] for this. Don't introduce new dependencies without my approval."
2. If you actually want the new tool, update CLAUDE.md so future sessions know.

---

## Claude is generating mock data inside production code paths

**Symptom:** You see `if (process.env.NODE_ENV === 'development') return mockData` scattered through services.

**Fix:**
- Mocks belong in test fixtures and seed scripts only
- Real connectors swap via feature flags or DI, not inline branching
- "Refactor: remove inline mock branches. Mocks live in seed scripts and test fixtures. Use the connector swap pattern from prompt 14."

---

## Migrations are getting hairy

**Symptom:** Schema drift between dev and prod; migrations conflict; rollbacks scary.

**Fix:**
- Forward-only migrations after going to staging
- Never edit a migration that's been applied to staging or prod
- Squash migrations into a baseline before initial production deploy
- Always test migrations against a copy of production data before applying
- For irreversible changes (e.g., dropping columns), do them in two phases: stop writing in v1, drop in v2

---

## Build is slow

**Symptom:** `pnpm build` takes minutes; HMR sluggish.

**Fix:**
- Audit `tsconfig.json` for incremental builds
- Use Turborepo or `nx` for monorepo caching
- Move heavy chart libraries to dynamic imports
- Profile bundle with `@next/bundle-analyzer`
- Consider moving the design system package to a published package once stable

---

## AI calls are expensive and slow

**Symptom:** AI inference latency creeping up; daily costs ballooning.

**Fix:**
- Cache deterministic outputs (translations, classifications, summaries) by input hash
- Batch where possible (extract skills for 20 courses in one call)
- Use a smaller model for simple classification, reserve larger for reasoning
- Set per-user daily quotas
- Profile from `AiInference` table: which module, which prompt, which model is the cost driver
- Optimize the worst-cost prompt first; iterate

---

## Tests pass locally but fail in CI

**Symptom:** "It works on my machine."

**Common causes:**
- Test depends on local DB state — use testcontainers
- Test depends on env var that's not set in CI
- Test depends on file path with backslash vs forward slash
- Test depends on external network in CI (it shouldn't)
- Time zone differences (tests run in UTC in CI)

**Fix:**
- Pin Node version in CI to match local
- Use testcontainers for any DB test
- Mock all external HTTP in tests
- Set `TZ=UTC` in test environment

---

## PDF extraction quality is low

**Symptom:** Many extractions in review queue; field accuracy < 80%.

**Diagnose:**
- Is it OCR quality? Check OCR confidence per page
- Is it scanned PDFs being mis-handled as text PDFs?
- Is the LLM prompt missing examples for this document type?
- Are tables being lost?

**Fix:**
- Add domain-specific examples to the extractor prompt (Thai government docs differ structurally from journals)
- For consistently low-quality scans from a specific source, route to a higher-capability vision model
- Build per-source extraction templates for the most common document layouts (NSO tables, MHESI announcements, มคอ.2)
- Have analysts label 50 examples; use as a regression suite

---

## Thai text rendering looks wrong

**Symptom:** Thai characters cut off, baselines off, line height too tight.

**Fix:**
- Verify the font supports Thai (not all do — Inter doesn't render Thai well)
- Recommended: Sarabun, Noto Sans Thai, IBM Plex Sans Thai
- Increase line-height for Thai (Thai needs 1.6+ vs Latin's 1.4)
- Add language tag: `<html lang="th">` or per-element `lang="th"`
- Test in PDFs too — Thai PDF rendering is its own can of worms; verify font embedding

---

## Theme toggle causes flash on page load

**Symptom:** Page loads in light theme then snaps to dark.

**Fix:**
- Use `next-themes` with `attribute="class"` and `defaultTheme="system"`
- Disable transitions on initial load
- Set the theme class on `<html>` server-side before hydration
- Use `suppressHydrationWarning` on `<html>` only

---

## Provenance drawer is empty

**Symptom:** Click ⓘ on a chart, drawer opens, but no sources shown.

**Cause:** The data flowed through without `sourceId` or the `getProvenance()` lookup is broken.

**Fix:**
- Trace: find the data point, query its source on the backend, see if `sourceId` is set
- If `sourceId` is null, the connector that loaded it isn't setting it — fix the connector
- Ensure `meta.sources` is included in API response envelopes
- For computed metrics (e.g., health score), provenance should chain back to all input sources

---

## Scope filtering is confusing for users

**Symptom:** Users complain "I selected my faculty but I see other faculties."

**Diagnose:**
- Is it RBAC-driven (DEAN sees aggregated)? → make this explicit in UI
- Is it a stale URL (?scope= didn't update)? → check ScopeSelector binding
- Is the backend respecting the scope param? → check API logs

**Fix:**
- Always show the active scope visibly (breadcrumb in top bar)
- Show "Scope: Faculty of Engineering — read-only for other faculties" banner for DEAN role
- If the user requests a scope they don't have permission for, show a clear permission denial with explanation, not silent filtering

---

## AI Analyst hallucinated

**Symptom:** AI Analyst stated something not in the data.

**Critical — handle carefully:**
1. Capture the exact conversation immediately (it's in `AiInference` if logging is correct)
2. Identify which tool call should have been made but wasn't, or what the tool returned
3. If the AI ignored a tool result, strengthen the system prompt: "You must not state facts that aren't in tool results"
4. Add this as a regression test: ask the same question, assert no hallucination
5. If it's a recurring pattern, add a verification step: AI's draft answer is checked against tool results before sending to user
6. Surface this in the disagreement log
7. Tell users — never hide AI errors from Council; trust comes from transparency about limits

---

## Data is sensitive and got into the wrong place

**Symptom:** Faculty salary visible to a COUNCIL user who shouldn't see it.

**Critical — treat as a security incident:**
1. Pull the relevant page offline immediately
2. Audit `AuditLog` for who viewed what
3. Identify the permission gap
4. Patch and add regression test
5. Document in incident log
6. Report to the user's department per PDPA obligations
7. Review all related endpoints for similar gaps

Prevention:
- RBAC tests for every endpoint at every role
- Default-deny: explicitly grant, never explicitly deny
- Field-level filtering, not just endpoint-level

---

## Stuck in a loop where Claude won't move forward

**Symptom:** Claude keeps making the same edit, undoing it, redoing it; or refuses to commit because tests fail in a way it can't fix.

**Fix:**
- Stop the session
- Read the actual error yourself
- Start a new session: "Here's the error: <paste>. Diagnose root cause. Don't write any code yet."
- Sometimes the test is wrong, not the code. Push back.
- If genuinely stuck, ask Claude to write down everything it tried and why each failed; this helps both of you reason

---

## Claude wrote code I don't understand

**Symptom:** Working but opaque code; you couldn't maintain it.

**Fix:**
- Don't accept it. Say: "Explain this to me line by line. Then propose a simpler version."
- If a clever pattern is genuinely needed, document it in code comments + in `docs/architecture.md`
- Bias toward boring, obvious code. This project has a long maintenance horizon.

---

## I want to deviate from the prompt set

**Symptom:** A new requirement emerged or you have a better idea than what's in the prompts.

**Fix:**
1. Update `GLOBAL-UPDATES.md` if it's cross-cutting
2. Update the relevant prompt file
3. Update `CLAUDE.md`
4. Tell Claude in the next session: "I've changed [X]. Read updated CLAUDE.md and confirm understanding before proceeding."

The prompt set is a starting point, not a contract. Adapt freely; just keep the docs in sync.

---

## I forgot what state the project is in

**Symptom:** Coming back after weeks; CLAUDE.md status section out of date.

**Fix:**
1. Don't trust the "Current status" checklist if it might be stale
2. Have Claude do an audit:
   ```
   Audit the repo. For each prompt 00–13, verify the deliverables and report status.
   Compare against the checklist in CLAUDE.md. Tell me what's actually done, what's
   partially done, and what's missing. Don't fix anything yet.
   ```
3. Reconcile CLAUDE.md
4. Then resume

This is also a useful weekly habit.

---

## Last resort: nuke and rebuild a module

**Symptom:** A module is so tangled you'd rather start over than fix it.

**Fix (carefully):**
- Don't delete the whole module with `rimraf` — tests and DB migrations live there
- Git branch first
- Identify the module's API surface (what other modules depend on it)
- Re-run the relevant prompt with: "I'm rebuilding this module. The existing implementation is in [path] for reference. Replace it but preserve the API surface so dependent modules still work."
- Diff the rebuild against the previous; check for lost edge cases
- Run all tests before merging

---

## Windows/WSL2 issues

**Symptom:** Docker build fails with `/bin/sh: 1: syntax error` or `fc-cache: command not found` in a COPY step.

**Cause:** CRLF line endings in the Dockerfile.

**Fix:**
```bash
# Inside WSL2
cd infra/gotenberg
git ls-files --eol | grep -v 'i/lf'  # any line not 'i/lf' is wrong
# If any file has CRLF:
git add --renormalize .
git commit -m "fix: normalize line endings to LF"
```
Verify `.gitattributes` is present and correct at repo root.

---

**Symptom:** `pnpm install` fails with `ENAMETOOLONG` or `EPERM` on Windows.

**Cause:** Either path too deep (>260 chars) or you're not inside WSL2.

**Fix:**
- Move the repo into WSL2: `~/projects/program-landscape`
- If you must stay on native Windows, put the repo close to the drive root (`C:\dev\kku`, not `C:\Users\Denpong\OneDrive\Documents\Projects\...`)

---

**Symptom:** Prisma throws "binary target not found" when running inside Docker or on WSL2.

**Cause:** Missing binary targets in schema.prisma.

**Fix:** In `packages/db/prisma/schema.prisma`:
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x", "windows"]
}
```
Then `pnpm --filter db prisma generate`.

---

**Symptom:** Hot reload takes 10+ seconds for every change on Windows.

**Cause:** Project is on `/mnt/c/` (Windows filesystem mounted into WSL2).

**Fix:** Move the project into WSL2's native filesystem:
```bash
# Inside WSL2
cp -r /mnt/c/dev/program-landscape ~/projects/
cd ~/projects/program-landscape
rm -rf node_modules
pnpm install
```
Open VS Code via `code .` from the WSL2 path. Hot reload should be instant.

---

**Symptom:** Git on Windows shows every file as modified after clone, or diffs show whole-file changes on files you didn't touch.

**Cause:** Git's `core.autocrlf` is converting line endings on checkout.

**Fix:**
```powershell
# In PowerShell on Windows
git config --global core.autocrlf input
```
Then re-clone the repo. (`input` = convert CRLF→LF on commit but leave files alone on checkout; this works when `.gitattributes` also sets `eol=lf`.)

---

**Symptom:** Thai characters show as `□□□` in the terminal.

**Cause:** Terminal doesn't support UTF-8.

**Fix:** Use Windows Terminal (not legacy cmd.exe). Install from Microsoft Store. Set default profile to Ubuntu (WSL2). Thai renders correctly.

---

**Symptom:** `docker compose` fails with "command not found" but `docker-compose` works.

**Cause:** Old Docker Desktop or Compose v1 only.

**Fix:** Update Docker Desktop to latest. Compose v2 (invoked as `docker compose` with a space) is the supported syntax; `docker-compose` (hyphen) is the deprecated v1. Our scripts use v2. If you can't update, globally alias `docker compose` → `docker-compose`.

---

**Symptom:** Playwright tests fail to launch Chromium on WSL2.

**Fix:**
```bash
pnpm exec playwright install --with-deps chromium
```
The `--with-deps` flag installs system libraries Chromium needs on Linux.

---

**Symptom:** Claude Code generates PowerShell commands or Windows-style paths when I'm in WSL2.

**Fix:** Tell it: "I'm on WSL2 (Ubuntu inside Windows). Use Linux bash commands and forward-slash paths. The Docker containers are Linux." Claude Code usually picks up the environment from `uname -a` but occasionally slips; correct it immediately.

---

**Symptom:** `testcontainers` fails to start PostgreSQL during tests.

**Cause:** Docker Desktop not running, or WSL2 integration disabled.

**Fix:** Open Docker Desktop → Settings → Resources → WSL Integration. Toggle on your Ubuntu distro. Verify in WSL2:
```bash
docker ps   # should list containers, not error
```

---

## When to ask for human help

The prompt set assumes you can solve most things with Claude Code. Some things you genuinely need humans for:

- KKU SSO configuration questions → KKU IT
- Cost methodology → Finance Division joint team
- Faculty data sensitivity → KKU PDPA officer
- Real KKU REG/HR/Finance API access → respective division heads
- Council usability feedback → at least one friendly Council member willing to test
- Brand assets → KKU communications office

Schedule those conversations early; they have human latency.
