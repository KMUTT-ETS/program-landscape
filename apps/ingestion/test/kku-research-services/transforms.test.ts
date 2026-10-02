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
