# Fresh Checkout Setup — Developer Guide

Bringing a brand-new clone of Program Landscape to a running local instance.

This is the operational checklist for **what to do after `git clone`**. It is
the dev-environment companion to the root `README.md` *Getting started* section
and to `docs/adopters/README.md` §5 (*First run — clone to a working local
instance*), which frames the same steps for an adopting university.

**Target outcome**

- `postgres`, `redis`, `minio`, and `gotenberg` containers running via Docker Compose.
- A migrated, seeded, empty-but-valid database.
- Web at `http://localhost:3000` with a working sign-in.
- API healthy at `http://localhost:4000/api/v1/healthz`.

Budget roughly 30–60 minutes the first time; most of it is Docker image builds
and dependency downloads. Subsequent runs are fast.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Git** | Any recent version. |
| **Node.js 20+** | `.nvmrc` pins `20`. Run `nvm use` before anything else. |
| **pnpm** | The repo declares `packageManager: pnpm@10.33.1`. The supported way to get it is Corepack: `corepack enable`. A mismatched global pnpm can print spurious warnings — prefer the pinned version. |
| **Docker Engine + Compose v2** | Check with `docker compose version`. The database is not installed locally; it runs in Compose. |
| **OS** | Linux, macOS, or Windows with WSL2 (Ubuntu). Windows/WSL2 is the primary dev machine — see `prompts/WINDOWS-DEV.md`. There is deliberately **no Makefile**; everything is a pnpm script. |
| **Disk space** | Several GB for `node_modules`, the Prisma engine, and Docker images. |
| **Free ports** | `3000` web, `4000` api, `5432` postgres, `6379` redis, `9000`/`9001` minio, `3001` gotenberg, `8800` markitdown. |

---

## 2. Clone and check out

```bash
git clone <repository-url> program-landscape
cd program-landscape
git checkout <branch-or-tag>   # e.g. main, or the release tag you are testing
```

Then make sure the toolchain resolves the pinned pnpm:

```bash
corepack enable     # once per machine
node --version      # expect v20.x
```

---

## 3. Create the environment file

```bash
cp .env.example .env
```

**The example defaults are a complete, working local-dev configuration.** You do
not need any external credentials to boot the stack. Values worth knowing:

| Variable | Dev default | Why it matters |
|---|---|---|
| `NODE_ENV` | `development` | Must not be `production` for local auth to load. |
| `DATABASE_URL`, `POSTGRES_*` | `kku` / `kku_dev_password` @ `localhost:5432` | Must match the Compose service. Defaults already do. |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ queues. |
| `MINIO_*` | `minio_dev` / `minio_dev_password` | Must match the Compose service. |
| `ENABLE_LOCAL_AUTH` | `true` | Enables the dev-only Credentials provider so you can sign in without SSO. Hard-fails if `NODE_ENV=production`. |
| `DEV_AUTH_PASSWORD` | `kku-dev` | The shared password for seeded users. Dev only. |
| `NEXTAUTH_SECRET` | placeholder | Fine for local; set a real random value if the box is reachable by others. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | empty | Optional. AI surfaces degrade to empty states without a key. |
| `AI_PROVIDER` | `stub` | Which LLM backend to use: `google` / `anthropic` / `stub`. **Leave on `stub`** unless you have a key — `google` (the code default when unset) crashes api + ingestion at boot without `GOOGLE_AI_API_KEY`. Set `GOOGLE_AI_API_KEY` (and switch to `google`) for real AI calls. |
| `KKU_REGISTRY_DB_*`, `KKU_HR_DB_*`, other connector creds | `REPLACE_ME` / empty | **Not needed.** Connectors stay mocked/empty; see step 8. |

`.env` is gitignored. Never commit it — a real secret in history is far more
expensive to remove than to avoid.

> The root `.env` is the single source of truth. `scripts/link-env.mjs`
> (run by `pnpm setup`) symlinks it into `apps/web`, `apps/api`,
> `apps/ingestion`, and `packages/db`, each of which loads env from its own
> directory.

---

## 4. Run the one-shot setup

```bash
pnpm setup
```

This expands to, in order:

1. `pnpm install` — install workspace dependencies.
2. `node scripts/link-env.mjs` — symlink the root `.env` into the three apps **and** `packages/db`.
3. `pnpm db:generate` — `prisma generate` (build the typed Prisma Client).
4. `pnpm db:up` — `docker compose up -d postgres redis minio gotenberg`.
5. `pnpm minio:init` — create the object-storage buckets.
6. `pnpm db:migrate` — `prisma migrate deploy` (apply all migrations).
7. `pnpm db:seed` — seed reference data (faculties, skills, sectors, users).

The command is **idempotent** — re-running it is safe. If a step fails, run the
steps individually to isolate which one broke.

---

## 5. Start the dev servers

```bash
pnpm dev
```

This runs `web`, `api`, and `ingestion` in parallel with labelled, colour-coded
output. Leave it running and open a second terminal for other commands.

---

## 6. Verify

| URL | What |
|---|---|
| `http://localhost:3000` | Web (Next.js) |
| `http://localhost:4000/api/v1/healthz` | API liveness |
| `http://localhost:4000/api/v1/ready` | API dependency health — probes Postgres, Redis, MinIO, Gotenberg, AI provider |
| `http://localhost:9001` | MinIO console |
| `http://localhost:3001` | Gotenberg |

Quick command-line checks:

```bash
docker compose ps                                   # all four services healthy
curl -sSf http://localhost:4000/api/v1/healthz   # -> {"status":"ok"}
curl -sSf http://localhost:4000/api/v1/ready     # -> per-dependency status
```

---

## 7. Sign in

With `ENABLE_LOCAL_AUTH=true`, use the Credentials provider on the sign-in page.
Sign in with **any seeded email** and the `DEV_AUTH_PASSWORD` (default `kku-dev`).

Seeded users (`packages/db/prisma/seed.ts`):

| Email | Role | Scope |
|---|---|---|
| `admin@kku.ac.th` | `SUPER_ADMIN` | full access — use this to start |
| `analyst@kku.ac.th` | `SYSTEM_ADMIN` | institutional analyst |
| `exec@kku.ac.th` | `SYSTEM_ADMIN` | executive officer |
| `dean.en@kku.ac.th` | `FACULTY_USER` | faculty `EN` |
| `dh.cpe@kku.ac.th` | `FACULTY_USER` | faculty `EN`, dept `EN-CPE` |
| `council@kku.ac.th` | `UNIVERSITY_USER` | council member |
| `viewer@kku.ac.th` | `UNIVERSITY_USER` | read-only |

Wiring a real university SSO (OIDC) is a separate task; `docs/auth/kku-sso.md`
documents KKU's configuration as a worked example.

---

## 8. What "working" looks like

Most analytical surfaces will be **empty, and that is correct**. The seed gives
you faculties, departments, a skill taxonomy, sectors, users, and reference
data. It deliberately does **not** give you student, staff, financial, or
programme-document data — that data belongs to the institution and is loaded by
connectors.

Empty sections render an explicit empty state that names the connector you need
to run. There is no mock-data escape hatch by policy. **If you see
fabricated-looking numbers, something is wrong** — investigate rather than trust
it.

---

## 9. Everyday commands

| Command | Purpose |
|---|---|
| `pnpm dev` | run web + api + ingestion in parallel |
| `pnpm db:up` / `pnpm db:down` | start / stop the infra containers |
| `pnpm db:generate` | regenerate the Prisma Client after schema changes |
| `pnpm db:migrate` | apply pending Prisma migrations |
| `pnpm db:seed` | seed without dropping data |
| `pnpm db:reset` | **destructive** — drop volumes, then generate + migrate + seed |
| `pnpm test` | unit + integration tests across workspaces |
| `pnpm e2e` | Playwright end-to-end |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm check` | lint + typecheck + test — run before committing |
| `pnpm clean` | remove `node_modules`, `dist`, `.next`, `coverage` |

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Environment variable not found: DATABASE_URL` during `db:migrate` / `db:generate` | No root `.env`, or it is not linked into `packages/db` | `cp .env.example .env && pnpm link-env` |
| `Prisma.sql is not a function` (or "did you forget to run prisma generate") during `db:seed` | Prisma Client not generated | `pnpm db:generate` (also part of `pnpm setup`) |
| `Cannot connect to the Docker daemon` | Docker not running | start Docker Desktop / `sudo systemctl start docker` |
| `port is already allocated` / `EADDRINUSE` | A port is taken by another process | stop the conflicting process, or change the matching `*_PORT` in `.env` |
| Sign-in loops back to `/signin`; protected routes 307 | Per-app `.env` symlinks missing (Edge middleware can't see `NEXTAUTH_SECRET`) | `pnpm link-env` — see `docs/adopters/README.md` Trap 4 |
| `minio:init` connection refused | MinIO container not healthy yet | `docker compose ps`, then retry `pnpm minio:init` |
| `Unknown option: 'verify-deps-before-run-install'` before a script runs | Global pnpm version differs from the pinned `pnpm@10.33.1` | Use the pinned version (`corepack enable`). The repo sets `verifyDepsBeforeRun: false`, so the message is non-fatal if it still appears. |
| Node engine / syntax errors on install | Wrong Node version | `nvm use` (Node 20 per `.nvmrc`) |
| `api` and/or `ingestion` exit at boot with `AI_PROVIDER=google but no GOOGLE_AI_API_KEY configured` | `.env` does not set `AI_PROVIDER`, so the code defaults to `google`, but no API key is present | Set `AI_PROVIDER=stub` in `.env` (the shipped `.env.example` now does) and restart `pnpm dev` |
| Fresh checkout shows pending migrations | Migrations not applied | `pnpm db:migrate` |

More: `prompts/TROUBLESHOOTING.md` and `docs/adopters/README.md` §14 (*Traps
that will cost you days*).

---

## 11. Reset and tear down

```bash
pnpm db:reset     # DESTRUCTIVE — drops the dev database volume, then re-seeds
pnpm db:down      # stop the infra containers (volumes are kept)
pnpm clean        # remove node_modules / build outputs; re-run `pnpm setup` after
```

> The dev database is shared across sessions and checkouts on a machine. Before
> running anything destructive, read `docs/dev-database-safety.md`.

---

## 12. Where to go next

- `README.md` — project overview and script index.
- `docs/adopters/README.md` §5–7 — first run, codebase layout, configuration, for adopters.
- `docs/architecture.md` — system design.
- `docs/evaluation-pipeline.md` — how the scoring modules interlock (read before changing anything cross-module).
- `docs/dev-database-safety.md` — protecting the shared dev database.
- `prompts/WINDOWS-DEV.md` — Windows/WSL2 specifics.
