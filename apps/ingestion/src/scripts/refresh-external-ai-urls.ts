// One-shot refresh of the Phase-5 ExternalAiSource catalog URLs.
//
// The seed's upsert path preserves operator-managed fields on re-seed.
// This script pushes the curated URL refresh into the live DB after a
// post-launch probe of which seeded URLs still respond. Safe to re-run.
//
// Usage: pnpm tsx apps/ingestion/src/scripts/refresh-external-ai-urls.ts

import 'dotenv/config';
import { Prisma, prisma } from '@kku/db';

interface Refresh {
  slug: string;
  configJson: Record<string, unknown>;
  description?: string;
  status?: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  notes?: string;
}

const REFRESHES: Refresh[] = [
  {
    slug: 'imd-competitiveness',
    configJson: {
      urls: [
        'https://www.imd.org/centers/wcc/world-competitiveness-center/',
        'https://www.imd.org/news/',
        'https://www.imd.org/research-knowledge/',
      ],
    },
    description: 'IMD World Competitiveness Center publications + news + research.',
  },
  {
    slug: 'thailand-boi',
    configJson: {
      urls: [
        'https://www.boi.go.th/en/news_business',
        'https://www.boi.go.th/index.php?page=research_report',
      ],
    },
    description:
      'Thailand Board of Investment — English-language news + research reports. PAUSED: BOI escalated to Incapsula bot-challenge protection (HTTP 200 but body is a JS challenge); needs headless-browser fetcher to harvest.',
    status: 'PAUSED',
    notes: 'BOI now serves an Incapsula JS challenge to non-browser clients; pausing.',
  },
  {
    slug: 'world-bank-thailand',
    configJson: {
      urls: [
        'https://www.worldbank.org/en/country/thailand/overview',
        'https://www.worldbank.org/en/news/all?qterm=Thailand&displayconttype_exact=News',
      ],
    },
    description: 'World Bank Thailand country page — overview + Thailand-specific news.',
  },
  {
    slug: 'oecd-education',
    configJson: {
      urls: ['https://www.oecd.org/en/topics/policy-areas/education-and-skills.html'],
    },
    description:
      'OECD education skills, higher-education, and labour-market policy publications. PAUSED — OECD CDN blocks non-browser fetches via TLS fingerprinting; needs a headless-browser fetcher.',
    status: 'PAUSED',
    notes: 'OECD blocks every URL with Akamai-style fingerprinting; pausing until headless support lands.',
  },
  {
    slug: 'unesco-iesalc',
    configJson: {
      urls: [
        'https://www.iesalc.unesco.org/en/publications/',
        'https://en.unesco.org/news/higher-education',
      ],
    },
    description: 'UNESCO International Institute for Higher Education — policy briefs + global reports.',
  },
  {
    slug: 'mhesi-news',
    configJson: {
      urls: [
        'https://www.mhesi.go.th/index.php/news.html',
        'https://www.mhesi.go.th/',
      ],
    },
    description:
      'Thai Ministry of Higher Education, Science, Research and Innovation — policy notices, regulation, funding calls.',
  },
  {
    slug: 'asean-he',
    configJson: {
      urls: ['https://aunsec.org/news', 'https://aunsec.org/'],
    },
    description:
      'ASEAN University Network — secretariat news + higher-education programmes. (Switched from asean.org which returns 307 to bot fetchers.)',
  },
];

async function main() {
  let updated = 0;
  for (const r of REFRESHES) {
    const before = await prisma.externalAiSource.findUnique({ where: { slug: r.slug } });
    if (!before) {
      console.log(`✖ no source with slug: ${r.slug}`);
      continue;
    }
    await prisma.externalAiSource.update({
      where: { slug: r.slug },
      data: {
        configJson: r.configJson as Prisma.InputJsonValue,
        description: r.description,
        ...(r.status !== undefined && { status: r.status }),
      },
    });
    updated += 1;
    console.log(`✓ ${r.slug}`);
    if (r.notes) console.log(`    note: ${r.notes}`);
  }
  console.log(`\nrefreshed ${updated}/${REFRESHES.length} sources`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
