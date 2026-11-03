# Fresh Checkout Setup — Developer Guide

Bringing a brand-new clone of Program Landscape to a running local instance.

This is the operational checklist for **what to do after `git clone`**. It is
the dev-environment companion to the root `README.md` *Getting started* section
and to `docs/adopters/README.md` §5 (*First run — clone to a working local
instance*), which frames the same steps for an adopting university.

**Target outcome**

- `postgres`, `redis`, `minio`, and `gotenberg` containers running via Docker Compose.
- A migrated, empty-but-valid database with its data sources registered.
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
| `DATABASE_URL`, `POSTGRES_*` | `landscape` / `landscape_dev_password` @ `localhost:5432` | Must match the Compose service. Defaults already do. A dev volume created before this change keeps its old `kku` credentials; keep your existing `.env` values for it. |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ queues. |
| `MINIO_*` | `minio_dev` / `minio_dev_password` | Must match the Compose service. |
| `ENABLE_LOCAL_AUTH` | `true` | Enables the dev-only Credentials provider so you can sign in without SSO. Hard-fails if `NODE_ENV=production`. |
| `DEV_AUTH_PASSWORD` | `change-me-dev` | The shared password for seeded users. Dev only. |
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
7. `pnpm data-sources:sync --apply` — register one `data_sources` row per
   catalogued connector and per spreadsheet-import dataset. Without them every
   import upload is refused. Idempotent; never deletes.

8. `pnpm db:seed:reference` — the generic reference seed: eight Thai policy
   sectors, a neutral cost-allocation methodology and the external AI sources.
   Nothing in it belongs to any one university. `pnpm db:seed` is the same
   command.

`pnpm setup` does **not** run `pnpm db:seed:kku`. That seed loads KKU's
faculties, departments, demo accounts, synthetic skills and sample
demographics. A KKU developer who wants that demo state runs it by hand after
`pnpm setup` (and sets `ALLOW_MOCK_CONNECTOR_RUNS=true` to exercise the mock
connectors); an adopting institution should not. A fresh installation schedules
no connector: switch sources on at `/admin/data-sources`. Run
`pnpm adopter:fresh-check` to confirm the database holds nothing of KKU's.

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

**Fresh database (the default after `pnpm setup`).** Open
`http://localhost:3000`. With no administrator in the database it redirects to
**`/setup`**: enter a name, an email and a password (at least 12 characters)
to create the first `SUPER_ADMIN`, then sign in with them. `/setup` closes
permanently once used. It is open to anyone who can reach the address, so
claim it straight away on any machine others can reach.

**After `pnpm db:seed:kku` (KKU developers).** With `ENABLE_LOCAL_AUTH=true`, sign
in with **any seeded email** and the `DEV_AUTH_PASSWORD` (default `change-me-dev`).
Seeding creates administrators, so `/setup` stays closed.

Seeded users (`packages/db/prisma/seed.ts`, run by `pnpm db:seed:kku`):

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

Every analytical surface will be **empty, and that is correct**. A fresh
database holds no faculties, programmes, students, staff or financial data —
that data belongs to the institution. Load it with the spreadsheet import at
`/admin/data-setup` (see [Importing from spreadsheets](../data-import.md);
faculties, departments and programmes first), with connectors, or both.
`pnpm db:seed:kku` adds KKU's faculties, departments, users and reference data,
but still no student, staff, financial or programme-document data.

Empty sections render an explicit empty state that names the connector you need
to run. There is no mock-data escape hatch by policy. **If you see
fabricated-looking numbers, something is wrong** — investigate rather than trust
it.

### Loading the first public data sources

Four sources need no credentials and can be loaded straight away. **Before
running them at an institution other than KKU, first fill in /admin/organization**
(sign in as an admin). The Thai name there must match TCAS exactly; the form
shows how many TCAS rows it matches.

```bash
# 1. World Bank — six Thailand indicators, last 10 years → Trends Radar
pnpm connector:run world-bank

# 2. Thailand youth-cohort projections. A seed script, not a connector:
#    the NESDC figures are in the script; nothing is downloaded.
pnpm demographics:seed

# 3. TCAS round-3 admission statistics for every institution, TCAS62–68.
#    Your rows link to programmes only if your faculties and programmes are
#    loaded with nameTh exactly as CUPT writes them; unmatched rows land with
#    programId = null and are listed in the run metadata. Safe to re-run after
#    importing programmes.
pnpm connector:run tcas

# 4. Curated policy and industry reports (MHESI, NESDC, NXPO, BOI, EECO,
#    WEF, OECD, ADB) → Trends Radar
for s in mhesi-policy nesdc-reports nxpo-reports boi-sectoral eeco-reports \
         wef-future-of-jobs oecd-reports adb-gms; do
  pnpm connector:run "$s"
done
```

Check each with `/admin/data-sources/<slug>` (a SUCCEEDED run) and `/trends`.

`demographics:seed` writes source `NESDC-PopProj-2010-2040`; `pnpm db:seed`
also writes a synthetic `NESDC-v1` series beside it. Both stay in the table.

**Report PDFs.** Every catalogued report becomes a Trends Radar signal whether
or not its PDF downloads. Only entries whose URL ends in `.pdf` are fetched:

| Slug | Document | URL | Expect |
|---|---|---|---|
| wef-future-of-jobs | Future of Jobs 2025 | https://www3.weforum.org/docs/WEF_Future_of_Jobs_Report_2025.pdf | downloads |
| wef-future-of-jobs | Future of Jobs 2023 | https://www3.weforum.org/docs/WEF_Future_of_Jobs_2023.pdf | downloads |
| adb-gms | GMS Strategic Framework 2030 | https://www.adb.org/sites/default/files/institutional-document/678631/gms-economic-cooperation-strategic-framework-2030.pdf | downloads |
| adb-gms | Quality Jobs and the Future of Work in Asia-Pacific (2024) | https://www.adb.org/sites/default/files/publication/999501/quality-jobs-future-work-asia-pacific.pdf | downloads |
| boi-sectoral | BOI Investment Promotion Strategy 2023–2027 | https://www.boi.go.th/upload/content/BOI_Strategy_2023.pdf | **HTTP 404** (checked 2026-10-15) — the file has moved; find the current copy on https://www.boi.go.th/ |

The rest are landing pages and are never fetched. To get the document, open the
page in a browser and download the PDF:

| Slug | Document | Where to find it |
|---|---|---|
| mhesi-policy | TCAS reform — policy direction | https://www.mhesi.go.th/ (search the title) |
| mhesi-policy | MHESI Skill Mapping initiative | https://www.mhesi.go.th/ (search the title) |
| mhesi-policy | CISA platform launch | https://cisa.mhesi.go.th/ |
| nesdc-reports | 13th NESDP 2023–2027 | https://www.nesdc.go.th/main.php?filename=plan13 |
| nesdc-reports | Thailand Future Skills Outlook 2030 | https://www.nesdc.go.th/ (search the title) |
| nesdc-reports | Quarterly Economic Outlook | https://www.nesdc.go.th/main.php?filename=QGDP_report |
| nxpo-reports | NXPO Annual Report 2025 | https://www.nxpo.or.th/th/en/43052/ |
| nxpo-reports | BCG Economy Model implementation report 2024 | https://www.nxpo.or.th/th/bcg-economy-model/ |
| boi-sectoral | Target industries — updated incentives 2024 | https://www.boi.go.th/index.php?page=incentives_target |
| boi-sectoral | Investment statistics H1 2024 | https://www.boi.go.th/index.php?page=statistics_thailand_investment |
| eeco-reports | EEC development plans | https://www.eeco.or.th/en/eec-development-plan |
| eeco-reports | EEC workforce demand forecast 2024–2030 | https://www.eeco.or.th/ (search the title) |
| wef-future-of-jobs | Reskilling Revolution — 2024 update | https://www.weforum.org/agenda/2024/01/reskilling-revolution-2024-davos/ |
| oecd-reports | OECD Skills Strategy for Southeast Asia | https://www.oecd.org/en/publications/oecd-skills-strategy-southeast-asia_5c5af83d-en.html |
| oecd-reports | OECD Economic Survey: Thailand 2023 | https://www.oecd.org/economy/thailand-economic-snapshot/ |
| oecd-reports | OECD Employment Outlook 2024 | https://www.oecd.org/employment/oecd-employment-outlook-19991266.htm |
| adb-gms | ADB–Thailand Country Partnership Strategy 2021–2025 | https://www.adb.org/documents/thailand-country-partnership-strategy-2021-2025 |

Upload a downloaded PDF at `/upload` (admin), with the issuing organisation as
the source. Do not use `/admin/trend-documents` for these: it creates a second
Trends Radar signal that duplicates the catalogue entry. A failed download is
recorded only in the run log, not in the database.

Downloaded and uploaded PDFs wait as `PENDING` until something queues them:
with an AI key configured (`AI_PROVIDER=google` + `GOOGLE_AI_API_KEY`), call
`POST /api/v1/pdfs/bulk-reprocess` as an admin while `pnpm dev` is running.
With `AI_PROVIDER=stub` they get placeholder analysis only.

---

## 9. Everyday commands

| Command | Purpose |
|---|---|
| `pnpm dev` | run web + api + ingestion in parallel |
| `pnpm db:up` / `pnpm db:down` | start / stop the infra containers |
| `pnpm db:generate` | regenerate the Prisma Client after schema changes |
| `pnpm db:migrate` | apply pending Prisma migrations |
| `pnpm db:seed` / `pnpm db:seed:reference` | generic reference seed (no KKU data) |
| `pnpm db:seed:kku` | KKU's demo seed, KKU developers only |
| `pnpm adopter:fresh-check` | read-only: confirm no KKU sample data and no scheduled sources |
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

- [Tutorial: get Program Deep-Dive working](../tutorials/program-deep-dive.md) — fill a programme's Deep-Dive with real content, step by step.
- [README](../../README.md) — project overview and script index.
- [Adopter guide](../adopters/README.md) §5–7 — first run, codebase layout, configuration, for adopters.
- [Architecture](../architecture.md) — system design.
- [Evaluation pipeline](../evaluation-pipeline.md) — how the scoring modules interlock (read before changing anything cross-module).
- [Dev database safety](../dev-database-safety.md) — protecting the shared dev database.
- `prompts/WINDOWS-DEV.md` — Windows/WSL2 specifics.
