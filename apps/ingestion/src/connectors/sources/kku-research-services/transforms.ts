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

// The SQL hash strips only '-' and ' ' (MySQL 5.7 has no REGEXP_REPLACE). An id
// carrying any other punctuation (dots, slashes, NBSP) hashes differently from
// hashCitizenId(), so that lead is not matched by hash and falls back to email.
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

export interface InvalidRowSample {
  /** The row's own identifier (proposal_id / co_id) — a project key, never a person. */
  id: string | number | null;
  /** Path of the first schema issue on that row. */
  path: string;
}

export interface PartitionedRows<T> {
  valid: T[];
  invalidCount: number;
  invalidSamples: InvalidRowSample[];
}

const MAX_INVALID_SAMPLES = 20;

/**
 * Validate rows one by one, so a single malformed row is skipped and counted
 * instead of failing the whole view. Only the row's identifier is sampled.
 */
export function partitionRows<T>(
  rows: readonly unknown[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  idKey: string,
): PartitionedRows<T> {
  const valid: T[] = [];
  const invalidSamples: InvalidRowSample[] = [];
  let invalidCount = 0;
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
      continue;
    }
    invalidCount += 1;
    if (invalidSamples.length < MAX_INVALID_SAMPLES) {
      const raw = row !== null && typeof row === 'object' ? (row as Record<string, unknown>)[idKey] : undefined;
      const id = typeof raw === 'string' || typeof raw === 'number' ? raw : null;
      invalidSamples.push({ id, path: parsed.error.issues[0]?.path.join('.') ?? '' });
    }
  }
  return { valid, invalidCount, invalidSamples };
}

/** Null while invalid rows stay at or under 1 % of the view; otherwise the refusal text. */
export function driftMessage(view: string, invalid: number, total: number): string | null {
  if (invalid === 0 || invalid <= total * 0.01) return null;
  return `${invalid} of ${total} ${view} rows failed validation — over 1 %, the view shape has likely changed`;
}

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
  /** Projects whose lead resolved to a faculty member (a per-project count). */
  projectsWithMatchedLead: number;
  /** Distinct lead identities (citizen hash, else email); leads with neither are not counted. */
  leadPeople: number;
  /** Distinct faculty members resolved as a lead. */
  leadPeopleMatched: number;
  coRows: number;
  /** Co-investigator rows (on projects in the view) carrying a 6-digit id. */
  coSixDigit: number;
  coMatched: number;
  /** Distinct 6-digit co-investigator ids, and how many of them resolved. */
  coPeopleSixDigit: number;
  coPeopleMatched: number;
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
  let projectsWithMatchedLead = 0;
  const leadKeys = new Set<string>();
  const leadMatchedIds = new Set<string>();

  for (const r of projectRows) {
    const id = `rsp-${r.proposal_id}`;
    idByKey.set(r.proposal_id_md5, id);
    const unitName = r.proposal_dept.trim();
    const lead =
      (r.head_citizen_hash ? idx.byCitizenHash.get(r.head_citizen_hash) : undefined) ??
      (r.lead_email ? idx.byEmail.get(r.lead_email) : undefined);
    const leadKey = r.head_citizen_hash ?? r.lead_email;
    if (leadKey) leadKeys.add(leadKey);
    if (lead) {
      projectsWithMatchedLead += 1;
      leadMatchedIds.add(lead.id);
    }
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
  const coKeys = new Set<string>();
  const coMatchedKeys = new Set<string>();
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
      coKeys.add(key);
      staff = idx.byEmployeeId.get(key);
      if (staff) {
        coMatched += 1;
        coMatchedKeys.add(key);
      }
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
      projectsWithMatchedLead,
      leadPeople: leadKeys.size,
      leadPeopleMatched: leadMatchedIds.size,
      coRows: coRows.length,
      coSixDigit,
      coMatched,
      coPeopleSixDigit: coKeys.size,
      coPeopleMatched: coMatchedKeys.size,
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
