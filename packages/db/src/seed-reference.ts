import type { PrismaClient } from '@prisma/client';

/**
 * Generic reference seed — content every installation needs and none of it
 * specific to one university: strategic sectors, a placeholder cost
 * methodology and the catalogue of external AI intelligence feeds.
 *
 * Idempotent and never overwrites: every write is create-if-missing (or a
 * cosmetic-only refresh), so operator edits survive a re-run.
 */

export interface SeedReferenceResult {
  sectors: number;
  costMethodology: 'created' | 'kept';
  externalAiSources: number;
}

const SECTORS = [
  { code: 'BCG-BIO',     family: 'BCG'    as const, nameTh: 'เศรษฐกิจชีวภาพ',           nameEn: 'Bio-economy',             demandMultiplier: 1.15 },
  { code: 'BCG-CIRCULAR',family: 'BCG'    as const, nameTh: 'เศรษฐกิจหมุนเวียน',        nameEn: 'Circular economy',        demandMultiplier: 1.05 },
  { code: 'BCG-GREEN',   family: 'BCG'    as const, nameTh: 'เศรษฐกิจสีเขียว',          nameEn: 'Green economy',           demandMultiplier: 1.20 },
  { code: 'SC-AUTO',     family: 'SCURVE' as const, nameTh: 'ยานยนต์สมัยใหม่',           nameEn: 'Next-gen automotive',     demandMultiplier: 1.25 },
  { code: 'SC-SMART',    family: 'SCURVE' as const, nameTh: 'อิเล็กทรอนิกส์อัจฉริยะ',     nameEn: 'Smart electronics',       demandMultiplier: 1.20 },
  { code: 'SC-MED',      family: 'SCURVE' as const, nameTh: 'ศูนย์การแพทย์',             nameEn: 'Medical hub',             demandMultiplier: 1.30 },
  { code: 'SC-DIGITAL',  family: 'SCURVE' as const, nameTh: 'เศรษฐกิจดิจิทัล',           nameEn: 'Digital economy',         demandMultiplier: 1.35 },
  { code: 'SC-AGRI',     family: 'SCURVE' as const, nameTh: 'เกษตรและอาหารขั้นสูง',      nameEn: 'Advanced agri/food',      demandMultiplier: 1.15 },
];

const COST_METHODOLOGY_DESCRIPTION =
  'Placeholder cost-allocation methodology. Replace once your finance office has agreed a cost-allocation method (docs/methodologies/cost-allocation.md).';

// External AI sources are seeded PAUSED so the operator activates each one
// explicitly after deciding cadence and verifying any required env keys.
const EXTERNAL_AI_SOURCES = [
    {
      slug: 'wef-global-risks',
      name: 'World Economic Forum',
      description: 'WEF Global Risks Report, future-of-jobs publications, and weekly insights blog.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.7,
      cadenceCron: '0 8 * * 1',
      configJson: {
        urls: [
          'https://www.weforum.org/reports/global-risks-report-2026',
          'https://www.weforum.org/agenda/archive/jobs-and-the-future-of-work/',
        ],
      },
    },
    {
      slug: 'imd-competitiveness',
      name: 'IMD World Competitiveness',
      description: 'IMD World Competitiveness Center publications + news + research.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.65,
      cadenceCron: '0 8 1 * *',
      configJson: {
        urls: [
          'https://www.imd.org/centers/wcc/world-competitiveness-center/',
          'https://www.imd.org/news/',
          'https://www.imd.org/research-knowledge/',
        ],
      },
    },
    {
      slug: 'thailand-boi',
      name: 'Thailand BOI',
      description:
        'Thailand Board of Investment — English-language news + research reports. PAUSED by default: BOI now serves an Incapsula bot challenge to non-browser clients; needs headless-browser fetcher to harvest.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.6,
      cadenceCron: '0 8 * * 2',
      configJson: {
        urls: [
          'https://www.boi.go.th/en/news_business',
          'https://www.boi.go.th/index.php?page=research_report',
        ],
      },
    },
    {
      slug: 'world-bank-thailand',
      name: 'World Bank Thailand',
      description: 'World Bank Thailand country page — overview + Thailand-specific news.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.55,
      cadenceCron: '0 9 1 * *',
      configJson: {
        urls: [
          'https://www.worldbank.org/en/country/thailand/overview',
          'https://www.worldbank.org/en/news/all?qterm=Thailand&displayconttype_exact=News',
        ],
      },
    },
    {
      slug: 'oecd-education',
      name: 'OECD Education',
      description:
        'OECD education skills, higher-education, and labour-market policy publications. PAUSED by default — OECD CDN aggressively blocks non-browser fetches (TLS fingerprinting); requires a headless-browser fetcher to harvest. Switch to ACTIVE after headless support lands.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.6,
      cadenceCron: '0 9 1 * *',
      configJson: {
        urls: [
          'https://www.oecd.org/en/topics/policy-areas/education-and-skills.html',
        ],
      },
    },
    {
      slug: 'unesco-iesalc',
      name: 'UNESCO IESALC',
      description: 'UNESCO International Institute for Higher Education — policy briefs + global reports.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.55,
      cadenceCron: '0 9 1 * *',
      configJson: {
        urls: [
          'https://www.iesalc.unesco.org/en/publications/',
          'https://en.unesco.org/news/higher-education',
        ],
      },
    },
    {
      slug: 'mhesi-news',
      name: 'MHESI announcements',
      description: 'Thai Ministry of Higher Education, Science, Research and Innovation — policy notices, regulation, funding calls.',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.7,
      cadenceCron: '0 9 * * *',
      configJson: {
        urls: [
          'https://www.mhesi.go.th/index.php/news.html',
          'https://www.mhesi.go.th/',
        ],
      },
    },
    {
      slug: 'asean-he',
      name: 'ASEAN University Network',
      description: 'ASEAN University Network — secretariat news + higher-education programmes. (Switched from asean.org which returns 307 to bot fetchers.)',
      kind: 'URL_LIST' as const,
      signalType: 'POLICY' as const,
      defaultImpact: 0.5,
      cadenceCron: '0 9 1 * *',
      configJson: {
        urls: [
          'https://aunsec.org/news',
          'https://aunsec.org/',
        ],
      },
    },
];

export async function seedReference(client: PrismaClient): Promise<SeedReferenceResult> {
  for (const s of SECTORS) {
    await client.sector.upsert({ where: { code: s.code }, update: {}, create: s });
  }

  const existing = await client.costMethodology.findUnique({ where: { version: 'v1' } });
  await client.costMethodology.upsert({
    where: { version: 'v1' },
    update: {},
    create: {
      version: 'v1',
      description: COST_METHODOLOGY_DESCRIPTION,
      effectiveDate: new Date('2024-01-01'),
    },
  });

  for (const s of EXTERNAL_AI_SOURCES) {
    await client.externalAiSource.upsert({
      where: { slug: s.slug },
      create: {
        slug: s.slug,
        name: s.name,
        description: s.description,
        kind: s.kind,
        status: 'PAUSED',
        signalType: s.signalType,
        defaultImpact: s.defaultImpact,
        cadenceCron: s.cadenceCron,
        configJson: s.configJson,
      },
      // Cosmetic fields only; status, cadence and config are operator-owned.
      update: { name: s.name, description: s.description },
    });
  }

  return {
    sectors: SECTORS.length,
    costMethodology: existing ? 'kept' : 'created',
    externalAiSources: EXTERNAL_AI_SOURCES.length,
  };
}

const SECTOR_KEYWORDS: Array<[RegExp, string]> = [
  [/bio|genetic|microb|biotech|life-sci|biology/i, 'BCG-BIO'],
  [/recycl|circular|waste|reuse|sustainab/i, 'BCG-CIRCULAR'],
  [/green|renewable|solar|wind|clean.?energy/i, 'BCG-GREEN'],
  [/auto|vehicle|ev|battery|mechatronic/i, 'SC-AUTO'],
  [/electron|embedded|iot|sensor|semicon/i, 'SC-SMART'],
  [/medic|health|clinic|nurs|pharma/i, 'SC-MED'],
  [/data|ai|machine.?learning|software|cloud|cyber|digital|program/i, 'SC-DIGITAL'],
  [/agri|farm|food|crop|livestock|soil/i, 'SC-AGRI'],
];

/** Best-effort keyword tagging of skills into strategic sectors. Idempotent. */
export async function tagSkillSectors(client: PrismaClient): Promise<{ tagged: number }> {
  const sectorIdByCode = new Map(
    (await client.sector.findMany({ select: { id: true, code: true } })).map((s) => [s.code, s.id]),
  );
  const skills = await client.skill.findMany({ select: { id: true, code: true, nameEn: true } });
  let tagged = 0;
  for (const [needle, sectorCode] of SECTOR_KEYWORDS) {
    const sectorId = sectorIdByCode.get(sectorCode);
    if (!sectorId) continue;
    for (const sk of skills) {
      if (!needle.test(sk.nameEn) && !needle.test(sk.code)) continue;
      await client.skillSector.upsert({
        where: { skillId_sectorId: { skillId: sk.id, sectorId } },
        update: {},
        create: { skillId: sk.id, sectorId, weight: 1.0 },
      });
      tagged++;
    }
  }
  return { tagged };
}
