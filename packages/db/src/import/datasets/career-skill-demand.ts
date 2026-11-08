import type { KmitlDataScope, KmitlDemandSource, Prisma, PrismaClient } from '@prisma/client';

import type { ImportDataset, ImportLoadContext, ImportLoadResult, ImportRow } from '../types';
import { buildSkillLookup, resolveSkillId } from '../../skill-lookup';

// Tier 2. Career skill demand: which skills the labour market asks for, per
// career. It is the fallback for the KMITL Skill Mapping API, which an adopting
// university usually cannot reach: it writes the same two tables, so the
// labour-market alignment driver, the strategic-sector driver and the
// programme-career mapping read it unchanged.
//
// KMITL's own ids are positive. An imported career, group and sub-group take
// the next value BELOW the lowest negative id held, so the two can never
// collide, and a re-upload finds its careers by name and keeps their ids.
//
// Unit of `Share of Postings (%)`: the same 0–100 percentage the KMITL API
// returns (transforms.ts keeps it unconverted) and the readers compare with a
// threshold of 5 (health-score.ts KMITL_DEMAND_THRESHOLD_PCT).

const SLUG = 'xlsx-career-skill-demand';
const NO_SUB_GROUP = 'General';

const SCOPES: Readonly<Record<string, KmitlDataScope>> = {
  Thailand: 'THAILAND',
  Global: 'GLOBAL',
};
const SOURCES: Readonly<Record<string, KmitlDemandSource>> = {
  'Job postings': 'JOB_POSTINGS',
  Profiles: 'PROFILES',
};

const careerKey = (group: string, sub: string, career: string): string =>
  `${group}\u0000${sub}\u0000${career}`;

const subGroupOf = (row: ImportRow): string =>
  typeof row.careerSubGroup === 'string' && row.careerSubGroup.trim() !== ''
    ? row.careerSubGroup.trim()
    : NO_SUB_GROUP;

export const careerSkillDemandDataset: ImportDataset = {
  slug: 'career-skill-demand',
  title: 'Career Skill Demand',
  description:
    'How much of the labour market asks for each skill, per career: one row per career per skill per ' +
    'scope and data source. The fallback for the KMITL Skill Mapping API. Feeds the labour-market and ' +
    'strategic-sector scores and the programme-career mapping. Upload it after the programme pipeline ' +
    'has built your skills, and again later to resolve more skill names.',
  tier: 2,
  sheetName: 'Career Skill Demand',
  columns: [
    {
      header: 'Career Group',
      key: 'careerGroup',
      type: 'text',
      required: true,
      guide:
        'The broad field of the career. Only these names count as strategic sectors in the ' +
        'strategic-sector score: IT, Engineer, Health Science, Smart Farmer, New S Curve, Food. ' +
        'Any other name is allowed and scores as non-strategic.',
      example: 'Engineer',
    },
    {
      header: 'Career Sub-group',
      key: 'careerSubGroup',
      type: 'text',
      required: false,
      guide: `A narrower grouping inside the group. Blank is stored as "${NO_SUB_GROUP}".`,
      example: 'Mechanical',
    },
    {
      header: 'Career',
      key: 'career',
      type: 'text',
      required: true,
      guide: 'The career or occupation. The programme-career mapping picks careers by this name.',
      example: 'Mechanical engineer',
    },
    {
      header: 'Skill',
      key: 'skill',
      type: 'text',
      required: true,
      guide:
        'The skill, in English or Thai, matched exactly (ignoring case) against your skill taxonomy. ' +
        'A name that matches nothing is still stored but does not score; upload the sheet again ' +
        'once the programme pipeline has built your skills.',
      example: 'Python',
      identity: (value) => String(value).trim().toLowerCase(),
    },
    {
      header: 'Scope',
      key: 'scope',
      type: 'enum',
      required: true,
      enumValues: Object.keys(SCOPES),
      guide: 'Whether the figure describes the Thai market or the global one.',
      example: 'Thailand',
    },
    {
      header: 'Data Source',
      key: 'dataSource',
      type: 'enum',
      required: true,
      enumValues: Object.keys(SOURCES),
      guide: 'Whether the figure comes from job postings or from people’s professional profiles.',
      example: 'Job postings',
    },
    {
      header: 'Share of Postings (%)',
      key: 'share',
      type: 'decimal',
      required: true,
      guide:
        'The share of this career’s postings (or profiles) that name the skill, as a percentage from ' +
        '0 to 100: write 12.5 for 12.5 %. A skill counts as demanded at 5 or more.',
      example: '12.5',
      check: (value) => {
        if (typeof value !== 'number') return null;
        if (value < 0) return 'A share cannot be negative.';
        if (value > 100) {
          return `${value} is above 100. This column is a percentage from 0 to 100 — write 12.5, not 1250.`;
        }
        return null;
      },
    },
  ],
  strategy: {
    kind: 'upsert',
    // The table's real key uses the career id, which the sheet does not carry.
    match: {
      kind: 'manual',
      columns: ['careerGroup', 'careerSubGroup', 'career', 'skill', 'scope', 'dataSource'],
    },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const { tx } = ctx;
    const freshnessDate = new Date();

    // Careers this dataset owns are exactly the ones with a negative id.
    const owned = await tx.kmitlCareer.findMany({
      where: { kmitlCareerId: { lt: 0 } },
      select: {
        id: true,
        kmitlCareerId: true,
        kmitlGroupId: true,
        kmitlSubGroupId: true,
        groupName: true,
        subGroupName: true,
        careerName: true,
      },
    });
    const careers = new Map(owned.map((c) => [careerKey(c.groupName, c.subGroupName, c.careerName), c]));
    const groupIds = new Map<string, number>();
    const subGroupIds = new Map<string, number>();
    let lowestCareer = 0;
    let lowestGroup = 0;
    let lowestSub = 0;
    for (const c of owned) {
      groupIds.set(c.groupName, c.kmitlGroupId);
      subGroupIds.set(`${c.groupName}\u0000${c.subGroupName}`, c.kmitlSubGroupId);
      lowestCareer = Math.min(lowestCareer, c.kmitlCareerId);
      lowestGroup = Math.min(lowestGroup, c.kmitlGroupId);
      lowestSub = Math.min(lowestSub, c.kmitlSubGroupId);
    }

    const careerRecord = new Map<string, { id: string; kmitlCareerId: number }>();
    for (const row of rows) {
      const group = String(row.careerGroup).trim();
      const sub = subGroupOf(row);
      const name = String(row.career).trim();
      const key = careerKey(group, sub, name);
      if (careerRecord.has(key)) continue;

      const existing = careers.get(key);
      if (existing) {
        await tx.kmitlCareer.update({
          where: { id: existing.id },
          data: { freshnessDate, ingestionRunId: ctx.ingestionRunId },
        });
        careerRecord.set(key, { id: existing.id, kmitlCareerId: existing.kmitlCareerId });
        continue;
      }
      let groupId = groupIds.get(group);
      if (groupId === undefined) {
        groupId = --lowestGroup;
        groupIds.set(group, groupId);
      }
      const subKey = `${group}\u0000${sub}`;
      let subId = subGroupIds.get(subKey);
      if (subId === undefined) {
        subId = --lowestSub;
        subGroupIds.set(subKey, subId);
      }
      const created = await tx.kmitlCareer.create({
        data: {
          kmitlCareerId: --lowestCareer,
          kmitlGroupId: groupId,
          kmitlSubGroupId: subId,
          groupName: group,
          subGroupName: sub,
          careerName: name,
          freshnessDate,
          ingestionRunId: ctx.ingestionRunId,
        },
        select: { id: true, kmitlCareerId: true },
      });
      careerRecord.set(key, created);
    }

    // Skill resolution, exactly as the KMITL connector does it.
    const [skills, aliases] = await Promise.all([
      tx.skill.findMany({ select: { id: true, nameEn: true, nameTh: true } }),
      tx.skillAlias.findMany({
        where: { sourceContext: 'linkedin', status: 'RESOLVED', resolvedSkillId: { not: null } },
        select: { rawNameLower: true, resolvedSkillId: true },
      }),
    ]);
    const lookup = buildSkillLookup(
      skills,
      aliases.map((a) => ({ rawNameLower: a.rawNameLower, resolvedSkillId: a.resolvedSkillId! })),
    );

    const heldDemand = await tx.kmitlCareerSkillDemand.findMany({
      where: { kmitlCareerId: { in: [...careerRecord.values()].map((c) => c.kmitlCareerId) } },
      select: { id: true, kmitlCareerId: true, skillNameRaw: true, dataScope: true, dataSource: true },
    });
    const held = new Map(
      heldDemand.map((d) => [`${d.kmitlCareerId}\u0000${d.skillNameRaw}\u0000${d.dataScope}\u0000${d.dataSource}`, d.id]),
    );

    let inserted = 0;
    let updated = 0;
    let unresolved = 0;
    const toCreate: Prisma.KmitlCareerSkillDemandCreateManyInput[] = [];
    for (const row of rows) {
      const career = careerRecord.get(
        careerKey(String(row.careerGroup).trim(), subGroupOf(row), String(row.career).trim()),
      )!;
      const skillName = String(row.skill).trim();
      const skillId = resolveSkillId(lookup, skillName);
      if (skillId === null) unresolved += 1;
      const dataScope = SCOPES[String(row.scope)] ?? 'THAILAND';
      const dataSource = SOURCES[String(row.dataSource)] ?? 'JOB_POSTINGS';
      const percentage = Number(row.share);
      const heldId = held.get(`${career.kmitlCareerId}\u0000${skillName}\u0000${dataScope}\u0000${dataSource}`);
      if (heldId) {
        await tx.kmitlCareerSkillDemand.update({
          where: { id: heldId },
          data: {
            skillId,
            percentage,
            snapshotAt: freshnessDate,
            freshnessDate,
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        updated += 1;
      } else {
        toCreate.push({
          careerId: career.id,
          kmitlCareerId: career.kmitlCareerId,
          skillId,
          skillNameRaw: skillName,
          dataScope,
          dataSource,
          percentage,
          snapshotAt: freshnessDate,
          freshnessDate,
          ingestionRunId: ctx.ingestionRunId,
        });
        inserted += 1;
      }
    }
    if (toCreate.length > 0) await tx.kmitlCareerSkillDemand.createMany({ data: toCreate });
    return { inserted, updated, deleted: 0, unresolved };
  },

  // Only rows this dataset wrote: the tables also hold the connector's.
  count: (prisma: PrismaClient): Promise<number> =>
    prisma.kmitlCareerSkillDemand.count({ where: { ingestionRun: { dataSource: { slug: SLUG } } } }),

  clear: async (tx, runIds): Promise<number> => {
    const demand = await tx.kmitlCareerSkillDemand.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    // Careers last, and only those with no rows left beneath them.
    await tx.kmitlCareer.deleteMany({
      where: { ingestionRunId: { in: [...runIds] }, skillDemands: { none: {} } },
    });
    return demand.count;
  },
};
