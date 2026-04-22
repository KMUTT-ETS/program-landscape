# Prompt 00 — Project Bootstrap

> **When to use:** First prompt. Run in an empty directory. Sets up the project skeleton and the `CLAUDE.md` file that will guide every subsequent session.
>
> **Skills to invoke this session:** `frontend-design`, `theme-factory` (for the visual direction in `CLAUDE.md`)

---

Before starting, please read and apply these Claude skills:
- `/mnt/skills/public/frontend-design/SKILL.md`
- `/mnt/skills/examples/theme-factory/SKILL.md`

Also read the file `GLOBAL-UPDATES.md` in this directory if present — these are cross-cutting requirements you must encode in `CLAUDE.md` and follow forever.

---

I'm building a strategic decision-support web application called **KKU Curriculum Landscape** (internal codename: *Curriculum Compass* / *ทักษทัศน์*) for Khon Kaen University. Users are the University Council, top management, deans, and analysts. The application analyzes 297 academic programs against future trends, financial sustainability, and labor market demand.

This is a complex, multi-module project. I want to build it incrementally with you over many sessions. Before we write any code:

### 1. Create the project skeleton with this stack
- **Frontend:** Next.js 14 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui (with full dark/light mode), Recharts + visx for advanced charts, deck.gl for geo, Framer Motion for tasteful motion, `cmdk` for command palette
- **Backend:** NestJS with TypeScript
- **Database:** PostgreSQL 16 with `postgis`, `pgvector`, `pg_trgm` extensions
- **ORM:** Prisma
- **Cache/queue:** Redis + BullMQ
- **Auth:** `next-auth` v5 (KKU SSO via OIDC; configurable provider; local credentials only in dev)
- **Internationalization:** `next-intl` for the small set of static analysis-content strings (the UI itself is English-only — see language strategy below)
- **Monorepo:** pnpm workspaces with `apps/web`, `apps/api`, `apps/ingestion`, `packages/shared`, `packages/db`, `packages/ui`, `packages/design`
- **Containerization:** docker-compose for local dev (postgres, redis, web, api, ingestion, **gotenberg**, **minio**)
- **PDF generation:** Gotenberg with TH Sarabun New embedded (full setup in prompt 02c)
- **Production deployment target:** on-prem Ubuntu server on KKU internal network, running Docker Compose v2. Public URL: `https://program-landscape.kku.ac.th`. GitHub repo: `https://github.com/khon-kaen-university/program-landscape`. **End-to-end TLS:** KKU's university reverse proxy terminates the public cert; re-encrypts to our server over HTTPS on `:8443` with a self-signed cert. Pack-and-ship workflow builds images on Windows/WSL2 dev and ships as a tarball (full setup in prompt 13b). All production Docker images must be built for `linux/amd64` and tagged as `ghcr.io/khon-kaen-university/program-landscape-<service>:<version>`.
- **Testing:** Vitest, Playwright, testcontainers for PostgreSQL in tests

### 2. Create `CLAUDE.md` at the repo root documenting

**Project context:**
- Purpose, audience (University Council = high-stakes decisions)
- The eight strategic questions (paste verbatim — see end)
- The eight modules
- Multi-level analytical scope (university / faculty / department / program) — every analytical view supports all four

**Language strategy (critical, encode this clearly):**
- UI labels (menus, buttons, headers, form fields, errors): **English only**
- Analysis content (AI narratives, briefs, summaries, recommendations): **Thai primary**, with on-demand English translation toggle
- Data labels (program/faculty/course names): both Thai and English stored, both displayed where space allows

**Theme strategy:**
- Light + dark mode required from day one
- All colors via CSS variables, never hardcoded
- WCAG AA contrast in both modes

**SaaS UX principles:**
- Visual benchmark: Linear, Vercel, Stripe Dashboard, Retool, Notion
- Command palette (Cmd/Ctrl+K), keyboard shortcuts, density-tunable layouts
- URL-shareable state (filters, scope, view config)
- Skeletons not spinners, optimistic UI, side panels over full-page navigation
- Subtle Framer Motion (≤200ms)

**Coding conventions:**
- TypeScript strict, no `any`
- Zod for all I/O validation
- Server components by default
- Conventional commits

**Council-readiness rules (non-negotiable):**
- Every chart supports "show provenance"
- Every AI output shows confidence + sources
- Every data point has a freshness timestamp
- Every mutation and AI call is audit-logged

**Skills section (add this in CLAUDE.md):**
- "For every UI session, invoke the `frontend-design` skill at session start"
- "For every PDF intake session, invoke the `pdf-reading` skill"
- "For every PDF generation session, invoke the `pdf` skill"
- Reference `SKILLS.md` and `GLOBAL-UPDATES.md` in this directory

**Folder conventions, run/test/lint commands, and a "what NOT to do" section.**

### 3. Create `docs/` folder with placeholders
- `architecture.md`
- `data-sources.md`
- `pdf-ingestion.md`
- `ai-governance.md`
- `glossary-th-en.md` (Thai-English term mapping for academic + technical vocabulary)
- `auth/kku-sso.md` (placeholder for KKU SSO configuration notes)
- `methodologies/` folder for per-metric methodology docs
- `design-system.md` (filled in detail in prompt 02b)

### 4. Set up the database container
- PostgreSQL 16 with `postgis`, `pgvector`, `pg_trgm` extensions
- Initial Prisma models (just these — full schema in prompt 01):
  - `Faculty` (id, code, nameTh, nameEn)
  - `Department` (id, code, nameTh, nameEn, facultyId)
  - `Program` (id, code, nameTh, nameEn, facultyId, departmentId nullable, level [BACHELOR/MASTER/DOCTORAL], status [ACTIVE/PAUSED/SUNSET], yearEstablished)
  - `User` (id, email, ssoSubject nullable, role [VIEWER/COUNCIL/EXECUTIVE/DEAN/DEPT_HEAD/ANALYST/ADMIN], facultyId nullable, departmentId nullable, themePreference [LIGHT/DARK/SYSTEM])
  - `AuditLog` (id, userId, action, entityType, entityId, payloadJson, createdAt)
  - `AiInference` (id, userId, module, prompt, model, response, confidence, sourcesJson, createdAt)

### 5. Seed minimal data
- 3 faculties, 6 departments (2 per faculty), ~10 sample programs
- 1 admin user, 1 dean user, 1 dept_head user, 1 council user (local credentials, dev only)

### 6. Create root `package.json` scripts (portable across Linux/macOS/Windows/WSL2)

**Do NOT create a Makefile.** The primary developer machine is Windows. Use pnpm scripts instead — they work identically on all platforms.

In the root `package.json`, add scripts using `cross-env` and `concurrently` for portability:

```json
{
  "scripts": {
    "setup": "pnpm install && pnpm db:up && pnpm db:migrate && pnpm db:seed",
    "dev": "concurrently -n web,api,ingest -c blue,green,magenta \"pnpm --filter web dev\" \"pnpm --filter api start:dev\" \"pnpm --filter ingestion start:dev\"",
    "db:up": "docker compose up -d postgres redis minio gotenberg",
    "db:down": "docker compose down",
    "db:reset": "docker compose down -v && pnpm db:up && pnpm db:migrate && pnpm db:seed",
    "db:migrate": "pnpm --filter db prisma migrate deploy",
    "db:seed": "pnpm --filter db seed",
    "test": "pnpm -r test",
    "e2e": "pnpm --filter web test:e2e",
    "lint": "pnpm -r lint",
    "format": "pnpm -r format",
    "typecheck": "pnpm -r typecheck",
    "check": "pnpm lint && pnpm typecheck && pnpm test",
    "storybook": "pnpm --filter ui storybook"
  }
}
```

Install the cross-platform helpers at the root: `cross-env`, `concurrently`, `rimraf` (for cross-platform file deletion).

Document the full command list in the repo `README.md`.

### 7. Windows / cross-platform files (mandatory — primary dev machine is Windows)

Create these at the repo root:

**`.gitattributes`** — forces LF line endings on all text files (critical for Docker builds and Prisma on Windows):

```gitattributes
* text=auto eol=lf

*.sh              text eol=lf
Dockerfile        text eol=lf
*.dockerfile      text eol=lf
*.prisma          text eol=lf
docker-compose*.yml text eol=lf
.env*             text eol=lf

*.ttf             binary
*.otf             binary
*.png             binary
*.jpg             binary
*.jpeg            binary
*.gif             binary
*.webp            binary
*.ico             binary
*.pdf             binary
*.zip             binary
*.gz              binary
```

**`.editorconfig`** — editor consistency:

```editorconfig
root = true

[*]
end_of_line = lf
charset = utf-8
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

**Prisma `schema.prisma` generator** — include Windows binary targets for native Windows dev fallback, plus Linux targets for containers:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x", "windows"]
}
```

### 8. Cross-platform code patterns

Enforce in this codebase throughout:
- Use Node's `path.join()` / `path.resolve()` for all filesystem paths — never string-concatenate with `/`
- Use `fs/promises` with forward-slash or `path.join()` paths; don't hardcode separators
- For file URLs, use `url.pathToFileURL()`
- Shell scripts live in Docker containers only (Linux); Node-based tooling is always the default
- Use the `rimraf` package (not `rm -rf`) in any clean scripts
- All POSIX-specific commands (`find`, `sed`, `grep` in scripts) go inside Docker or get rewritten as Node scripts

### 9. Aesthetic direction (use frontend-design skill)
Apply the `frontend-design` skill to commit to a specific aesthetic for this app. The brief:
- "A modern enterprise SaaS for university leadership — confident, data-dense but breathable, professional but not boring, suggesting institutional gravitas without feeling bureaucratic."
- Reference points: Linear's clarity, Stripe's data presentation, Notion's calm density.
- Typography: pair a refined Thai-capable display font with a clean body font (avoid Inter — pick something more distinctive; suggest 2–3 options with rationale, both must support Thai).
- Color: KKU brand red as accent only (not dominant); calm neutrals as base; semantic colors for status (with WCAG-AA verified contrast in both light + dark).
- Don't implement the design system yet (that's prompt 02b) — but **document the chosen aesthetic direction in `docs/design-system.md`** with concrete font + color suggestions to anchor prompt 02b.

### 10. Show me the final folder tree and a one-page summary
- What you built
- Aesthetic direction chosen with rationale
- Decisions you made that I should review
- 3 specific suggestions for the next session

---

**The eight strategic questions (paste verbatim into CLAUDE.md):**
1. Which programs are strategically critical to KKU's mission and Thailand's future?
2. Which programs are financially unsustainable at current trajectory?
3. Which programs are misaligned with future skill demand (1, 5, 10 years out)?
4. Which programs duplicate each other across faculties and could be consolidated?
5. Where are the white spaces — programs we should launch but haven't?
6. Which programs are at quality/relevance risk (aging faculty, outdated curriculum, weak research base)?
7. What is the demographic ceiling on each program given Thailand's declining youth cohort?
8. How does each program compare to peer institutions (Thai, ASEAN, global)?

---

**Constraints for this session:**
- Do not implement any module logic yet. Just scaffold + CLAUDE.md + aesthetic direction doc.
- Use latest stable versions of all dependencies.
- Stop and ask before installing anything paid.
- Encode `GLOBAL-UPDATES.md` content into `CLAUDE.md` so future sessions inherit it.
