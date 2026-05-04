// Pure read function that pulls newly-fed system data for one Program
// from the curriculum-pipeline's surrounding context:
//
//   - DS2004  (staff_program_assignment) → staff list, joined to
//             FacultyMember by citizenIdHash; rank from FacultyMember
//   - DS2003  (staff_education_history)  → degree origin (TH vs intl)
//             for the program's resolved faculty members
//   - DS1001  (student_program_record)   → live student snapshot
//             (count, gender, status, GPA, admit-year mix)
//   - kku-hr  (FacultyMember)            → rank, names, ORCID
//
// The output is structured for two downstream consumers:
//   1. program-faculty/run.ts uses `staffFromMhesi` to seed
//      ProgramFaculty rows directly (no AI guessing).
//   2. program-digest/run.ts feeds the aggregate `summary` object
//      into the LLM prompt as factual grounding for the recruitment
//      narrative — keeping the digest's claims aligned with reality.
//
// Pure read; no writes. Safe to call from any pipeline phase.

import { prisma } from '@kku/db';

export interface ProgramSystemStaff {
  citizenIdHash: string;
  facultyMemberId: string | null;
  nameTh: string | null;
  nameEn: string | null;
  rank: 'LECTURER' | 'ASST_PROF' | 'ASSOC_PROF' | 'PROF' | null;
  teachTypeId: number; // 1 regular, 2 curriculum lecturer, 3 responsible
  // Highest-degree origin from DS2003 (when available)
  highestEducationCountry: string | null;
  highestEducationLevel: string | null;
}

export interface ProgramSystemSummary {
  // Staff side
  staffTotal: number;
  staffMatchedToFacultyMember: number;
  staffByTeachType: { type1: number; type2: number; type3: number };
  staffByRank: { lecturer: number; asstProf: number; assocProf: number; prof: number; unranked: number };
  staffEducationOrigin: { thai: number; international: number; unknown: number };
  internationalCountriesTop: Array<{ country: string; count: number }>;

  // Student side (from DS1001)
  studentTotal: number;
  studentByStatus: Record<string, number>;
  studentByGender: { male: number; female: number; other: number };
  studentByNationality: { thai: number; foreign: number };
  studentAdmitYearRange: { earliest: number | null; latest: number | null };
  studentGpaAvg: number | null;
  studentGpaCount: number;
}

export interface ProgramSystemContext {
  programId: string;
  staffFromMhesi: ProgramSystemStaff[];
  summary: ProgramSystemSummary;
  // Audit cues — flag in the run log when these are zero so the
  // analyst knows the pipeline ran without DS2004/DS1001 grounding.
  flags: { hasMhesiStaff: boolean; hasStudents: boolean };
}

const RANK_LABEL: Record<NonNullable<ProgramSystemStaff['rank']>, string> = {
  LECTURER: 'อาจารย์',
  ASST_PROF: 'ผู้ช่วยศาสตราจารย์',
  ASSOC_PROF: 'รองศาสตราจารย์',
  PROF: 'ศาสตราจารย์',
};

export function rankLabelTh(rank: ProgramSystemStaff['rank']): string {
  if (!rank) return 'ไม่ระบุระดับ';
  return RANK_LABEL[rank];
}

export async function loadProgramSystemContext(
  programId: string,
): Promise<ProgramSystemContext> {
  // ── Staff (DS2004 + FacultyMember + DS2003) ──────────────────────
  const staffRows = await prisma.$queryRaw<
    Array<{
      citizen_id_hash: string;
      teach_type_id: number;
      faculty_member_id: string | null;
      name_th: string | null;
      name_en: string | null;
      rank: ProgramSystemStaff['rank'];
    }>
  >`
    SELECT spa.citizen_id_hash,
           spa.teach_type_id,
           fm.id          AS faculty_member_id,
           fm.name_th,
           fm.name_en,
           fm.rank
      FROM staff_program_assignment spa
      LEFT JOIN faculty_members fm ON fm.citizen_id_hash = spa.citizen_id_hash
     WHERE spa.program_id = ${programId}
  `;

  // For staff that resolved to FacultyMember, look up DS2003 highest
  // degree (we approximate "highest" as the most recent grad year).
  const allHashes = [...new Set(staffRows.map((r) => r.citizen_id_hash))];
  const eduRows =
    allHashes.length === 0
      ? []
      : await prisma.$queryRaw<
          Array<{
            citizen_id_hash: string;
            grad_country_id: string | null;
            grad_level_name: string | null;
            grad_year: string | null;
          }>
        >`
          SELECT citizen_id_hash, grad_country_id, grad_level_name, grad_year
            FROM staff_education_history
           WHERE citizen_id_hash = ANY(${allHashes})
        `;
  const highestByHash = new Map<
    string,
    { country: string | null; level: string | null }
  >();
  for (const r of eduRows) {
    const existing = highestByHash.get(r.citizen_id_hash);
    const yr = Number(r.grad_year ?? 0);
    if (!existing) {
      highestByHash.set(r.citizen_id_hash, { country: r.grad_country_id, level: r.grad_level_name });
    } else {
      // Replace only when this row is more recent (larger BE year)
      const prevYr = Number(eduRows.find((x) => x.citizen_id_hash === r.citizen_id_hash)?.grad_year ?? 0);
      if (yr > prevYr) {
        highestByHash.set(r.citizen_id_hash, { country: r.grad_country_id, level: r.grad_level_name });
      }
    }
  }

  // Dedupe — same person can hold multiple teach types per program;
  // keep the highest-priority (3 > 2 > 1) for the "primary role" view
  // but preserve the union of teach-types in the summary buckets.
  const byPerson = new Map<string, ProgramSystemStaff>();
  for (const r of staffRows) {
    const edu = highestByHash.get(r.citizen_id_hash);
    const rec: ProgramSystemStaff = {
      citizenIdHash: r.citizen_id_hash,
      facultyMemberId: r.faculty_member_id,
      nameTh: r.name_th,
      nameEn: r.name_en,
      rank: r.rank,
      teachTypeId: r.teach_type_id,
      highestEducationCountry: edu?.country ?? null,
      highestEducationLevel: edu?.level ?? null,
    };
    const existing = byPerson.get(r.citizen_id_hash);
    if (!existing || r.teach_type_id > existing.teachTypeId) {
      byPerson.set(r.citizen_id_hash, rec);
    }
  }
  const staffFromMhesi = [...byPerson.values()];

  // Aggregations
  const staffByTeachType = { type1: 0, type2: 0, type3: 0 };
  for (const r of staffRows) {
    if (r.teach_type_id === 1) staffByTeachType.type1 += 1;
    else if (r.teach_type_id === 2) staffByTeachType.type2 += 1;
    else if (r.teach_type_id === 3) staffByTeachType.type3 += 1;
  }
  const staffByRank = { lecturer: 0, asstProf: 0, assocProf: 0, prof: 0, unranked: 0 };
  for (const s of staffFromMhesi) {
    if (s.rank === 'LECTURER') staffByRank.lecturer += 1;
    else if (s.rank === 'ASST_PROF') staffByRank.asstProf += 1;
    else if (s.rank === 'ASSOC_PROF') staffByRank.assocProf += 1;
    else if (s.rank === 'PROF') staffByRank.prof += 1;
    else staffByRank.unranked += 1;
  }
  const staffEducationOrigin = { thai: 0, international: 0, unknown: 0 };
  const intlByCountry = new Map<string, number>();
  for (const s of staffFromMhesi) {
    const c = s.highestEducationCountry;
    if (!c) {
      staffEducationOrigin.unknown += 1;
    } else if (c.toUpperCase() === 'TH') {
      staffEducationOrigin.thai += 1;
    } else {
      staffEducationOrigin.international += 1;
      intlByCountry.set(c, (intlByCountry.get(c) ?? 0) + 1);
    }
  }

  // ── Students (DS1001) ────────────────────────────────────────────
  const students = await prisma.studentProgramRecord.findMany({
    where: { programId },
    select: {
      genderId: true,
      nationalityId: true,
      admitYear: true,
      gpa: true,
      gpax: true,
      studentStatusId: true,
    },
  });
  const studentByStatus: Record<string, number> = {};
  const studentByGender = { male: 0, female: 0, other: 0 };
  const studentByNationality = { thai: 0, foreign: 0 };
  let earliest: number | null = null;
  let latest: number | null = null;
  let gpaSum = 0;
  let gpaCount = 0;
  for (const s of students) {
    const status = s.studentStatusId ?? '∅';
    studentByStatus[status] = (studentByStatus[status] ?? 0) + 1;
    // GENDER_ID: 1 = male, 2 = female (KKU registrar convention)
    if (s.genderId === '1') studentByGender.male += 1;
    else if (s.genderId === '2') studentByGender.female += 1;
    else studentByGender.other += 1;
    if (s.nationalityId === 'TH') studentByNationality.thai += 1;
    else if (s.nationalityId) studentByNationality.foreign += 1;
    if (typeof s.admitYear === 'number') {
      earliest = earliest === null ? s.admitYear : Math.min(earliest, s.admitYear);
      latest = latest === null ? s.admitYear : Math.max(latest, s.admitYear);
    }
    // Use cumulative GPA (gpax) when present, fall back to current-term gpa
    const g = s.gpax ?? s.gpa;
    if (typeof g === 'number' && g > 0 && g <= 4) {
      gpaSum += g;
      gpaCount += 1;
    }
  }

  return {
    programId,
    staffFromMhesi,
    summary: {
      staffTotal: staffFromMhesi.length,
      staffMatchedToFacultyMember: staffFromMhesi.filter((s) => s.facultyMemberId).length,
      staffByTeachType,
      staffByRank,
      staffEducationOrigin,
      internationalCountriesTop: [...intlByCountry.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([country, count]) => ({ country, count })),
      studentTotal: students.length,
      studentByStatus,
      studentByGender,
      studentByNationality,
      studentAdmitYearRange: { earliest, latest },
      studentGpaAvg: gpaCount > 0 ? Number((gpaSum / gpaCount).toFixed(3)) : null,
      studentGpaCount: gpaCount,
    },
    flags: {
      hasMhesiStaff: staffFromMhesi.length > 0,
      hasStudents: students.length > 0,
    },
  };
}
