import { Injectable, Optional } from '@nestjs/common';
import { prisma, type Prisma } from '@kku/db';
import { CacheService } from '../common/cache.service';
import {
  ACADEMIC_STANDING,
  ACADEMIC_STANDING_RANK,
  ADMIN_POSITION,
  BUDGET_SOURCE,
  DEFORM_NORMAL,
  GENDER,
  INCOME_BAND,
  INCOME_BAND_ORDER,
  POSITION_LEVEL,
  STAFF_TYPE,
  SUB_STAFFTYPE,
  TIME_CONTACT,
  lookupOrCode,
  staffTrack,
} from './unicon-codes';
import { compareThai, compareLevel } from '../education/sorting';

// Filter shape shared across the 6 dashboards
export interface StaffFilter {
  facultyName?: string[];
  staffTypeId?: string[];
  track?: Array<'ACADEMIC' | 'SUPPORT'>;
  academicStandingId?: string[];
  positionLevelId?: string[];
  budgetId?: string[];
  nationalityId?: string[];
}

interface FacetCount {
  key: string;
  label: string;
  count: number;
}

@Injectable()
export class StaffService {
  // Optional so the publications.smoke.ts standalone runner can
  // instantiate this class without spinning up the full Nest DI stack.
  // In production, Nest injects the singleton from app.module.ts.
  constructor(@Optional() private readonly cache?: CacheService) {}

  /** Build a Prisma where clause from the cross-dashboard filter. */
  private whereFromFilter(f: StaffFilter): Prisma.StaffMasterRecordWhereInput {
    const where: Prisma.StaffMasterRecordWhereInput = {};
    const and: Prisma.StaffMasterRecordWhereInput[] = [];

    if (f.facultyName?.length) {
      and.push({
        OR: [
          { faculty: { nameTh: { in: f.facultyName } } },
          // Fallback: when facultyId is null, we can't filter by name —
          // tag rows that have a non-null facultyId only. (We still
          // surface the unmapped count separately.)
        ],
      });
    }
    if (f.staffTypeId?.length) and.push({ staffTypeId: { in: f.staffTypeId } });
    if (f.track?.length) {
      const subTypes: string[] = [];
      if (f.track.includes('ACADEMIC')) subTypes.push('1', '4');
      if (f.track.includes('SUPPORT')) subTypes.push('2', '3', '5');
      if (subTypes.length === 5) {
        // 'all' — no filter
      } else {
        and.push({ subStaffTypeId: { in: subTypes } });
      }
    }
    if (f.academicStandingId?.length) and.push({ academicStandingId: { in: f.academicStandingId } });
    if (f.positionLevelId?.length) and.push({ positionLevelId: { in: f.positionLevelId } });
    if (f.budgetId?.length) and.push({ budgetId: { in: f.budgetId } });
    if (f.nationalityId?.length) and.push({ nationalityId: { in: f.nationalityId } });

    if (and.length > 0) where.AND = and;
    return where;
  }

  /** Provide the available filter dropdown options (always full set). */
  async filterOptions() {
    const rows = await prisma.staffMasterRecord.findMany({
      select: {
        staffTypeId: true,
        subStaffTypeId: true,
        academicStandingId: true,
        positionLevelId: true,
        budgetId: true,
        nationalityId: true,
        faculty: { select: { nameTh: true } },
      },
    });

    const facultyNames = new Set<string>();
    const staffTypeIds = new Set<string>();
    const academicStandingIds = new Set<string>();
    const positionLevelIds = new Set<string>();
    const budgetIds = new Set<string>();
    const nationalityIds = new Set<string>();
    for (const r of rows) {
      if (r.faculty?.nameTh) facultyNames.add(r.faculty.nameTh);
      if (r.staffTypeId) staffTypeIds.add(r.staffTypeId);
      if (r.academicStandingId) academicStandingIds.add(r.academicStandingId);
      if (r.positionLevelId) positionLevelIds.add(r.positionLevelId);
      if (r.budgetId) budgetIds.add(r.budgetId);
      if (r.nationalityId) nationalityIds.add(r.nationalityId);
    }

    return {
      faculties: [...facultyNames].sort(compareThai),
      staffTypes: [...staffTypeIds].sort().map((id) => ({ id, label: lookupOrCode(STAFF_TYPE, id) })),
      tracks: [
        { id: 'ACADEMIC', label: 'สายวิชาการ' },
        { id: 'SUPPORT', label: 'สายสนับสนุน' },
      ],
      academicStandings: [...academicStandingIds].sort().map((id) => ({
        id,
        label: lookupOrCode(ACADEMIC_STANDING, id),
      })),
      positionLevels: [...positionLevelIds].sort().map((id) => ({
        id,
        label: lookupOrCode(POSITION_LEVEL, id),
      })),
      budgets: [...budgetIds].sort().map((id) => ({ id, label: lookupOrCode(BUDGET_SOURCE, id) })),
      nationalities: [...nationalityIds].sort(),
    };
  }

  // ── 1. Workforce Overview + Demographics (merged dashboard) ───────
  async workforce(filter: StaffFilter) {
    const [overview, demo] = await Promise.all([
      this.overview(filter),
      this.demographics(filter),
    ]);
    return { ...overview, demographics: demo };
  }

  async overview(filter: StaffFilter) {
    const where = this.whereFromFilter(filter);
    const rows = await prisma.staffMasterRecord.findMany({
      where,
      select: {
        citizenIdHash: true,
        subStaffTypeId: true,
        adminPositionId: true,
        academicStandingId: true,
        positionLevelId: true,
        birthYear: true,
        dateInWork: true,
        movementTypeId: true,
        movementDate: true,
        faculty: { select: { nameTh: true } },
      },
    });

    // Pull authoritative birth-year-AD from processed-HR (DS2001's BIRTHDAY
    // is a placeholder).
    const lifecycle = await prisma.staffLifecycleDates.findMany({
      where: { citizenIdHash: { in: rows.map((r) => r.citizenIdHash) } },
      select: { citizenIdHash: true, birthYearAd: true },
    });
    const lifeByHash = new Map(lifecycle.map((l) => [l.citizenIdHash, l.birthYearAd]));

    const total = rows.length;
    let academic = 0;
    let support = 0;
    let executives = 0;
    let unknownTrack = 0;
    for (const r of rows) {
      const t = staffTrack(r.subStaffTypeId);
      if (t === 'ACADEMIC') academic += 1;
      else support += 1;
      if (r.adminPositionId && r.adminPositionId !== '00') executives += 1;
      if (!r.subStaffTypeId) unknownTrack += 1;
    }

    // 5-year retirement cliff: anyone who turns 60 within the next 5
    // calendar years (Thai mandatory retirement age).
    const currentYearAd = new Date().getFullYear();
    let cliffAcademic = 0;
    let cliffSupport = 0;
    for (const r of rows) {
      const ad = lifeByHash.get(r.citizenIdHash) ??
        (r.birthYear ? (r.birthYear > 2400 ? r.birthYear - 543 : r.birthYear) : null);
      if (ad === null) continue;
      const ageNow = currentYearAd - ad;
      if (ageNow >= 55 && ageNow < 60) {
        if (staffTrack(r.subStaffTypeId) === 'ACADEMIC') cliffAcademic += 1;
        else cliffSupport += 1;
      }
    }

    // Faculty mosaic — totals per (faculty × track)
    const byFaculty = new Map<string, { academic: number; support: number }>();
    for (const r of rows) {
      const fac = r.faculty?.nameTh ?? '∅ (unmapped)';
      const cell = byFaculty.get(fac) ?? { academic: 0, support: 0 };
      if (staffTrack(r.subStaffTypeId) === 'ACADEMIC') cell.academic += 1;
      else cell.support += 1;
      byFaculty.set(fac, cell);
    }

    const facultyMosaic = [...byFaculty.entries()]
      .map(([name, cell]) => ({ facultyName: name, ...cell, total: cell.academic + cell.support }))
      .sort((a, b) => b.total - a.total);

    // 12-month hire / separation flow from MOVEMENT_DATE/TYPE
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    let hires12m = 0;
    let separations12m = 0;
    for (const r of rows) {
      if (!r.movementDate || !r.movementTypeId) continue;
      if (r.movementDate < oneYearAgo) continue;
      const code = r.movementTypeId.padStart(2, '0');
      // 03=บรรจุใหม่, 09=ทำสัญญาครั้งแรก, 04=บรรจุกลับ → hires
      // 06=เกษียณ, 07=ลาออก, 08=ถึงแก่กรรม, 11=หมดสัญญา, 12=พ้นสภาพ → separations
      if (['03', '09', '04', '05'].includes(code)) hires12m += 1;
      if (['06', '07', '08', '11', '12'].includes(code)) separations12m += 1;
    }

    return {
      headcount: { total, academic, support, executives, unknownTrack },
      retirementCliff5y: { academic: cliffAcademic, support: cliffSupport, total: cliffAcademic + cliffSupport },
      flow12m: { hires: hires12m, separations: separations12m },
      facultyMosaic,
    };
  }

  // ── 2. Demographics & Lifecycle ──────────────────────────────────
  async demographics(filter: StaffFilter) {
    const where = this.whereFromFilter(filter);
    const rows = await prisma.staffMasterRecord.findMany({
      where,
      select: {
        citizenIdHash: true,
        subStaffTypeId: true,
        academicStandingId: true,
        positionLevelId: true,
        birthYear: true,
        dateStartThisU: true,
        genderId: true,
        nationalityId: true,
        faculty: { select: { nameTh: true } },
      },
    });

    // DS2001's BIRTHDAY is a placeholder ('1970-01-01' for every row —
    // KKU sanitised that field in the MHESI submission). We pull the
    // authoritative year-precision dates from processed-HR's vw_history,
    // joined here via citizenIdHash. Falls back to DS2001 birth_year
    // for the rare staff missing from vw_history.
    const lifecycle = await prisma.staffLifecycleDates.findMany({
      where: { citizenIdHash: { in: rows.map((r) => r.citizenIdHash) } },
      select: { citizenIdHash: true, birthYearAd: true, retireYearAd: true },
    });
    const lifeByHash = new Map(lifecycle.map((l) => [l.citizenIdHash, l]));

    const currentYearAd = new Date().getFullYear();
    function adBirth(beYear: number | null): number | null {
      if (!beYear) return null;
      // BE → AD when the year is in the BE range; pass through if already AD.
      return beYear > 2400 ? beYear - 543 : beYear;
    }

    interface AgePyramidCell {
      bucket: string;
      male: number;
      female: number;
      total: number;
    }
    function emptyPyramid(): AgePyramidCell[] {
      return ['<25', '25–34', '35–44', '45–54', '55–59', '60+'].map((b) => ({
        bucket: b,
        male: 0,
        female: 0,
        total: 0,
      }));
    }
    function ageBucket(age: number): string {
      if (age < 25) return '<25';
      if (age < 35) return '25–34';
      if (age < 45) return '35–44';
      if (age < 55) return '45–54';
      if (age < 60) return '55–59';
      return '60+';
    }

    const academicPyramid = emptyPyramid();
    const supportPyramid = emptyPyramid();
    const tenureBucketsAcademic: Record<string, number> = { '<5': 0, '5–9': 0, '10–19': 0, '20–29': 0, '30+': 0 };
    const tenureBucketsSupport: Record<string, number> = { '<5': 0, '5–9': 0, '10–19': 0, '20–29': 0, '30+': 0 };

    let academicTotal = 0;
    let supportTotal = 0;
    let academicNearRetire = 0;
    let supportNearRetire = 0;

    for (const r of rows) {
      const track = staffTrack(r.subStaffTypeId);
      // Prefer processed-HR's birthYearAd (already in AD years); fall
      // back to DS2001's birth_year (BE) only when the row isn't on
      // vw_history. DS2001 dates are unreliable so the LEFT JOIN is
      // the primary path.
      const life = lifeByHash.get(r.citizenIdHash);
      const ay = life?.birthYearAd ?? adBirth(r.birthYear);
      const age = ay ? currentYearAd - ay : null;

      if (track === 'ACADEMIC') academicTotal += 1;
      else supportTotal += 1;

      if (age !== null && age > 0 && age < 100) {
        const cell = (track === 'ACADEMIC' ? academicPyramid : supportPyramid).find(
          (c) => c.bucket === ageBucket(age),
        );
        if (cell) {
          if (r.genderId === '1') cell.male += 1;
          else if (r.genderId === '2') cell.female += 1;
          cell.total += 1;
        }
        if (age >= 55 && age < 60) {
          if (track === 'ACADEMIC') academicNearRetire += 1;
          else supportNearRetire += 1;
        }
      }

      if (r.dateStartThisU) {
        const tenureYears = currentYearAd - r.dateStartThisU.getFullYear();
        const buckets = track === 'ACADEMIC' ? tenureBucketsAcademic : tenureBucketsSupport;
        if (tenureYears < 5) buckets['<5']! += 1;
        else if (tenureYears < 10) buckets['5–9']! += 1;
        else if (tenureYears < 20) buckets['10–19']! += 1;
        else if (tenureYears < 30) buckets['20–29']! += 1;
        else buckets['30+']! += 1;
      }
    }

    // Per-faculty retirement-risk table (>20% retiring in 5y)
    const facultyRisk = new Map<string, { total: number; retire5y: number }>();
    for (const r of rows) {
      const fac = r.faculty?.nameTh ?? '∅ (unmapped)';
      const life = lifeByHash.get(r.citizenIdHash);
      const ay = life?.birthYearAd ?? adBirth(r.birthYear);
      const age = ay ? currentYearAd - ay : null;
      const cell = facultyRisk.get(fac) ?? { total: 0, retire5y: 0 };
      cell.total += 1;
      if (age !== null && age >= 55 && age < 60) cell.retire5y += 1;
      facultyRisk.set(fac, cell);
    }
    const riskRanked = [...facultyRisk.entries()]
      .filter(([, c]) => c.total >= 5)
      .map(([name, c]) => ({
        facultyName: name,
        total: c.total,
        retire5y: c.retire5y,
        pct: c.total > 0 ? (c.retire5y / c.total) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);

    return {
      academic: {
        total: academicTotal,
        nearRetirement: academicNearRetire,
        agePyramid: academicPyramid,
        tenureBuckets: tenureBucketsAcademic,
      },
      support: {
        total: supportTotal,
        nearRetirement: supportNearRetire,
        agePyramid: supportPyramid,
        tenureBuckets: tenureBucketsSupport,
      },
      facultyRetirementRisk: riskRanked,
    };
  }

  // ── 3. Faculty Composition by Program (academic only, drill-down) ─
  // Tree shape: Faculty → ProgramLevel → Program. Each row carries:
  //   * type3 (อาจารย์ผู้รับผิดชอบหลักสูตร — the 5-person responsible
  //     committee that MHESI requires per program)
  //   * type2 (อาจารย์ประจำหลักสูตร — curriculum lecturers; in practice
  //     KKU lists the same people as both type3 and type2)
  //   * distinctStaff — unique humans by citizen_id_hash, regardless of
  //     teach type. NOT filtered by HR-match anymore (kku-hr is academic-
  //     only, so the previous filter under-counted dual-appointment and
  //     researcher-track staff).
  // Type 1 (อาจารย์ประจำ — any faculty teaching in the program) is omitted —
  // it overlaps heavily with type 2/3 and isn't load-bearing for the
  // MHESI 5-responsible-faculty rule.
  async facultyByProgram() {
    const rows = await prisma.$queryRaw<
      Array<{
        program_id: string;
        program_name_th: string;
        faculty_name_th: string;
        program_level: string;
        teach_type_2: number;
        teach_type_3: number;
        distinct_staff: number;
      }>
    >`
      SELECT p.id::text AS program_id,
             p.name_th  AS program_name_th,
             f.name_th  AS faculty_name_th,
             p.level::text AS program_level,
             SUM(CASE WHEN spa.teach_type_id = 2 THEN 1 ELSE 0 END)::int AS teach_type_2,
             SUM(CASE WHEN spa.teach_type_id = 3 THEN 1 ELSE 0 END)::int AS teach_type_3,
             COUNT(DISTINCT spa.citizen_id_hash)::int AS distinct_staff
        FROM staff_program_assignment spa
        JOIN programs p ON p.id = spa.program_id
        JOIN faculties f ON f.id = p.faculty_id
       GROUP BY p.id, p.name_th, f.name_th, p.level
    `;

    const studentCounts = await prisma.$queryRaw<Array<{ program_id: string; n: number }>>`
      SELECT program_id::text AS program_id, COUNT(*)::int AS n
        FROM student_program_record
       WHERE program_id IS NOT NULL
       GROUP BY program_id
    `;
    const studByProg = new Map(studentCounts.map((s) => [s.program_id, s.n]));

    // Build the 3-level drill-down tree.
    interface ProgramLeaf {
      programId: string;
      programName: string;
      teachType2: number;
      teachType3: number;
      distinctStaff: number;
      studentCount: number;
      studentsPerStaff: number | null;
      meetsResponsibleMin: boolean;
    }
    interface LevelBranch {
      programLevel: string;
      programs: ProgramLeaf[];
      teachType2: number;
      teachType3: number;
      distinctStaff: number;
      studentCount: number;
      studentsPerStaff: number | null;
      programCount: number;
      programsBelowMin: number;
    }
    interface FacultyBranch {
      facultyName: string;
      levels: LevelBranch[];
      teachType2: number;
      teachType3: number;
      distinctStaff: number;
      studentCount: number;
      studentsPerStaff: number | null;
      programCount: number;
      programsBelowMin: number;
    }

    const facMap = new Map<string, Map<string, ProgramLeaf[]>>();
    for (const r of rows) {
      const tt3 = Number(r.teach_type_3);
      const distinct = Number(r.distinct_staff);
      const students = studByProg.get(r.program_id) ?? 0;
      const leaf: ProgramLeaf = {
        programId: r.program_id,
        programName: r.program_name_th,
        teachType2: Number(r.teach_type_2),
        teachType3: tt3,
        distinctStaff: distinct,
        studentCount: students,
        studentsPerStaff: distinct > 0 ? students / distinct : null,
        meetsResponsibleMin: tt3 >= 5,
      };
      let lvl = facMap.get(r.faculty_name_th);
      if (!lvl) {
        lvl = new Map();
        facMap.set(r.faculty_name_th, lvl);
      }
      const list = lvl.get(r.program_level) ?? [];
      list.push(leaf);
      lvl.set(r.program_level, list);
    }

    function summarise(programs: ProgramLeaf[]) {
      const tt2 = programs.reduce((a, b) => a + b.teachType2, 0);
      const tt3 = programs.reduce((a, b) => a + b.teachType3, 0);
      const distinct = programs.reduce((a, b) => a + b.distinctStaff, 0);
      const students = programs.reduce((a, b) => a + b.studentCount, 0);
      const programsBelowMin = programs.filter((p) => !p.meetsResponsibleMin).length;
      return {
        teachType2: tt2,
        teachType3: tt3,
        distinctStaff: distinct,
        studentCount: students,
        studentsPerStaff: distinct > 0 ? students / distinct : null,
        programCount: programs.length,
        programsBelowMin,
      };
    }

    const tree: FacultyBranch[] = [...facMap.entries()].map(([facName, lvlMap]) => {
      const levels: LevelBranch[] = [...lvlMap.entries()].map(([lvl, programs]) => ({
        programLevel: lvl,
        programs: [...programs].sort((a, b) => compareThai(a.programName, b.programName)),
        ...summarise(programs),
      }));
      const flat = levels.flatMap((l) => l.programs);
      return {
        facultyName: facName,
        levels: levels.sort((a, b) => compareLevel(a.programLevel, b.programLevel)),
        ...summarise(flat),
      };
    });

    return {
      thresholds: { responsibleMinimum: 5 },
      faculties: tree.sort((a, b) => compareThai(a.facultyName, b.facultyName)),
    };
  }

  // ── 4. Specialisation & Skills (academic focus) ──────────────────
  async specialisations(filter: StaffFilter) {
    const where = this.whereFromFilter(filter);
    const rows = await prisma.staffMasterRecord.findMany({
      where: { ...where, subStaffTypeId: { in: ['1', '4'] } },
      select: {
        academicStandingSubjectId: true,
        academicStandingSubjectOther: true,
        specialNameId1: true,
        specialNameId2: true,
        teachLevelId: true,
        academicStandingId: true,
        faculty: { select: { nameTh: true } },
      },
    });

    // Specialisation counts (REF_ACADEMICSTANDING_SUBJECT id → count)
    const subjectCounts = new Map<string, number>();
    for (const r of rows) {
      for (const id of [r.academicStandingSubjectId, r.specialNameId1, r.specialNameId2]) {
        if (!id || id === '-' || id === '0000') continue;
        subjectCounts.set(id, (subjectCounts.get(id) ?? 0) + 1);
      }
    }

    // Specialisation by faculty (matrix)
    const facultyToSubjects = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const fac = r.faculty?.nameTh ?? '∅';
      let row = facultyToSubjects.get(fac);
      if (!row) {
        row = new Map();
        facultyToSubjects.set(fac, row);
      }
      for (const id of [r.academicStandingSubjectId, r.specialNameId1, r.specialNameId2]) {
        if (!id || id === '-' || id === '0000') continue;
        row.set(id, (row.get(id) ?? 0) + 1);
      }
    }

    // Teach-level distribution (which levels academic staff teach)
    const teachLevelCounts: Record<string, number> = {};
    for (const r of rows) {
      if (!r.teachLevelId || r.teachLevelId === '-') {
        teachLevelCounts['ไม่ได้สอน'] = (teachLevelCounts['ไม่ได้สอน'] ?? 0) + 1;
      } else {
        // Pipe-delimited list of teach levels
        for (const lvl of r.teachLevelId.split('|').map((s) => s.trim()).filter(Boolean)) {
          teachLevelCounts[lvl] = (teachLevelCounts[lvl] ?? 0) + 1;
        }
      }
    }

    return {
      totalAcademic: rows.length,
      topSubjects: [...subjectCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([id, count]) => ({ subjectId: id, count })),
      bySubjectByFaculty: [...facultyToSubjects.entries()].map(([fac, m]) => ({
        facultyName: fac,
        subjects: [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ subjectId: id, count: n })),
      })).sort((a, b) => compareThai(a.facultyName, b.facultyName)),
      teachLevelDistribution: Object.entries(teachLevelCounts)
        .map(([level, n]) => ({ level, count: n }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ── 5. Research Output ───────────────────────────────────────────
  // Consolidated 2026-05-07: was the old staff_master_records-based view.
  // Now grounded in FacultyMember + ResearchOutput directly, surfacing
  // the kku-publications mirror corpus including kkupub_-backfilled
  // active staff (covers 99.6% of authorships). Replaces the previous
  // /staff/publications view; backend method renamed accordingly.
  // Lives at /staff-dashboard/research.

  // ── 6. Compensation & Funding ────────────────────────────────────
  async compensation(filter: StaffFilter) {
    const where = this.whereFromFilter(filter);
    const masterRows = await prisma.staffMasterRecord.findMany({
      where,
      select: {
        subStaffTypeId: true,
        budgetId: true,
        incomeId: true,
        faculty: { select: { nameTh: true } },
      },
    });

    // Budget source × track
    const budgetByTrack = new Map<string, { academic: number; support: number }>();
    for (const r of masterRows) {
      const k = lookupOrCode(BUDGET_SOURCE, r.budgetId);
      const cell = budgetByTrack.get(k) ?? { academic: 0, support: 0 };
      if (staffTrack(r.subStaffTypeId) === 'ACADEMIC') cell.academic += 1;
      else cell.support += 1;
      budgetByTrack.set(k, cell);
    }

    // Income-band × track
    const incomeByTrack = new Map<string, { academic: number; support: number }>();
    for (const id of INCOME_BAND_ORDER) incomeByTrack.set(id, { academic: 0, support: 0 });
    for (const r of masterRows) {
      const id = (r.incomeId ?? '').padStart(2, '0');
      if (!INCOME_BAND_ORDER.includes(id)) continue;
      const cell = incomeByTrack.get(id)!;
      if (staffTrack(r.subStaffTypeId) === 'ACADEMIC') cell.academic += 1;
      else cell.support += 1;
    }

    // Aggregate compensation cells from processed-HR (n>=5).
    // Two normalisation rules:
    //   * รวม กอง*** → สำนักงานอธิการบดี (the divisions roll up to the
    //     Office of the President in the org chart).
    //   * ∅ sal_type → "เงินรายได้" (the source data leaves it blank when
    //     the row is funded purely from university revenue).
    const rawCompRows = await prisma.staffCompensationCube.findMany();
    function normaliseFaculty(name: string): string {
      const t = name.trim();
      if (t.startsWith('กอง')) return 'สำนักงานอธิการบดี';
      return t || 'สำนักงานอธิการบดี';
    }
    function normaliseSalType(sal: string | null): string {
      const t = (sal ?? '').trim();
      if (!t || t === '∅') return 'เงินรายได้';
      return t;
    }

    // Re-aggregate after normalisation. Build rows for the drill-down
    // pivot: Faculty → Track → Funding-source.
    interface CompCell {
      facultyName: string;
      track: 'ACADEMIC' | 'SUPPORT';
      salType: string;
      level: string | null;
      headcount: number;
      meanSalary: number;
      minSalary: number;
      maxSalary: number;
      sumSalary: number;
    }
    const cells: CompCell[] = [];
    for (const r of rawCompRows) {
      cells.push({
        facultyName: normaliseFaculty(r.facultyName),
        track: r.isAcademic ? 'ACADEMIC' : 'SUPPORT',
        salType: normaliseSalType(r.salType),
        level: r.level,
        headcount: r.headcount,
        meanSalary: r.meanSalary,
        minSalary: r.minSalary,
        maxSalary: r.maxSalary,
        sumSalary: r.sumSalary,
      });
    }

    // Build the 3-level drill-down structure: Faculty → Track → Funding.
    // Each leaf carries weighted-average salary stats so the pivot can
    // sort by faculty/track/funding without losing the per-cell detail.
    interface FundLeaf {
      salType: string;
      headcount: number;
      meanSalary: number;
      minSalary: number;
      maxSalary: number;
    }
    interface TrackBranch {
      track: 'ACADEMIC' | 'SUPPORT';
      headcount: number;
      meanSalary: number;
      minSalary: number;
      maxSalary: number;
      children: FundLeaf[];
    }
    interface FacultyBranch {
      facultyName: string;
      headcount: number;
      meanSalary: number;
      minSalary: number;
      maxSalary: number;
      children: TrackBranch[];
    }

    const facMap = new Map<string, Map<'ACADEMIC' | 'SUPPORT', Map<string, { headcount: number; sum: number; min: number; max: number }>>>();
    for (const c of cells) {
      let lvl1 = facMap.get(c.facultyName);
      if (!lvl1) {
        lvl1 = new Map();
        facMap.set(c.facultyName, lvl1);
      }
      let lvl2 = lvl1.get(c.track);
      if (!lvl2) {
        lvl2 = new Map();
        lvl1.set(c.track, lvl2);
      }
      const existing = lvl2.get(c.salType) ?? {
        headcount: 0,
        sum: 0,
        min: Number.POSITIVE_INFINITY,
        max: 0,
      };
      existing.headcount += c.headcount;
      existing.sum += c.sumSalary;
      existing.min = Math.min(existing.min, c.minSalary);
      existing.max = Math.max(existing.max, c.maxSalary);
      lvl2.set(c.salType, existing);
    }

    function rollup(stats: { headcount: number; sum: number; min: number; max: number }) {
      return {
        headcount: stats.headcount,
        meanSalary: stats.headcount > 0 ? stats.sum / stats.headcount : 0,
        minSalary: stats.min === Number.POSITIVE_INFINITY ? 0 : stats.min,
        maxSalary: stats.max,
      };
    }

    const drillDown: FacultyBranch[] = [...facMap.entries()].map(([fac, byTrack]) => {
      const trackBranches: TrackBranch[] = [];
      let facStats = { headcount: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: 0 };
      for (const [track, byFund] of byTrack) {
        const leaves: FundLeaf[] = [];
        let trackStats = { headcount: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: 0 };
        for (const [salType, leafStats] of byFund) {
          leaves.push({ salType, ...rollup(leafStats) });
          trackStats.headcount += leafStats.headcount;
          trackStats.sum += leafStats.sum;
          trackStats.min = Math.min(trackStats.min, leafStats.min);
          trackStats.max = Math.max(trackStats.max, leafStats.max);
        }
        leaves.sort((a, b) => b.headcount - a.headcount);
        trackBranches.push({ track, ...rollup(trackStats), children: leaves });
        facStats.headcount += trackStats.headcount;
        facStats.sum += trackStats.sum;
        facStats.min = Math.min(facStats.min, trackStats.min);
        facStats.max = Math.max(facStats.max, trackStats.max);
      }
      trackBranches.sort((a, b) => b.headcount - a.headcount);
      return { facultyName: fac, ...rollup(facStats), children: trackBranches };
    });
    drillDown.sort((a, b) => b.headcount - a.headcount);

    return {
      budgetByTrack: [...budgetByTrack.entries()].map(([source, cell]) => ({
        source,
        academic: cell.academic,
        support: cell.support,
        total: cell.academic + cell.support,
      })),
      incomeByTrack: INCOME_BAND_ORDER.map((id) => ({
        bandId: id,
        bandLabel: INCOME_BAND[id]!,
        academic: incomeByTrack.get(id)!.academic,
        support: incomeByTrack.get(id)!.support,
      })),
      drillDown,
      sources: {
        masterRowCount: masterRows.length,
        compensationCells: rawCompRows.length,
        notice:
          'อัปเดตจาก processed-HR (HAVING n≥5 บังคับ server-side). กอง* รวมเข้า สำนักงานอธิการบดี; ∅ sal_type → เงินรายได้.',
      },
    };
  }

  // ── 6. (consolidated entry point — see comment block at §5 above) ──
  async researchOutput(filter: { facultyName?: string[]; sources?: string[]; yearFrom?: number }) {
    const yearFrom = filter.yearFrom ?? Number(process.env.KKU_RESEARCH_YEAR_FROM ?? 2015);
    const sourceFilter = filter.sources && filter.sources.length > 0
      ? filter.sources
      : ['kku-publications:scopus', 'kku-publications:pubmed'];

    // 5-minute cache. Publications data refreshes weekly via the
    // kku-research connector; 5 minutes is fresh enough for Council prep.
    // Fails open — Redis outage falls through to direct compute.
    const cacheKey = CacheService.keyOf('staff:research-v2', {
      facultyName: filter.facultyName?.sort() ?? [],
      sources: sourceFilter.slice().sort(),
      yearFrom,
    });
    const cached = await this.cache?.get<unknown>(cacheKey);
    if (cached) return cached;
    const result = await this.computeResearchOutput(filter, sourceFilter, yearFrom);
    await this.cache?.set(cacheKey, result, 60 * 5);
    return result;
  }

  private async computeResearchOutput(
    filter: { facultyName?: string[]; sources?: string[]; yearFrom?: number },
    sourceFilter: string[],
    yearFrom: number,
  ) {

    // FacultyMember snapshot — always filter to active employees only.
    // The program-landscape application is a "current portfolio" tool;
    // retired/historical authors get filtered upstream. For kku-hr rows,
    // isActive comes from KKU HR; for kkupub_-backfilled rows it's
    // heuristic (paper in last 2 years).
    const facultyWhere: Prisma.FacultyMemberWhereInput = { isActive: true };
    if (filter.facultyName && filter.facultyName.length > 0) {
      facultyWhere.faculty = { OR: [{ nameTh: { in: filter.facultyName } }, { nameEn: { in: filter.facultyName } }] };
    }
    const fmRows = await prisma.facultyMember.findMany({
      where: facultyWhere,
      select: {
        id: true,
        nameTh: true,
        nameEn: true,
        rank: true,
        isActive: true,
        employeeCode: true,
        facultyId: true,
        faculty: { select: { nameTh: true, nameEn: true } },
        department: { select: { nameTh: true, nameEn: true } },
      },
    });
    const fmIds = fmRows.map((r) => r.id);

    // Research output — filtered to FM IDs + source + year window
    const papers =
      fmIds.length === 0
        ? []
        : await prisma.researchOutput.findMany({
            where: {
              facultyMemberId: { in: fmIds },
              source: { in: sourceFilter },
              year: { gte: yearFrom },
            },
            select: {
              facultyMemberId: true,
              year: true,
              type: true,
              source: true,
              venue: true,
              citations: true,
              doi: true,
              scopusId: true,
              pmid: true,
            },
          });

    const fmById = new Map(fmRows.map((r) => [r.id, r]));

    // Per-author roll-up
    interface AuthorAgg {
      fmId: string;
      nameTh: string | null;
      nameEn: string | null;
      rank: string;
      isActive: boolean;
      employeeSource: 'kku-hr' | 'kku-publications' | 'other';
      facultyName: string | null;
      departmentName: string | null;
      papers: number;
      citations: number;
      hIndex: number;
      mostRecentYear: number | null;
      bySource: Record<string, number>;
    }
    const perAuthor = new Map<string, AuthorAgg>();
    const authorCitations = new Map<string, number[]>();

    for (const p of papers) {
      if (!p.facultyMemberId) continue;
      const cites = authorCitations.get(p.facultyMemberId) ?? [];
      cites.push(p.citations ?? 0);
      authorCitations.set(p.facultyMemberId, cites);
    }

    function hIndex(citations: number[]): number {
      const sorted = [...citations].sort((a, b) => b - a);
      let h = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i]! >= i + 1) h = i + 1;
        else break;
      }
      return h;
    }

    function classifyEmployeeSource(code: string): 'kku-hr' | 'kku-publications' | 'other' {
      if (code.startsWith('hr_')) return 'kku-hr';
      if (code.startsWith('kkupub_')) return 'kku-publications';
      return 'other';
    }

    for (const fm of fmRows) {
      const cites = authorCitations.get(fm.id) ?? [];
      const sourceCounts: Record<string, number> = {};
      const yearsSeen: number[] = [];
      for (const p of papers) {
        if (p.facultyMemberId !== fm.id) continue;
        const src = p.source ?? 'unknown';
        sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
        yearsSeen.push(p.year);
      }
      const totalCitations = cites.reduce((a, b) => a + b, 0);
      perAuthor.set(fm.id, {
        fmId: fm.id,
        nameTh: fm.nameTh,
        nameEn: fm.nameEn,
        rank: fm.rank,
        isActive: fm.isActive,
        employeeSource: classifyEmployeeSource(fm.employeeCode),
        facultyName: fm.faculty?.nameEn ?? fm.faculty?.nameTh ?? null,
        departmentName: fm.department?.nameEn ?? fm.department?.nameTh ?? null,
        papers: cites.length,
        citations: totalCitations,
        hIndex: hIndex(cites),
        mostRecentYear: yearsSeen.length > 0 ? Math.max(...yearsSeen) : null,
        bySource: sourceCounts,
      });
    }

    // ── Dedup-by-paper roll-up groundwork ────────────────────────────
    // The papers[] rows we pull are (paper × author) tuples — a single
    // multi-author paper appears N times. Counting these directly inflates
    // every paper-count metric (~2x for medical PubMed papers with co-
    // authors at KKU). Reconciling against the KKU Library dashboard
    // showed PubMed at 1,963 vs library 1,058 (2022) — exactly the ~2x
    // signature. Library reports distinct papers; we should too.
    //
    // We still need per-author rows for rank productivity + topAuthors,
    // but every paper-count metric below is keyed off this dedup map.
    interface DistinctPaper {
      key: string; // ${source}:${externalId}
      year: number;
      type: string;
      source: string;
      venue: string | null;
      citations: number;
      facultyNames: Set<string>; // every faculty that has ≥1 author on this paper
    }
    const paperMap = new Map<string, DistinctPaper>();
    for (const p of papers) {
      const externalId =
        p.source === 'kku-publications:scopus' ? p.scopusId : p.pmid;
      if (!externalId) continue;
      const key = `${p.source}:${externalId}`;
      let entry = paperMap.get(key);
      if (!entry) {
        entry = {
          key,
          year: p.year,
          type: p.type ?? 'JOURNAL',
          source: p.source ?? 'unknown',
          venue: p.venue,
          citations: p.citations ?? 0,
          facultyNames: new Set<string>(),
        };
        paperMap.set(key, entry);
      }
      const fm = fmById.get(p.facultyMemberId ?? '');
      const fname = fm?.faculty?.nameEn ?? fm?.faculty?.nameTh ?? null;
      if (fname) entry.facultyNames.add(fname);
    }

    // Per-faculty rollup — papers/citations counted once per (faculty, paper).
    // A paper with 2 authors in the same faculty contributes 1 to that
    // faculty (not 2); a paper with authors in 2 faculties contributes 1
    // to each.
    const byFaculty = new Map<
      string,
      {
        facultyName: string;
        staffCount: number;
        publishingStaff: number;
        papers: number;
        citations: number;
        bySource: Record<string, number>;
        byType: Record<string, number>;
      }
    >();
    for (const fm of fmRows) {
      const fname = fm.faculty?.nameEn ?? fm.faculty?.nameTh ?? '(unmapped)';
      const cell = byFaculty.get(fname) ?? {
        facultyName: fname,
        staffCount: 0,
        publishingStaff: 0,
        papers: 0,
        citations: 0,
        bySource: {},
        byType: {},
      };
      cell.staffCount += 1;
      // publishingStaff counts staff who have ≥1 paper (per-author still)
      if ((perAuthor.get(fm.id)?.papers ?? 0) > 0) cell.publishingStaff += 1;
      byFaculty.set(fname, cell);
    }
    for (const paper of paperMap.values()) {
      for (const fname of paper.facultyNames) {
        const cell = byFaculty.get(fname);
        if (!cell) continue;
        cell.papers += 1;
        cell.citations += paper.citations;
        cell.bySource[paper.source] = (cell.bySource[paper.source] ?? 0) + 1;
        cell.byType[paper.type] = (cell.byType[paper.type] ?? 0) + 1;
      }
    }

    // Year × Faculty heatmap — distinct papers per (faculty, year)
    const heatmap = new Map<string, Map<number, number>>();
    for (const paper of paperMap.values()) {
      for (const fname of paper.facultyNames) {
        const facMap = heatmap.get(fname) ?? new Map<number, number>();
        facMap.set(paper.year, (facMap.get(paper.year) ?? 0) + 1);
        heatmap.set(fname, facMap);
      }
    }

    // Year totals — distinct papers per (year, source). Split per-source
    // so the chart surfaces the curator-resolution lag on Scopus directly
    // (Scopus 2022+ underrepresents real KKU output because the upstream
    // mirror's person_id linking lags ~2 years behind ingestion).
    const byYearMap = new Map<number, { scopus: number; pubmed: number }>();
    for (const paper of paperMap.values()) {
      const cell = byYearMap.get(paper.year) ?? { scopus: 0, pubmed: 0 };
      if (paper.source === 'kku-publications:scopus') cell.scopus += 1;
      else if (paper.source === 'kku-publications:pubmed') cell.pubmed += 1;
      byYearMap.set(paper.year, cell);
    }

    // Type breakdown (Journal / Conference / Book / Patent) — distinct papers
    const byType: Record<string, number> = {};
    for (const paper of paperMap.values()) {
      byType[paper.type] = (byType[paper.type] ?? 0) + 1;
    }

    // Source breakdown — distinct papers
    const bySource: Record<string, number> = {};
    for (const paper of paperMap.values()) {
      bySource[paper.source] = (bySource[paper.source] ?? 0) + 1;
    }

    // Top venues — distinct papers per venue
    const venueCounts = new Map<string, number>();
    for (const paper of paperMap.values()) {
      if (!paper.venue) continue;
      venueCounts.set(paper.venue, (venueCounts.get(paper.venue) ?? 0) + 1);
    }
    const topVenues = [...venueCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([venue, papers]) => ({ venue, papers }));

    // Top authors leaderboard (top 30 by paper count)
    const authorList = [...perAuthor.values()].filter((a) => a.papers > 0);
    const topAuthors = [...authorList].sort((a, b) => b.papers - a.papers).slice(0, 30);

    // Productivity by academic rank — kku-hr-sourced staff only.
    // The 326 kkupub_-backfilled rows carry rank=LECTURER as a placeholder
    // (the publications mirror doesn't record rank) and would skew the
    // averages. We exclude them here and surface "rank rollup ⊆ HR-sourced
    // staff only" as an explicit caveat.
    type RankCell = {
      rank: string;
      rankRank: number; // ordering: PROF=4, ASSOC_PROF=3, ASST_PROF=2, LECTURER=1
      staffCount: number;
      publishingStaff: number;
      papers: number;
      citations: number;
      maxHIndex: number;
    };
    const RANK_ORDER: Record<string, number> = {
      PROF: 4,
      ASSOC_PROF: 3,
      ASST_PROF: 2,
      LECTURER: 1,
    };
    const RANK_LABEL: Record<string, string> = {
      PROF: 'Professor',
      ASSOC_PROF: 'Associate Professor',
      ASST_PROF: 'Assistant Professor',
      LECTURER: 'Lecturer',
    };
    const byRankMap = new Map<string, RankCell>();
    for (const fm of fmRows) {
      if (!fm.employeeCode.startsWith('hr_')) continue; // exclude kkupub_ placeholders
      const cell = byRankMap.get(fm.rank) ?? {
        rank: fm.rank,
        rankRank: RANK_ORDER[fm.rank] ?? 0,
        staffCount: 0,
        publishingStaff: 0,
        papers: 0,
        citations: 0,
        maxHIndex: 0,
      };
      cell.staffCount += 1;
      const author = perAuthor.get(fm.id);
      if (author && author.papers > 0) {
        cell.publishingStaff += 1;
        cell.papers += author.papers;
        cell.citations += author.citations;
        if (author.hIndex > cell.maxHIndex) cell.maxHIndex = author.hIndex;
      }
      byRankMap.set(fm.rank, cell);
    }
    const byRank = [...byRankMap.values()]
      .map((cell) => ({
        rank: cell.rank,
        rankLabel: RANK_LABEL[cell.rank] ?? cell.rank,
        rankRank: cell.rankRank,
        staffCount: cell.staffCount,
        publishingStaff: cell.publishingStaff,
        papers: cell.papers,
        citations: cell.citations,
        avgPapersPerStaff: cell.staffCount > 0 ? cell.papers / cell.staffCount : 0,
        avgCitesPerStaff: cell.staffCount > 0 ? cell.citations / cell.staffCount : 0,
        maxHIndex: cell.maxHIndex,
      }))
      .sort((a, b) => b.rankRank - a.rankRank); // most senior first

    let totalCitations = 0;
    for (const paper of paperMap.values()) totalCitations += paper.citations;
    return {
      yearFrom,
      yearTo: new Date().getFullYear(),
      totalStaff: fmRows.length,
      publishingStaff: authorList.length,
      totalPapers: paperMap.size,
      totalCitations,
      bySource,
      byType,
      byYear: [...byYearMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, cell]) => ({
          year,
          scopus: cell.scopus,
          pubmed: cell.pubmed,
          total: cell.scopus + cell.pubmed,
        })),
      byFaculty: [...byFaculty.values()].sort((a, b) => b.papers - a.papers),
      heatmap: [...heatmap.entries()]
        .sort((a, b) => {
          const aTotal = [...a[1].values()].reduce((s, v) => s + v, 0);
          const bTotal = [...b[1].values()].reduce((s, v) => s + v, 0);
          return bTotal - aTotal;
        })
        .map(([facultyName, yearMap]) => ({
          facultyName,
          years: [...yearMap.entries()].sort((a, b) => a[0] - b[0]).map(([year, papers]) => ({ year, papers })),
        })),
      topVenues,
      topAuthors,
      perAuthor: authorList,
      byRank,
      employeeSourceMix: {
        kkuHr: authorList.filter((a) => a.employeeSource === 'kku-hr').length,
        kkuPublications: authorList.filter((a) => a.employeeSource === 'kku-publications').length,
        other: authorList.filter((a) => a.employeeSource === 'other').length,
      },
      caveats: [
        'Paper counts (totalPapers, byYear, byFaculty, topVenues, etc.) are distinct papers — a paper with N KKU co-authors counts once. Reconciles with KKU Library dashboard PubMed within 1-3% (e.g. our 2024 = library 997).',
        'Scopus 2022+ counts undercount real KKU output. The kku-publications mirror has fresh Scopus papers through 2026 (2,349 in 2025 alone), but KKU Library curators have not yet linked them to KKU person_ids — only ~12% of 2022 papers, ~1% of 2023, ~0.1% of 2024 are author-resolved. PubMed is unaffected. KKU Library reports ~1,200-1,900 Scopus papers/year for 2022-2025 (presumably from a separate Scopus-API source that bypasses the mirror); we surface only what the mirror has resolved.',
        'Active employees only. For kku-hr rows isActive comes from KKU HR; for kkupub_-backfilled rows it is heuristic (paper in last 2 years).',
        'kku-publications:pubmed citation count is 0 because pubmed_documents in the mirror does not carry counts; total citations reflects Scopus only.',
        'Productivity-by-rank breakdown is restricted to kku-hr-sourced staff (employee_code prefix hr_). The 326 kkupub_-backfilled rows carry rank=LECTURER as a placeholder and are excluded from that section to keep the averages meaningful.',
      ],
    };
  }
}
