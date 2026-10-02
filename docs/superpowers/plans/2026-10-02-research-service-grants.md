# Research & Academic Service Grants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync KKU's Research and Academic Services MySQL views daily. Show the data on a new Staff dashboard, on the owner's `/profile`, and in an opt-in `grants` section of the external Staff Profile API.

**Architecture:**
- A new real connector `kku-research-services` reads two MySQL views. It hashes the lead's citizen ID inside SQL, matches people to `faculty_members`, and replaces two Postgres tables in one transaction each day.
- One query module in `packages/db` serves the dashboard API. One person loader serves both `/profile` and the external API, with the summary maths in a browser-safe file in `@kku/shared`.
- Spec: `docs/superpowers/specs/2026-10-02-research-service-grants-design.md`.

**Tech Stack:** Prisma (Postgres 16), mysql2, NestJS, Next.js 14 App Router, Zod, Vitest.

**House rules every task follows:**
- TypeScript strict, no `any`.
- Design tokens only. In SVG, colour via `style={{ fill: 'oklch(var(--color-chart-N))' }}`, never a hex.
- `border-border-*`, bare `rounded`, and `-default` on `success`/`warning`/`danger` emit no CSS. Use `border-default`, `rounded-md`, `text-warning`.
- **Never nest `Prisma.sql`/`Prisma.empty`.** This plan uses no raw SQL in `packages/db`.
- **Commits:** use `git commit -F <file>` (write the message to the session scratchpad). End every message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never `git add` `handoff.md`, `presentation_en.md`, `presentation_th.md`.
- **Never read or grep `.env`.** A PreToolUse hook blocks it. Hand any `.env` edit to the operator as a `! ` command.
- `nest start --watch` and `next dev` do not reload `packages/*`. Restart the dev servers after package changes before live checks. Stop processes by explicit PID.

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` (modify) | 2 enums, 2 models, back-relations on `IngestionRun` and `FacultyMember` |
| `packages/db/prisma/migrations/20261002100000_research_service_projects/migration.sql` (create) | Hand-written additive DDL |
| `packages/shared/src/staff-profile/grants.ts` (create) | Browser-safe types and `summariseStaffGrants` |
| `packages/shared/src/staff-profile/api-schema.ts` (modify) | `grants` section, label, wire schema |
| `packages/shared/src/staff-profile/index.ts`, `packages/shared/package.json` (modify) | Export and deep path |
| `apps/ingestion/src/connectors/sources/kku-research-services/transforms.ts` (create) | Pure: row schemas, type mapping, identity resolution, snapshot plan, shrink guard |
| `apps/ingestion/src/connectors/sources/kku-research-services/connector.ts` (create) | Fetch (SQL), load (transaction) |
| `apps/ingestion/src/connectors/sources/kku-research-services/index.ts` (create) | Re-export |
| `apps/ingestion/src/connectors/sources/kku-connectors.ts` (modify) | Empty mock class |
| `apps/ingestion/src/connectors/registry.ts` (modify) | Registry entry |
| `packages/shared/src/ingestion/catalog.ts` (modify) | Catalog entry |
| `.env.prod.example` (modify) | New env keys |
| `packages/db/src/research-services.ts` (create) | Dashboard aggregation (pure and loader), project detail, person loader |
| `packages/db/src/index.ts`, `packages/db/src/staff-profile/index.ts` (modify) | Exports |
| `apps/api/src/staff-dashboard/grants.service.ts` (create) | Cache and meta around the query module |
| `apps/api/src/staff-dashboard/staff.controller.ts`, `staff.module.ts` (modify) | 2 endpoints, provider |
| `apps/web/app/staff/grants/{page,client}.tsx` (create) | Dashboard |
| `apps/web/app/staff/types.ts`, `page.tsx`, `thumbnails.tsx` (modify) | Response type, tile, thumb |
| `apps/web/src/components/data-source-mark.tsx`, `apps/web/app/docs/acknowledgements/registry.tsx` (modify) | Source mark and acknowledgement |
| `apps/web/app/profile/grants-panel.tsx` (create) | Owner-only panel |
| `apps/web/src/lib/profile-data.ts`, `apps/web/app/profile/page.tsx`, `profile-view.tsx` (modify) | Load and render the panel |
| `apps/api/src/external/staff-profile.{mapper,service}.ts` (modify) | `grants` section |
| `apps/web/app/admin/external/api-clients/client.tsx` (modify) | Opt-in checkbox |
| `scripts/pdpa/dsar-dump.ts` (modify) | DSAR covers the member rows |
| `docs/data-sources/kku-research-services.md` (create), `docs/pdpa.md`, `docs/integrations/staff-profile-api.md`, `docs/data-sources/README.md` (modify) | Docs |

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261002100000_research_service_projects/migration.sql`

- [ ] **Step 1: Add the models.** Append to `schema.prisma`:

```prisma
// ─────────────────────────────────────────────────────────────────────
// KKU Research & Academic Services — externally funded research and
// academic-service projects (connector `kku-research-services`, daily
// snapshot replace). Spec: docs/superpowers/specs/2026-10-02-research-service-grants-design.md
// ─────────────────────────────────────────────────────────────────────

enum ResearchServiceProjectType {
  RESEARCH
  ACADEMIC_SERVICE
  CONSULTING
  OTHER
}

enum ResearchServiceMemberRole {
  LEAD
  CO_INVESTIGATOR
}

model ResearchServiceProject {
  /// Deterministic `rsp-<proposal_id>` so links survive the daily replace.
  id                  String                     @id
  sourceProposalId    Int                        @unique @map("source_proposal_id")
  sourceProposalKey   String                     @unique @map("source_proposal_key")
  titleTh             String                     @map("title_th")
  titleEn             String?                    @map("title_en")
  type                ResearchServiceProjectType
  typeRaw             String                     @map("type_raw")
  fiscalYearBe        Int                        @map("fiscal_year_be")
  projectBudgetYearBe Int?                       @map("project_budget_year_be")
  startDate           DateTime?                  @map("start_date")
  endDate             DateTime?                  @map("end_date")
  /// Whole-project budget (THB). Never split among people or faculties.
  budgetThb           BigInt?                    @map("budget_thb")
  funderName          String?                    @map("funder_name")
  keywords            String?
  workflowStatus      String                     @map("workflow_status")
  leadUnitName        String                     @map("lead_unit_name")
  /// Resolved faculty Thai name (matched lead's faculty, else lead_unit_name).
  leadFacultyName     String                     @map("lead_faculty_name")
  facultyId           String?                    @map("faculty_id")
  acroRaw             String?                    @map("acro_raw")
  pmuOkrRaw           String?                    @map("pmu_okr_raw")
  submittedAt         DateTime?                  @map("submitted_at")
  acceptedAt          DateTime?                  @map("accepted_at")
  ingestionRunId      String                     @map("ingestion_run_id")
  ingestionRun        IngestionRun               @relation(fields: [ingestionRunId], references: [id])
  members             ResearchServiceProjectMember[]

  @@index([fiscalYearBe])
  @@index([facultyId])
  @@index([type])
  @@index([ingestionRunId])
  @@map("research_service_projects")
}

model ResearchServiceProjectMember {
  id              String                    @id @default(cuid())
  projectId       String                    @map("project_id")
  project         ResearchServiceProject    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  role            ResearchServiceMemberRole
  facultyMemberId String?                   @map("faculty_member_id")
  facultyMember   FacultyMember?            @relation(fields: [facultyMemberId], references: [id], onDelete: SetNull)
  displayName     String?                   @map("display_name")
  /// Co-investigator kku_id verbatim; null for the lead.
  sourcePersonKey String?                   @map("source_person_key")
  /// Lead only. SHA-256 of the citizen ID — PII-class: never sent to a browser or API client.
  citizenIdHash   String?                   @map("citizen_id_hash")
  unitName        String?                   @map("unit_name")
  facultyId       String?                   @map("faculty_id")
  /// Resolved faculty Thai name (matched member's faculty, else unit_name).
  facultyName     String?                   @map("faculty_name")
  ingestionRunId  String                    @map("ingestion_run_id")
  ingestionRun    IngestionRun              @relation(fields: [ingestionRunId], references: [id])

  @@index([facultyMemberId])
  @@index([projectId])
  @@index([facultyName])
  @@index([citizenIdHash])
  @@index([ingestionRunId])
  @@map("research_service_project_members")
}
```

Then add back-relations. In `model IngestionRun { ... }` add:

```prisma
  researchServiceProjects       ResearchServiceProject[]
  researchServiceProjectMembers ResearchServiceProjectMember[]
```

In `model FacultyMember { ... }` add:

```prisma
  researchServiceProjectMembers ResearchServiceProjectMember[]
```

- [ ] **Step 2: Generate the SQL without touching any database.** From `packages/db` (never `npx prisma` at the repo root, which resolves a global v7):

```bash
cd packages/db && ./node_modules/.bin/prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/claude-1000/-home-denpong-projects-program-landscape/d2067f4b-2efc-4db8-895c-c4490d693ebe/scratchpad/rsp.sql
```

This compares the live dev DB to the schema and only prints. **Do not use `--from-migrations` or `--shadow-database-url`.** The dev-guard hook blocks them, and they wipe databases.

Copy only the statements for the two enums, two tables, their indexes and FKs into `packages/db/prisma/migrations/20261002100000_research_service_projects/migration.sql`. Strip any Prisma banner. Expected content shape:

```sql
-- CreateEnum
CREATE TYPE "ResearchServiceProjectType" AS ENUM ('RESEARCH', 'ACADEMIC_SERVICE', 'CONSULTING', 'OTHER');
-- CreateEnum
CREATE TYPE "ResearchServiceMemberRole" AS ENUM ('LEAD', 'CO_INVESTIGATOR');
-- CreateTable
CREATE TABLE "research_service_projects" ( ... );
-- CreateTable
CREATE TABLE "research_service_project_members" ( ... );
-- CreateIndex ... (unique on source_proposal_id, source_proposal_key; the @@index list)
-- AddForeignKey ... (projects.ingestion_run_id, members.project_id CASCADE, members.faculty_member_id SET NULL, members.ingestion_run_id)
```

If the diff shows statements unrelated to these two tables, that is existing drift. Leave it out and mention it in the task report.

- [ ] **Step 3: Apply and generate the client.**

```bash
cd packages/db && ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma generate
```

Expected: `Applying migration 20261002100000_research_service_projects` and `All migrations have been successfully applied.`

- [ ] **Step 4: Migration linter passes.** Run `pnpm --filter @kku/db test -- migration-linter`. Expected: PASS. The migration is additive only.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261002100000_research_service_projects
git commit -F <msgfile>   # "feat(db): tables for research and academic service grants"
```

---

### Task 2: Shared grants summary and API wire schema

**Files:**
- Create: `packages/shared/src/staff-profile/grants.ts`
- Modify: `packages/shared/src/staff-profile/api-schema.ts`, `packages/shared/src/staff-profile/index.ts`, `packages/shared/package.json` (exports)
- Test: `packages/shared/test/staff-grants.test.ts`, `packages/shared/test/staff-profile-api-schema.test.ts`

- [ ] **Step 1: Write the failing test** `packages/shared/test/staff-grants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summariseStaffGrants, type StaffGrantEntry } from '../src/staff-profile/grants';

const e = (over: Partial<StaffGrantEntry>): StaffGrantEntry => ({
  sourceProposalId: 1,
  titleTh: 'โครงการ',
  titleEn: null,
  type: 'RESEARCH',
  role: 'LEAD',
  fiscalYearBe: 2568,
  startDate: null,
  endDate: null,
  funderName: null,
  budgetThb: null,
  workflowStatus: 'x',
  teamSize: 1,
  ...over,
});
const TODAY = new Date('2026-10-02T05:00:00Z');

describe('summariseStaffGrants', () => {
  it('counts led and co-investigator projects and types', () => {
    const s = summariseStaffGrants(
      [e({ sourceProposalId: 1 }), e({ sourceProposalId: 2, role: 'CO_INVESTIGATOR', type: 'ACADEMIC_SERVICE' })],
      TODAY,
      null,
    );
    expect(s.led).toBe(1);
    expect(s.coInvestigator).toBe(1);
    expect(s.byType).toEqual({ RESEARCH: 1, ACADEMIC_SERVICE: 1, CONSULTING: 0, OTHER: 0 });
  });

  it('keeps one entry per project, preferring LEAD when a person is listed twice', () => {
    const s = summariseStaffGrants(
      [e({ sourceProposalId: 7, role: 'CO_INVESTIGATOR' }), e({ sourceProposalId: 7, role: 'LEAD' })],
      TODAY,
      null,
    );
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0]!.role).toBe('LEAD');
    expect(s.led).toBe(1);
    expect(s.coInvestigator).toBe(0);
  });

  it('counts a project active only when today falls inside both stated dates', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 1, startDate: '2026-01-01', endDate: '2026-12-31' }),
        e({ sourceProposalId: 2, startDate: '2025-01-01', endDate: '2025-12-31' }),
        e({ sourceProposalId: 3, startDate: '2026-01-01', endDate: null }),
      ],
      TODAY,
      null,
    );
    expect(s.active).toBe(1);
  });

  it('sorts newest fiscal year first, then lead before co-investigator, then title', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 1, fiscalYearBe: 2566, titleTh: 'ก' }),
        e({ sourceProposalId: 2, fiscalYearBe: 2569, role: 'CO_INVESTIGATOR', titleTh: 'ก' }),
        e({ sourceProposalId: 3, fiscalYearBe: 2569, titleTh: 'ข' }),
      ],
      TODAY,
      '2026-10-02T04:00:00.000Z',
    );
    expect(s.projects.map((p) => p.sourceProposalId)).toEqual([3, 2, 1]);
    expect(s.freshnessDate).toBe('2026-10-02T04:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `pnpm --filter @kku/shared test -- staff-grants`. Expected: FAIL, cannot resolve `../src/staff-profile/grants`.

- [ ] **Step 3: Implement** `packages/shared/src/staff-profile/grants.ts`:

```ts
// Research & academic-service grants for one staff member — the summary behind
// the /profile "Grants & academic service" panel and the external API's `grants`
// section. Browser-safe on purpose (types + pure maths only): the panel imports
// its types from here. Budget is always the WHOLE project's budget — the source
// states no per-person share, so none is invented.

export const GRANT_PROJECT_TYPES = ['RESEARCH', 'ACADEMIC_SERVICE', 'CONSULTING', 'OTHER'] as const;
export type GrantProjectType = (typeof GRANT_PROJECT_TYPES)[number];
export type GrantRole = 'LEAD' | 'CO_INVESTIGATOR';

export interface StaffGrantEntry {
  sourceProposalId: number;
  titleTh: string;
  titleEn: string | null;
  type: GrantProjectType;
  role: GrantRole;
  fiscalYearBe: number;
  /** ISO date `YYYY-MM-DD`, Bangkok calendar day. */
  startDate: string | null;
  endDate: string | null;
  funderName: string | null;
  /** Whole-project budget, THB. */
  budgetThb: number | null;
  workflowStatus: string;
  teamSize: number;
}

export interface StaffGrantsSummary {
  led: number;
  coInvestigator: number;
  active: number;
  byType: Record<GrantProjectType, number>;
  projects: StaffGrantEntry[];
  /** Completion time of the sync the rows came from. */
  freshnessDate: string | null;
}

function bangkokDay(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function summariseStaffGrants(
  entries: readonly StaffGrantEntry[],
  today: Date,
  freshnessDate: string | null,
): StaffGrantsSummary {
  const byProject = new Map<number, StaffGrantEntry>();
  for (const entry of entries) {
    const prev = byProject.get(entry.sourceProposalId);
    if (!prev || (prev.role === 'CO_INVESTIGATOR' && entry.role === 'LEAD')) {
      byProject.set(entry.sourceProposalId, entry);
    }
  }
  const projects = [...byProject.values()].sort(
    (a, b) =>
      b.fiscalYearBe - a.fiscalYearBe ||
      (a.role === b.role ? 0 : a.role === 'LEAD' ? -1 : 1) ||
      a.titleTh.localeCompare(b.titleTh, 'th'),
  );
  const day = bangkokDay(today);
  const byType: Record<GrantProjectType, number> = { RESEARCH: 0, ACADEMIC_SERVICE: 0, CONSULTING: 0, OTHER: 0 };
  let led = 0;
  let active = 0;
  for (const p of projects) {
    byType[p.type] += 1;
    if (p.role === 'LEAD') led += 1;
    if (p.startDate && p.endDate && p.startDate <= day && day <= p.endDate) active += 1;
  }
  return { led, coInvestigator: projects.length - led, active, byType, projects, freshnessDate };
}
```

- [ ] **Step 4: Export.** In `packages/shared/src/staff-profile/index.ts` add `export * from './grants';`. In `packages/shared/package.json` `exports`, beside the teaching-evaluation line, add `"./src/staff-profile/grants": "./src/staff-profile/grants.ts",`.

- [ ] **Step 5: Run the test.** `pnpm --filter @kku/shared test -- staff-grants`. Expected: 4 passed.

- [ ] **Step 6: Add the wire schema test** to `packages/shared/test/staff-profile-api-schema.test.ts` (append inside the file's top-level describe, or as a new describe):

```ts
import { STAFF_PROFILE_SECTIONS, STAFF_PROFILE_SECTION_LABELS, StaffProfileResponseDataSchema } from '../src/staff-profile/api-schema';

describe('grants section', () => {
  it('is a grantable section with a readable label', () => {
    expect(STAFF_PROFILE_SECTIONS).toContain('grants');
    expect(STAFF_PROFILE_SECTION_LABELS.grants).toBe('Research & academic service grants');
  });

  it('accepts a grants payload and rejects one carrying a hash', () => {
    const base = StaffProfileResponseDataSchema.shape.grants.unwrap();
    const ok = {
      led: 1, coInvestigator: 0, active: 0,
      byType: { RESEARCH: 1, ACADEMIC_SERVICE: 0, CONSULTING: 0, OTHER: 0 },
      projects: [{
        sourceProposalId: 1, titleTh: 'ก', titleEn: null, type: 'RESEARCH', role: 'LEAD', fiscalYearBe: 2568,
        startDate: null, endDate: null, funderName: null, budgetThb: 1000, workflowStatus: 'x', teamSize: 2,
      }],
    };
    expect(base.safeParse(ok).success).toBe(true);
    const strictProject = base.shape.projects.element;
    expect(strictProject.safeParse({ ...ok.projects[0], citizenIdHash: 'a'.repeat(64) }).success).toBe(false);
  });
});
```

(If the file already imports these names, merge the imports rather than duplicating them.)

- [ ] **Step 7: Run it and confirm it fails.** `pnpm --filter @kku/shared test -- staff-profile-api-schema`. Expected: FAIL (`grants` is not in the sections).

- [ ] **Step 8: Implement in `api-schema.ts`.** Add `'grants'` to `STAFF_PROFILE_SECTIONS` after `'teachingEvaluation'`, with the comment `// Funding records about the person: opt-in, never granted by default.`. Add `grants: 'Research & academic service grants',` to `STAFF_PROFILE_SECTION_LABELS`. Inside `StaffProfileResponseDataSchema`, after `teachingEvaluation`, add:

```ts
  // Granted → always an object (empty lists when nothing is on record);
  // withheld → key absent and listed in sectionsWithheld.
  grants: z
    .object({
      led: z.number(),
      coInvestigator: z.number(),
      active: z.number(),
      byType: z.object({
        RESEARCH: z.number(),
        ACADEMIC_SERVICE: z.number(),
        CONSULTING: z.number(),
        OTHER: z.number(),
      }),
      projects: z.array(
        z
          .object({
            sourceProposalId: z.number(),
            titleTh: z.string(),
            titleEn: z.string().nullable(),
            type: z.enum(['RESEARCH', 'ACADEMIC_SERVICE', 'CONSULTING', 'OTHER']),
            role: z.enum(['LEAD', 'CO_INVESTIGATOR']),
            fiscalYearBe: z.number(),
            startDate: z.string().nullable(),
            endDate: z.string().nullable(),
            funderName: z.string().nullable(),
            /** Whole-project budget, not this person's share. */
            budgetThb: z.number().nullable(),
            workflowStatus: z.string(),
            teamSize: z.number(),
          })
          .strict(),
      ),
    })
    .optional(),
```

- [ ] **Step 9: Run all shared tests.** `pnpm --filter @kku/shared test`. Expected: all pass. Fix any existing test that hard-codes the section list, such as an `ALL` array, by appending `'grants'`.

- [ ] **Step 10: Commit.** `feat(shared): staff grants summary and the grants API section schema`

---

### Task 3: Connector transforms (pure)

**Files:**
- Create: `apps/ingestion/src/connectors/sources/kku-research-services/transforms.ts`
- Test: `apps/ingestion/test/kku-research-services/transforms.test.ts`

- [ ] **Step 1: Write the failing test** `apps/ingestion/test/kku-research-services/transforms.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashCitizenId } from '@kku/shared';
import {
  CO_INVESTIGATORS_SQL,
  PROJECTS_SQL,
  mapProjectType,
  parseBangkokDateTime,
  planSnapshot,
  shrinkGuardMessage,
  type CoRow,
  type IdentityIndex,
  type ProjectRow,
} from '../../src/connectors/sources/kku-research-services/transforms';

const project = (over: Partial<ProjectRow> = {}): ProjectRow => ({
  proposal_id: 101,
  proposal_id_md5: 'a'.repeat(32),
  proposal_name_th: ' โครงการทดสอบ ',
  proposal_name_en: '-',
  proposal_type: 'งานวิจัย',
  budget_year: '2568',
  pro_bud_year: 2568,
  pro_start_date: '2025-10-01 00:00:00',
  pro_expire_date: '2026-09-30 00:00:00',
  proposal_budget_all: 500000,
  tax_name: ' วช. ',
  keywords: null,
  proposal_status2: 'RAD ตรวจสอบแล้ว ',
  proposal_dept: 'คณะวิศวกรรมศาสตร์',
  proposal_head: 'นาย ก',
  head_citizen_hash: 'b'.repeat(64),
  lead_email: 'lead@kku.ac.th',
  acro: 'No',
  pmu_okr: null,
  insert_date: '2025-01-01 10:00:00',
  accept_date: '2025-01-02 10:00:00',
  ...over,
});
const co = (over: Partial<CoRow> = {}): CoRow => ({
  co_id: 1, proposal_id: 'a'.repeat(32), fullname: 'นาง ข', kku_id: '123456', dept: null, ...over,
});
const emptyIndex = (): IdentityIndex => ({
  byCitizenHash: new Map(), byEmail: new Map(), byEmployeeId: new Map(),
  facultyIdByName: new Map(), facultyNameById: new Map(),
});

describe('SQL contract', () => {
  it('hashes the citizen id inside MySQL and never selects it raw', () => {
    expect(PROJECTS_SQL).toContain("SHA2(REPLACE(REPLACE(TRIM(head_citizen), '-', ''), ' ', ''), 256)");
    expect(PROJECTS_SQL).not.toMatch(/head_citizen\s*,/);
    expect(PROJECTS_SQL).not.toMatch(/SELECT\s+\*/i);
    expect(CO_INVESTIGATORS_SQL).not.toMatch(/SELECT\s+\*/i);
  });

  it('the SQL hash equals hashCitizenId for digit ids with dashes or spaces', () => {
    const raw = '1-2345-67890-12-3';
    const sqlEquivalent = createHash('sha256').update(raw.replace(/-/g, '').replace(/ /g, '')).digest('hex');
    expect(sqlEquivalent).toBe(hashCitizenId(raw));
  });
});

describe('mapProjectType', () => {
  it('maps the four known values and keeps unknowns as OTHER', () => {
    expect(mapProjectType('งานวิจัย')).toBe('RESEARCH');
    expect(mapProjectType('บริการวิชาการ ')).toBe('ACADEMIC_SERVICE');
    expect(mapProjectType('จ้างที่ปรึกษา')).toBe('CONSULTING');
    expect(mapProjectType('ข้อตกลงบริการวิชาการ (MOU) ')).toBe('OTHER');
  });
});

describe('parseBangkokDateTime', () => {
  it('reads MySQL datetimes as Bangkok local time', () => {
    expect(parseBangkokDateTime('2025-10-01 00:00:00')?.toISOString()).toBe('2025-09-30T17:00:00.000Z');
    expect(parseBangkokDateTime(null)).toBeNull();
    expect(parseBangkokDateTime('0000-00-00 00:00:00')).toBeNull();
  });
});

describe('planSnapshot', () => {
  it('builds a project row with trimmed text, a blank-or-1-char English title nulled, BE years', () => {
    const plan = planSnapshot([project()], [], emptyIndex());
    const p = plan.projects[0]!;
    expect(p).toMatchObject({
      id: 'rsp-101', sourceProposalId: 101, titleTh: 'โครงการทดสอบ', titleEn: null, type: 'RESEARCH',
      typeRaw: 'งานวิจัย', fiscalYearBe: 2568, budgetThb: 500000n, funderName: 'วช.',
      workflowStatus: 'RAD ตรวจสอบแล้ว', leadUnitName: 'คณะวิศวกรรมศาสตร์', leadFacultyName: 'คณะวิศวกรรมศาสตร์',
    });
  });

  it('matches the lead by citizen hash first, then by email, and takes the matched faculty', () => {
    const idx = emptyIndex();
    idx.byEmail.set('lead@kku.ac.th', { id: 'fm-email', facultyId: 'f2' });
    idx.byCitizenHash.set('b'.repeat(64), { id: 'fm-hash', facultyId: 'f1' });
    idx.facultyNameById.set('f1', 'คณะแพทยศาสตร์');
    const plan = planSnapshot([project()], [], idx);
    const lead = plan.members.find((m) => m.role === 'LEAD')!;
    expect(lead.facultyMemberId).toBe('fm-hash');
    expect(lead.facultyName).toBe('คณะแพทยศาสตร์');
    expect(lead.citizenIdHash).toBe('b'.repeat(64));
    expect(plan.projects[0]!.leadFacultyName).toBe('คณะแพทยศาสตร์');
    expect(plan.stats.leadsMatched).toBe(1);
  });

  it('falls back to email when the hash does not match', () => {
    const idx = emptyIndex();
    idx.byEmail.set('lead@kku.ac.th', { id: 'fm-email', facultyId: null });
    const plan = planSnapshot([project()], [], idx);
    expect(plan.members[0]!.facultyMemberId).toBe('fm-email');
  });

  it('resolves an unmatched unit name to a faculty by exact Thai name only', () => {
    const idx = emptyIndex();
    idx.facultyIdByName.set('คณะวิศวกรรมศาสตร์', 'f-eng');
    const plan = planSnapshot([project()], [], idx);
    expect(plan.projects[0]!.facultyId).toBe('f-eng');
  });

  it('matches 6-digit co-investigator ids to employee ids and keeps junk ids unmatched', () => {
    const idx = emptyIndex();
    idx.byEmployeeId.set('123456', { id: 'fm-co', facultyId: null });
    const plan = planSnapshot([project()], [co(), co({ co_id: 2, kku_id: '0' }), co({ co_id: 3, kku_id: null })], idx);
    const cos = plan.members.filter((m) => m.role === 'CO_INVESTIGATOR');
    expect(cos).toHaveLength(3);
    expect(cos.map((m) => m.facultyMemberId)).toEqual(['fm-co', null, null]);
    expect(cos[1]!.sourcePersonKey).toBe('0');
    expect(plan.stats).toMatchObject({ coSixDigit: 1, coMatched: 1, coOtherIds: 2 });
  });

  it('drops co-investigators whose project is not in the view, and counts them', () => {
    const plan = planSnapshot([project()], [co({ proposal_id: 'f'.repeat(32) })], emptyIndex());
    expect(plan.members.filter((m) => m.role === 'CO_INVESTIGATOR')).toHaveLength(0);
    expect(plan.stats.coOrphans).toBe(1);
  });

  it('samples unmatched unit names, never people', () => {
    const plan = planSnapshot([project({ proposal_dept: 'หน่วยใหม่' })], [], emptyIndex());
    expect(plan.stats.unmatchedUnitSamples).toEqual(['หน่วยใหม่']);
  });
});

describe('shrinkGuardMessage', () => {
  it('refuses to replace a snapshot with under half its projects', () => {
    expect(shrinkGuardMessage(100, 4291)).toMatch(/refusing/);
    expect(shrinkGuardMessage(2200, 4291)).toBeNull();
    expect(shrinkGuardMessage(10, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `pnpm --filter ingestion test -- kku-research-services`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `apps/ingestion/src/connectors/sources/kku-research-services/transforms.ts`:

```ts
// KKU Research & Academic Services — pure transforms for the connector.
// Source views (MySQL 5.7): T_external_fund_View_landscape (one row per
// externally funded project) and coproject_landscape (one row per
// co-investigator, joined on proposal_id = proposal_id_md5).
//
// PDPA: the lead's citizen id is hashed INSIDE MySQL (PROJECTS_SQL), so only the
// SHA-256 crosses the wire. MySQL 5.7 has no REGEXP_REPLACE, so the SQL strips
// dashes and spaces only; for digit ids that equals hashCitizenId(). The staff
// email is read for matching and never stored.

import { z } from 'zod';

export const PROJECTS_SQL = `
SELECT proposal_id, proposal_id_md5, proposal_name_th, proposal_name_en, proposal_type,
       budget_year, pro_bud_year, pro_start_date, pro_expire_date, proposal_budget_all,
       tax_name, keywords, proposal_status2, proposal_dept, proposal_head,
       IF(head_citizen IS NULL OR TRIM(head_citizen) = '', NULL,
          LOWER(SHA2(REPLACE(REPLACE(TRIM(head_citizen), '-', ''), ' ', ''), 256))) AS head_citizen_hash,
       LOWER(TRIM(proposal_email)) AS lead_email,
       acro, pmu_okr, insert_date, accept_date
  FROM T_external_fund_View_landscape`;

export const CO_INVESTIGATORS_SQL = `
SELECT co_id, proposal_id, fullname, kku_id, dept
  FROM coproject_landscape`;

const nullableText = z.string().nullable();

export const ProjectRowSchema = z.object({
  proposal_id: z.number().int(),
  proposal_id_md5: z.string().length(32),
  proposal_name_th: z.string(),
  proposal_name_en: nullableText,
  proposal_type: z.string(),
  budget_year: z.string().regex(/^\d{4}$/),
  pro_bud_year: z.number().int().nullable(),
  pro_start_date: nullableText,
  pro_expire_date: nullableText,
  proposal_budget_all: z.number().nullable(),
  tax_name: nullableText,
  keywords: nullableText,
  proposal_status2: z.string(),
  proposal_dept: z.string(),
  proposal_head: nullableText,
  head_citizen_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  lead_email: nullableText,
  acro: nullableText,
  pmu_okr: nullableText,
  insert_date: nullableText,
  accept_date: nullableText,
});
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

export const CoRowSchema = z.object({
  co_id: z.number().int(),
  proposal_id: z.string(),
  fullname: nullableText,
  kku_id: nullableText,
  dept: nullableText,
});
export type CoRow = z.infer<typeof CoRowSchema>;

export type ProjectType = 'RESEARCH' | 'ACADEMIC_SERVICE' | 'CONSULTING' | 'OTHER';

export function mapProjectType(raw: string): ProjectType {
  switch (raw.trim()) {
    case 'งานวิจัย':
      return 'RESEARCH';
    case 'บริการวิชาการ':
      return 'ACADEMIC_SERVICE';
    case 'จ้างที่ปรึกษา':
      return 'CONSULTING';
    default:
      return 'OTHER';
  }
}

function text(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** MySQL `dateStrings` datetime → instant, read as Bangkok local time. */
export function parseBangkokDateTime(v: string | null): Date | null {
  if (!v || v.startsWith('0000')) return null;
  const d = new Date(`${v.trim().replace(' ', 'T')}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface StaffRef {
  id: string;
  facultyId: string | null;
}

export interface IdentityIndex {
  byCitizenHash: Map<string, StaffRef>;
  /** Lowercased KKU email. */
  byEmail: Map<string, StaffRef>;
  /** 6-digit HR employee id. */
  byEmployeeId: Map<string, StaffRef>;
  /** Faculty Thai name → id (exact match only). */
  facultyIdByName: Map<string, string>;
  facultyNameById: Map<string, string>;
}

export interface ProjectInsert {
  id: string;
  sourceProposalId: number;
  sourceProposalKey: string;
  titleTh: string;
  titleEn: string | null;
  type: ProjectType;
  typeRaw: string;
  fiscalYearBe: number;
  projectBudgetYearBe: number | null;
  startDate: Date | null;
  endDate: Date | null;
  budgetThb: bigint | null;
  funderName: string | null;
  keywords: string | null;
  workflowStatus: string;
  leadUnitName: string;
  leadFacultyName: string;
  facultyId: string | null;
  acroRaw: string | null;
  pmuOkrRaw: string | null;
  submittedAt: Date | null;
  acceptedAt: Date | null;
}

export interface MemberInsert {
  projectId: string;
  role: 'LEAD' | 'CO_INVESTIGATOR';
  facultyMemberId: string | null;
  displayName: string | null;
  sourcePersonKey: string | null;
  citizenIdHash: string | null;
  unitName: string | null;
  facultyId: string | null;
  facultyName: string | null;
}

export interface SnapshotStats {
  projects: number;
  leadsMatched: number;
  coRows: number;
  coSixDigit: number;
  coMatched: number;
  coOtherIds: number;
  coOrphans: number;
  unmatchedUnitSamples: string[];
}

export interface SnapshotPlan {
  projects: ProjectInsert[];
  members: MemberInsert[];
  stats: SnapshotStats;
}

const SIX_DIGITS = /^\d{6}$/;

export function planSnapshot(
  projectRows: readonly ProjectRow[],
  coRows: readonly CoRow[],
  idx: IdentityIndex,
): SnapshotPlan {
  const unmatchedUnits = new Set<string>();
  const resolveFaculty = (staff: StaffRef | undefined, unitName: string | null) => {
    if (staff?.facultyId) {
      return { facultyId: staff.facultyId, facultyName: idx.facultyNameById.get(staff.facultyId) ?? unitName };
    }
    if (!unitName) return { facultyId: null, facultyName: null };
    const id = idx.facultyIdByName.get(unitName) ?? null;
    if (!id) unmatchedUnits.add(unitName);
    return { facultyId: id, facultyName: unitName };
  };

  const projects: ProjectInsert[] = [];
  const members: MemberInsert[] = [];
  const idByKey = new Map<string, string>();
  let leadsMatched = 0;

  for (const r of projectRows) {
    const id = `rsp-${r.proposal_id}`;
    idByKey.set(r.proposal_id_md5, id);
    const unitName = r.proposal_dept.trim();
    const lead =
      (r.head_citizen_hash ? idx.byCitizenHash.get(r.head_citizen_hash) : undefined) ??
      (r.lead_email ? idx.byEmail.get(r.lead_email) : undefined);
    if (lead) leadsMatched += 1;
    const leadFaculty = resolveFaculty(lead, unitName);
    const titleEn = text(r.proposal_name_en);
    projects.push({
      id,
      sourceProposalId: r.proposal_id,
      sourceProposalKey: r.proposal_id_md5,
      titleTh: r.proposal_name_th.trim(),
      titleEn: titleEn && titleEn.length > 1 ? titleEn : null,
      type: mapProjectType(r.proposal_type),
      typeRaw: r.proposal_type.trim(),
      fiscalYearBe: Number(r.budget_year),
      projectBudgetYearBe: r.pro_bud_year,
      startDate: parseBangkokDateTime(r.pro_start_date),
      endDate: parseBangkokDateTime(r.pro_expire_date),
      budgetThb: r.proposal_budget_all === null ? null : BigInt(Math.round(r.proposal_budget_all)),
      funderName: text(r.tax_name),
      keywords: text(r.keywords),
      workflowStatus: r.proposal_status2.trim(),
      leadUnitName: unitName,
      leadFacultyName: leadFaculty.facultyName ?? unitName,
      facultyId: leadFaculty.facultyId,
      acroRaw: text(r.acro),
      pmuOkrRaw: text(r.pmu_okr),
      submittedAt: parseBangkokDateTime(r.insert_date),
      acceptedAt: parseBangkokDateTime(r.accept_date),
    });
    members.push({
      projectId: id,
      role: 'LEAD',
      facultyMemberId: lead?.id ?? null,
      displayName: text(r.proposal_head),
      sourcePersonKey: null,
      citizenIdHash: r.head_citizen_hash,
      unitName,
      facultyId: leadFaculty.facultyId,
      facultyName: leadFaculty.facultyName,
    });
  }

  let coSixDigit = 0;
  let coMatched = 0;
  let coOtherIds = 0;
  let coOrphans = 0;
  for (const c of coRows) {
    const projectId = idByKey.get(c.proposal_id.trim());
    if (!projectId) {
      coOrphans += 1;
      continue;
    }
    const key = text(c.kku_id);
    let staff: StaffRef | undefined;
    if (key && SIX_DIGITS.test(key)) {
      coSixDigit += 1;
      staff = idx.byEmployeeId.get(key);
      if (staff) coMatched += 1;
    } else {
      coOtherIds += 1;
    }
    const unitName = text(c.dept);
    const f = resolveFaculty(staff, unitName);
    members.push({
      projectId,
      role: 'CO_INVESTIGATOR',
      facultyMemberId: staff?.id ?? null,
      displayName: text(c.fullname),
      sourcePersonKey: key,
      citizenIdHash: null,
      unitName,
      facultyId: f.facultyId,
      facultyName: f.facultyName,
    });
  }

  return {
    projects,
    members,
    stats: {
      projects: projects.length,
      leadsMatched,
      coRows: coRows.length,
      coSixDigit,
      coMatched,
      coOtherIds,
      coOrphans,
      unmatchedUnitSamples: [...unmatchedUnits].slice(0, 20),
    },
  };
}

/** Null when the new snapshot may replace the old one. */
export function shrinkGuardMessage(fetched: number, current: number): string | null {
  if (current === 0) return null;
  if (fetched >= current * 0.5) return null;
  return `fetched ${fetched} projects against ${current} held — under 50 %, refusing to replace the snapshot`;
}
```

- [ ] **Step 4: Run the test.** `pnpm --filter ingestion test -- kku-research-services`. Expected: all pass.

- [ ] **Step 5: Commit.** `feat(ingestion): pure transforms for the research-services connector`

---

### Task 4: Connector class, registry, catalog, env

**Files:**
- Create: `apps/ingestion/src/connectors/sources/kku-research-services/connector.ts`, `index.ts`
- Modify: `apps/ingestion/src/connectors/sources/kku-connectors.ts`, `apps/ingestion/src/connectors/registry.ts`, `packages/shared/src/ingestion/catalog.ts`, `.env.prod.example`
- Test: `apps/ingestion/test/kku-research-services/registry.test.ts`

- [ ] **Step 1: Write the failing test** `apps/ingestion/test/kku-research-services/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getCatalogEntry } from '@kku/shared';
import { KkuResearchServicesRealConnector } from '../../src/connectors/sources/kku-research-services';

describe('kku-research-services wiring', () => {
  it('is a real, daily catalog source', () => {
    const e = getCatalogEntry('kku-research-services');
    expect(e).toBeDefined();
    expect(e!.mocked).toBe(false);
    expect(e!.cadenceCron).toBe('0 4 * * *');
  });

  it('the real connector carries the catalog slug', () => {
    const c = new KkuResearchServicesRealConnector();
    expect(c.slug).toBe('kku-research-services');
    expect(c.mocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `pnpm --filter ingestion test -- kku-research-services/registry`. Expected: FAIL.

- [ ] **Step 3: Implement** `connector.ts`:

```ts
// KKU Research & Academic Services — externally funded research and
// academic-service projects, with their leads and co-investigators.
// Source: MySQL 5.7 at KKU_RESEARCH_SERVICES_DB_* (read-only login).
// Daily snapshot replace: both tables are rewritten in ONE transaction, and
// only after both views were fetched, so a failed fetch never deletes data.
// Pure logic + SQL live in transforms.ts.

import type {
  Connector,
  ConnectorContext,
  HealthStatus,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';
import { prisma } from '@kku/db';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import { configFromEnv, query, withConnection } from '../../../lib/mysql-client';
import {
  CO_INVESTIGATORS_SQL,
  CoRowSchema,
  PROJECTS_SQL,
  ProjectRowSchema,
  planSnapshot,
  shrinkGuardMessage,
  type CoRow,
  type IdentityIndex,
  type ProjectRow,
  type StaffRef,
} from './transforms';

const ENV_PREFIX = 'KKU_RESEARCH_SERVICES_DB';
const CHUNK = 1000;

interface Fetched {
  projects: ProjectRow[];
  cos: CoRow[];
}

export class KkuResearchServicesRealConnector extends ApiConnector implements Connector {
  readonly slug = 'kku-research-services';
  readonly mocked = false;

  private fetched: Fetched | null = null;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const cfg = configFromEnv(ENV_PREFIX);
      await withConnection(cfg, async (conn) => query(conn, 'SELECT 1 AS ok'));
      return { ok: true, message: `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const cfg = configFromEnv(ENV_PREFIX);
    const { rawProjects, rawCos } = await withConnection(cfg, async (conn) => ({
      rawProjects: await query(conn, PROJECTS_SQL),
      rawCos: await query(conn, CO_INVESTIGATORS_SQL),
    }));
    const projects = ProjectRowSchema.array().safeParse(rawProjects);
    const cos = CoRowSchema.array().safeParse(rawCos);
    if (!projects.success || !cos.success) {
      const issue = (projects.success ? cos.error! : projects.error).issues[0];
      throw new NonRetryableError(
        'SCHEMA_DRIFT',
        `research-services view shape changed at ${issue?.path.join('.')}: ${issue?.message}`,
      );
    }
    if (projects.data.length === 0) {
      throw new NonRetryableError('EMPTY_DATA', 'project view returned 0 rows — refusing to wipe the snapshot');
    }
    this.fetched = { projects: projects.data, cos: cos.data };
    ctx.log.info(`fetched ${projects.data.length} projects, ${cos.data.length} co-investigator rows`);
    // One synthetic record: the snapshot is planned and loaded as a whole in load().
    return [{ externalId: 'snapshot', data: {}, sourceTimestamp: new Date() }];
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ target: 'research_service_snapshot', externalId: raw.externalId, payload: {}, freshnessDate: raw.sourceTimestamp }];
  }

  async load(ctx: ConnectorContext, _normalized: NormalizedRecord[]): Promise<LoadResult> {
    if (!this.fetched) throw new Error('fetch() must run before load()');
    const { projects, cos } = this.fetched;

    const current = await prisma.researchServiceProject.count();
    const refusal = shrinkGuardMessage(projects.length, current);
    if (refusal) throw new NonRetryableError('SNAPSHOT_SHRANK', refusal);

    const plan = planSnapshot(projects, cos, await buildIdentityIndex(projects, cos));

    await prisma.$transaction(
      async (tx) => {
        await tx.researchServiceProjectMember.deleteMany({});
        await tx.researchServiceProject.deleteMany({});
        for (let i = 0; i < plan.projects.length; i += CHUNK) {
          await tx.researchServiceProject.createMany({
            data: plan.projects.slice(i, i + CHUNK).map((p) => ({ ...p, ingestionRunId: ctx.runId })),
          });
        }
        for (let i = 0; i < plan.members.length; i += CHUNK) {
          await tx.researchServiceProjectMember.createMany({
            data: plan.members.slice(i, i + CHUNK).map((m) => ({ ...m, ingestionRunId: ctx.runId })),
          });
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    const s = plan.stats;
    return {
      recordsFetched: projects.length + cos.length,
      recordsLoaded: plan.projects.length + plan.members.length,
      recordsFailed: 0,
      metadata: {
        projectsFetched: projects.length,
        coRowsFetched: cos.length,
        membersLoaded: plan.members.length,
        leadsMatched: s.leadsMatched,
        leadMatchRate: projects.length ? s.leadsMatched / projects.length : null,
        coSixDigit: s.coSixDigit,
        coMatched: s.coMatched,
        coMatchRate: s.coSixDigit ? s.coMatched / s.coSixDigit : null,
        coOtherIds: s.coOtherIds,
        coOrphansNotInView: s.coOrphans,
        unmatchedUnitSamples: s.unmatchedUnitSamples,
      },
    };
  }
}

/** Batch lookups only — never one query per row. */
async function buildIdentityIndex(projects: ProjectRow[], cos: CoRow[]): Promise<IdentityIndex> {
  const hashes = [...new Set(projects.map((p) => p.head_citizen_hash).filter((h): h is string => !!h))];
  const emails = [...new Set(projects.map((p) => p.lead_email).filter((e): e is string => !!e))];
  const empIds = [...new Set(cos.map((c) => c.kku_id?.trim() ?? '').filter((k) => /^\d{6}$/.test(k)))];
  const sel = { id: true, facultyId: true, citizenIdHash: true, kkuEmail: true, employeeId: true } as const;
  const [byHash, byEmail, byEmp, faculties] = await Promise.all([
    prisma.facultyMember.findMany({ where: { citizenIdHash: { in: hashes } }, select: sel }),
    prisma.facultyMember.findMany({ where: { kkuEmail: { in: emails, mode: 'insensitive' } }, select: sel }),
    // Prefer an active record when an employee id appears on more than one row.
    prisma.facultyMember.findMany({
      where: { employeeId: { in: empIds } },
      select: sel,
      orderBy: [{ isActive: 'desc' }, { id: 'asc' }],
    }),
    prisma.faculty.findMany({ select: { id: true, nameTh: true } }),
  ]);
  const ref = (m: { id: string; facultyId: string | null }): StaffRef => ({ id: m.id, facultyId: m.facultyId });
  const idx: IdentityIndex = {
    byCitizenHash: new Map(),
    byEmail: new Map(),
    byEmployeeId: new Map(),
    facultyIdByName: new Map(faculties.map((f) => [f.nameTh, f.id])),
    facultyNameById: new Map(faculties.map((f) => [f.id, f.nameTh])),
  };
  for (const m of byHash) if (m.citizenIdHash) idx.byCitizenHash.set(m.citizenIdHash, ref(m));
  for (const m of byEmail) if (m.kkuEmail) idx.byEmail.set(m.kkuEmail.toLowerCase(), ref(m));
  for (const m of byEmp) if (m.employeeId && !idx.byEmployeeId.has(m.employeeId)) idx.byEmployeeId.set(m.employeeId, ref(m));
  return idx;
}
```

Note: `FacultyMember.facultyId` is non-null and `isActive` exists (schema.prisma ~1504/1529); `StaffRef.facultyId` is typed nullable so the transforms stay usable for unmatched people.

`index.ts`:

```ts
export { KkuResearchServicesRealConnector } from './connector';
```

- [ ] **Step 4: Add the mock and registry entry.** In `apps/ingestion/src/connectors/sources/kku-connectors.ts`, after `UniconDs2004Connector`, add:

```ts
// No sample rows: the no-mock-data policy. In mocked mode this source is simply empty.
export class KkuResearchServicesConnector extends ApiConnector {
  readonly slug = 'kku-research-services';
  readonly mocked = true;

  async fetch(): Promise<RawRecord[]> {
    return [];
  }
  async transform(): Promise<NormalizedRecord[]> {
    return [];
  }
  async load(_c: ConnectorContext, n: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsFetched: n.length, recordsLoaded: 0, recordsFailed: 0, metadata: { note: 'mocked — no rows' } };
  }
}
```

In `registry.ts`, add `KkuResearchServicesConnector` to the `./sources/kku-connectors` import and `import { KkuResearchServicesRealConnector } from './sources/kku-research-services';`. Then append to the entries array, before the closing `];`:

```ts
  // KKU Research & Academic Services (MySQL) — external grants + academic service
  {
    slug: 'kku-research-services',
    mock: () => new KkuResearchServicesConnector(),
    real: () => new KkuResearchServicesRealConnector(),
  },
```

- [ ] **Step 5: Add the catalog entry** in `packages/shared/src/ingestion/catalog.ts`, after the `unicon-ds2004` entry:

```ts
  {
    slug: 'kku-research-services',
    name: 'KKU Research & Academic Services — external grants',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 4 * * *', // daily at 04:00, after the UNICON syncs
    ownerContact: 'KKU Research Administration (กองบริหารงานวิจัย)',
    notes:
      'Externally funded research and academic-service projects with lead + co-investigators (MySQL views T_external_fund_View_landscape + coproject_landscape). Daily snapshot replace. Lead citizen id hashed in SQL.',
    mocked: false,
  },
```

- [ ] **Step 6: Document the env keys.** Append to `.env.prod.example`:

```bash
# KKU Research & Academic Services (MySQL 5.7, read-only) — connector kku-research-services
KKU_RESEARCH_SERVICES_DB_HOST=10.101.106.65
KKU_RESEARCH_SERVICES_DB_PORT=3306
KKU_RESEARCH_SERVICES_DB_DATABASE=
KKU_RESEARCH_SERVICES_DB_USER=
KKU_RESEARCH_SERVICES_DB_PASSWORD=
KKU_RESEARCH_SERVICES_DB_SSL=false
CONNECTOR_KKU_RESEARCH_SERVICES_MODE=real
```

- [ ] **Step 7: Run the tests and typecheck.** Run `pnpm --filter ingestion test -- kku-research-services`, then `pnpm --filter ingestion typecheck`, then `pnpm --filter @kku/shared test`. Expected: all pass. Some existing catalog/registry tests assert the source count or every catalog slug has a registry entry; they should pass. If one hard-codes a count, update it.

- [ ] **Step 8: Commit.** `feat(ingestion): kku-research-services connector, registered and catalogued`

---

### Task 5: Live sync on dev (three green runs)

No code. This verifies Tasks 1–4 against the real source.

- [ ] **Step 1: Turn the connector on in dev.** Hand this to the operator (never edit `.env` yourself):

```
! printf '\nCONNECTOR_KKU_RESEARCH_SERVICES_MODE=real\n' >> .env
```

- [ ] **Step 2: Create the `data_sources` row.** `pnpm data-sources:sync --apply`. Expected output names `kku-research-services` as created.

- [ ] **Step 3: Run three times.** `pnpm connector:run kku-research-services`, three times. Expected each time: `SUCCEEDED`, with metadata near `projectsFetched 4291`, `leadMatchRate ≈ 0.88`, `coMatchRate ≈ 0.69`, `coOrphansNotInView ≈ 448`. The counts must be identical across runs unless the source changed in between.

- [ ] **Step 4: Spot-check the tables.** Counts only, no personal data:

```bash
docker exec program-landscape-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT (SELECT count(*) FROM research_service_projects), (SELECT count(*) FROM research_service_project_members), (SELECT count(*) FROM research_service_project_members WHERE faculty_member_id IS NOT NULL), (SELECT count(DISTINCT ingestion_run_id) FROM research_service_projects)"'
```

Expected: about `4291|9300|…|1`. There is exactly one run id, because each run replaces the whole snapshot.

- [ ] **Step 5: Record the measured numbers** in the task report. They go into the data-source doc in Task 12.

---

### Task 6: Query module

**Files:**
- Create: `packages/db/src/research-services.ts`
- Modify: `packages/db/src/index.ts` (export), `packages/db/src/staff-profile/index.ts` (re-export `getStaffGrants`)
- Test: `packages/db/test/research-services.test.ts`

- [ ] **Step 1: Write the failing test** `packages/db/test/research-services.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateGrants, toStaffGrantEntry, type GrantProjectRow } from '../src/research-services';

const p = (over: Partial<GrantProjectRow>): GrantProjectRow => ({
  id: 'rsp-1', sourceProposalId: 1, titleTh: 'ก', titleEn: null, type: 'RESEARCH', fiscalYearBe: 2568,
  startDate: null, endDate: null, budgetThb: 100n, funderName: 'วช.', workflowStatus: 's',
  leadFacultyName: 'A',
  members: [{ role: 'LEAD', facultyMemberId: 'm1', displayName: 'L', facultyName: 'A' }],
  ...over,
});

describe('aggregateGrants', () => {
  const rows = [
    p({ id: 'rsp-1', budgetThb: 100n, members: [
      { role: 'LEAD', facultyMemberId: 'm1', displayName: 'L', facultyName: 'A' },
      { role: 'CO_INVESTIGATOR', facultyMemberId: 'm2', displayName: 'C', facultyName: 'B' },
    ] }),
    p({ id: 'rsp-2', sourceProposalId: 2, type: 'ACADEMIC_SERVICE', fiscalYearBe: 2569, budgetThb: 50n, funderName: null,
      leadFacultyName: 'B', members: [{ role: 'LEAD', facultyMemberId: null, displayName: 'X', facultyName: 'B' }] }),
  ];

  it('counts each project once in the KKU total and its budget', () => {
    const r = aggregateGrants(rows, { facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    expect(r.kpis).toMatchObject({ projects: 2, budgetThb: 150, staffInvolved: 2, membersTotal: 3, membersMatched: 2 });
  });

  it('credits every participating faculty, so faculty totals exceed the KKU total', () => {
    const r = aggregateGrants(rows, { facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    const a = r.byFaculty.find((f) => f.facultyName === 'A')!;
    const b = r.byFaculty.find((f) => f.facultyName === 'B')!;
    expect(a).toMatchObject({ led: 1, coOnly: 0, total: 1 });
    expect(b).toMatchObject({ led: 1, coOnly: 1, total: 2 });
    expect(r.byFaculty.reduce((s, f) => s + f.total, 0)).toBeGreaterThan(r.kpis.projects);
  });

  it('limits faculty rows to the faculties in the filter', () => {
    const r = aggregateGrants(rows, { facultyName: ['B'], page: 1, pageSize: 50, sort: 'year' });
    expect(r.byFaculty.map((f) => f.facultyName)).toEqual(['B']);
  });

  it('trends by fiscal year and type, and ranks funders with an explicit unknown bucket', () => {
    const r = aggregateGrants(rows, { facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    expect(r.trend).toEqual([
      { fiscalYearBe: 2568, RESEARCH: 1, ACADEMIC_SERVICE: 0, OTHER: 0, budgetThb: 100 },
      { fiscalYearBe: 2569, RESEARCH: 0, ACADEMIC_SERVICE: 1, OTHER: 0, budgetThb: 50 },
    ]);
    expect(r.topFunders[0]).toEqual({ funderName: 'วช.', projects: 1, budgetThb: 100 });
    expect(r.topFunders.find((f) => f.funderName === null)).toEqual({ funderName: null, projects: 1, budgetThb: 50 });
  });

  it('pages and sorts the project table; rows carry no person ids or hashes', () => {
    const r = aggregateGrants(rows, { facultyName: [], page: 1, pageSize: 1, sort: 'budget' });
    expect(r.table.total).toBe(2);
    expect(r.table.rows).toHaveLength(1);
    expect(r.table.rows[0]!.id).toBe('rsp-1');
    expect(JSON.stringify(r.table.rows)).not.toMatch(/facultyMemberId|citizenIdHash/);
  });
});

describe('toStaffGrantEntry', () => {
  it('formats dates as Bangkok calendar days and budget as a number', () => {
    const e = toStaffGrantEntry(
      p({ startDate: new Date('2025-09-30T17:00:00Z'), endDate: new Date('2026-09-29T17:00:00Z'), budgetThb: 205427844n }),
      'CO_INVESTIGATOR',
    );
    expect(e).toMatchObject({ startDate: '2025-10-01', endDate: '2026-09-30', budgetThb: 205427844, role: 'CO_INVESTIGATOR', teamSize: 1 });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `pnpm --filter @kku/db test -- research-services`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `packages/db/src/research-services.ts`:

```ts
// KKU Research & Academic Services — read model for the Staff grants
// dashboard, the project side panel, and the per-person loader shared by
// /profile and the external Staff Profile API.
//
// Attribution (spec D4): a faculty is credited with a project for EVERY
// faculty that has a team member on it, so faculty counts sum to more than
// the KKU total. Money is never split: the KKU total counts each project's
// budget once, and a person's figure is always the project total.
//
// Plain Prisma queries + in-memory aggregation (~4.3k projects). No raw SQL,
// so no Prisma.sql fragments — /profile calls getStaffGrants inside Next.js.

import { summariseStaffGrants, type StaffGrantEntry, type StaffGrantsSummary } from '@kku/shared';
import { prisma } from './index';
import { realDataWhere } from './data-quality';

export type GrantType = 'RESEARCH' | 'ACADEMIC_SERVICE' | 'CONSULTING' | 'OTHER';
export const GRANTS_SOURCE_SLUG = 'kku-research-services';

export interface GrantMemberRow {
  role: 'LEAD' | 'CO_INVESTIGATOR';
  facultyMemberId: string | null;
  displayName: string | null;
  facultyName: string | null;
}

export interface GrantProjectRow {
  id: string;
  sourceProposalId: number;
  titleTh: string;
  titleEn: string | null;
  type: GrantType;
  fiscalYearBe: number;
  startDate: Date | null;
  endDate: Date | null;
  budgetThb: bigint | null;
  funderName: string | null;
  workflowStatus: string;
  leadFacultyName: string;
  members: GrantMemberRow[];
}

export interface GrantsFilter {
  facultyName: string[];
  yearFrom?: number;
  yearTo?: number;
  type?: GrantType[];
  funder?: string[];
  page: number;
  pageSize: number;
  sort: 'year' | 'budget' | 'title';
}

export interface GrantsTableRow {
  id: string;
  titleTh: string;
  titleEn: string | null;
  type: GrantType;
  fiscalYearBe: number;
  leadName: string | null;
  leadFacultyName: string;
  funderName: string | null;
  budgetThb: number | null;
  teamSize: number;
  workflowStatus: string;
}

export interface GrantsDashboard {
  kpis: { projects: number; budgetThb: number; staffInvolved: number; membersTotal: number; membersMatched: number };
  trend: Array<{ fiscalYearBe: number; RESEARCH: number; ACADEMIC_SERVICE: number; OTHER: number; budgetThb: number }>;
  byFaculty: Array<{ facultyName: string; led: number; coOnly: number; total: number }>;
  topFunders: Array<{ funderName: string | null; projects: number; budgetThb: number }>;
  table: { total: number; page: number; pageSize: number; rows: GrantsTableRow[] };
}

const num = (b: bigint | null): number | null => (b === null ? null : Number(b));

export function aggregateGrants(rows: readonly GrantProjectRow[], f: GrantsFilter): GrantsDashboard {
  const facultyFilter = f.facultyName.length > 0 ? new Set(f.facultyName) : null;
  const staff = new Set<string>();
  let membersTotal = 0;
  let membersMatched = 0;
  let budget = 0;
  const trend = new Map<number, GrantsDashboard['trend'][number]>();
  const fac = new Map<string, { led: number; coOnly: number }>();
  const funders = new Map<string | null, { projects: number; budgetThb: number }>();

  for (const r of rows) {
    const b = num(r.budgetThb) ?? 0;
    budget += b;
    for (const m of r.members) {
      membersTotal += 1;
      if (m.facultyMemberId) {
        membersMatched += 1;
        staff.add(m.facultyMemberId);
      }
    }
    const t = trend.get(r.fiscalYearBe) ?? { fiscalYearBe: r.fiscalYearBe, RESEARCH: 0, ACADEMIC_SERVICE: 0, OTHER: 0, budgetThb: 0 };
    if (r.type === 'RESEARCH') t.RESEARCH += 1;
    else if (r.type === 'ACADEMIC_SERVICE') t.ACADEMIC_SERVICE += 1;
    else t.OTHER += 1;
    t.budgetThb += b;
    trend.set(r.fiscalYearBe, t);

    const participating = new Set(r.members.map((m) => m.facultyName).filter((n): n is string => !!n));
    participating.add(r.leadFacultyName);
    for (const name of participating) {
      if (facultyFilter && !facultyFilter.has(name)) continue;
      const row = fac.get(name) ?? { led: 0, coOnly: 0 };
      if (name === r.leadFacultyName) row.led += 1;
      else row.coOnly += 1;
      fac.set(name, row);
    }

    const fu = funders.get(r.funderName) ?? { projects: 0, budgetThb: 0 };
    fu.projects += 1;
    fu.budgetThb += b;
    funders.set(r.funderName, fu);
  }

  const sorted = [...rows].sort((a, b) => {
    if (f.sort === 'budget') return (num(b.budgetThb) ?? -1) - (num(a.budgetThb) ?? -1);
    if (f.sort === 'title') return a.titleTh.localeCompare(b.titleTh, 'th');
    return b.fiscalYearBe - a.fiscalYearBe || (num(b.budgetThb) ?? -1) - (num(a.budgetThb) ?? -1);
  });
  const start = (f.page - 1) * f.pageSize;

  return {
    kpis: { projects: rows.length, budgetThb: budget, staffInvolved: staff.size, membersTotal, membersMatched },
    trend: [...trend.values()].sort((a, b) => a.fiscalYearBe - b.fiscalYearBe),
    byFaculty: [...fac.entries()]
      .map(([facultyName, v]) => ({ facultyName, ...v, total: v.led + v.coOnly }))
      .sort((a, b) => b.total - a.total || a.facultyName.localeCompare(b.facultyName, 'th')),
    topFunders: [...funders.entries()]
      .map(([funderName, v]) => ({ funderName, ...v }))
      .sort((a, b) => b.projects - a.projects)
      .slice(0, 15),
    table: {
      total: rows.length,
      page: f.page,
      pageSize: f.pageSize,
      rows: sorted.slice(start, start + f.pageSize).map((r) => ({
        id: r.id,
        titleTh: r.titleTh,
        titleEn: r.titleEn,
        type: r.type,
        fiscalYearBe: r.fiscalYearBe,
        leadName: r.members.find((m) => m.role === 'LEAD')?.displayName ?? null,
        leadFacultyName: r.leadFacultyName,
        funderName: r.funderName,
        budgetThb: num(r.budgetThb),
        teamSize: r.members.length,
        workflowStatus: r.workflowStatus,
      })),
    },
  };
}

const PROJECT_SELECT = {
  id: true, sourceProposalId: true, titleTh: true, titleEn: true, type: true, fiscalYearBe: true,
  startDate: true, endDate: true, budgetThb: true, funderName: true, workflowStatus: true, leadFacultyName: true,
  members: { select: { role: true, facultyMemberId: true, displayName: true, facultyName: true } },
} as const;

/** Rows visible to the filter: a project is in a faculty scope when ANY team member is. */
async function loadRows(f: GrantsFilter): Promise<GrantProjectRow[]> {
  return prisma.researchServiceProject.findMany({
    where: {
      ...realDataWhere(),
      ...(f.yearFrom || f.yearTo ? { fiscalYearBe: { gte: f.yearFrom, lte: f.yearTo } } : {}),
      ...(f.type && f.type.length > 0 ? { type: { in: f.type } } : {}),
      ...(f.funder && f.funder.length > 0 ? { funderName: { in: f.funder } } : {}),
      ...(f.facultyName.length > 0 ? { members: { some: { facultyName: { in: f.facultyName } } } } : {}),
    },
    select: PROJECT_SELECT,
  });
}

/** Completion time of the latest successful sync, or null before the first. */
export async function grantsFreshness(): Promise<{ runId: string; completedAt: Date } | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: GRANTS_SOURCE_SLUG } },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true },
  });
  return run?.completedAt ? { runId: run.id, completedAt: run.completedAt } : null;
}

export async function getGrantsDashboard(
  f: GrantsFilter,
): Promise<GrantsDashboard & { options: { yearMin: number | null; yearMax: number | null; funders: string[] } }> {
  const [rows, years, funderRows] = await Promise.all([
    loadRows(f),
    prisma.researchServiceProject.aggregate({ where: realDataWhere(), _min: { fiscalYearBe: true }, _max: { fiscalYearBe: true } }),
    prisma.researchServiceProject.groupBy({
      by: ['funderName'],
      where: { ...realDataWhere(), funderName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { funderName: 'desc' } },
      take: 50,
    }),
  ]);
  return {
    ...aggregateGrants(rows, f),
    options: {
      yearMin: years._min.fiscalYearBe,
      yearMax: years._max.fiscalYearBe,
      funders: funderRows.map((r) => r.funderName).filter((n): n is string => !!n),
    },
  };
}

export interface GrantProjectDetail {
  id: string;
  titleTh: string;
  titleEn: string | null;
  type: GrantType;
  typeRaw: string;
  fiscalYearBe: number;
  startDate: string | null;
  endDate: string | null;
  budgetThb: number | null;
  funderName: string | null;
  keywords: string | null;
  workflowStatus: string;
  leadFacultyName: string;
  team: Array<{ role: 'LEAD' | 'CO_INVESTIGATOR'; displayName: string | null; facultyName: string | null; matched: boolean }>;
}

/** Null when the project does not exist or no team member is inside `facultyNames` (null = all). */
export async function getGrantProjectDetail(
  id: string,
  facultyNames: string[] | null,
): Promise<GrantProjectDetail | null> {
  const p = await prisma.researchServiceProject.findFirst({
    where: {
      id,
      ...realDataWhere(),
      ...(facultyNames ? { members: { some: { facultyName: { in: facultyNames } } } } : {}),
    },
    select: {
      id: true, titleTh: true, titleEn: true, type: true, typeRaw: true, fiscalYearBe: true, startDate: true,
      endDate: true, budgetThb: true, funderName: true, keywords: true, workflowStatus: true, leadFacultyName: true,
      members: {
        select: { role: true, displayName: true, facultyName: true, facultyMemberId: true },
        orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      },
    },
  });
  if (!p) return null;
  return {
    id: p.id, titleTh: p.titleTh, titleEn: p.titleEn, type: p.type, typeRaw: p.typeRaw, fiscalYearBe: p.fiscalYearBe,
    startDate: bangkokDay(p.startDate), endDate: bangkokDay(p.endDate), budgetThb: num(p.budgetThb),
    funderName: p.funderName, keywords: p.keywords, workflowStatus: p.workflowStatus, leadFacultyName: p.leadFacultyName,
    team: p.members.map((m) => ({ role: m.role, displayName: m.displayName, facultyName: m.facultyName, matched: !!m.facultyMemberId })),
  };
}

function bangkokDay(d: Date | null): string | null {
  return d ? new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10) : null;
}

export function toStaffGrantEntry(r: GrantProjectRow, role: 'LEAD' | 'CO_INVESTIGATOR'): StaffGrantEntry {
  return {
    sourceProposalId: r.sourceProposalId,
    titleTh: r.titleTh,
    titleEn: r.titleEn,
    type: r.type,
    role,
    fiscalYearBe: r.fiscalYearBe,
    startDate: bangkokDay(r.startDate),
    endDate: bangkokDay(r.endDate),
    funderName: r.funderName,
    budgetThb: num(r.budgetThb),
    workflowStatus: r.workflowStatus,
    teamSize: r.members.length,
  };
}

/** One staff member's grants. Callers enforce visibility: /profile passes the
 *  session user's own record; the external API calls it only for clients
 *  granted the `grants` section. */
export async function getStaffGrants(facultyMemberId: string): Promise<StaffGrantsSummary> {
  const [memberships, fresh] = await Promise.all([
    prisma.researchServiceProjectMember.findMany({
      where: { facultyMemberId, ...realDataWhere() },
      select: { role: true, project: { select: PROJECT_SELECT } },
    }),
    grantsFreshness(),
  ]);
  return summariseStaffGrants(
    memberships.map((m) => toStaffGrantEntry(m.project, m.role)),
    new Date(),
    fresh?.completedAt.toISOString() ?? null,
  );
}
```

- [ ] **Step 4: Export.** In `packages/db/src/index.ts` add `export * from './research-services';` next to the other module exports. In `packages/db/src/staff-profile/index.ts` add `export { getStaffGrants } from '../research-services';`.

- [ ] **Step 5: Run the tests and typecheck.** `pnpm --filter @kku/db test -- research-services && pnpm --filter @kku/db typecheck`. Expected: PASS. If `groupBy`'s `orderBy: { _count: { funderName: 'desc' } }` fails typecheck on this Prisma version, replace it with a `findMany({ select: { funderName: true } })` and count in memory.

- [ ] **Step 6: Commit.** `feat(db): grants read model — dashboard aggregation, project detail, person loader`

---

### Task 7: API endpoints

**Files:**
- Create: `apps/api/src/staff-dashboard/grants.service.ts`
- Modify: `apps/api/src/staff-dashboard/staff.controller.ts`, `apps/api/src/staff-dashboard/staff.module.ts`
- Test: `apps/api/test/staff-grants-service.test.ts`

- [ ] **Step 1: Write the failing test** `apps/api/test/staff-grants-service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@kku/db', () => ({
  grantsFreshness: vi.fn(async () => ({ runId: 'run-9', completedAt: new Date('2026-10-02T04:00:00Z') })),
  getGrantsDashboard: vi.fn(async () => ({
    kpis: { projects: 1, budgetThb: 1, staffInvolved: 1, membersTotal: 2, membersMatched: 1 },
    trend: [], byFaculty: [], topFunders: [], table: { total: 1, page: 1, pageSize: 50, rows: [] },
    options: { yearMin: 2558, yearMax: 2570, funders: [] },
  })),
  getGrantProjectDetail: vi.fn(async () => null),
}));

import { GrantsService } from '../src/staff-dashboard/grants.service';

describe('GrantsService', () => {
  it('returns data with provenance meta: freshness, source, caveats incl. the non-additive faculty note', async () => {
    const svc = new GrantsService();
    const r = await svc.dashboard({ facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    expect(r.meta.freshnessDate).toBe('2026-10-02T04:00:00.000Z');
    expect(r.meta.sources[0]!.id).toBe('kku-research-services');
    expect(r.meta.caveats!.join(' ')).toMatch(/more than the KKU total/);
    expect(r.meta.caveats!.join(' ')).toMatch(/not split/);
    expect(r.meta.methodologyParameters).toEqual([{ label: 'Staff matched to HR records', value: '1 of 2 team members (50%)' }]);
  });

  it('turns a missing or out-of-scope project into NOT_FOUND', async () => {
    const svc = new GrantsService();
    await expect(svc.detail('rsp-1', null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `pnpm --filter api test -- staff-grants-service`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `apps/api/src/staff-dashboard/grants.service.ts`. First confirm the `ApiError` import path the other services use; this plan assumes `@kku/shared`.

```ts
import { Injectable, Optional } from '@nestjs/common';
import {
  getGrantProjectDetail,
  getGrantsDashboard,
  grantsFreshness,
  type GrantsFilter,
} from '@kku/db';
import { ApiError, type ApiMeta } from '@kku/shared';
import { CacheService } from '../common/cache.service';

const SOURCE = { id: 'kku-research-services', name: 'KKU Research & Academic Services (external grants)' };
const CAVEATS = [
  'Faculty figures count a project for every faculty with a team member on it, so they add up to more than the KKU total.',
  'Budget is the whole project budget. It is not split between team members or faculties.',
  'Covers externally funded projects only (ทุนภายนอก). วิทยาลัยการปกครองท้องถิ่น holds about a third of all projects, mostly small academic-service projects — compare money as well as counts.',
  'Staff are matched to HR records by citizen-id hash or email (leads) and HR employee id (co-investigators); unmatched people still count in project totals.',
];

@Injectable()
export class GrantsService {
  constructor(@Optional() private readonly cache?: CacheService) {}

  async dashboard(f: GrantsFilter) {
    const fresh = await grantsFreshness();
    // The run id is in the key, so the next daily sync invalidates every entry.
    const key = CacheService.keyOf('staff:grants-v1', { ...f, run: fresh?.runId ?? 'none' });
    const cached = await this.cache?.get<Awaited<ReturnType<typeof getGrantsDashboard>>>(key);
    const data = cached ?? (await getGrantsDashboard(f));
    if (!cached) await this.cache?.set(key, data, 60 * 30);
    const { membersMatched, membersTotal } = data.kpis;
    const pct = membersTotal ? Math.round((membersMatched / membersTotal) * 100) : 0;
    const meta: Partial<ApiMeta> = {
      freshnessDate: fresh?.completedAt.toISOString() ?? null,
      sources: [SOURCE],
      caveats: CAVEATS,
      methodologyParameters: [
        { label: 'Staff matched to HR records', value: `${membersMatched} of ${membersTotal} team members (${pct}%)` },
      ],
    };
    return { data, meta };
  }

  async detail(id: string, facultyNames: string[] | null) {
    const [d, fresh] = await Promise.all([getGrantProjectDetail(id, facultyNames), grantsFreshness()]);
    if (!d) throw new ApiError('NOT_FOUND', 'Project not found');
    return { data: d, meta: { freshnessDate: fresh?.completedAt.toISOString() ?? null, sources: [SOURCE], caveats: CAVEATS } };
  }
}
```

- [ ] **Step 4: Wire the controller.** In `staff.controller.ts`:
- Add `import { GrantsService } from './grants.service';` and inject `private readonly grants: GrantsService` in the constructor.
- Add `'kku-research-services'` to `STAFF_REFRESH_SLUGS`, so the hub refresh can include it.
- Add the schema below next to `ResearchFilterSchema`, and the two handlers after `research()`:

```ts
const GrantTypeArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): Array<'RESEARCH' | 'ACADEMIC_SERVICE' | 'CONSULTING' | 'OTHER'> => {
    const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return arr.filter((x): x is 'RESEARCH' | 'ACADEMIC_SERVICE' | 'CONSULTING' | 'OTHER' =>
      ['RESEARCH', 'ACADEMIC_SERVICE', 'CONSULTING', 'OTHER'].includes(x));
  });

const beYear = z.coerce.number().int().min(2500).max(2700).optional();

const GrantsFilterSchema = z.object({
  facultyName: StringArray,
  yearFrom: beYear,
  yearTo: beYear,
  type: GrantTypeArray,
  funder: StringArray,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  sort: z.enum(['year', 'budget', 'title']).default('year'),
});
```

```ts
  @Get('grants')
  @Authorized('institution:read:dashboard')
  async grantsDashboard(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(GrantsFilterSchema)) q: z.infer<typeof GrantsFilterSchema>,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    return this.grants.dashboard(clamped ?? { ...q, facultyName: ['__none__'] });
  }

  @Get('grants/:id')
  @Authorized('institution:read:dashboard')
  async grantDetail(@AuthSession() user: SessionUser, @Param('id') id: string) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter({ facultyName: [] as string[] }, user);
    // all-scope → clamp returns the filter unchanged (empty) → no restriction.
    const names = clamped === null ? ['__none__'] : clamped.facultyName.length > 0 ? clamped.facultyName : null;
    return this.grants.detail(id, names);
  }
```

Add `Param` to the `@nestjs/common` import. In `staff.module.ts`, add `GrantsService` to `providers` and import it.

> Check against `scope-guards.ts`: `clampFacultyNameFilter` returns the filter **unchanged** for `mode === 'all'`. So an empty `facultyName` means "no restriction" for admins, and the user's granted list otherwise. That is exactly what `names` encodes.

- [ ] **Step 5: Run the tests and typecheck.** `pnpm --filter api test -- staff-grants-service && pnpm --filter api typecheck`. Expected: PASS.

- [ ] **Step 6: Commit.** `feat(api): staff grants dashboard and project detail endpoints`

---

### Task 8: Staff dashboard UI

**Files:**
- Create: `apps/web/app/staff/grants/page.tsx`, `apps/web/app/staff/grants/client.tsx`
- Modify: `apps/web/app/staff/types.ts`, `apps/web/app/staff/page.tsx`, `apps/web/app/staff/thumbnails.tsx`, `apps/web/src/components/data-source-mark.tsx`, `apps/web/app/docs/acknowledgements/registry.tsx`

- [ ] **Step 1: Write the failing test** `apps/web/test/staff-grants-page.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_SOURCE_MARKS } from '../src/components/data-source-mark';
import { ACKNOWLEDGEMENTS } from '../app/docs/acknowledgements/registry';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('staff grants dashboard', () => {
  it('has a hub tile', () => {
    expect(read('app/staff/page.tsx')).toContain("href: '/staff/grants'");
  });

  it('marks the source and acknowledges it', () => {
    expect(Object.keys(DATA_SOURCE_MARKS)).toContain('kku-research-services');
    expect(ACKNOWLEDGEMENTS.some((a) => a.slug === 'kku-research-services')).toBe(true);
  });

  it('every chart block carries provenance and freshness, and the page says faculty counts overlap', () => {
    const src = read('app/staff/grants/client.tsx');
    expect((src.match(/<ProvenanceButton/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(src).toContain('<FreshnessBadge');
    expect(src).toContain('<DataSourceMark source="kku-research-services"');
    expect(src).toContain('add up to more than the KKU total');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `pnpm --filter web test -- staff-grants-page`. Expected: FAIL.

- [ ] **Step 3: Add the source mark and acknowledgement.**
- In `data-source-mark.tsx`, widen `DataSourceMarkSlug` to `'jobthai' | 'job-108' | 'kku-research-services'`.
- Add `'kku-research-services': { name: 'KKU Research Services' },` to `DATA_SOURCE_MARKS`. There is no logo asset, so it renders as the text chip.

In `registry.tsx`, append to `ENTRIES`:

```tsx
  {
    slug: 'kku-research-services',
    kind: 'data-provider',
    name: 'KKU Research Administration',
    logo: 'kku-research-services',
    since: '2026-10-02',
    contributes: {
      en: 'Externally funded research and academic-service projects, with their leads and co-investigators — the platform’s view of the grants KKU staff win.',
      th: 'ข้อมูลโครงการวิจัยและบริการวิชาการที่ได้รับทุนภายนอก พร้อมหัวหน้าและผู้ร่วมโครงการ — มุมมองของระบบต่อทุนที่บุคลากร มข. ได้รับ',
    },
    body: {
      en: (
        <>
          <p>
            Khon Kaen University’s Research Administration maintains the Research and Academic Services system, whose
            record of externally funded projects lets Program Landscape show what research and service work each faculty
            and each staff member carries.
          </p>
          <p>
            The data is synchronised daily. A project counts for every faculty with a team member on it, and its budget is
            always shown as the whole project’s budget, never divided between people.
          </p>
        </>
      ),
      th: (
        <>
          <p>
            มหาวิทยาลัยขอนแก่นขอขอบคุณกองบริหารงานวิจัย ผู้ดูแลระบบงานวิจัยและบริการวิชาการ ซึ่งบันทึกโครงการที่ได้รับทุนภายนอก
            ทำให้ Program Landscape แสดงภาระงานวิจัยและบริการวิชาการของแต่ละคณะและบุคลากรแต่ละคนได้
          </p>
          <p>
            ข้อมูลซิงก์ทุกวัน โครงการหนึ่งนับให้ทุกคณะที่มีสมาชิกร่วมโครงการ และงบประมาณแสดงเป็นงบรวมของโครงการเสมอ ไม่แบ่งตามบุคคล
          </p>
        </>
      ),
    },
  },
```

- [ ] **Step 4: Add the response type** to `apps/web/app/staff/types.ts`. These are type-only imports, so they are client-safe:

```ts
export type { GrantsDashboard, GrantsTableRow, GrantProjectDetail } from '@kku/db';
export type GrantsResponse = import('@kku/db').GrantsDashboard & {
  options: { yearMin: number | null; yearMax: number | null; funders: string[] };
};
```

If `apps/web` type-imports from `@kku/db` elsewhere in client code, keep this. Otherwise copy the interfaces from Task 6 into `types.ts` verbatim; see the memory note "@kku/shared barrel leaks node:crypto".

- [ ] **Step 5: Add the tile and thumb.** In `thumbnails.tsx`, after `ResearchThumb`:

```tsx
export function GrantsThumb() {
  return (
    <Frame>
      {/* Stacked bars: research (accent) over academic service (cool) per year */}
      <g transform="translate(24,96)">
        {[
          [14, 10], [18, 22], [20, 30], [24, 26], [30, 34], [36, 40], [28, 44],
        ].map(([r, s], i) => (
          <g key={i}>
            <rect x={i * 22} y={-(r + s)} width={16} height={s} fill={PALETTE.cool} opacity={0.85} />
            <rect x={i * 22} y={-r} width={16} height={r} fill={PALETTE.accent} opacity={0.9} />
          </g>
        ))}
      </g>
    </Frame>
  );
}
```

In `apps/web/app/staff/page.tsx`, import `GrantsThumb` and an icon (`HandCoins` from `lucide-react`; if that name is not exported by the installed version, use `Landmark`). Add after the research tile:

```tsx
  {
    href: '/staff/grants',
    icon: HandCoins,
    title: 'Research and academic service grants',
    blurb:
      'Externally funded research and academic-service projects won by KKU staff — how many, how much, from which funders, and which faculties take part. A project counts for every faculty on its team; its budget is never split between people.',
    Thumb: GrantsThumb,
  },
```

- [ ] **Step 6: Write the page** `apps/web/app/staff/grants/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type ApiMeta, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { GrantsClient } from './client';
import type { FilterOptions, GrantsResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research and academic service grants — Staff' };

type SP = Record<string, string | string[] | undefined>;
const arr = (v: string | string[] | undefined): string[] => (!v ? [] : Array.isArray(v) ? v : [v]);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const int = (v: string | string[] | undefined) => {
  const raw = one(v);
  return raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
};

export default async function GrantsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const filters = {
    facultyName: arr(sp.facultyName),
    type: arr(sp.type),
    funder: arr(sp.funder),
    yearFrom: int(sp.yearFrom),
    yearTo: int(sp.yearTo),
    page: int(sp.page) ?? 1,
    sort: (one(sp.sort) ?? 'year') as 'year' | 'budget' | 'title',
    project: one(sp.project) ?? null,
  };
  const qs = new URLSearchParams();
  filters.facultyName.forEach((v) => qs.append('facultyName', v));
  filters.type.forEach((v) => qs.append('type', v));
  filters.funder.forEach((v) => qs.append('funder', v));
  if (filters.yearFrom) qs.set('yearFrom', String(filters.yearFrom));
  if (filters.yearTo) qs.set('yearTo', String(filters.yearTo));
  qs.set('page', String(filters.page));
  qs.set('sort', filters.sort);

  let data: GrantsResponse | null = null;
  let meta: ApiMeta | null = null;
  let error: string | null = null;
  try {
    const env = await apiFetchEnvelope<GrantsResponse>(`/staff-dashboard/grants?${qs}`);
    data = env.data;
    meta = env.meta;
  } catch (e) {
    error = (e as Error).message;
  }
  const options = await apiFetch<FilterOptions>('/staff-dashboard/filter-options').catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Research and academic service grants"
        subtitle="Externally funded research and academic-service projects recorded by KKU Research Administration, synced daily. A project counts for every faculty on its team; budgets are whole-project figures, never split between people."
      />
      {data && meta && options ? (
        <GrantsClient data={data} meta={meta} options={options} initialFilters={filters} />
      ) : (
        <DiagnosticEmptyState surface="research and academic service grants" error={error} />
      )}
    </AuthedAppShell>
  );
}
```

Check the `DiagnosticEmptyState` prop types. If `error` expects the `apiFetchSafe` error object rather than a string, use `apiFetchSafe` for the fetch and read `meta` via `apiFetchEnvelope` only on success. Mirror whatever `research/page.tsx` passes.

- [ ] **Step 7: Write the client** `apps/web/app/staff/grants/client.tsx`. It needs these sections. Each section header carries a `ProvenanceButton` and there is one `FreshnessBadge` in the KPI strip.

```tsx
'use client';

// Staff → Research and academic service grants. Evidence-page design language:
// quiet data cards, KPIs first, caveats in the provenance drawer. All numbers
// arrive pre-aggregated from /staff-dashboard/grants; this file only renders.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ApiMeta } from '@kku/shared';
import { Card, FreshnessBadge, ProvenanceButton, RightPanel } from '@kku/ui';
import { DataSourceMark } from '@/components/data-source-mark';
import { startRouteProgress } from '@/components/route-progress';
import { MultiSelectField } from '../multi-select';
import type { FilterOptions, GrantProjectDetail, GrantsResponse } from '../types';

const TYPE_LABEL: Record<string, string> = {
  RESEARCH: 'Research',
  ACADEMIC_SERVICE: 'Academic service',
  CONSULTING: 'Consulting',
  OTHER: 'Other',
};
const thb = (n: number | null) =>
  n === null ? '—' : n >= 1e6 ? `฿${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M` : `฿${n.toLocaleString('en-US')}`;

interface Filters {
  facultyName: string[];
  type: string[];
  funder: string[];
  yearFrom?: number;
  yearTo?: number;
  page: number;
  sort: 'year' | 'budget' | 'title';
  project: string | null;
}

export function GrantsClient({
  data,
  meta,
  options,
  initialFilters,
}: {
  data: GrantsResponse;
  meta: ApiMeta;
  options: FilterOptions;
  initialFilters: Filters;
}) {
  const router = useRouter();
  const push = (next: Partial<Filters>) => {
    const f = { ...initialFilters, page: 1, ...next };
    const qs = new URLSearchParams();
    f.facultyName.forEach((v) => qs.append('facultyName', v));
    f.type.forEach((v) => qs.append('type', v));
    f.funder.forEach((v) => qs.append('funder', v));
    if (f.yearFrom) qs.set('yearFrom', String(f.yearFrom));
    if (f.yearTo) qs.set('yearTo', String(f.yearTo));
    if (f.page > 1) qs.set('page', String(f.page));
    if (f.sort !== 'year') qs.set('sort', f.sort);
    if (f.project) qs.set('project', f.project);
    startRouteProgress();
    router.push(`/staff/grants?${qs}`, { scroll: false });
  };
  const { kpis } = data;
  const coverage = kpis.membersTotal ? Math.round((kpis.membersMatched / kpis.membersTotal) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <Filters data={data} options={options} f={initialFilters} push={push} />

      <section aria-label="Key figures" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Key figures</h2>
          <ProvenanceButton title="Grants — key figures" meta={meta} size="xs" />
          <DataSourceMark source="kku-research-services" href="/docs/acknowledgements#kku-research-services" />
          <span className="ml-auto">
            <FreshnessBadge freshnessDate={meta.freshnessDate} label="grants data" />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Projects" value={kpis.projects.toLocaleString('en-US')} />
          <Kpi label="Total budget" value={thb(kpis.budgetThb)} hint="each project counted once" />
          <Kpi label="Staff involved" value={kpis.staffInvolved.toLocaleString('en-US')} hint="matched to HR records" />
          <Kpi label="Match coverage" value={`${coverage}%`} hint={`${kpis.membersMatched} of ${kpis.membersTotal} team members`} />
        </div>
      </section>

      <Card className="p-4">
        <Header title="By fiscal year" meta={meta} />
        <TrendChart trend={data.trend} />
      </Card>

      <Card className="p-4">
        <Header title="By faculty" meta={meta} />
        <p className="mt-1 text-xs text-text-tertiary">
          A project counts for every faculty with a team member on it, so these rows add up to more than the KKU total.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-text-tertiary">
            <tr>
              <th className="py-1">Faculty</th>
              <th className="py-1 text-right">Led</th>
              <th className="py-1 text-right">Co-investigator only</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.byFaculty.map((r) => (
              <tr key={r.facultyName} className="border-t border-default">
                <td className="py-1">{r.facultyName}</td>
                <td className="py-1 text-right tabular-nums">{r.led}</td>
                <td className="py-1 text-right tabular-nums">{r.coOnly}</td>
                <td className="py-1 text-right tabular-nums font-medium">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <Header title="Top funders" meta={meta} />
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {data.topFunders.map((fu) => (
            <li key={fu.funderName ?? '∅'} className="flex items-baseline justify-between gap-4 border-t border-default py-1">
              <span className={fu.funderName ? '' : 'text-text-tertiary'}>{fu.funderName ?? 'Funder not recorded'}</span>
              <span className="shrink-0 tabular-nums text-text-secondary">
                {fu.projects} projects · {thb(fu.budgetThb)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <Header title="Projects" meta={meta} />
        <ProjectTable data={data} f={initialFilters} push={push} />
      </Card>

      {initialFilters.project ? (
        <ProjectPanel id={initialFilters.project} onClose={() => push({ project: null, page: initialFilters.page })} />
      ) : null}
    </div>
  );
}

function Header({ title, meta }: { title: string; meta: ApiMeta }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <ProvenanceButton title={`Grants — ${title.toLowerCase()}`} meta={meta} size="xs" />
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-xl font-semibold tabular-nums text-text-primary">{value}</span>
      {hint ? <span className="text-xs text-text-tertiary">{hint}</span> : null}
    </Card>
  );
}

function TrendChart({ trend }: { trend: GrantsResponse['trend'] }) {
  if (trend.length === 0) return <p className="mt-3 text-sm text-text-tertiary">No projects match these filters.</p>;
  const W = 640;
  const H = 180;
  const pad = { l: 32, r: 8, t: 8, b: 24 };
  const max = Math.max(...trend.map((t) => t.RESEARCH + t.ACADEMIC_SERVICE + t.OTHER), 1);
  const bw = (W - pad.l - pad.r) / trend.length;
  const y = (v: number) => ((H - pad.t - pad.b) * v) / max;
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Projects per fiscal year by type">
        {trend.map((t, i) => {
          const x = pad.l + i * bw + bw * 0.15;
          const w = bw * 0.7;
          const base = H - pad.b;
          const r = y(t.RESEARCH);
          const s = y(t.ACADEMIC_SERVICE);
          const o = y(t.OTHER);
          return (
            <g key={t.fiscalYearBe}>
              <title>{`FY ${t.fiscalYearBe}: ${t.RESEARCH} research, ${t.ACADEMIC_SERVICE} academic service, ${t.OTHER} other — ${thb(t.budgetThb)}`}</title>
              <rect x={x} y={base - r} width={w} height={r} style={{ fill: 'oklch(var(--color-chart-1))' }} />
              <rect x={x} y={base - r - s} width={w} height={s} style={{ fill: 'oklch(var(--color-chart-3))' }} />
              <rect x={x} y={base - r - s - o} width={w} height={o} style={{ fill: 'oklch(var(--color-chart-6))' }} />
              <text x={x + w / 2} y={H - 8} textAnchor="middle" className="fill-text-tertiary text-[10px] tabular-nums">
                {t.fiscalYearBe}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-text-secondary">
        <Legend color="--color-chart-1" label="Research" />
        <Legend color="--color-chart-3" label="Academic service" />
        <Legend color="--color-chart-6" label="Other" />
        <span className="text-text-tertiary">Fiscal year (BE). Hover a bar for budget.</span>
      </figcaption>
    </figure>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg width={10} height={10} aria-hidden>
        <rect width={10} height={10} style={{ fill: `oklch(var(${color}))` }} />
      </svg>
      {label}
    </span>
  );
}

function ProjectTable({ data, f, push }: { data: GrantsResponse; f: Filters; push: (n: Partial<Filters>) => void }) {
  const { table } = data;
  const pages = Math.max(1, Math.ceil(table.total / table.pageSize));
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        Sort:
        {(['year', 'budget', 'title'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => push({ sort: s })}
            className={s === f.sort ? 'font-semibold text-text-primary' : 'hover:text-text-primary'}
          >
            {s === 'year' ? 'Newest' : s === 'budget' ? 'Budget' : 'Title'}
          </button>
        ))}
        <span className="ml-auto tabular-nums">{table.total.toLocaleString('en-US')} projects</span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-text-tertiary">
          <tr>
            <th className="py-1">Project</th>
            <th className="py-1">Type</th>
            <th className="py-1 text-right">FY</th>
            <th className="py-1">Lead</th>
            <th className="py-1">Funder</th>
            <th className="py-1 text-right">Budget</th>
            <th className="py-1 text-right">Team</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => push({ project: r.id, page: f.page })}
              className="cursor-pointer border-t border-default hover:bg-surface-2"
            >
              <td className="py-1 pr-2">
                <div>{r.titleTh}</div>
                {r.titleEn ? <div className="text-xs text-text-tertiary">{r.titleEn}</div> : null}
              </td>
              <td className="py-1">{TYPE_LABEL[r.type]}</td>
              <td className="py-1 text-right tabular-nums">{r.fiscalYearBe}</td>
              <td className="py-1">
                <div>{r.leadName ?? '—'}</div>
                <div className="text-xs text-text-tertiary">{r.leadFacultyName}</div>
              </td>
              <td className="py-1">{r.funderName ?? <span className="text-text-tertiary">not recorded</span>}</td>
              <td className="py-1 text-right tabular-nums">{thb(r.budgetThb)}</td>
              <td className="py-1 text-right tabular-nums">{r.teamSize}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-end gap-3 text-xs">
        <button type="button" disabled={f.page <= 1} onClick={() => push({ page: f.page - 1 })} className="disabled:opacity-40">
          ← Previous
        </button>
        <span className="tabular-nums text-text-tertiary">
          Page {f.page} of {pages}
        </span>
        <button type="button" disabled={f.page >= pages} onClick={() => push({ page: f.page + 1 })} className="disabled:opacity-40">
          Next →
        </button>
      </div>
    </div>
  );
}

function ProjectPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [state, setState] = React.useState<{ detail: GrantProjectDetail | null; error: string | null }>({ detail: null, error: null });
  React.useEffect(() => {
    let live = true;
    fetch(`/api/staff-grants/${encodeURIComponent(id)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as GrantProjectDetail) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((detail) => live && setState({ detail, error: null }))
      .catch((e: Error) => live && setState({ detail: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [id]);
  const d = state.detail;
  return (
    <RightPanel open onOpenChange={(o) => !o && onClose()} title={d?.titleTh ?? 'Project'}>
      {state.error ? (
        <p className="text-sm text-text-tertiary">This project is unavailable or outside your scope.</p>
      ) : !d ? (
        <div className="h-24 animate-pulse rounded-md bg-surface-2" />
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {d.titleEn ? <p className="text-text-secondary">{d.titleEn}</p> : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-text-tertiary">Type</dt><dd>{d.typeRaw}</dd>
            <dt className="text-text-tertiary">Fiscal year</dt><dd>{d.fiscalYearBe}</dd>
            <dt className="text-text-tertiary">Period</dt><dd>{d.startDate ?? '—'} – {d.endDate ?? '—'}</dd>
            <dt className="text-text-tertiary">Funder</dt><dd>{d.funderName ?? 'not recorded'}</dd>
            <dt className="text-text-tertiary">Budget</dt><dd>{thb(d.budgetThb)} <span className="text-text-tertiary">(project total)</span></dd>
            <dt className="text-text-tertiary">Status</dt><dd>{d.workflowStatus}</dd>
          </dl>
          <h3 className="text-xs font-semibold text-text-tertiary">Team</h3>
          <ul className="flex flex-col gap-1">
            {d.team.map((m, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 border-t border-default py-1">
                <span>
                  {m.displayName ?? 'Name not recorded'}
                  <span className="ml-2 text-xs text-text-tertiary">{m.role === 'LEAD' ? 'Lead' : 'Co-investigator'}</span>
                </span>
                <span className="text-xs text-text-tertiary">{m.facultyName ?? '—'}{m.matched ? '' : ' · not matched'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </RightPanel>
  );
}

function Filters({
  data,
  options,
  f,
  push,
}: {
  data: GrantsResponse;
  options: FilterOptions;
  f: Filters;
  push: (n: Partial<Filters>) => void;
}) {
  const years: number[] = [];
  if (data.options.yearMin && data.options.yearMax) {
    for (let y = data.options.yearMax; y >= data.options.yearMin; y -= 1) years.push(y);
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <MultiSelectField
        label="Faculty"
        options={options.faculties.map((x) => ({ value: x.nameTh, label: x.nameTh }))}
        value={f.facultyName}
        onChange={(v) => push({ facultyName: v })}
      />
      <MultiSelectField
        label="Type"
        options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        value={f.type}
        onChange={(v) => push({ type: v })}
      />
      <MultiSelectField
        label="Funder"
        options={data.options.funders.map((x) => ({ value: x, label: x }))}
        value={f.funder}
        onChange={(v) => push({ funder: v })}
      />
      <label className="flex flex-col gap-1 text-xs text-text-tertiary">
        From FY
        <select
          value={f.yearFrom ?? ''}
          onChange={(e) => push({ yearFrom: e.target.value ? Number(e.target.value) : undefined })}
          className="rounded-md border border-default bg-surface-1 px-2 py-1 text-sm text-text-primary"
        >
          <option value="">Any</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-tertiary">
        To FY
        <select
          value={f.yearTo ?? ''}
          onChange={(e) => push({ yearTo: e.target.value ? Number(e.target.value) : undefined })}
          className="rounded-md border border-default bg-surface-1 px-2 py-1 text-sm text-text-primary"
        >
          <option value="">Any</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
    </div>
  );
}
```

**Before writing, read** `apps/web/app/staff/multi-select.tsx` and `FilterOptions` in `../types`, and adapt the `MultiSelectField` props and faculty option field names to what they actually are. Also read `RightPanel`'s props in `packages/ui`. The shapes above are the intent.

- [ ] **Step 8: Add the detail proxy route.** The panel fetches client-side, so add `apps/web/app/api/staff-grants/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const detail = await apiFetch(`/staff-dashboard/grants/${encodeURIComponent(id)}`);
    return NextResponse.json(detail);
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
```

If the web app already proxies api calls for client components another way, such as server actions in `apps/web/src/lib/actions/`, use that pattern instead. Grep `src/lib/actions` for a staff example.

- [ ] **Step 9: Run the test, typecheck and lint.** `pnpm --filter web test -- staff-grants-page acknowledgements-registry && pnpm --filter web typecheck && pnpm --filter web exec eslint app/staff/grants src/components/data-source-mark.tsx`. Expected: PASS, no lint errors (no hex literals).

- [ ] **Step 10: Commit.** `feat(web): staff grants dashboard`

---

### Task 9: `/profile` grants panel

**Files:**
- Create: `apps/web/app/profile/grants-panel.tsx`
- Modify: `apps/web/src/lib/profile-data.ts`, `apps/web/app/profile/page.tsx`, `apps/web/app/profile/profile-view.tsx`
- Test: `apps/web/test/profile-grants-panel.test.tsx`

- [ ] **Step 1: Write the failing test** `apps/web/test/profile-grants-panel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StaffGrantsSummary } from '@kku/shared';
import { GrantsPanel } from '../app/profile/grants-panel';

const summary = (over: Partial<StaffGrantsSummary> = {}): StaffGrantsSummary => ({
  led: 1, coInvestigator: 1, active: 1,
  byType: { RESEARCH: 1, ACADEMIC_SERVICE: 1, CONSULTING: 0, OTHER: 0 },
  projects: [
    { sourceProposalId: 1, titleTh: 'โครงการหนึ่ง', titleEn: 'Project one', type: 'RESEARCH', role: 'LEAD', fiscalYearBe: 2569,
      startDate: '2025-10-01', endDate: '2026-09-30', funderName: 'วช.', budgetThb: 1500000, workflowStatus: 'x', teamSize: 3 },
  ],
  freshnessDate: '2026-10-02T04:00:00.000Z',
  ...over,
});

describe('GrantsPanel', () => {
  it('shows KPIs and labels the budget as the project total', () => {
    const html = renderToStaticMarkup(<GrantsPanel state={summary()} lang="en" />);
    expect(html).toContain('Led');
    expect(html).toContain('project total');
    expect(html).toContain('โครงการหนึ่ง');
  });

  it('says plainly when the person is not linked, has no projects, or the read failed', () => {
    expect(renderToStaticMarkup(<GrantsPanel state="unlinked" lang="en" />)).toContain("couldn't link you");
    expect(renderToStaticMarkup(<GrantsPanel state={summary({ projects: [], led: 0, coInvestigator: 0, active: 0 })} lang="en" />)).toContain(
      'No external grants on record',
    );
    expect(renderToStaticMarkup(<GrantsPanel state="unavailable" lang="en" />)).toContain('unavailable');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `pnpm --filter web test -- profile-grants-panel`. Expected: FAIL.

- [ ] **Step 3: Implement** `apps/web/app/profile/grants-panel.tsx`:

```tsx
'use client';

// "Grants & academic service" on the owner's own /profile — never on /p/[slug].
// Summarised server-side by summariseStaffGrants(); this file only renders.
// Budgets are whole-project figures: the source states no per-person share.

import * as React from 'react';
import { HandCoins } from 'lucide-react';
import type { StaffGrantsSummary } from '@kku/shared';
import { Card, FreshnessBadge, ProvenanceButton, Section } from '@kku/ui';

type Lang = 'th' | 'en';
export type GrantsPanelState = StaffGrantsSummary | 'unlinked' | 'unavailable';

const L = {
  en: {
    title: 'Grants & academic service',
    led: 'Led',
    co: 'Co-investigator',
    active: 'Active now',
    lead: 'Lead',
    projectTotal: 'project total',
    types: { RESEARCH: 'Research', ACADEMIC_SERVICE: 'Academic service', CONSULTING: 'Consulting', OTHER: 'Other' },
    fy: (y: number) => `FY ${y}`,
    unlinked: "We couldn't link you to the grants system.",
    empty: 'No external grants on record.',
    unavailable: 'Grants are temporarily unavailable.',
    source: 'KKU Research & Academic Services (external grants)',
    caveats: [
      'Budget is the whole project budget, not your share.',
      'Externally funded projects only (ทุนภายนอก). Synced daily from KKU Research Administration.',
    ],
  },
  th: {
    title: 'ทุนวิจัยและบริการวิชาการ',
    led: 'หัวหน้าโครงการ',
    co: 'ผู้ร่วมโครงการ',
    active: 'กำลังดำเนินการ',
    lead: 'หัวหน้า',
    projectTotal: 'งบรวมโครงการ',
    types: { RESEARCH: 'วิจัย', ACADEMIC_SERVICE: 'บริการวิชาการ', CONSULTING: 'ที่ปรึกษา', OTHER: 'อื่นๆ' },
    fy: (y: number) => `ปีงบ ${y}`,
    unlinked: 'ไม่สามารถเชื่อมโยงคุณกับระบบทุนวิจัยได้',
    empty: 'ไม่มีข้อมูลทุนภายนอก',
    unavailable: 'ข้อมูลทุนไม่พร้อมใช้งานชั่วคราว',
    source: 'ระบบงานวิจัยและบริการวิชาการ มข. (ทุนภายนอก)',
    caveats: ['งบประมาณเป็นงบรวมของโครงการ ไม่ใช่ส่วนของคุณ', 'เฉพาะโครงการทุนภายนอก ซิงก์ทุกวันจากกองบริหารงานวิจัย'],
  },
} as const;

const thb = (n: number | null) => (n === null ? '—' : `฿${n.toLocaleString('en-US')}`);

export function GrantsPanel({ state, lang }: { state: GrantsPanelState; lang: Lang }) {
  const t = L[lang];
  const meta = {
    freshnessDate: typeof state === 'object' ? state.freshnessDate : null,
    sources: [{ id: 'kku-research-services', name: t.source }],
    caveats: [...t.caveats],
  };
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <HandCoins className="size-icon-md" aria-hidden />
          {t.title}
          <ProvenanceButton title={t.title} meta={meta} size="xs" />
        </span>
      }
      actions={typeof state === 'object' ? <FreshnessBadge freshnessDate={state.freshnessDate} label={t.title} /> : null}
    >
      <Card className="p-4">
        {state === 'unlinked' ? (
          <p className="text-sm text-text-tertiary">{t.unlinked}</p>
        ) : state === 'unavailable' ? (
          <p className="text-sm text-text-tertiary">{t.unavailable}</p>
        ) : state.projects.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t.empty}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t.led} value={state.led} />
              <Stat label={t.co} value={state.coInvestigator} />
              <Stat label={t.active} value={state.active} />
            </div>
            <ul className="flex flex-col">
              {state.projects.map((p) => (
                <li key={p.sourceProposalId} className="flex flex-col gap-1 border-t border-default py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{p.role === 'LEAD' ? t.lead : t.co}</span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{t.types[p.type]}</span>
                    <span className="text-text-tertiary">{t.fy(p.fiscalYearBe)}</span>
                  </div>
                  <div className="text-sm text-text-primary">{p.titleTh}</div>
                  {p.titleEn ? <div className="text-xs text-text-tertiary">{p.titleEn}</div> : null}
                  <div className="flex flex-wrap justify-between gap-x-4 text-xs text-text-secondary">
                    <span>
                      {p.funderName ?? '—'}
                      {p.startDate && p.endDate ? ` · ${p.startDate} – ${p.endDate}` : ''}
                    </span>
                    <span className="tabular-nums">
                      {thb(p.budgetThb)} <span className="text-text-tertiary">({t.projectTotal})</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-text-primary">{value}</span>
    </div>
  );
}
```

Read how `teaching-evaluation-panel.tsx` uses `Section` (its prop names, e.g. `title`/`actions`/`icon`) and match them exactly; adjust the JSX above if `Section` takes different props.

- [ ] **Step 4: Add the loader** in `apps/web/src/lib/profile-data.ts`, beside `getMyTeachingEvaluation`:

```ts
/** The signed-in user's own grants for the /profile panel. Server-only; never
 *  called for /p/[slug]. 'unlinked' when the account resolves to no staff record. */
export async function getMyGrants(userId: string): Promise<StaffGrantsSummary | 'unlinked'> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true, name: true } });
  if (!user) return 'unlinked';
  const memberId = await resolveFacultyMemberForUser(user);
  if (!memberId) return 'unlinked';
  return getStaffGrants(memberId);
}
```

Import `getStaffGrants` from `@kku/db` and `type StaffGrantsSummary` from `@kku/shared`, following the file's existing imports.

- [ ] **Step 5: Load it on the page.** In `apps/web/app/profile/page.tsx`, add a fifth entry to the `Promise.all` and destructure it as `grants`:

```ts
    getMyGrants(user.userId).catch((err: unknown) => {
      const name = err instanceof Error ? err.name : typeof err;
      const code =
        typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : null;
      console.error(`[profile] grants read failed: ${name}${code ? ` (${code})` : ''}`);
      return 'unavailable' as const;
    }),
```

Pass `grants={grants}` to `<ProfileView>` beside `teachingEvaluation={teachingEvaluation}`.

- [ ] **Step 6: Render it.** In `profile-view.tsx`:
- Add the prop `grants?: GrantsPanelState` with default `grants = 'unavailable'`.
- Import `GrantsPanel, type GrantsPanelState` from `./grants-panel`.
- Inside the existing `!publicMode && profile.hasFacultyMemberRecord` fragment, after `<TeachingEvaluationPanel …/>`, add `<GrantsPanel state={grants} lang={lang} />`.

- [ ] **Step 7: Run the tests and typecheck.** `pnpm --filter web test -- profile-grants-panel && pnpm --filter web typecheck`. Expected: PASS.

- [ ] **Step 8: Commit.** `feat(profile): owner-only grants and academic service panel`

---

### Task 10: External API `grants` section

**Files:**
- Modify: `apps/api/src/external/staff-profile.mapper.ts`, `apps/api/src/external/staff-profile.service.ts`, `apps/web/app/admin/external/api-clients/client.tsx`
- Test: `apps/api/test/staff-profile-mapper.test.ts`, `apps/api/test/staff-profile-service.test.ts`, `apps/web/test/api-clients-client-safe.test.ts`

- [ ] **Step 1: Write the failing mapper tests.** Append to `apps/api/test/staff-profile-mapper.test.ts`, and add `'grants'` to its `ALL` array:

```ts
const grants = (): StaffGrantsSummary => ({
  led: 1, coInvestigator: 0, active: 0,
  byType: { RESEARCH: 1, ACADEMIC_SERVICE: 0, CONSULTING: 0, OTHER: 0 },
  projects: [{ sourceProposalId: 9, titleTh: 'ก', titleEn: null, type: 'RESEARCH', role: 'LEAD', fiscalYearBe: 2568,
    startDate: null, endDate: null, funderName: null, budgetThb: 10, workflowStatus: 's', teamSize: 2 }],
  freshnessDate: '2026-10-02T04:00:00.000Z',
});

it('maps granted grants without freshness, and the result satisfies the wire schema', () => {
  const r = toStaffProfileResponse(staffProfileFixture(), grant(['grants']), { grants: grants() });
  expect(StaffProfileResponseDataSchema.safeParse(r.data).success).toBe(true);
  expect(r.data.grants!.projects[0]!.sourceProposalId).toBe(9);
  expect(r.data.grants).not.toHaveProperty('freshnessDate');
  expect(r.included).toContain('grants');
});

it('refuses a granted grants section that was never loaded', () => {
  expect(() => toStaffProfileResponse(staffProfileFixture(), grant(['grants']))).toThrow(/grants is granted/);
});

it('withholds grants by default', () => {
  expect(toStaffProfileResponse(staffProfileFixture(), grant(['education'])).withheld).toContain('grants');
});
```

Add `type StaffGrantsSummary` to the test's `@kku/shared` import. Update the `withheld` expectation in the existing "returns only granted sections" test to end with `'teachingEvaluation', 'grants'`.

- [ ] **Step 2: Run them and confirm they fail.** `pnpm --filter api test -- staff-profile-mapper`. Expected: FAIL.

- [ ] **Step 3: Implement in the mapper.**
- Add `grants?: StaffGrantsSummary;` to `StaffProfileExtras`, with the comment `/** Always an object when granted — empty lists when nothing is on record. */`.
- Import `type StaffGrantsSummary` from `@kku/shared`.
- After the `teachingEvaluation` block, add:

```ts
  if (granted.has('grants')) {
    if (extras.grants === undefined) {
      throw new Error('grants is granted but was not loaded');
    }
    const { freshnessDate: _fresh, ...wire } = extras.grants;
    data.grants = wire;
  }
```

- [ ] **Step 4: Implement in the service** `staff-profile.service.ts`.
- Import `getStaffGrants` from `@kku/db` and `type StaffGrantsSummary` from `@kku/shared`.
- Add the constants below, an in-flight map `private readonly grantsInFlight = new Map<string, Promise<StaffGrantsSummary>>();`, and `grantsOnce()` mirroring `evaluationOnce`.

```ts
/** Said only when the grants section is actually returned. */
const GRANTS_CAVEATS = [
  'grants.projects[].budgetThb is the whole project budget, not this person\'s share.',
  'grants covers externally funded projects recorded in the KKU Research and Academic Services system, synced daily.',
];
const GRANTS_SOURCE = { id: 'kku-research-services', name: 'KKU Research & Academic Services (external grants)' };
```

```ts
  private grantsOnce(facultyMemberId: string): Promise<StaffGrantsSummary> {
    const existing = this.grantsInFlight.get(facultyMemberId);
    if (existing) return existing;
    const p = getStaffGrants(facultyMemberId).finally(() => this.grantsInFlight.delete(facultyMemberId));
    this.grantsInFlight.set(facultyMemberId, p);
    return p;
  }
```

In the request handler, beside the evaluation lines:

```ts
      const wantsGrants = client.allowedSections.includes('grants');
      const grantsP = facultyMemberId && wantsGrants ? this.grantsOnce(facultyMemberId) : undefined;
      grantsP?.catch(() => undefined);
```

Change `extras` to:

```ts
      const extras = {
        ...(evaluation ? { teachingEvaluation: await evaluation } : {}),
        ...(grantsP ? { grants: await grantsP } : {}),
      };
```

Build sources and caveats from what was returned:

```ts
      const grantsReturned = mapped.included.includes('grants');
      const sources = [...BASE_SOURCES, ...(evaluationReturned ? [EVALUATION_SOURCE] : []), ...(grantsReturned ? [GRANTS_SOURCE] : [])];
      const caveats = [...CAVEATS, ...(evaluationReturned ? EVALUATION_CAVEATS : []), ...(grantsReturned ? GRANTS_CAVEATS : [])];
```

Use `sources` and `caveats` in `meta` in place of the two ternaries.

- [ ] **Step 5: Add the service tests.** In `apps/api/test/staff-profile-service.test.ts`, follow the existing teachingEvaluation cases:
- Mock `getStaffGrants` in the `@kku/db` mock.
- A client granted `grants` gets `data.grants`, `meta.sources` containing `kku-research-services`, and a caveat matching `/not this person's share/`.
- A client not granted it never calls `getStaffGrants`.
- A granted `getStaffGrants` rejection yields a 500, not a missing section.

Copy the exact structure of the three existing teachingEvaluation tests in that file, substituting names.

- [ ] **Step 6: Add the admin checkbox.** In `apps/web/app/admin/external/api-clients/client.tsx`:
- Add the constant `const GRANTS_GRANT_NOTE = 'Funding records about the person — grant only to systems with a recorded basis for it.';`.
- Change the main list filter to `.filter((s) => s !== 'teachingEvaluation' && s !== 'grants')`.
- After the teachingEvaluation `<div>`, add:

```tsx
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
          <Check
            label={STAFF_PROFILE_SECTION_LABELS.grants}
            wireKey="grants"
            checked={draft.sections.includes('grants')}
            onChange={() => toggleSection('grants')}
          />
          <span className="text-xs text-warning">{GRANTS_GRANT_NOTE}</span>
        </div>
```

In `apps/web/test/api-clients-client-safe.test.ts`, add:

```ts
  it('offers grants as its own opt-in', () => {
    expect(src).toContain("toggleSection('grants')");
    expect(src).toContain('Funding records about the person — grant only to systems with a recorded basis for it.');
  });
```

- [ ] **Step 7: Run the tests.** `pnpm --filter api test -- staff-profile && pnpm --filter web test -- api-clients-client-safe && pnpm --filter api typecheck`. Expected: PASS.

- [ ] **Step 8: Commit.** `feat(api): staff profiles can carry grants, for clients granted them`

---

### Task 11: DSAR coverage

**Files:**
- Modify: `scripts/pdpa/dsar-dump.ts`
- Test: `packages/db/test/dsar-dump.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `packages/db/test/dsar-dump.test.ts`, inside `describe('dumpByCitizenHash', …)`:

```ts
  it('includes grant memberships found by the lead hash or through the staff records', async () => {
    const { db, model } = stubDb({
      facultyMember: { findMany: vi.fn(async () => [{ id: 'fm1' }]) },
      researchServiceProjectMember: { findMany: vi.fn(async () => [{ id: 'g1' }]) },
    });
    const out = await dumpByCitizenHash(db, 'abc');
    expect(model('researchServiceProjectMember').findMany).toHaveBeenCalledWith({
      where: { OR: [{ citizenIdHash: 'abc' }, { facultyMemberId: { in: ['fm1'] } }] },
      orderBy: { id: 'asc' },
      include: { project: true },
    });
    expect(out.researchServiceProjectMembers).toEqual([{ id: 'g1' }]);
  });
```

- [ ] **Step 2: Run it and confirm it fails.** `pnpm --filter @kku/db test -- dsar-dump`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `dumpByCitizenHash`, after `byStaffRecord` is computed:

```ts
  // Grant memberships: the lead row carries the hash; a co-investigator row is
  // reachable only through the staff record it was matched to.
  const researchServiceProjectMembers = await db.researchServiceProjectMember.findMany({
    where: { OR: [{ citizenIdHash: hash }, { facultyMemberId: { in: facultyMembers.map((m) => m.id) } }] },
    orderBy: { id: 'asc' },
    include: { project: true },
  });
```

Add `researchServiceProjectMembers` to the returned object. Update the header comment: `// ── Hash-keyed dump (covers HR / staff / DS2003 / lifecycle / grants) ──`.

- [ ] **Step 4: Run the test.** `pnpm --filter @kku/db test -- dsar-dump`. Expected: PASS.

- [ ] **Step 5: Commit.** `fix(pdpa): DSAR export includes research-service grant memberships`

---

### Task 12: Documentation

**Files:**
- Create: `docs/data-sources/kku-research-services.md`
- Modify: `docs/data-sources/README.md`, `docs/pdpa.md`, `docs/integrations/staff-profile-api.md`

- [ ] **Step 1: Write the source spec** `docs/data-sources/kku-research-services.md`. Base the sections on spec §2 and §5, using the numbers measured in Task 5:
- **Source:** host, MySQL 5.7, the two views, read-only login, env keys.
- **Columns read**, with the PDPA note: lead citizen id hashed in SQL, email used for matching and not stored.
- **Cadence:** daily 04:00 snapshot replace in one transaction, plus the 50 % shrink guard.
- **Matching:** method and measured rates.
- **Caveats:**
  - College of Local Government skew;
  - the ~448 co-investigator rows outside the view;
  - `acro`/`pmu_okr` unknown, especially whether `ซ้ำPMU` marks duplicates;
  - external funding only;
  - faculty counts sum to more than the KKU total;
  - budget is never split.
- **Open questions for KKU Research Administration** (spec §13).
- **Session log:** `2026-10-02 — flipped real on dev; 3 SUCCEEDED runs`.

- [ ] **Step 2: Add the row** to `docs/data-sources/README.md`'s source table, following its existing row format: slug, name, phase A (internal), status real.

- [ ] **Step 3: Update `docs/pdpa.md`.** Next to the `teachingEvaluation` entry near line 239, add a section covering:
- what is stored (project metadata, member display names, the lead's citizen-id hash, HR match);
- the legal basis to record before granting the `grants` API section;
- that hash columns are PII-class and never leave the server;
- that the DSAR export includes grant memberships;
- retention: snapshot replace, no history.

- [ ] **Step 4: Update `docs/integrations/staff-profile-api.md`.** Add a `grants` section reference: its fields (from the Task 2 schema), "opt-in, never granted by default", the budget-is-project-total caveat, and that it is an empty object (not null) when nothing is on record.

- [ ] **Step 5: Commit.** `docs: kku-research-services source, PDPA posture, staff-profile API grants section`

---

### Task 13: Full verification on dev

- [ ] **Step 1: Repo checks.** Run `pnpm typecheck` and `pnpm test`.
- Expected: green, apart from the known pre-existing failure `usage-action-coverage.test.ts`, which has 4 unclassified audit actions.
- Report any other failure with its output; do not hide it.
- Then run lint on the changed files only: `pnpm exec eslint $(git diff --name-only main~13 -- '*.ts' '*.tsx')`. Adjust the range to the task commits.

- [ ] **Step 2: Restart the dev servers.** Package changes do not hot-reload. Hand the operator `! pnpm dev`, after stopping the old processes by explicit PID (`ss -ltnp` to find the listeners on `:3000`/`:4000`).

- [ ] **Step 3: Check the dashboard.**
- **As admin:** open `/staff/grants`. The KPI total should be about 4,291 projects. The faculty table should carry the note that faculty rows add up to more than the KKU total.
- **Filters:** Type = Research should show about 1,193.
- **Side panel:** open a row; it shows the team.
- **Provenance drawer:** shows the source, caveats and the match-coverage parameter.
- **As a FACULTY_USER:** only their faculty, and a project outside it returns "outside your scope".

- [ ] **Step 4: Check `/profile`.** For denpong, the grants panel shows below Teaching evaluation, with the right state. `/p/<slug>` does not show it.

- [ ] **Step 5: Check the API on `:4000`.**
- Grant a test client `grants` at `/admin/external/api-clients` and POST `{"email": "<a staff email with grants>"}` with its key.
- Expected: `data.grants` is present, and `meta.sources` includes `kku-research-services`.
- Remove the grant and repeat: `grants` is listed in `meta.integration.sectionsWithheld`.

- [ ] **Step 6: Report.** List what passed, what was skipped and why, and the measured match rates. Remind the operator of the pre-deploy items:
- prod `.env.prod` needs the `KKU_RESEARCH_SERVICES_DB_*` keys and `CONNECTOR_KKU_RESEARCH_SERVICES_MODE=real`;
- confirm the prod ingestion container reaches `10.101.106.65:3306`;
- the `data_sources` row is created by the deploy-time catalog sync;
- the changelog entry is written at release time.
