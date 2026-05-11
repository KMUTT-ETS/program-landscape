# schema.prisma changes for migration `20260511120000_data_quality_provenance`

Apply these 17 changes to `packages/db/prisma/schema.prisma` in the same commit as the migration SQL. After applying, run `pnpm prisma generate` to refresh the client types; do **not** run `prisma migrate dev` (the migration is hand-written and already on disk).

Each model gets the same 3-line addition. The standard pattern (matching the existing `StaffEducationHistory` / `StaffProgramAssignment` / etc. style):

```prisma
  ingestionRunId String?  @map("ingestion_run_id")
  ingestionRun   IngestionRun? @relation(fields: [ingestionRunId], references: [id], onDelete: SetNull)

  // ... add to the existing @@index block:
  @@index([ingestionRunId])
```

Place the `ingestionRunId` field declaration with the other field declarations (before the first relation). Place the `ingestionRun` line in the relations block (after existing relations). Place the `@@index([ingestionRunId])` line in the `@@index` block (before `@@map(...)`).

---

## 1. `DataSource` — add `mocked` field

In `model DataSource { ... }` (currently around line 2237), after the `status` field and before `ownerContact`:

```prisma
  status            String                @default("active")
  /// Explicit marker for connectors that produce mocked data. Promoted
  /// from the free-text `status='mocked'` convention by migration
  /// 20260511120000_data_quality_provenance. The catalog seeder in
  /// packages/shared/src/ingestion/catalog.ts is the source of truth;
  /// flip a connector's `mocked` value there + reseed to update.
  mocked            Boolean               @default(false)
  ownerContact      String?               @map("owner_contact")
```

And in the `@@index` block (before `@@map("data_sources")`):

```prisma
  @@index([status])
  @@index([mocked])
  @@map("data_sources")
```

---

## 2. `IngestionRun` — add 15 reverse relations

In `model IngestionRun { ... }` (currently around line 2276), in the relations block right after `staffCompensationCubes  StaffCompensationCube[]`:

```prisma
  staffCompensationCubes  StaffCompensationCube[]
  // Metric/fact tables added by migration 20260511120000_data_quality_provenance.
  // Each metric row's ingestion_run_id traces back to the originating
  // connector run, enabling per-row provenance + mock-filter at the
  // query layer (see packages/db/src/data-quality.ts).
  enrollmentMetrics           EnrollmentMetric[]
  studentDemographics         StudentDemographic[]
  tcasAdmissionStats          TcasAdmissionStat[]
  alumniCohortStatuses        AlumniCohortStatus[]
  studentCohortDistributions  StudentCohortDistribution[]
  financialMetrics            FinancialMetric[]
  graduateOutcomes            GraduateOutcome[]
  researchOutputs             ResearchOutput[]
  facultyCompensations        FacultyCompensation[]
  facultyBudgets              FacultyBudget[]
  kmitlCareers                KmitlCareer[]
  kmitlCareerSkillDemands     KmitlCareerSkillDemand[]
  kmitlSkillGrowths           KmitlSkillGrowth[]
  tcasAdmissionFunnels        TcasAdmissionFunnel[]
  programDemandMatches        ProgramDemandMatch[]
```

---

## 3–17. The 15 metric/fact models

For each model below, apply the standard 3-line addition described at the top. Models are listed in the same order as the migration SQL.

| # | Model | Currently around line | Existing relation count (for placement) |
|---|---|---|---|
| 3 | `EnrollmentMetric` | 1205 | 1 (`program`) |
| 4 | `StudentDemographic` | 1230 | 1 (`program`) |
| 5 | `TcasAdmissionStat` | 1253 | 1 (`program?`) |
| 6 | `AlumniCohortStatus` | 1305 | 1 (`program`) |
| 7 | `StudentCohortDistribution` | 1327 | 1 (`program`) |
| 8 | `FinancialMetric` | 1364 | 2 (`program`, `costMethodology?`) |
| 9 | `GraduateOutcome` | 1396 | 1 (`program`) |
| 10 | `ResearchOutput` | 1442 | (verify in file) |
| 11 | `FacultyCompensation` | 2842 | (verify in file) |
| 12 | `FacultyBudget` | 2886 | (verify in file) |
| 13 | `KmitlCareer` | 2938 | (verify in file) |
| 14 | `KmitlCareerSkillDemand` | 2972 | (verify in file) |
| 15 | `KmitlSkillGrowth` | 3004 | (verify in file) |
| 16 | `TcasAdmissionFunnel` | 3579 | (verify in file) |
| 17 | `ProgramDemandMatch` | 967 | 3 (`program`, `skill`, `aiInference?`) |

### Worked example — `EnrollmentMetric`

**Before** (current state, lines ~1205-1228):

```prisma
model EnrollmentMetric {
  id                 String   @id @default(cuid())
  programId          String   @map("program_id")
  academicYear       Int      @map("academic_year")
  // ... fields ...
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  program Program @relation(fields: [programId], references: [id], onDelete: Cascade)

  @@unique([programId, academicYear])
  @@index([programId])
  @@index([academicYear])
  @@index([freshnessDate])
  @@map("enrollment_metrics")
}
```

**After**:

```prisma
model EnrollmentMetric {
  id                 String   @id @default(cuid())
  programId          String   @map("program_id")
  academicYear       Int      @map("academic_year")
  // ... fields ...
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")
  ingestionRunId     String?  @map("ingestion_run_id")

  program      Program       @relation(fields: [programId], references: [id], onDelete: Cascade)
  ingestionRun IngestionRun? @relation(fields: [ingestionRunId], references: [id], onDelete: SetNull)

  @@unique([programId, academicYear])
  @@index([programId])
  @@index([academicYear])
  @@index([freshnessDate])
  @@index([ingestionRunId])
  @@map("enrollment_metrics")
}
```

Repeat the same pattern for the other 14 models. Field placement: last field before the relations block. Relation placement: last relation. Index placement: last entry before `@@map(...)`.

---

## Verification

After applying:

```bash
# 1. Confirm schema parses
pnpm prisma format

# 2. Confirm migration matches schema (should show "Database schema is up to date")
pnpm prisma migrate diff \
  --from-schema-datamodel packages/db/prisma/schema.prisma \
  --to-schema-datasource  packages/db/prisma/schema.prisma \
  --exit-code

# 3. Regenerate client
pnpm prisma generate

# 4. Apply migration (when ready to land)
pnpm prisma migrate deploy
```

If `prisma format` complains about field alignment, accept its reformat — it's whitespace only.

## Rollback

The migration is reversible. If the apply needs to be reverted:

```sql
-- Drop the ingestion_run_id columns from all 15 metric tables
ALTER TABLE "enrollment_metrics" DROP COLUMN "ingestion_run_id";
-- ... repeat for the other 14 tables ...

-- Drop the mocked column
ALTER TABLE "data_sources" DROP COLUMN "mocked";
```

Re-apply schema.prisma to its pre-migration state in the same commit.
