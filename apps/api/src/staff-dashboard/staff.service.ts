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

  // ── 5. Research Output (academic only) ───────────────────────────
  async researchOutput(filter: StaffFilter) {
    const fiveYearsAgo = new Date().getFullYear() - 5;
    const where = this.whereFromFilter(filter);
    const academicStaff = await prisma.staffMasterRecord.findMany({
      where: { ...where, subStaffTypeId: { in: ['1', '4'] } },
      select: {
        citizenIdHash: true,
        firstName: true,
        lastName: true,
        academicStandingId: true,
        faculty: { select: { nameTh: true } },
      },
    });
    const hashToStaff = new Map(academicStaff.map((s) => [s.citizenIdHash, s]));
    const allHashes = [...hashToStaff.keys()];

    // Pull every paper-citation row matched to one of our academic staff,
    // 5-year window. Need per-paper citations to compute h-index.
    const papers =
      allHashes.length === 0
        ? []
        : await prisma.$queryRaw<Array<{ citizen_id_hash: string; citations: number }>>`
            SELECT fm.citizen_id_hash, ro.citations
              FROM research_outputs ro
              JOIN faculty_members fm ON fm.id = ro.faculty_member_id
             WHERE fm.citizen_id_hash = ANY(${allHashes})
               AND ro.year >= ${fiveYearsAgo}
          `;

    // Group papers by author hash
    const papersByAuthor = new Map<string, number[]>();
    for (const p of papers) {
      const list = papersByAuthor.get(p.citizen_id_hash) ?? [];
      list.push(Number(p.citations));
      papersByAuthor.set(p.citizen_id_hash, list);
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

    // Per-author summary
    const perAuthor = academicStaff
      .map((s) => {
        const cites = papersByAuthor.get(s.citizenIdHash) ?? [];
        const totalCitations = cites.reduce((a, b) => a + b, 0);
        const fullName = [s.firstName, s.lastName].filter(Boolean).join(' ') || null;
        return {
          citizenIdHash: s.citizenIdHash,
          nameTh: fullName,
          rank: lookupOrCode(ACADEMIC_STANDING, s.academicStandingId),
          rankRank: ACADEMIC_STANDING_RANK[(s.academicStandingId ?? '').padStart(2, '0')] ?? 0,
          facultyName: s.faculty?.nameTh ?? null,
          publications: cites.length,
          citations: totalCitations,
          hIndex: hIndex(cites),
        };
      })
      // Top producers list — anyone with at least 1 publication
      .filter((p) => p.publications > 0);

    // Per-faculty rollup
    const byFaculty = new Map<string, { staffCount: number; staffWithPubs: number; pubsLast5y: number; citations: number }>();
    for (const s of academicStaff) {
      const fac = s.faculty?.nameTh;
      if (!fac) continue;
      const cites = papersByAuthor.get(s.citizenIdHash) ?? [];
      const cell = byFaculty.get(fac) ?? { staffCount: 0, staffWithPubs: 0, pubsLast5y: 0, citations: 0 };
      cell.staffCount += 1;
      if (cites.length > 0) cell.staffWithPubs += 1;
      cell.pubsLast5y += cites.length;
      cell.citations += cites.reduce((a, b) => a + b, 0);
      byFaculty.set(fac, cell);
    }

    // Per-rank rollup (with rankRank for chart ordering)
    const byRank = new Map<string, { rank: string; rankRank: number; staffCount: number; pubsLast5y: number; citations: number; hIndexMax: number }>();
    for (const s of academicStaff) {
      const code = (s.academicStandingId ?? '').padStart(2, '0');
      const rank = lookupOrCode(ACADEMIC_STANDING, code) || 'ไม่มีตำแหน่งทางวิชาการ';
      const rankRank = ACADEMIC_STANDING_RANK[code] ?? 0;
      const cites = papersByAuthor.get(s.citizenIdHash) ?? [];
      const cell = byRank.get(rank) ?? { rank, rankRank, staffCount: 0, pubsLast5y: 0, citations: 0, hIndexMax: 0 };
      cell.staffCount += 1;
      cell.pubsLast5y += cites.length;
      cell.citations += cites.reduce((a, b) => a + b, 0);
      cell.hIndexMax = Math.max(cell.hIndexMax, hIndex(cites));
      byRank.set(rank, cell);
    }

    // ORCID coverage
    const orcid = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM faculty_members WHERE orcid IS NOT NULL
    `;
    const staffWithOrcid = Number(orcid[0]?.n ?? 0);

    return {
      windowYears: 5,
      facultyTotal: academicStaff.length,
      authorsWithPubs: perAuthor.length,
      totalPubs: perAuthor.reduce((a, b) => a + b.publications, 0),
      totalCitations: perAuthor.reduce((a, b) => a + b.citations, 0),
      orcidCoverage: { withOrcid: staffWithOrcid, total: academicStaff.length },
      byFaculty: [...byFaculty.entries()]
        .map(([name, cell]) => ({
          facultyName: name,
          staffCount: cell.staffCount,
          staffWithPubs: cell.staffWithPubs,
          pubsLast5y: cell.pubsLast5y,
          citations: cell.citations,
          intensity: cell.staffCount > 0 ? cell.pubsLast5y / cell.staffCount / 5 : 0,
        }))
        .sort((a, b) => b.pubsLast5y - a.pubsLast5y),
      byRank: [...byRank.values()]
        .map((cell) => ({
          rank: cell.rank,
          rankRank: cell.rankRank,
          staffCount: cell.staffCount,
          pubsLast5y: cell.pubsLast5y,
          citations: cell.citations,
          avgPubsPerStaff: cell.staffCount > 0 ? cell.pubsLast5y / cell.staffCount : 0,
          avgCitesPerStaff: cell.staffCount > 0 ? cell.citations / cell.staffCount : 0,
          maxHIndex: cell.hIndexMax,
        }))
        .sort((a, b) => a.rankRank - b.rankRank),
      // For the drill-down: Faculty → Author rows, with sortable metrics
      perAuthor,
    };
  }

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

  // ── 6. Publications (kku-publications mirror) ────────────────────
  // Grounded in FacultyMember + ResearchOutput directly, NOT in
  // staff_master_records like /research is. This view surfaces the full
  // publications corpus including kkupub_-prefixed FacultyMember rows
  // backfilled from the kku-publications mirror — covering 99.6% of the
  // 65,717 paper×author authorships from Scopus + PubMed in the kku-research
  // window (default 2015+).
  //
  // Differs from /research:
  //   /research      → kku-hr-employed staff only (joined via citizen_id_hash); 5y window
  //   /publications  → all FacultyMember (employed + kku-publications-backfilled); year-from configurable
  async publications(filter: { facultyName?: string[]; sources?: string[]; activeOnly?: boolean; yearFrom?: number }) {
    const yearFrom = filter.yearFrom ?? Number(process.env.KKU_RESEARCH_YEAR_FROM ?? 2015);
    const sourceFilter = filter.sources && filter.sources.length > 0
      ? filter.sources
      : ['kku-publications:scopus', 'kku-publications:pubmed'];

    // 5-minute cache. Publications data refreshes weekly via the
    // kku-research connector; 5 minutes is fresh enough for Council prep.
    // Fails open — Redis outage falls through to direct compute.
    const cacheKey = CacheService.keyOf('staff:publications', {
      facultyName: filter.facultyName?.sort() ?? [],
      sources: sourceFilter.slice().sort(),
      activeOnly: filter.activeOnly ?? false,
      yearFrom,
    });
    const cached = await this.cache?.get<unknown>(cacheKey);
    if (cached) return cached;
    const result = await this.computePublications(filter, sourceFilter, yearFrom);
    await this.cache?.set(cacheKey, result, 60 * 5);
    return result;
  }

  private async computePublications(
    filter: { facultyName?: string[]; sources?: string[]; activeOnly?: boolean; yearFrom?: number },
    sourceFilter: string[],
    yearFrom: number,
  ) {

    // FacultyMember snapshot — filtered if facultyName supplied
    const facultyWhere: Prisma.FacultyMemberWhereInput = {};
    if (filter.activeOnly) facultyWhere.isActive = true;
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

    // Per-faculty rollup
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
      const myPapers = papers.filter((p) => p.facultyMemberId === fm.id);
      if (myPapers.length > 0) cell.publishingStaff += 1;
      cell.papers += myPapers.length;
      for (const p of myPapers) {
        cell.citations += p.citations ?? 0;
        const src = p.source ?? 'unknown';
        cell.bySource[src] = (cell.bySource[src] ?? 0) + 1;
        const t = p.type ?? 'JOURNAL';
        cell.byType[t] = (cell.byType[t] ?? 0) + 1;
      }
      byFaculty.set(fname, cell);
    }

    // Year × Faculty heatmap
    const heatmap = new Map<string, Map<number, number>>();
    for (const p of papers) {
      const fm = fmById.get(p.facultyMemberId ?? '');
      if (!fm) continue;
      const fname = fm.faculty?.nameEn ?? fm.faculty?.nameTh ?? '(unmapped)';
      const facMap = heatmap.get(fname) ?? new Map<number, number>();
      facMap.set(p.year, (facMap.get(p.year) ?? 0) + 1);
      heatmap.set(fname, facMap);
    }

    // Year totals (for trend line)
    const byYear = new Map<number, number>();
    for (const p of papers) byYear.set(p.year, (byYear.get(p.year) ?? 0) + 1);

    // Type breakdown (Journal / Conference / Book / Patent)
    const byType: Record<string, number> = {};
    for (const p of papers) {
      const t = p.type ?? 'JOURNAL';
      byType[t] = (byType[t] ?? 0) + 1;
    }

    // Source breakdown
    const bySource: Record<string, number> = {};
    for (const p of papers) {
      const s = p.source ?? 'unknown';
      bySource[s] = (bySource[s] ?? 0) + 1;
    }

    // Top venues (journals/conferences) by paper count
    const venueCounts = new Map<string, number>();
    for (const p of papers) {
      if (!p.venue) continue;
      venueCounts.set(p.venue, (venueCounts.get(p.venue) ?? 0) + 1);
    }
    const topVenues = [...venueCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([venue, papers]) => ({ venue, papers }));

    // Top authors leaderboard (top 30 by paper count)
    const authorList = [...perAuthor.values()].filter((a) => a.papers > 0);
    const topAuthors = [...authorList].sort((a, b) => b.papers - a.papers).slice(0, 30);

    return {
      yearFrom,
      yearTo: new Date().getFullYear(),
      totalStaff: fmRows.length,
      publishingStaff: authorList.length,
      totalPapers: papers.length,
      totalCitations: papers.reduce((a, b) => a + (b.citations ?? 0), 0),
      bySource,
      byType,
      byYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, papers]) => ({ year, papers })),
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
      employeeSourceMix: {
        kkuHr: authorList.filter((a) => a.employeeSource === 'kku-hr').length,
        kkuPublications: authorList.filter((a) => a.employeeSource === 'kku-publications').length,
        other: authorList.filter((a) => a.employeeSource === 'other').length,
      },
      activeStaffSplit: {
        active: authorList.filter((a) => a.isActive).length,
        inactive: authorList.filter((a) => !a.isActive).length,
      },
      caveats: [
        'kku-publications:pubmed citation count is 0 because pubmed_documents in the mirror does not carry counts; total citations reflects Scopus only.',
        'Authors backfilled from kku-publications.people (employee_code prefix kkupub_) carry rank=LECTURER as a placeholder — the publications mirror does not record academic rank.',
        'isActive=true is heuristic for kkupub_-prefixed staff: paper in last 2 years. kku-hr-prefixed staff (hr_*) get isActive from KKU HR.',
      ],
    };
  }
}
