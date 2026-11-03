import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeKmitlProgramAlignment, prisma } from '../src';
import { careerSkillDemandDataset } from '../src/import/datasets/career-skill-demand';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const PREFIX = 'CSD Test ';
const SLUG = 'xlsx-career-skill-demand';
const SKILL_EN = `${PREFIX}Welding`;
const SKILL_TH = `${PREFIX}การเชื่อม`;
let runA = '';
let otherRun = '';
let skillId = '';

async function makeRun(slug: string): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug },
    update: { mocked: false },
    create: { slug, name: `${slug} test`, kind: 'CSV', inputFormat: 'XLSX', mocked: false, scheduleEnabled: false, status: 'real' },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'SUCCEEDED', attempt: 1 },
    select: { id: true },
  });
  return run.id;
}

function load(rows: readonly ImportRow[], runId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: runId };
    return careerSkillDemandDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const parsed: ParsedSheet = {
    sheetName: careerSkillDemandDataset.sheetName,
    headers: careerSkillDemandDataset.columns.map((c) => c.header),
    rows,
  };
  return validateSheet(careerSkillDemandDataset, parsed, {
    references: new Map(),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

const sRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  'Career Group': `${PREFIX}Engineer`,
  'Career Sub-group': `${PREFIX}Mechanical`,
  Career: `${PREFIX}Welder`,
  Skill: SKILL_EN,
  Scope: 'Thailand',
  'Data Source': 'Job postings',
  'Share of Postings (%)': 12.5,
  ...over,
});

const iRow = (over: Record<string, unknown> = {}): ImportRow => ({
  careerGroup: `${PREFIX}Engineer`,
  careerSubGroup: `${PREFIX}Mechanical`,
  career: `${PREFIX}Welder`,
  skill: SKILL_EN,
  scope: 'Thailand',
  dataSource: 'Job postings',
  share: 12.5,
  ...over,
}) as ImportRow;

async function cleanup(): Promise<void> {
  await prisma.kmitlCareerSkillDemand.deleteMany({ where: { skillNameRaw: { startsWith: PREFIX } } });
  await prisma.kmitlCareerSkillDemand.deleteMany({ where: { career: { groupName: { startsWith: PREFIX } } } });
  await prisma.kmitlCareer.deleteMany({ where: { groupName: { startsWith: PREFIX } } });
  await prisma.skill.deleteMany({ where: { nameEn: { startsWith: PREFIX } } });
}

describe('career-skill-demand dataset', () => {
  beforeAll(async () => {
    await cleanup();
    runA = await makeRun(SLUG);
    otherRun = await makeRun('xlsx-other-test-csd');
    const skill = await prisma.skill.create({
      data: { code: `${PREFIX}welding`, nameEn: SKILL_EN, nameTh: SKILL_TH, taxonomySource: 'KKU' },
      select: { id: true },
    });
    skillId = skill.id;
  });
  afterAll(async () => {
    await cleanup();
  });

  it('is registered', () => {
    expect(getImportDataset('career-skill-demand')).toBe(careerSkillDemandDataset);
  });

  it('refuses a percentage above 100', () => {
    const result = validate([sRow({ 'Share of Postings (%)': 140 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.column).toBe('Share of Postings (%)');
  });

  it('allocates negative career ids, stable on re-upload', async () => {
    await load([iRow(), iRow({ career: `${PREFIX}Fitter`, skill: `${PREFIX}Other` })], runA);
    const first = await prisma.kmitlCareer.findMany({
      where: { groupName: `${PREFIX}Engineer` },
      orderBy: { careerName: 'asc' },
    });
    expect(first).toHaveLength(2);
    for (const c of first) {
      expect(c.kmitlCareerId).toBeLessThan(0);
      expect(c.kmitlGroupId).toBeLessThan(0);
      expect(c.kmitlSubGroupId).toBeLessThan(0);
      expect(c.ingestionRunId).toBe(runA);
    }
    expect(first[0]!.kmitlGroupId).toBe(first[1]!.kmitlGroupId);
    expect(first[0]!.kmitlCareerId).not.toBe(first[1]!.kmitlCareerId);

    const again = await load([iRow({ share: 20 })], runA);
    expect(again.updated).toBe(1);
    const second = await prisma.kmitlCareer.findMany({
      where: { groupName: `${PREFIX}Engineer` },
      orderBy: { careerName: 'asc' },
    });
    expect(second.map((c) => c.kmitlCareerId)).toEqual(first.map((c) => c.kmitlCareerId));
    const demand = await prisma.kmitlCareerSkillDemand.findFirst({
      where: { skillNameRaw: SKILL_EN },
    });
    expect(demand?.percentage).toBe(20);
  });

  it('resolves skills by English and Thai name and counts the unresolved', async () => {
    const result = await load(
      [
        iRow({ career: `${PREFIX}Brazier`, skill: SKILL_EN.toUpperCase() }),
        iRow({ career: `${PREFIX}Brazier`, skill: SKILL_TH }),
        iRow({ career: `${PREFIX}Brazier`, skill: `${PREFIX}No Such Skill` }),
      ],
      runA,
    );
    expect(result.unresolved).toBe(1);
    const rows = await prisma.kmitlCareerSkillDemand.findMany({
      where: { career: { careerName: `${PREFIX}Brazier` } },
    });
    expect(rows.filter((r) => r.skillId === skillId)).toHaveLength(2);
    expect(rows.filter((r) => r.skillId === null)).toHaveLength(1);
  });

  it('labour_market_alignment reads an imported row', async () => {
    const faculty = await prisma.faculty.create({
      data: { code: 'CSDFAC', nameTh: 'คณะทดสอบ', nameEn: `${PREFIX}Faculty` },
      select: { id: true },
    });
    const programme = await prisma.program.create({
      data: {
        code: 'CSD-PROG', nameTh: 'ทดสอบ', nameEn: `${PREFIX}Programme`,
        facultyId: faculty.id, level: 'BACHELOR', status: 'ACTIVE', sequenceNoFromSheet: -9301,
      },
      select: { id: true },
    });
    try {
      await prisma.programSkill.create({
        data: { programId: programme.id, skillId, weight: 1 },
      });
      const alignment = await computeKmitlProgramAlignment();
      expect(alignment.get(programme.id)).toBe(100);
    } finally {
      await prisma.program.delete({ where: { id: programme.id } });
      await prisma.faculty.delete({ where: { id: faculty.id } });
    }
  });

  it('treats skill names case-insensitively in the duplicate key', () => {
    const result = validate([sRow({ Skill: 'Python' }), sRow({ Skill: 'python' })]);
    expect(result.ok).toBe(false);
  });

  it("clear only deletes this dataset's runs", async () => {
    const careerRow = await prisma.kmitlCareer.create({
      data: {
        kmitlCareerId: -900000001,
        kmitlGroupId: -900000001,
        kmitlSubGroupId: -900000001,
        groupName: `${PREFIX}Other`,
        subGroupName: 'x',
        careerName: `${PREFIX}Other career`,
        freshnessDate: new Date(),
        ingestionRunId: otherRun,
      },
    });
    const deleted = await prisma.$transaction((tx) => careerSkillDemandDataset.clear(tx, [runA]));
    expect(deleted).toBeGreaterThan(0);
    expect(await prisma.kmitlCareer.count({ where: { groupName: `${PREFIX}Engineer` } })).toBe(0);
    expect(await prisma.kmitlCareerSkillDemand.count({ where: { skillNameRaw: { startsWith: PREFIX } } })).toBe(0);
    expect(await prisma.kmitlCareer.findUnique({ where: { id: careerRow.id } })).not.toBeNull();
  });
});
