# Prompt 01 — Full Data Model

> **When to use:** After bootstrap. Builds the complete Prisma schema. Run before any module work.
> **Skills to invoke:** none specific (pure backend session)

---

Read `CLAUDE.md` and `GLOBAL-UPDATES.md` first.

Expand the Prisma schema to cover all data domains. Use snake_case table names via `@@map`, camelCase in TypeScript. Include indexes, foreign keys, `createdAt`/`updatedAt` on every entity. Every metric table includes a `freshnessDate` field (required for provenance).

**Critical: every analytical entity must support multi-level scope.** Either store at the most granular level (program) and aggregate up, or denormalize to the four scopes — but the schema must clearly enable university / faculty / department / program rollups.

### Core organizational hierarchy
- `Faculty` (already from prompt 00)
- `Department` (already from prompt 00)
- `Program` (already from prompt 00) — must include `departmentId` (nullable for programs not assigned to a department)

### Curriculum & program structure
- `Curriculum` — versioned curriculum (มคอ.2) per Program: programId, version, effectiveYear, totalCredits, mko2DocumentUrl, sourcePdfId (link to PdfDocument), status
- `Course` — programId, code, nameTh, nameEn, credits, type (CORE/ELECTIVE/GENERAL), description, descriptionTh, descriptionEn
- `CurriculumCourse` — many-to-many Curriculum↔Course, semester, isRequired
- `Skill` — id, code, nameTh, nameEn, taxonomySource (LIGHTCAST/ESCO/TPQI/KKU), category, parentSkillId, embedding (vector(1536))
- `CourseSkill` — many-to-many Course↔Skill, weight (0–1), source (MANUAL/LLM_EXTRACTED), confidence
- `ProgramSkill` — denormalized rollup
- `DepartmentSkill` — denormalized rollup at department level
- `FacultySkill` — denormalized rollup at faculty level

### People
- `FacultyMember` — id, facultyId, departmentId nullable, employeeCode, nameTh, nameEn, rank, academicQualification, specialization, dateOfBirth, hireDate, retirementDate, isActive
- `ProgramFaculty` — many-to-many FacultyMember↔Program, role (COORDINATOR/CORE/SUPPORT)

### Student funnel (per program, per academic year)
- `EnrollmentMetric` — programId, academicYear, applications, admitted, enrolled, retainedYear2, graduatedOnTime, graduatedLate, dropouts, freshnessDate
- `StudentDemographic` — programId, academicYear, breakdown by region, gender, average TGAT/TPAT scores

### Financial (per program, per fiscal year)
- `FinancialMetric` — programId, fiscalYear, tuitionRevenue, otherRevenue, directCost, allocatedFacultyCost, allocatedFacilityCost, allocatedOverhead, netContribution, costPerStudent, freshnessDate, methodologyVersion
- `CostMethodology` — version, description, effectiveDate, documentUrl

### Outcomes
- `GraduateOutcome` — programId, graduationYear, surveyYear (1yr/5yr), employmentRate, averageSalary, jobRelevanceScore, furtherStudyRate, freshnessDate, sampleSize
- `EmployerFeedback` — programId, year, employerName, satisfactionScore, skillGapsJson, sampleSize

### Research linkage
- `ResearchOutput` — facultyMemberId, year, type (JOURNAL/CONFERENCE/PATENT/BOOK), title, venue, citations, scopusId, doi

### Aggregation views (materialized)
Build PostgreSQL materialized views for fast scope rollups:
- `mv_department_metrics` — aggregates EnrollmentMetric, FinancialMetric, GraduateOutcome at department level
- `mv_faculty_metrics` — at faculty level
- `mv_university_metrics` — at university level
- Refresh on ingestion with proper concurrency
- Document refresh strategy in `docs/architecture.md`

### External signals
- `JobPosting` — id, source, externalId, title, employerName, location, province, salaryMin, salaryMax, postedDate, descriptionRaw, embedding, processedAt, sourcePdfId nullable
- `JobPostingSkill` — many-to-many, weight, extractedBy
- `OccupationDemand` — occupationCode (ISCO-08), province, year, month, postingsCount, medianSalary, growthRate
- `PolicyDocument` — id, source (MHESI/NESDC/NXPO/BOI/EECO/OTHER), title, publishedDate, url, contentRaw, summaryTh, summaryEn, embedding, relevantProgramIds (array), relevantSkillIds (array), sourcePdfId (link to PdfDocument — most policies arrive as PDFs)
- `TrendSignal` — id, signalType (POLICY/RESEARCH/MARKET/TECH/NEWS), title, summaryTh, summaryEn, sourceUrl, detectedDate, impactScore (0–1), affectedProgramIds, affectedSkillIds, aiInferenceId
- `PeerProgram` — institution, country, programName, programLevel, descriptionUrl, ranking, lastScraped, embedding, sourcePdfId nullable
- `LaborMarketForecast` — occupationCode, region, year, projectedDemand, projectedSupply, source, confidence
- `DemographicProjection` — region, year, ageCohort, population, source

### PDF document infrastructure (NEW — primary data input mechanism)
- `PdfDocument` — id, originalFilename, storageUrl, fileSize, pageCount, sourceCategory (POLICY/REPORT/CURRICULUM/PEER_PROGRAM/SURVEY/COMMITTEE_MINUTES/OTHER), sourceOrg, language (TH/EN/MIXED), uploadedByUserId, uploadedAt, processingStatus (PENDING/PROCESSING/COMPLETED/FAILED), extractedTextUrl, ocrApplied, ocrConfidence, contentHash (for dedup), embedding
- `PdfPage` — pdfDocumentId, pageNumber, textContent, hasImages, hasTables, embedding
- `PdfExtraction` — pdfDocumentId, extractionType (POLICY_DOC/JOB_POSTING_BATCH/CURRICULUM_SPEC/etc), targetEntityType, targetEntityId, confidence, methodVersion, reviewStatus (AUTO_APPROVED/PENDING_REVIEW/APPROVED/REJECTED), reviewedByUserId, reviewedAt
- `PdfTable` — pdfDocumentId, pageNumber, tableIndex, headersJson, rowsJson, structuredData

### Decision & governance
- `Scenario`, `ScenarioResult` — as before
- `CouncilDecision`, `Annotation` — as before
- `DataSource` — as before, plus `acceptsPdfUploads` boolean

### Scope-aware metric query helpers
In `packages/db`, build TypeScript helpers:
```ts
queryMetricByScope({ scope: 'university'|'faculty'|'department'|'program', scopeId?: string, metric: string, dateRange })
```
These resolve to the right materialized view or aggregation query. Every module uses these — never raw queries scattered across the app.

### After writing the schema
1. Generate the migration
2. Update seed script: 5 faculties, 12 departments, 30 programs, 200 sample courses, ~500 sample skills (small dummy taxonomy), 3 years enrollment + financial data, 50 sample job postings, 5 sample PDF documents (mock content)
3. Seed users for every role (VIEWER, COUNCIL, EXECUTIVE, DEAN, DEPT_HEAD, ANALYST, ADMIN)
4. Write `packages/db/README.md` with the data model, ERD in Mermaid, and the scope-aggregation strategy explained
5. Document key design decisions in `docs/architecture.md` under "Data model"

Do not implement UI or API endpoints in this session. Schema, materialized views, scope helpers, seed, docs only.

### Deliverables
- Migration applied to local DB
- Seed run cleanly
- ERD diagram
- 3 suggestions for the next session
