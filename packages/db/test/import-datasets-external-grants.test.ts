import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { __resetGrantSourceCache, grantAward, loadGrantSourceSynced } from '../src/grant-award';
import { grantsFreshness } from '../src/research-services';
import {
  externalGrantTeamDataset,
  externalGrantsDataset,
} from '../src/import/datasets/external-grants';
import { getImportDataset } from '../src/import/registry';
import type { ImportDataset, ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

// External grants: projects and team members. Neither may touch the
// kku-research-services connector's rows, and the grant award must see them.

const FACULTY_CODE = 'XG-FAC';
const STAFF_CODE = 'XG-STAFF-1';
const PREFIX = 'XG-P';
const NOW = new Date('2026-10-03T12:00:00+07:00'); // FY window BE 2567-2569

let projRun = '';
let projRunB = '';
let teamRun = '';
let connectorRun = '';
let staffId = '';
let facultyId = '';

async function makeRun(slug: string, status: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED'): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug },
    update: { mocked: false },
    create: { slug, name: `${slug} test`, kind: 'CSV', inputFormat: 'XLSX', mocked: false, scheduleEnabled: false, status: 'real' },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status, attempt: 1, completedAt: new Date() },
    select: { id: true },
  });
  return run.id;
}

async function cleanup(): Promise<void> {
  await prisma.researchServiceProject.deleteMany({
    where: { OR: [{ id: { startsWith: 'rsp-xlsx-XG-' } }, { id: 'rsp-xg-connector' }] },
  });
  await prisma.facultyMember.deleteMany({ where: { employeeCode: STAFF_CODE } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

function load(dataset: ImportDataset, rows: readonly ImportRow[], runId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: runId };
    return dataset.load(ctx, rows);
  });
}

function validate(dataset: ImportDataset, rows: Record<string, unknown>[], refs: Record<string, string[]>) {
  const parsed: ParsedSheet = {
    sheetName: dataset.sheetName,
    headers: dataset.columns.map((c) => c.header),
    rows,
  };
  return validateSheet(dataset, parsed, {
    references: new Map(Object.entries(refs).map(([k, v]) => [k, new Set(v)])),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

const pRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  'Project Code': `${PREFIX}1`, 'Title (Thai)': 'โครงการทดสอบ', 'Title (English)': 'Test project',
  Type: 'Research', 'Fiscal Year': 2025, 'Budget (THB)': 6_000_000, Funder: 'Test Fund',
  'Lead Faculty Code': FACULTY_CODE, ...over,
});
const pImp = (code: string, over: Record<string, unknown> = {}): ImportRow =>
  ({
    projectCode: code, titleTh: 'โครงการทดสอบ', titleEn: null, type: 'Research', fiscalYear: 2025,
    budgetThb: 6_000_000, funder: null, leadFacultyCode: FACULTY_CODE, ...over,
  }) as ImportRow;
const tImp = (projectCode: string, employeeCode: string, role = 'Lead'): ImportRow =>
  ({ projectCode, employeeCode, role }) as ImportRow;

beforeAll(async () => {
  await cleanup();
  projRun = await makeRun('xlsx-external-grants');
  projRunB = await makeRun('xlsx-external-grants');
  teamRun = await makeRun('xlsx-external-grant-team');
  connectorRun = await makeRun('kku-research-services');
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'คณะทดสอบทุน', nameEn: 'Grant test' },
    select: { id: true },
  });
  facultyId = faculty.id;
  const staff = await prisma.facultyMember.create({
    data: {
      facultyId, employeeCode: STAFF_CODE, nameTh: 'ทดสอบ', nameEn: 'Test Staff', rank: 'LECTURER', isActive: true,
      ingestionRunId: projRun,
    },
    select: { id: true },
  });
  staffId = staff.id;
});

beforeEach(() => __resetGrantSourceCache());
afterAll(cleanup);

describe('external grants datasets', () => {
  it('are registered', () => {
    expect(getImportDataset('external-grants').slug).toBe('external-grants');
    expect(getImportDataset('external-grant-team').slug).toBe('external-grant-team');
  });

  it('refuses a Buddhist-era fiscal year and a negative budget', () => {
    const be = validate(externalGrantsDataset, [pRow({ 'Fiscal Year': 2568 })], { faculties: [FACULTY_CODE] });
    expect(be.ok).toBe(false);
    const neg = validate(externalGrantsDataset, [pRow({ 'Budget (THB)': -1 })], { faculties: [FACULTY_CODE] });
    expect(neg.ok).toBe(false);
    expect(validate(externalGrantsDataset, [pRow()], { faculties: [FACULTY_CODE] }).ok).toBe(true);
  });

  it('refuses an unknown employee code naming the row', () => {
    const r = validate(
      externalGrantTeamDataset,
      [
        { 'Project Code': `${PREFIX}1`, 'Employee Code': STAFF_CODE, Role: 'Lead' },
        { 'Project Code': `${PREFIX}1`, 'Employee Code': 'NOBODY', Role: 'Co-investigator' },
      ],
      { 'external-grants': [`${PREFIX}1`], 'faculty-members': [STAFF_CODE] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]!.row).toBe(3);
      expect(r.errors[0]!.column).toBe('Employee Code');
    }
  });

  it('refuses a team row for an unknown project', () => {
    const r = validate(
      externalGrantTeamDataset,
      [{ 'Project Code': 'NOPE', 'Employee Code': STAFF_CODE, Role: 'Lead' }],
      { 'external-grants': [`${PREFIX}1`], 'faculty-members': [STAFF_CODE] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.column).toBe('Project Code');
  });

  it('sourceProposalId is negative and stable across re-upload', async () => {
    await load(externalGrantsDataset, [pImp(`${PREFIX}1`), pImp(`${PREFIX}2`)], projRun);
    const first = await prisma.researchServiceProject.findMany({
      where: { id: { startsWith: 'rsp-xlsx-XG-' } },
      orderBy: { id: 'asc' },
    });
    expect(first.every((p) => p.sourceProposalId < 0)).toBe(true);
    expect(new Set(first.map((p) => p.sourceProposalId)).size).toBe(2);
    expect(first[0]!.sourceProposalKey).toBe(`xlsx:${PREFIX}1`);
    expect(first[0]!.fiscalYearBe).toBe(2568);
    expect(first[0]!.workflowStatus).toBe('IMPORTED');
    expect(first[0]!.type).toBe('RESEARCH');
    expect(first[0]!.typeRaw).toBe('Research');
    expect(first[0]!.leadFacultyName).toBe('คณะทดสอบทุน');
    expect(first[0]!.leadUnitName).toBe('คณะทดสอบทุน');
    expect(first[0]!.facultyId).toBe(facultyId);

    const again = await load(externalGrantsDataset, [pImp(`${PREFIX}1`, { type: 'Consulting' })], projRunB);
    expect(again.updated).toBe(1);
    const second = await prisma.researchServiceProject.findUniqueOrThrow({ where: { id: `rsp-xlsx-${PREFIX}1` } });
    expect(second.sourceProposalId).toBe(first[0]!.sourceProposalId);
    expect(second.type).toBe('CONSULTING');
  });

  it('team load resolves the staff member and leaves personal fields null', async () => {
    await load(externalGrantTeamDataset, [tImp(`${PREFIX}1`, STAFF_CODE, 'Co-investigator')], teamRun);
    const m = await prisma.researchServiceProjectMember.findFirstOrThrow({ where: { projectId: `rsp-xlsx-${PREFIX}1` } });
    expect(m.facultyMemberId).toBe(staffId);
    expect(m.role).toBe('CO_INVESTIGATOR');
    expect(m.displayName).toBeNull();
    expect(m.sourcePersonKey).toBeNull();
    expect(m.citizenIdHash).toBeNull();
    expect(m.facultyId).toBe(facultyId);

    const again = await load(externalGrantTeamDataset, [tImp(`${PREFIX}1`, STAFF_CODE, 'Lead')], teamRun);
    expect(again.updated).toBe(1);
    expect(await prisma.researchServiceProjectMember.count({ where: { projectId: `rsp-xlsx-${PREFIX}1` } })).toBe(1);
  });

  it('grant award counts an imported project', async () => {
    // Project 1 is FY BE 2568 (inside 2567-2569) with the staff member on it.
    expect(await loadGrantSourceSynced()).toBe(true);
    const a = await grantAward([staffId], NOW);
    expect(a.raw.reason).toBeUndefined();
    expect(a.points).not.toBeNull();
    expect(a.raw.projects).toBe(1);
    expect(a.points!).toBeGreaterThan(0);
  });

  it('freshness reads either grants source', async () => {
    const f = await grantsFreshness();
    expect(f).not.toBeNull();
  });

  it('clear only deletes this dataset’s runs', async () => {
    // A connector row, with a member, in the same tables.
    await prisma.researchServiceProject.create({
      data: {
        id: 'rsp-xg-connector', sourceProposalId: 987654321, sourceProposalKey: 'xg-connector',
        titleTh: 'x', type: 'RESEARCH', typeRaw: 'x', fiscalYearBe: 2568, workflowStatus: 'DONE',
        leadUnitName: 'x', leadFacultyName: 'x', ingestionRunId: connectorRun,
        members: { create: { role: 'LEAD', facultyMemberId: staffId, ingestionRunId: connectorRun } },
      },
    });
    const members = await prisma.$transaction((tx) => externalGrantTeamDataset.clear(tx, [teamRun]));
    expect(members).toBe(1);
    const projects = await prisma.$transaction((tx) => externalGrantsDataset.clear(tx, [projRun, projRunB]));
    expect(projects).toBe(2);
    const kept = await prisma.researchServiceProject.findUnique({
      where: { id: 'rsp-xg-connector' },
      include: { members: true },
    });
    expect(kept).not.toBeNull();
    expect(kept!.members).toHaveLength(1);
  });
});
