# Database Index Review

Snapshot taken during Prompt 13 hardening. Goal: verify the indexes declared in `packages/db/prisma/schema.prisma` cover the query patterns we actually run, and identify slow queries before they become a Council-session problem.

---

## Method

1. Scan every query in `apps/api/src/**/*.service.ts` + `packages/db/src/**/*.ts`.
2. For each `prisma.<model>.(findMany|count|groupBy|$queryRaw)` call site, identify:
   - The filter columns (WHERE).
   - The sort columns (ORDER BY).
   - Whether an index exists that covers them (leftmost-prefix rule).
3. Flag query patterns that don't have index coverage.

This is a static review — a live `EXPLAIN ANALYZE` against seeded data lives in Phase 0 of the rollout plan. Here we document what the schema promises.

---

## Existing indexes (declared)

From `prisma/schema.prisma` — summary by model:

| Model | Indexes |
|---|---|
| `Program` | `facultyId`, `departmentId`, `status`, `level`, unique `code` |
| `Department` | `facultyId`, unique `(facultyId, code)` |
| `Curriculum` | `programId`, `effectiveYear`, unique `(programId, version)` |
| `Course` | `(programId, code)`, `programId` |
| `CourseSkill` | `(courseId, skillId)`, `skillId` |
| `Skill` | `(taxonomy, externalId)` unique, parent/children via `parentId` |
| `ProgramSkill` | `programId`, `skillId`, unique `(programId, skillId)` |
| `EnrollmentMetric` | `programId`, `academicYear`, `freshnessDate`, unique `(programId, academicYear)` |
| `FinancialMetric` | `programId`, `fiscalYear`, `freshnessDate`, unique `(programId, fiscalYear)` |
| `GraduateOutcome` | `programId`, `graduationYear`, `freshnessDate`, unique `(programId, graduationYear, surveyYear)` |
| `EmployerFeedback` | `programId`, `surveyDate`, unique `(programId, employerId, surveyYear)` |
| `AiInference` | `userId`, `module`, `createdAt` |
| `PdfDocument` | `sourceCategory`, `processingStatus`, `uploadedAt`, unique `contentHash` |
| `PdfExtraction` | `pdfDocumentId`, `extractionType`, `reviewStatus`, `(targetEntityType, targetEntityId)` |
| `PdfPage` | unique `(pdfDocumentId, pageNumber)`, `pdfDocumentId` |
| `ProgramDocument` | `programId`, `pdfDocumentId`, `role`, unique `(programId, pdfDocumentId)` |
| `IngestionRun` | `dataSourceId`, `status`, `startedAt`, `trigger` |
| `TrendSignal` | `signalType`, `detectedDate` |
| `Notification` | `(userId, readAt)`, `userId`, `signalId` |
| `Scenario` | `createdBy`, `workflowStatus`, `type` |
| `ScenarioRun` | `scenarioId`, `createdAt` |
| `CouncilDecision` | `status`, `decisionType`, `(facultyId, status)`, `updatedAt` |
| `DecisionMilestone` | `decisionId`, `status`, `dueDate` |
| `DecisionApprover` | unique `(decisionId, userId)` |
| `DecisionOutcomeReview` | `decisionId`, `horizon` |
| `Annotation` | `(entityType, entityId)`, `userId`, `kind` |
| `PeerProgram` | `country`, `institution`, `programLevel`, `subjectArea` |
| `PeerSet` | `ownerId`, `isSystem` |
| `AuditLog` | `userId`, `entityType`, `action`, `createdAt` |

## Query patterns reviewed

### Cockpit (module 5)

- `EnrollmentMetric` filtered by `programId` + `academicYear IN (…)` → covered by `(programId, academicYear)` unique.
- Materialized views `mv_program_metrics` / `mv_faculty_metrics` / `mv_department_metrics` / `mv_university_metrics` refresh nightly — indexed on their primary key.
- ✅ No gaps.

### Gap Analyzer (module 8)

- `JobPosting` filtered by `regionCode` + `province` + `detectedAt DESC` — `regionCode` indexed, `(regionCode, province)` not. **FLAG** — add a composite index when job-posting volume crosses 100k rows (prompt 14 connector).
- `OccupationDemand` filtered by `occupationCode` — indexed.
- `ForecastRun` filtered by `(metric, scope, scopeId)` + ordered by `generatedAt DESC` — single-column index; acceptable at current volumes.

### Decisions (module 12)

- `CouncilDecision.updatedAt DESC` for recent-decisions widget — indexed.
- `Annotation` filtered by `(entityType, entityId)` — indexed.
- `DecisionOutcomeReview` filtered by `decisionId` — indexed.
- ✅ No gaps.

### Admin dashboards (prompt 13)

- `AiInference` groupBy `module` + filter `createdAt >= $since` — `createdAt` indexed; group-by is aggregation, no index needed.
- `AuditLog` filtered by `userId` (DSAR export) — indexed.
- `EnrollmentMetric` raw SQL anomaly scan (`data-quality.controller.ts`) — reads all rows; acceptable at 297 programs × 5 years = ~1500 rows.

---

## Deliberate absences

- `Program.code` is unique, but we don't have a case-insensitive index — duplicate detection does `mode: 'insensitive'` at query time. Acceptable: the collision-check is triggered by the admin, low call rate.
- `PeerProgram.ranking` not indexed — we list all peers per peer-set, filter in-memory. Peer count is < 100 per set; re-evaluate at 500+.
- `TrendSignal.affectedProgramIds String[]` and `affectedSkillIds String[]` — not indexed. GIN index would help if we added `WHERE affectedProgramIds @> ARRAY[…]` queries. Currently we fetch all signals and filter client-side; OK at < 1000 seeded signals.

---

## Recommendations for 14

| Severity | Action |
|---|---|
| Low | `@@index([regionCode, province])` on `JobPosting` before flipping the JobThai/JobsDB connectors to real |
| Low | `@@index([ownerContact])` on `DataSource` for ops-search by owner email |
| Low | GIN index on `TrendSignal.affectedProgramIds` + `affectedSkillIds` if we ever run array-contains queries |
| Med | Review query plans for `computePortfolioComparison` under 1000+ peer rows — suspect the subject-area LIKE heuristic needs a trigram index |
| Med | Periodic `REINDEX` cron if we see index bloat (Postgres doesn't auto-reindex; 6-month cadence) |

## Slow-query monitoring (prompt 13b)

Postgres `log_min_duration_statement=500` in `postgresql.conf` captures every query > 500ms. Logs rotated daily; weekly triage by the analyst on duty.

A cron script (`scripts/slow-query-report.sh`, lands in 13b) greps the logs, groups by normalised query signature, writes `docs/slow-queries/YYYY-WW.md` for review.
