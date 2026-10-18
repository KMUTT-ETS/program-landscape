import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { prisma, type Prisma } from '@kku/db';
import { Authorized, Provenance, ZodValidationPipe } from '../common';

// ─────────────────────────────────────────────────────────────────────────────
// Raw-data viewer for the Setup hub. One generic endpoint with a switch
// on dataset slug — admins can drill into each data set and see the
// actual records in tabular form.
//
// All datasets enforce admin/analyst role via @Authorized. Server-side
// pagination capped at 1000 rows per page; default 200. A free-text
// search is applied to the most-relevant columns per dataset.
//
// Adding a new dataset = adding one entry to DATASETS below. The frontend
// renders columns generically based on the returned `columns` array.
// ─────────────────────────────────────────────────────────────────────────────

const RawDataQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200),
  q: z.string().optional(),
});
type RawDataQuery = z.infer<typeof RawDataQuerySchema>;

interface ColumnSpec {
  /** Stable key — used as the React-Table accessor. */
  key: string;
  label: string;
  /** Right-align + tabular-nums in the UI. */
  numeric?: boolean;
  /** Format hint for the frontend renderer. */
  format?: 'date' | 'datetime' | 'currency-thb' | 'percent' | 'json' | 'truncate' | 'link';
  /** When format='link', the URL template — `{value}` is replaced with
   *  the cell value. Falls back to value-as-href if omitted. */
  linkTemplate?: string;
  /** Optional separate display key when format='link' — the rendered
   *  text shows `row[displayKey]` while the href is built from `row[key]`. */
  linkDisplayKey?: string;
}

interface RawDatasetResult {
  title: string;
  description: string;
  columns: ColumnSpec[];
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

@Controller('/admin/data-setup/raw')
export class AdminDataSetupRawController {
  @Get(':dataset')
  @Authorized('programs:manage:all')
  @Provenance({ sources: [{ id: 'kku-data', name: 'KKU Data' }] })
  async getDataset(
    @Param('dataset') dataset: string,
    @Query(new ZodValidationPipe(RawDataQuerySchema)) q: RawDataQuery,
  ): Promise<RawDatasetResult> {
    const fetcher = DATASETS[dataset];
    if (!fetcher) {
      throw new NotFoundException(`Unknown dataset: ${dataset}. Available: ${Object.keys(DATASETS).join(', ')}`);
    }
    return fetcher(q);
  }

  @Get()
  @Authorized('programs:manage:all')
  async listDatasets(): Promise<{ datasets: Array<{ slug: string; title: string }> }> {
    return {
      datasets: Object.entries(DATASETS).map(([slug, fn]) => ({
        slug,
        // Cheap title-only call; pageSize=1 minimises work
        title: '',
      })),
    };
  }
}

// ─── Dataset registry ────────────────────────────────────────────────────────

type DatasetFetcher = (q: RawDataQuery) => Promise<RawDatasetResult>;

const DATASETS: Record<string, DatasetFetcher> = {
  // ── Organisation backbone (spreadsheet import) ──────────────────────────
  // Tier 0 of the import framework. On an installation with no registrar
  // connector these are the only way the org chart exists at all, so the
  // raw view doubles as the adopter's confirmation that an upload landed.
  faculties: async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.FacultyWhereInput = q.q
      ? {
          OR: [
            { code: { contains: q.q, mode: 'insensitive' } },
            { nameEn: { contains: q.q, mode: 'insensitive' } },
            { nameTh: { contains: q.q } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.faculty.findMany({
        where,
        orderBy: { code: 'asc' },
        skip,
        take: q.pageSize,
        include: { _count: { select: { departments: true, programs: true } } },
      }),
      prisma.faculty.count({ where }),
    ]);
    return {
      title: 'Faculties',
      description:
        'Faculties, colleges and institutes. Populated by the Faculties spreadsheet import, or by the seed on a KKU installation.',
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'nameTh', label: 'Name (TH)' },
        { key: 'nameEn', label: 'Name (EN)' },
        { key: 'kind', label: 'Kind' },
        { key: 'departments', label: 'Departments', numeric: true },
        { key: 'programs', label: 'Programmes', numeric: true },
        { key: 'imported', label: 'Imported' },
      ],
      items: rows.map((r) => ({
        code: r.code,
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        kind: r.kind,
        departments: r._count.departments,
        programs: r._count.programs,
        imported: r.ingestionRunId !== null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  departments: async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.DepartmentWhereInput = q.q
      ? {
          OR: [
            { code: { contains: q.q, mode: 'insensitive' } },
            { nameEn: { contains: q.q, mode: 'insensitive' } },
            { nameTh: { contains: q.q } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.department.findMany({
        where,
        orderBy: { code: 'asc' },
        skip,
        take: q.pageSize,
        include: { faculty: { select: { code: true } }, _count: { select: { programs: true } } },
      }),
      prisma.department.count({ where }),
    ]);
    return {
      title: 'Departments',
      description: 'Departments within a faculty. Optional — an installation may put programmes directly under a faculty.',
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'nameTh', label: 'Name (TH)' },
        { key: 'nameEn', label: 'Name (EN)' },
        { key: 'facultyCode', label: 'Faculty' },
        { key: 'programs', label: 'Programmes', numeric: true },
        { key: 'imported', label: 'Imported' },
      ],
      items: rows.map((r) => ({
        code: r.code,
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        facultyCode: r.faculty?.code ?? '—',
        programs: r._count.programs,
        imported: r.ingestionRunId !== null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  programmes: async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.ProgramWhereInput = q.q
      ? {
          OR: [
            { code: { contains: q.q, mode: 'insensitive' } },
            { nameEn: { contains: q.q, mode: 'insensitive' } },
            { nameTh: { contains: q.q } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.program.findMany({
        where,
        orderBy: { code: 'asc' },
        skip,
        take: q.pageSize,
        include: { faculty: { select: { code: true } }, department: { select: { code: true } } },
      }),
      prisma.program.count({ where }),
    ]);
    return {
      title: 'Programmes',
      description:
        'Curricula. "Canonical" means the programme carries a sequence number; Council surfaces list only canonical programmes, and the importer assigns one on insert.',
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'nameEn', label: 'Name (EN)' },
        { key: 'level', label: 'Level' },
        { key: 'status', label: 'Status' },
        { key: 'facultyCode', label: 'Faculty' },
        { key: 'departmentCode', label: 'Department' },
        { key: 'canonical', label: 'Canonical' },
        { key: 'imported', label: 'Imported' },
      ],
      items: rows.map((r) => ({
        code: r.code,
        nameEn: r.nameEn,
        level: r.level,
        status: r.status,
        facultyCode: r.faculty?.code ?? '—',
        departmentCode: r.department?.code ?? '—',
        canonical: r.sequenceNoFromSheet !== null,
        imported: r.ingestionRunId !== null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Student information (kku-registry) ──────────────────────────────────
  'enrollment-metrics': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.EnrollmentMetricWhereInput = q.q
      ? {
          program: {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
              { nameTh: { contains: q.q } },
            ],
          },
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.enrollmentMetric.findMany({
        where,
        include: { program: { select: { code: true, nameEn: true, nameTh: true } } },
        orderBy: [{ academicYear: 'desc' }, { programId: 'asc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.enrollmentMetric.count({ where }),
    ]);
    return {
      title: 'Student information — enrollment per program × year',
      description: 'Source: kku-registry connector (Oracle DW). One row per (program, academic year). Server-side aggregated per (program × major × level × year) — no per-student rows leave the source DB (PDPA).',
      columns: [
        { key: 'academicYear', label: 'Year', numeric: true },
        { key: 'programCode', label: 'Program', format: 'truncate' },
        { key: 'programNameEn', label: 'Name (EN)' },
        { key: 'applications', label: 'Apps', numeric: true },
        { key: 'admitted', label: 'Admitted', numeric: true },
        { key: 'enrolled', label: 'Enrolled', numeric: true },
        { key: 'retainedYear2', label: 'Year 2', numeric: true },
        { key: 'graduatedOnTime', label: 'Grad on-time', numeric: true },
        { key: 'graduatedLate', label: 'Grad late', numeric: true },
        { key: 'dropouts', label: 'Dropouts', numeric: true },
      ],
      items: rows.map((r) => ({
        academicYear: r.academicYear,
        programCode: r.program?.code ?? r.programId,
        programNameEn: r.program?.nameEn ?? '',
        applications: r.applications,
        admitted: r.admitted,
        enrolled: r.enrolled,
        retainedYear2: r.retainedYear2,
        graduatedOnTime: r.graduatedOnTime,
        graduatedLate: r.graduatedLate,
        dropouts: r.dropouts,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Student demographics ─────────────────────────────────────────────────
  'student-demographics': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.StudentDemographicWhereInput = q.q
      ? {
          program: {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
              { nameTh: { contains: q.q } },
            ],
          },
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.studentDemographic.findMany({
        where,
        include: { program: { select: { code: true, nameEn: true } } },
        orderBy: [{ academicYear: 'desc' }, { programId: 'asc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.studentDemographic.count({ where }),
    ]);
    return {
      title: 'Student demographics — cohort breakdowns per program × year',
      description: 'Source: kku-registry connector. Aggregated breakdowns by gender, home-province, and nationality for each cohort. Per-student data never leaves the source DB.',
      columns: [
        { key: 'academicYear', label: 'Year', numeric: true },
        { key: 'programCode', label: 'Program', format: 'truncate' },
        { key: 'programNameEn', label: 'Name' },
        { key: 'breakdownJson', label: 'Breakdown (JSON)', format: 'json' },
      ],
      items: rows.map((r) => ({
        academicYear: r.academicYear,
        programCode: r.program?.code ?? r.programId,
        programNameEn: r.program?.nameEn ?? '',
        breakdownJson: r.breakdownJson,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Financial — per program ──────────────────────────────────────────────
  'financial-metrics': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.FinancialMetricWhereInput = q.q
      ? {
          program: {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
              { nameTh: { contains: q.q } },
            ],
          },
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.financialMetric.findMany({
        where,
        include: { program: { select: { code: true, nameEn: true } } },
        orderBy: [{ fiscalYear: 'desc' }, { programId: 'asc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.financialMetric.count({ where }),
    ]);
    return {
      title: 'Financial — per program × fiscal year',
      description: 'Source: kku-finance connector (Oracle tuition + MSSQL ERP). Tuition revenue is real (server-side aggregate, ≥5 students per cell). Cost columns sentinel-zero until cost-allocation methodology v1.0 lands.',
      columns: [
        { key: 'fiscalYear', label: 'FY', numeric: true },
        { key: 'programCode', label: 'Program', format: 'truncate' },
        { key: 'programNameEn', label: 'Name' },
        { key: 'tuitionRevenue', label: 'Tuition revenue (THB)', numeric: true, format: 'currency-thb' },
        { key: 'directCost', label: 'Direct cost', numeric: true, format: 'currency-thb' },
        { key: 'allocatedFacultyCost', label: 'Faculty cost', numeric: true, format: 'currency-thb' },
        { key: 'allocatedFacilityCost', label: 'Facility cost', numeric: true, format: 'currency-thb' },
        { key: 'allocatedOverhead', label: 'Overhead', numeric: true, format: 'currency-thb' },
        { key: 'costPerStudent', label: 'Cost / student', numeric: true, format: 'currency-thb' },
      ],
      items: rows.map((r) => ({
        fiscalYear: r.fiscalYear,
        programCode: r.program?.code ?? r.programId,
        programNameEn: r.program?.nameEn ?? '',
        tuitionRevenue: r.tuitionRevenue,
        directCost: r.directCost,
        allocatedFacultyCost: r.allocatedFacultyCost,
        allocatedFacilityCost: r.allocatedFacilityCost,
        allocatedOverhead: r.allocatedOverhead,
        costPerStudent: r.costPerStudent,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Faculty budgets ──────────────────────────────────────────────────────
  'faculty-budgets': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.FacultyBudgetWhereInput = q.q
      ? {
          OR: [
            { divisionName: { contains: q.q } },
            { fundCategory: { contains: q.q } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.facultyBudget.findMany({
        where,
        include: { faculty: { select: { code: true, nameTh: true } } },
        orderBy: [{ fiscalYear: 'desc' }, { divisionName: 'asc' }, { fundCategory: 'asc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.facultyBudget.count({ where }),
    ]);
    return {
      title: 'Faculty budgets — per division × fund × fiscal year',
      description: 'Source: kku-finance connector ([ERPPowerBI].[BudgetData]). Latest snapshot per (division, fund, fiscal year). divisionName preserved verbatim — sub-units like "คณะแพทยศาสตร์ - โรงพยาบาลศรีนครินทร์" land alongside the parent faculty.',
      columns: [
        { key: 'fiscalYear', label: 'FY', numeric: true },
        { key: 'divisionName', label: 'Division (raw)' },
        { key: 'facultyNameTh', label: 'Faculty (mapped)' },
        { key: 'fundCategory', label: 'Fund' },
        { key: 'totalBudget', label: 'Allocated (THB)', numeric: true, format: 'currency-thb' },
      ],
      items: rows.map((r) => ({
        fiscalYear: r.fiscalYear,
        divisionName: r.divisionName,
        facultyNameTh: r.faculty?.nameTh ?? '(unmapped)',
        fundCategory: r.fundCategory,
        totalBudget: r.totalBudget,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Faculty members ──────────────────────────────────────────────────────
  'faculty-members': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.FacultyMemberWhereInput = q.q
      ? {
          OR: [
            { nameEn: { contains: q.q, mode: 'insensitive' } },
            { nameTh: { contains: q.q } },
            { employeeId: { contains: q.q, mode: 'insensitive' } },
            { orcid: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.facultyMember.findMany({
        where,
        include: {
          faculty: { select: { nameTh: true } },
          // Publication count via the FacultyMember ↔ ResearchOutput relation.
          // One ResearchOutput row per (paper × matched KKU author), so
          // _count.researchOutputs is "papers I've co-authored" per source.
          _count: { select: { researchOutputs: true } },
        },
        orderBy: [{ facultyId: 'asc' }, { rank: 'desc' }, { nameEn: 'asc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.facultyMember.count({ where }),
    ]);
    return {
      title: 'Academic staff — faculty roster',
      description: 'Source: kku-hr connector (HCMEmployee + epm_report.workforce_hcm_actual). Active + retired members. EMPLOYEEID is the HR-internal employment number (NOT citizen ID — confirmed not PII). Citizen ID stays hashed at source. ORCID + OpenAlex IDs are filled lazily by kku-research; publication count is cross-joined from research_outputs.',
      columns: [
        // EMPLOYEEID — un-hashed HR-internal employment number, not PII.
        // Distinct from employee_code (which is `hr_<hash>` and stays as
        // the unique cross-system join key).
        { key: 'employeeId', label: 'EMPLOYEEID', format: 'truncate' },
        { key: 'nameTh', label: 'Name (TH)' },
        { key: 'nameEn', label: 'Name (EN)' },
        { key: 'rank', label: 'Rank' },
        { key: 'facultyNameTh', label: 'Faculty' },
        { key: 'isActive', label: 'Active' },
        { key: 'publicationCount', label: 'Publications', numeric: true },
        // Scopus → clickable link to the author's Scopus profile.
        // Filled by `pnpm staff:enrich-scopus` (free, via OpenAlex).
        {
          key: 'scopusAuthorId',
          label: 'Scopus',
          format: 'link',
          linkTemplate: 'https://www.scopus.com/authid/detail.uri?authorId={value}',
        },
        // ORCID → clickable link to the public ORCID profile.
        {
          key: 'orcid',
          label: 'ORCID',
          format: 'link',
          linkTemplate: 'https://orcid.org/{value}',
        },
        // OpenAlex → clickable link to the OpenAlex author page.
        {
          key: 'openalexAuthorId',
          label: 'OpenAlex',
          format: 'link',
          linkTemplate: 'https://openalex.org/{value}',
        },
        { key: 'retirementDate', label: 'Retire', format: 'date' },
      ],
      items: rows.map((r) => ({
        employeeId: r.employeeId,
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        rank: r.rank,
        facultyNameTh: r.faculty?.nameTh ?? '',
        isActive: r.isActive,
        publicationCount: r._count.researchOutputs,
        scopusAuthorId: r.scopusAuthorId,
        orcid: r.orcid,
        openalexAuthorId: r.openalexAuthorId,
        retirementDate: r.retirementDate?.toISOString() ?? null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Faculty compensation (aggregate, role-gated) ─────────────────────────
  'faculty-compensation': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.FacultyCompensationWhereInput = q.q
      ? { faculty: { nameTh: { contains: q.q } } }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.facultyCompensation.findMany({
        where,
        include: {
          faculty: { select: { nameTh: true } },
          department: { select: { nameTh: true } },
        },
        orderBy: [{ fiscalYear: 'desc' }, { facultyId: 'asc' }, { rank: 'desc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.facultyCompensation.count({ where }),
    ]);
    return {
      title: 'Faculty compensation — aggregate per faculty × rank × FY',
      description: 'Source: kku-hr connector. SQL Server-side GROUP BY with HAVING COUNT(*) ≥ 5 — no per-person salary leaves the source. NULL fields where the bucket has < 5 individuals.',
      columns: [
        { key: 'fiscalYear', label: 'FY', numeric: true },
        { key: 'facultyNameTh', label: 'Faculty' },
        { key: 'departmentNameTh', label: 'Department' },
        { key: 'rank', label: 'Rank' },
        { key: 'headcount', label: 'Headcount', numeric: true },
        { key: 'sumSalary', label: 'Total salary (THB)', numeric: true, format: 'currency-thb' },
        { key: 'meanSalary', label: 'Mean salary', numeric: true, format: 'currency-thb' },
        { key: 'minSalary', label: 'Min', numeric: true, format: 'currency-thb' },
        { key: 'maxSalary', label: 'Max', numeric: true, format: 'currency-thb' },
      ],
      items: rows.map((r) => ({
        fiscalYear: r.fiscalYear,
        facultyNameTh: r.faculty?.nameTh ?? '',
        departmentNameTh: r.department?.nameTh ?? '',
        rank: r.rank,
        headcount: r.headcount,
        sumSalary: r.sumSalary,
        meanSalary: r.meanSalary,
        minSalary: r.minSalary,
        maxSalary: r.maxSalary,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── KMITL career taxonomy ────────────────────────────────────────────────
  'kmitl-careers': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.KmitlCareerWhereInput = q.q
      ? {
          OR: [
            { careerName: { contains: q.q, mode: 'insensitive' } },
            { groupName: { contains: q.q, mode: 'insensitive' } },
            { subGroupName: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.kmitlCareer.findMany({
        where,
        orderBy: [{ groupName: 'asc' }, { subGroupName: 'asc' }, { careerName: 'asc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.kmitlCareer.count({ where }),
    ]);
    return {
      title: 'Labour-market career taxonomy',
      description: 'Career taxonomy used by the LinkedIn-derived labour-market dataset. **Data: LinkedIn. Subscriber: MHESI** (institutional licence). API hosted by KMITL on behalf of MHESI — KMITL is not the data owner. The taxonomy structure (14 groups → 77 sub-groups → 401 careers) is curated by KMITL for the API; iscoCode is populated by an analyst hand-mapping pass.',
      columns: [
        { key: 'kmitlCareerId', label: 'API career ID', numeric: true },
        { key: 'groupName', label: 'Group' },
        { key: 'subGroupName', label: 'Sub-group' },
        { key: 'careerName', label: 'Career' },
        { key: 'iscoCode', label: 'ISCO-08' },
      ],
      items: rows.map((r) => ({
        kmitlCareerId: r.kmitlCareerId,
        groupName: r.groupName,
        subGroupName: r.subGroupName,
        careerName: r.careerName,
        iscoCode: r.iscoCode,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── KMITL skill demand (the LinkedIn data) ───────────────────────────────
  'kmitl-skill-demands': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.KmitlCareerSkillDemandWhereInput = q.q
      ? {
          OR: [
            { skillNameRaw: { contains: q.q, mode: 'insensitive' } },
            { career: { careerName: { contains: q.q, mode: 'insensitive' } } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.kmitlCareerSkillDemand.findMany({
        where,
        include: {
          career: { select: { careerName: true, groupName: true } },
          skill: { select: { nameEn: true, nameTh: true } },
        },
        orderBy: [{ percentage: 'desc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.kmitlCareerSkillDemand.count({ where }),
    ]);
    return {
      title: 'Labour-market skills demand — LinkedIn (subscribed by MHESI)',
      description: '**Data: LinkedIn** (profile-level + job-posting prevalence, aggregated). **Subscriber / data licence holder: MHESI** (Ministry of Higher Education, Science, Research and Innovation). The API endpoint is hosted by KMITL on behalf of MHESI — KMITL is not the data owner and is not the data curator. Aggregated per (career, skill, dataScope, dataSource). Percentages — not per-posting rows. THAILAND × JOB_POSTINGS rows with percentage ≥ 5% drive the health-score labour-market alignment driver.',
      columns: [
        { key: 'group', label: 'Group' },
        { key: 'careerName', label: 'Career' },
        { key: 'skillNameRaw', label: 'Skill (raw)' },
        { key: 'skillResolved', label: 'Skill (resolved)' },
        { key: 'dataScope', label: 'Scope' },
        { key: 'dataSource', label: 'Source' },
        { key: 'percentage', label: '%', numeric: true, format: 'percent' },
        { key: 'amount', label: 'Count', numeric: true },
      ],
      items: rows.map((r) => ({
        group: r.career?.groupName ?? '',
        careerName: r.career?.careerName ?? '',
        skillNameRaw: r.skillNameRaw,
        skillResolved: r.skill ? `${r.skill.nameEn} / ${r.skill.nameTh}` : '(unresolved)',
        dataScope: r.dataScope,
        dataSource: r.dataSource,
        percentage: r.percentage,
        amount: r.amount,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── KMITL skill growth ───────────────────────────────────────────────────
  'kmitl-skill-growths': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.KmitlSkillGrowthWhereInput = q.q
      ? {
          OR: [
            { skillNameRaw: { contains: q.q, mode: 'insensitive' } },
            { contextName: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.kmitlSkillGrowth.findMany({
        where,
        include: { skill: { select: { nameEn: true, nameTh: true } } },
        orderBy: [{ growthPct: 'desc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.kmitlSkillGrowth.count({ where }),
    ]);
    return {
      title: 'Labour-market skill growth — LinkedIn (subscribed by MHESI)',
      description: '**Data: LinkedIn** skill-growth percentages aggregated at three levels — group, sub-group, career. **Subscriber: MHESI** (institutional licence). API hosted by KMITL on behalf of MHESI; KMITL is not the data owner. Positive growth = rising demand year-over-year per LinkedIn signal.',
      columns: [
        { key: 'contextLevel', label: 'Level' },
        { key: 'contextName', label: 'Context' },
        { key: 'skillNameRaw', label: 'Skill (raw)' },
        { key: 'skillResolved', label: 'Skill (resolved)' },
        { key: 'dataScope', label: 'Scope' },
        { key: 'growthPct', label: 'Growth %', numeric: true, format: 'percent' },
      ],
      items: rows.map((r) => ({
        contextLevel: r.contextLevel,
        contextName: r.contextName,
        skillNameRaw: r.skillNameRaw,
        skillResolved: r.skill ? `${r.skill.nameEn} / ${r.skill.nameTh}` : '(unresolved)',
        dataScope: r.dataScope,
        growthPct: r.growthPct,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Research outputs ─────────────────────────────────────────────────────
  'research-outputs': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.ResearchOutputWhereInput = q.q
      ? {
          OR: [
            { title: { contains: q.q, mode: 'insensitive' } },
            { venue: { contains: q.q, mode: 'insensitive' } },
            { doi: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.researchOutput.findMany({
        where,
        include: {
          facultyMember: {
            select: { nameEn: true, nameTh: true, faculty: { select: { nameTh: true } } },
          },
        },
        orderBy: [{ year: 'desc' }, { citations: 'desc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.researchOutput.count({ where }),
    ]);
    return {
      title: 'Research outputs (publications)',
      description: 'Source: kku-research connector (OpenAlex; Scopus enrichment deferred). Author resolution via ORCID → OpenAlex ID → exact name match. Unmatched authors land with facultyMemberId=NULL and the original kkuAuthorName preserved.',
      columns: [
        { key: 'year', label: 'Year', numeric: true },
        { key: 'title', label: 'Title', format: 'truncate' },
        { key: 'venue', label: 'Venue', format: 'truncate' },
        { key: 'authorName', label: 'KKU author' },
        { key: 'facultyNameTh', label: 'Faculty' },
        { key: 'citations', label: 'Citations', numeric: true },
        { key: 'doi', label: 'DOI', format: 'truncate' },
        { key: 'source', label: 'Source' },
      ],
      items: rows.map((r) => ({
        year: r.year,
        title: r.title,
        venue: r.venue,
        authorName: r.facultyMember?.nameEn ?? r.facultyMember?.nameTh ?? r.kkuAuthorName ?? '(unmatched)',
        facultyNameTh: r.facultyMember?.faculty?.nameTh ?? '',
        citations: r.citations,
        doi: r.doi,
        source: r.source,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Skill aliases (AI normaliser decisions) ──────────────────────────────
  'skill-aliases': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.SkillAliasWhereInput = q.q
      ? {
          OR: [
            { rawName: { contains: q.q, mode: 'insensitive' } },
            { newNameEn: { contains: q.q, mode: 'insensitive' } },
            { newNameTh: { contains: q.q } },
          ],
        }
      : {};
    const [rows, total] = await prisma.$transaction([
      prisma.skillAlias.findMany({
        where,
        include: { resolvedSkill: { select: { nameEn: true, nameTh: true } } },
        orderBy: [{ status: 'asc' }, { confidence: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.skillAlias.count({ where }),
    ]);
    return {
      title: 'Skill alias cache (AI normaliser decisions)',
      description: 'Cached normalisation decisions for free-text skill names. RESOLVED = mapped to existing Skill (auto or human). NEW_PROPOSED = AI suggests creating a new Skill (queued for review). AMBIGUOUS = needs human. REJECTED = analyst said no — never overwritten by automation.',
      columns: [
        { key: 'rawName', label: 'Raw name' },
        { key: 'sourceContext', label: 'Source' },
        { key: 'status', label: 'Status' },
        { key: 'resolvedSkillName', label: 'Resolved skill' },
        { key: 'newNameEn', label: 'Proposed (EN)' },
        { key: 'newNameTh', label: 'Proposed (TH)' },
        { key: 'confidence', label: 'Conf.', numeric: true, format: 'percent' },
        { key: 'method', label: 'Method' },
        { key: 'createdAt', label: 'Created', format: 'date' },
      ],
      items: rows.map((r) => ({
        rawName: r.rawName,
        sourceContext: r.sourceContext,
        status: r.status,
        resolvedSkillName: r.resolvedSkill ? `${r.resolvedSkill.nameEn} / ${r.resolvedSkill.nameTh}` : null,
        newNameEn: r.newNameEn,
        newNameTh: r.newNameTh,
        confidence: r.confidence,
        method: r.method,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── Curriculum PDFs (program ↔ PDF links) ────────────────────────────────
  'curriculum-pdfs': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.ProgramDocumentWhereInput = {
      role: 'CURRENT_CURRICULUM',
      ...(q.q
        ? {
            OR: [
              { program: { code: { contains: q.q, mode: 'insensitive' } } },
              { program: { nameEn: { contains: q.q, mode: 'insensitive' } } },
              { program: { nameTh: { contains: q.q } } },
              { pdfDocument: { originalFilename: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.programDocument.findMany({
        where,
        include: {
          program: { select: { code: true, nameEn: true, nameTh: true, level: true } },
          pdfDocument: {
            select: {
              originalFilename: true,
              fileSize: true,
              pageCount: true,
              processingStatus: true,
              createdAt: true,
            },
          },
        },
        orderBy: { program: { code: 'asc' } },
        skip,
        take: q.pageSize,
      }),
      prisma.programDocument.count({ where }),
    ]);
    return {
      title: 'Curriculum PDFs — program ↔ PDF links',
      description: 'Real curriculum documents (มคอ.2) loaded via the seed-from-sheet workflow + the smart linker. Each row is one (program, PDF) link with isCurrent=true.',
      columns: [
        { key: 'programCode', label: 'Program' },
        { key: 'programLevel', label: 'Level' },
        { key: 'programNameEn', label: 'Name' },
        { key: 'filename', label: 'PDF file' },
        { key: 'fileSize', label: 'Size (KB)', numeric: true },
        { key: 'pageCount', label: 'Pages', numeric: true },
        { key: 'processingStatus', label: 'Extract status' },
        { key: 'isCurrent', label: 'Current' },
        { key: 'attachedAt', label: 'Linked', format: 'date' },
      ],
      items: rows.map((r) => ({
        programCode: r.program.code,
        programLevel: r.program.level,
        programNameEn: r.program.nameEn || r.program.nameTh,
        filename: r.pdfDocument.originalFilename,
        fileSize: r.pdfDocument.fileSize ? Math.round(r.pdfDocument.fileSize / 1024) : null,
        pageCount: r.pdfDocument.pageCount,
        processingStatus: r.pdfDocument.processingStatus,
        isCurrent: r.isCurrent,
        attachedAt: r.attachedAt.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },

  // ── PROPOSED_SKILL queue (analyst review) ────────────────────────────────
  'proposed-skills': async (q) => {
    const skip = (q.page - 1) * q.pageSize;
    const where: Prisma.AiExtractionWhereInput = {
      extractionKind: 'PROPOSED_SKILL',
      reviewStatus: 'PENDING_REVIEW',
    };
    const [rows, total] = await prisma.$transaction([
      prisma.aiExtraction.findMany({
        where,
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: q.pageSize,
      }),
      prisma.aiExtraction.count({ where }),
    ]);
    return {
      title: 'Proposed skills — pending analyst review',
      description: 'Skills proposed by the program-digest AI extractor that don\'t exact-match an existing Skill row. After alias-normaliser pass (`pnpm skills:normalise --source=program_digest --auto-promote`), most of these resolve via the SkillAlias cache instead.',
      columns: [
        { key: 'nameTh', label: 'Name (TH)' },
        { key: 'nameEn', label: 'Name (EN)' },
        { key: 'category', label: 'Category' },
        { key: 'weight', label: 'Weight', numeric: true },
        { key: 'evidenceQuote', label: 'Evidence', format: 'truncate' },
        { key: 'sourceProgramId', label: 'Program' },
        { key: 'createdAt', label: 'Extracted', format: 'date' },
      ],
      items: rows.map((r) => {
        const p = r.payloadJson as { nameTh?: string; nameEn?: string; category?: string; weight?: number; evidenceQuote?: string };
        return {
          nameTh: p.nameTh ?? '',
          nameEn: p.nameEn ?? '',
          category: p.category ?? '',
          weight: p.weight ?? null,
          evidenceQuote: p.evidenceQuote ?? '',
          sourceProgramId: r.sourceEntityId,
          createdAt: r.createdAt.toISOString(),
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  },
};
