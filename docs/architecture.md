# Architecture

Placeholder. Filled in as the system evolves (prompts 01 → 13b).

## Monorepo layout

```
apps/
  web/         Next.js 14 (App Router) — user-facing UI
  api/         NestJS — main API surface
  ingestion/   NestJS standalone — PDF intake, connectors, BullMQ workers

packages/
  shared/       Zod schemas, types, decorators, AI service wrapper, RBAC,
                PDF generation service (Gotenberg client), S3/MinIO storage
  db/           Prisma schema, migrations, scope-aware query helpers
  ui/           shadcn-extended component library + Storybook
  design/       Design tokens (light + dark) + Tailwind preset
  pdf-templates/ React-rendered HTML templates for Council Pack, briefs,
                scenario packs, decision records (rendered by Chromium via
                Gotenberg — see `docs/pdf-generation.md`)

infra/
  postgres/    Custom postgres image (postgis + pgvector + pg_trgm)
  gotenberg/   Custom gotenberg image with TH Sarabun New embedded

docs/          This folder
prompts/       Session-by-session build manual
```

## Deployment topology (high level)

- **Dev:** WSL2 Ubuntu, docker-compose, ports exposed locally.
- **Prod:** On-prem Ubuntu server on KKU's internal network.
  - KKU university reverse proxy terminates public TLS for
    `program-landscape.kku.ac.th`, re-encrypts to us on `:8443` (self-signed).
  - Internal nginx handles path routing (`/api/*` → api, `/*` → web).
  - Images never pulled from Docker Hub — shipped as a tarball via the
    pack-and-ship workflow (prompt 13b).

## Data model (see `packages/db/README.md` for the ERD and full rationale)

**Design principle:** every metric is stored at the most granular level
(program × time) and rolled up through materialized views for the three
higher scopes (department / faculty / university). There is one entry
point for rollups — `queryMetricByScope` in `@kku/db` — and modules
**never** write ad-hoc rollup joins.

### Model families

| Family | Tables | Role |
|---|---|---|
| Organization | `Faculty`, `Department`, `Program` | Scope ladder |
| Curriculum | `Curriculum`, `Course`, `CurriculumCourse` | มคอ.2 + course catalog |
| Skills | `Skill`, `CourseSkill`, `ProgramSkill`, `DepartmentSkill`, `FacultySkill` | Taxonomy + denormalized rollups (not MVs — aggregation is a weighted union, not SUM) |
| People | `FacultyMember`, `ProgramFaculty` | Faculty demographics, program assignments |
| Metrics (program-scoped) | `EnrollmentMetric`, `StudentDemographic`, `FinancialMetric`, `GraduateOutcome`, `EmployerFeedback` | Source of truth; carry `freshnessDate` + `methodologyVersion` |
| Governance of metrics | `CostMethodology` | Versioned methodology docs |
| Research | `ResearchOutput` | Publications/patents per faculty member |
| External signals | `JobPosting`, `OccupationDemand`, `PolicyDocument`, `TrendSignal`, `PeerProgram`, `LaborMarketForecast`, `DemographicProjection` | Labor market, policy, trends, peers, projections |
| PDF | `PdfDocument`, `PdfPage`, `PdfExtraction`, `PdfTable` | First-class external input pipeline |
| Decisions | `Scenario`, `ScenarioResult`, `CouncilDecision`, `Annotation` | Decision Workspace |
| Governance | `User`, `AuditLog`, `AiInference`, `DataSource` | RBAC, audit trail, AI traces, source inventory |
| Profile page (per-user) | `UserExpertiseNarrative`, `UserPublicationsCache`, `User.avatarStorageKey`, `User.employeeId` | AI expertise blurb cache, kkuscholar+Scopus publication cache, MinIO avatar pointer, HR employment-number bridge to FacultyMember |

### Materialized views for scope rollup

Four MVs with a uniform column shape (see `packages/db/src/scope.ts` →
`MetricRowSchema`):

| View | Key | Purpose |
|---|---|---|
| `mv_program_metrics` | `(program_id, year)` | Pass-through unified view |
| `mv_department_metrics` | `(department_id, year)` | SUM by department |
| `mv_faculty_metrics` | `(faculty_id, year)` | SUM by faculty |
| `mv_university_metrics` | `('kku', year)` | Single row per year |

`year` is a unified time key pulled from `academic_year` /
`fiscal_year` / `graduation_year` via a `WITH years AS (UNION)` CTE. A
(scope_id, year) row exists iff at least one metric family has data for
it; non-applicable columns come back `NULL`.

Weighted averages (`employment_rate_weighted`, `average_salary_weighted`)
use `sample_size` as the weight — never a naïve `AVG()`.

### Refresh strategy

Refresh is triggered by the ingestion jobs (prompt 03) that write the
source metric rows, via `refreshMetricViews()`:

```
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_program_metrics;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_department_metrics;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_faculty_metrics;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_university_metrics;
```

Order matters only for reader consistency: we refresh bottom-up so that
a reader catching the window between refreshes sees a narrower-scope
row that's at least as fresh as the broader-scope row above it. Every MV
has a unique index, so `CONCURRENTLY` is always available — reads don't
block.

### Extensions managed by Prisma

`postgis` · `vector` · `pg_trgm` · `btree_gin` · `uuid-ossp` are declared
in `schema.prisma`'s datasource block (with
`previewFeatures = ["postgresqlExtensions"]`). The
`infra/postgres/init/01-extensions.sql` file is a belt-and-braces
fallback that runs only once at volume creation — both are idempotent.

## Per-user `/profile` page (added 2026-05-09)

Sits aside the main bulk pipelines. Per-user surface only — bridges
`User → FacultyMember` via HR `employeeId`, then aggregates education,
research, curriculum, and publications. **Profile-page-only paths
call Scopus + OpenAlex live**; the bulk modules (cockpit, gap,
benchmarking) keep reading the kkuscholar mirror nightly to stay
under Scopus's 20k req/week institutional limit.

See [`docs/profile-page.md`](./profile-page.md) for the pipeline
diagram, cache strategy, and file layout.

## Non-negotiables (see CLAUDE.md for the full list)

- Multi-level scope (university / faculty / department / program) baked into
  every API and every view.
- Provenance, confidence, freshness, audit, AI logging on every output.
- Methodology versioning on every metric.
