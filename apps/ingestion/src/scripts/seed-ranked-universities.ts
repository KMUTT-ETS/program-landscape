#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Seed RankedUniversity — curated QS / THE-ranked institutions across the
// four geographic tiers used by the Deep-Dive's AI peer selector:
//   - World (top global research universities)
//   - Asia (top Asian universities incl. East Asia)
//   - Southeast Asia (Singapore, Malaysia, Indonesia, Vietnam, Philippines)
//   - Thailand (universities at or above KKU's QS world rank)
//
// Source: QS World University Rankings 2025 + THE World University
// Rankings 2025 (publicly published positions). Refresh annually when
// KKU Library updates the subscription dataset; the AI selector reads
// `rankingYear=latest`.
//
// KKU's own QS world rank is roughly 1001-1200 in QS 2025; THE places
// it 1201-1500. The Thailand-tier list contains universities at or
// above KKU — Chulalongkorn, Mahidol, Chiang Mai, Thammasat, KMUTT,
// Kasetsart, KMITL, PSU.
//
// Idempotent on (name, rankingYear). Re-run safe.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { prisma } from '@kku/db';

interface UniSeed {
  name: string;
  country: string;
  region: 'World' | 'Asia' | 'Southeast Asia' | 'Thailand';
  qsWorldRank?: number;
  theWorldRank?: number;
  qsAsiaRank?: number;
  theAsiaRank?: number;
  websiteUrl?: string;
  notes?: string;
}

const RANKING_YEAR = 2025;

const UNIVERSITIES: UniSeed[] = [
  // ── World tier (top 30 global research universities) ─────────────────
  { name: 'Massachusetts Institute of Technology', country: 'United States', region: 'World', qsWorldRank: 1, theWorldRank: 2, websiteUrl: 'https://www.mit.edu' },
  { name: 'Imperial College London', country: 'United Kingdom', region: 'World', qsWorldRank: 2, theWorldRank: 9, websiteUrl: 'https://www.imperial.ac.uk' },
  { name: 'University of Oxford', country: 'United Kingdom', region: 'World', qsWorldRank: 3, theWorldRank: 1, websiteUrl: 'https://www.ox.ac.uk' },
  { name: 'Harvard University', country: 'United States', region: 'World', qsWorldRank: 4, theWorldRank: 3, websiteUrl: 'https://www.harvard.edu' },
  { name: 'University of Cambridge', country: 'United Kingdom', region: 'World', qsWorldRank: 5, theWorldRank: 5, websiteUrl: 'https://www.cam.ac.uk' },
  { name: 'Stanford University', country: 'United States', region: 'World', qsWorldRank: 6, theWorldRank: 6, websiteUrl: 'https://www.stanford.edu' },
  { name: 'ETH Zurich', country: 'Switzerland', region: 'World', qsWorldRank: 7, theWorldRank: 11, websiteUrl: 'https://www.ethz.ch' },
  { name: 'California Institute of Technology', country: 'United States', region: 'World', qsWorldRank: 10, theWorldRank: 7, websiteUrl: 'https://www.caltech.edu' },
  { name: 'University of California, Berkeley', country: 'United States', region: 'World', qsWorldRank: 12, theWorldRank: 9, websiteUrl: 'https://www.berkeley.edu' },
  { name: 'Princeton University', country: 'United States', region: 'World', qsWorldRank: 22, theWorldRank: 6, websiteUrl: 'https://www.princeton.edu' },
  { name: 'Yale University', country: 'United States', region: 'World', qsWorldRank: 23, theWorldRank: 13, websiteUrl: 'https://www.yale.edu' },
  { name: 'University of Toronto', country: 'Canada', region: 'World', qsWorldRank: 25, theWorldRank: 21, websiteUrl: 'https://www.utoronto.ca' },
  { name: 'Australian National University', country: 'Australia', region: 'World', qsWorldRank: 30, theWorldRank: 73, websiteUrl: 'https://www.anu.edu.au' },
  { name: 'University of Melbourne', country: 'Australia', region: 'World', qsWorldRank: 13, theWorldRank: 39, websiteUrl: 'https://www.unimelb.edu.au' },
  { name: 'University of Sydney', country: 'Australia', region: 'World', qsWorldRank: 18, theWorldRank: 61, websiteUrl: 'https://www.sydney.edu.au' },
  { name: 'TU Munich', country: 'Germany', region: 'World', qsWorldRank: 28, theWorldRank: 26, websiteUrl: 'https://www.tum.de' },
  { name: 'Delft University of Technology', country: 'Netherlands', region: 'World', qsWorldRank: 50, theWorldRank: 56, websiteUrl: 'https://www.tudelft.nl' },
  { name: 'KTH Royal Institute of Technology', country: 'Sweden', region: 'World', qsWorldRank: 73, theWorldRank: 121, websiteUrl: 'https://www.kth.se' },
  { name: 'University of Michigan-Ann Arbor', country: 'United States', region: 'World', qsWorldRank: 44, theWorldRank: 22, websiteUrl: 'https://umich.edu' },
  { name: 'Carnegie Mellon University', country: 'United States', region: 'World', qsWorldRank: 58, theWorldRank: 23, websiteUrl: 'https://www.cmu.edu' },

  // ── Asia tier (incl. East Asia + South Asia leaders) ─────────────────
  { name: 'National University of Singapore', country: 'Singapore', region: 'Asia', qsWorldRank: 8, theWorldRank: 19, qsAsiaRank: 1, websiteUrl: 'https://www.nus.edu.sg' },
  { name: 'Nanyang Technological University', country: 'Singapore', region: 'Asia', qsWorldRank: 15, theWorldRank: 30, qsAsiaRank: 4, websiteUrl: 'https://www.ntu.edu.sg' },
  { name: 'Tsinghua University', country: 'China', region: 'Asia', qsWorldRank: 20, theWorldRank: 12, qsAsiaRank: 2, websiteUrl: 'https://www.tsinghua.edu.cn' },
  { name: 'Peking University', country: 'China', region: 'Asia', qsWorldRank: 14, theWorldRank: 13, qsAsiaRank: 3, websiteUrl: 'https://www.pku.edu.cn' },
  { name: 'University of Hong Kong', country: 'Hong Kong SAR', region: 'Asia', qsWorldRank: 17, theWorldRank: 35, qsAsiaRank: 4, websiteUrl: 'https://www.hku.hk' },
  { name: 'University of Tokyo', country: 'Japan', region: 'Asia', qsWorldRank: 32, theWorldRank: 28, qsAsiaRank: 8, websiteUrl: 'https://www.u-tokyo.ac.jp' },
  { name: 'Kyoto University', country: 'Japan', region: 'Asia', qsWorldRank: 50, theWorldRank: 55, qsAsiaRank: 11, websiteUrl: 'https://www.kyoto-u.ac.jp' },
  { name: 'KAIST', country: 'South Korea', region: 'Asia', qsWorldRank: 53, theWorldRank: 82, qsAsiaRank: 12, websiteUrl: 'https://www.kaist.ac.kr' },
  { name: 'Seoul National University', country: 'South Korea', region: 'Asia', qsWorldRank: 31, theWorldRank: 62, qsAsiaRank: 9, websiteUrl: 'https://www.snu.ac.kr' },
  { name: 'Hong Kong University of Science and Technology', country: 'Hong Kong SAR', region: 'Asia', qsWorldRank: 47, theWorldRank: 66, qsAsiaRank: 10, websiteUrl: 'https://www.ust.hk' },
  { name: 'Chinese University of Hong Kong', country: 'Hong Kong SAR', region: 'Asia', qsWorldRank: 36, theWorldRank: 44, qsAsiaRank: 6, websiteUrl: 'https://www.cuhk.edu.hk' },
  { name: 'Fudan University', country: 'China', region: 'Asia', qsWorldRank: 39, theWorldRank: 36, qsAsiaRank: 7, websiteUrl: 'https://www.fudan.edu.cn' },
  { name: 'Shanghai Jiao Tong University', country: 'China', region: 'Asia', qsWorldRank: 45, theWorldRank: 43, qsAsiaRank: 11, websiteUrl: 'https://www.sjtu.edu.cn' },
  { name: 'Indian Institute of Technology Bombay', country: 'India', region: 'Asia', qsWorldRank: 118, theWorldRank: 201, qsAsiaRank: 28, websiteUrl: 'https://www.iitb.ac.in' },
  { name: 'Indian Institute of Technology Delhi', country: 'India', region: 'Asia', qsWorldRank: 150, theWorldRank: 401, qsAsiaRank: 44, websiteUrl: 'https://home.iitd.ac.in' },
  { name: 'Tokyo Institute of Technology', country: 'Japan', region: 'Asia', qsWorldRank: 84, theWorldRank: 191, qsAsiaRank: 20, websiteUrl: 'https://www.titech.ac.jp' },
  { name: 'Osaka University', country: 'Japan', region: 'Asia', qsWorldRank: 86, theWorldRank: 175, qsAsiaRank: 21, websiteUrl: 'https://www.osaka-u.ac.jp' },

  // ── Southeast Asia tier (excludes Thailand — separate tier) ──────────
  // NUS + NTU also live in Asia tier; the AI selector pulls them as
  // SEA candidates too because they're SG-based.
  { name: 'Universiti Malaya', country: 'Malaysia', region: 'Southeast Asia', qsWorldRank: 60, theWorldRank: 251, qsAsiaRank: 17, websiteUrl: 'https://www.um.edu.my' },
  { name: 'Universiti Sains Malaysia', country: 'Malaysia', region: 'Southeast Asia', qsWorldRank: 146, theWorldRank: 401, qsAsiaRank: 34, websiteUrl: 'https://www.usm.my' },
  { name: 'Universiti Kebangsaan Malaysia', country: 'Malaysia', region: 'Southeast Asia', qsWorldRank: 138, theWorldRank: 501, qsAsiaRank: 31, websiteUrl: 'https://www.ukm.my' },
  { name: 'Universiti Teknologi Malaysia', country: 'Malaysia', region: 'Southeast Asia', qsWorldRank: 188, theWorldRank: 601, qsAsiaRank: 49, websiteUrl: 'https://www.utm.my' },
  { name: 'Universiti Putra Malaysia', country: 'Malaysia', region: 'Southeast Asia', qsWorldRank: 148, theWorldRank: 601, qsAsiaRank: 36, websiteUrl: 'https://www.upm.edu.my' },
  { name: 'Universitas Indonesia', country: 'Indonesia', region: 'Southeast Asia', qsWorldRank: 206, theWorldRank: 801, qsAsiaRank: 50, websiteUrl: 'https://www.ui.ac.id' },
  { name: 'Institut Teknologi Bandung', country: 'Indonesia', region: 'Southeast Asia', qsWorldRank: 256, theWorldRank: 1001, qsAsiaRank: 64, websiteUrl: 'https://www.itb.ac.id' },
  { name: 'Universitas Gadjah Mada', country: 'Indonesia', region: 'Southeast Asia', qsWorldRank: 239, theWorldRank: 1001, qsAsiaRank: 58, websiteUrl: 'https://www.ugm.ac.id' },
  { name: 'Vietnam National University, Hanoi', country: 'Vietnam', region: 'Southeast Asia', qsWorldRank: 851, theWorldRank: 1201, qsAsiaRank: 187, websiteUrl: 'https://www.vnu.edu.vn' },
  { name: 'University of the Philippines', country: 'Philippines', region: 'Southeast Asia', qsWorldRank: 396, theWorldRank: 1001, qsAsiaRank: 87, websiteUrl: 'https://up.edu.ph' },
  { name: 'Asian Institute of Technology', country: 'Thailand', region: 'Southeast Asia', qsWorldRank: 901, websiteUrl: 'https://www.ait.ac.th', notes: 'Located in Thailand but operates as a regional ASEAN-postgraduate institution.' },

  // ── Thailand tier (universities at or above KKU's QS world rank) ─────
  { name: 'Chulalongkorn University', country: 'Thailand', region: 'Thailand', qsWorldRank: 229, theWorldRank: 1001, qsAsiaRank: 44, websiteUrl: 'https://www.chula.ac.th', notes: 'Highest-ranked Thai university; flagship in nearly every subject.' },
  { name: 'Mahidol University', country: 'Thailand', region: 'Thailand', qsWorldRank: 382, theWorldRank: 601, qsAsiaRank: 91, websiteUrl: 'https://www.mahidol.ac.th', notes: 'Strongest in life sciences + medicine.' },
  { name: 'Chiang Mai University', country: 'Thailand', region: 'Thailand', qsWorldRank: 571, theWorldRank: 1201, qsAsiaRank: 130, websiteUrl: 'https://www.cmu.ac.th', notes: 'Northern Thailand flagship; comparable scale to KKU.' },
  { name: 'Thammasat University', country: 'Thailand', region: 'Thailand', qsWorldRank: 601, theWorldRank: 1201, qsAsiaRank: 144, websiteUrl: 'https://www.tu.ac.th', notes: 'Strong in social sciences, law, business.' },
  { name: 'King Mongkut\'s University of Technology Thonburi', country: 'Thailand', region: 'Thailand', qsWorldRank: 601, theWorldRank: 1001, qsAsiaRank: 144, websiteUrl: 'https://www.kmutt.ac.th', notes: 'Engineering-focused.' },
  { name: 'Kasetsart University', country: 'Thailand', region: 'Thailand', qsWorldRank: 761, theWorldRank: 1501, qsAsiaRank: 174, websiteUrl: 'https://www.ku.ac.th', notes: 'Agriculture-focused; Thailand\'s leading agri-research institution.' },
  { name: 'King Mongkut\'s Institute of Technology Ladkrabang', country: 'Thailand', region: 'Thailand', qsWorldRank: 711, theWorldRank: 1501, qsAsiaRank: 167, websiteUrl: 'https://www.kmitl.ac.th', notes: 'Engineering + technology.' },
  { name: 'Prince of Songkla University', country: 'Thailand', region: 'Thailand', qsWorldRank: 901, theWorldRank: 1501, qsAsiaRank: 209, websiteUrl: 'https://www.psu.ac.th', notes: 'Southern Thailand flagship; comparable to KKU.' },
  { name: 'Khon Kaen University', country: 'Thailand', region: 'Thailand', qsWorldRank: 1001, theWorldRank: 1501, qsAsiaRank: 251, websiteUrl: 'https://www.kku.ac.th', notes: 'KKU itself — included for self-reference; AI selector excludes this row from peer picks.' },
];

async function main(): Promise<void> {
  let upserted = 0;
  for (const u of UNIVERSITIES) {
    await prisma.rankedUniversity.upsert({
      where: { name_rankingYear: { name: u.name, rankingYear: RANKING_YEAR } },
      create: {
        name: u.name,
        country: u.country,
        region: u.region,
        qsWorldRank: u.qsWorldRank ?? null,
        theWorldRank: u.theWorldRank ?? null,
        qsAsiaRank: u.qsAsiaRank ?? null,
        theAsiaRank: u.theAsiaRank ?? null,
        rankingYear: RANKING_YEAR,
        websiteUrl: u.websiteUrl ?? null,
        notes: u.notes ?? null,
      },
      update: {
        country: u.country,
        region: u.region,
        qsWorldRank: u.qsWorldRank ?? null,
        theWorldRank: u.theWorldRank ?? null,
        qsAsiaRank: u.qsAsiaRank ?? null,
        theAsiaRank: u.theAsiaRank ?? null,
        websiteUrl: u.websiteUrl ?? null,
        notes: u.notes ?? null,
      },
    });
    upserted++;
  }
  console.log(`✓ Upserted ${upserted} ranked universities for ${RANKING_YEAR}`);
  for (const region of ['World', 'Asia', 'Southeast Asia', 'Thailand']) {
    const c = await prisma.rankedUniversity.count({
      where: { region, rankingYear: RANKING_YEAR },
    });
    console.log(`  ${region}: ${c}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
