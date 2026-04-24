# Pull Request

## What does this change?

<!-- 1–3 sentences. Link to the issue it closes. -->

Closes #

## Why?

<!-- Motivation. If this implements or adjusts a prompt from `prompts/`,
reference the prompt number + anything that diverged from the spec. -->

## Type of change

- [ ] 🚀 Feature — new user-visible capability
- [ ] 🐛 Fix — corrects a bug without changing intended behaviour
- [ ] ♻️ Refactor — no behaviour change
- [ ] 📚 Docs / comments only
- [ ] 🔒 Security / governance
- [ ] ⚡ Performance
- [ ] 🧪 Tests
- [ ] 🏗️ Infra / deployment / CI
- [ ] 📦 Dependency update

## Audience impact

<!-- Tick every group whose behaviour changes. Guides the reviewer
pool and the release-notes entry. -->

- [ ] Council members
- [ ] Executives / Deans / Dept heads
- [ ] Analysts
- [ ] Admin / IT ops
- [ ] No user-visible change

## Checklist

### Before requesting review

- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm test` green (or intentionally skipped — explain below)
- [ ] `pnpm ai:eval` re-run when an AI prompt or safety rule changed
- [ ] New/changed methodology carries a version bump + `docs/methodologies/*.md` update
- [ ] `CLAUDE.md` → *Current status* + *Recent decisions* updated if the change is session-notable
- [ ] `docs/` updated when admin/ops/Council workflow changed
- [ ] No `console.log` / debug prints left behind
- [ ] No secrets / API keys added to tracked files (`.env*` stay gitignored)
- [ ] No unused `npm install`s or vendored code
- [ ] Breaking change? Flagged clearly in the PR description + `BREAKING CHANGE:` in the commit body

### Security + governance

- [ ] Authorization check on every new endpoint (`@Authorized(...)` + scope where needed)
- [ ] `@AuditLog()` on every mutation
- [ ] `@AiCall()` on every LLM call; safety gate considered for analyst-adjacent prompts
- [ ] No new Personal Data categories without a PDPA update (`docs/pdpa.md`)
- [ ] No new external data transfers without a note in `docs/security-review.md`

### Migrations

- [ ] Migration is **forward-only** (see `docs/migration-policy.md`)
- [ ] `ADD COLUMN` is nullable OR has a non-blocking default
- [ ] Column rename / drop follows the 3-release cadence
- [ ] `pnpm db:migrate` succeeds on a seeded dev DB

## Screenshots / traces

<!-- For UI work: before/after. For AI prompt changes: an eval snapshot
(`pnpm ai:eval` output). For a schema change: the `prisma migrate diff`
summary. -->

## Deployment notes

<!-- Anything the ops team needs to know before merging / cutting a
release. env changes, new secrets, migration that needs attention, etc.
If none, write "none". -->
