import type { SourceCatalogEntry } from './types';

// Canonical source catalog. DB seed upserts one row per entry; the
// ingestion connector registry looks up its DataSource row by slug. If
// you add a new connector, you MUST add an entry here in the same
// commit or the registry won't find a DataSource to write runs against.
//
// All entries currently `mocked: true` — real wiring belongs in prompt
// 14. Flip to false when the connector actually hits the real upstream.

export const SOURCE_CATALOG: readonly SourceCatalogEntry[] = [
  // ── Internal KKU systems ────────────────────────────────────────────────
  {
    slug: 'kku-registry',
    name: 'KKU Registry (REG)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 2 * * *', // daily at 02:00
    ownerContact: 'KKU Registrar — Academic Office',
    notes: 'Programs, courses, enrollment, degree completion. Master source for student-body demographics.',
    mocked: true,
  },
  {
    slug: 'kku-finance',
    name: 'KKU Finance',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 3 1 * *', // monthly on the 1st
    ownerContact: 'KKU Finance Office',
    notes: 'Program revenue, direct + shared cost allocation. Sensitive — restricted RBAC.',
    mocked: true,
  },
  {
    slug: 'kku-hr',
    name: 'KKU HR (Faculty roster)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 4 * * 1', // weekly on Monday
    ownerContact: 'KKU HR Office',
    notes: 'Faculty member list with rank, department, appointment date, retirement projections.',
    mocked: true,
  },
  {
    slug: 'kku-alumni',
    name: 'KKU Alumni Outcomes',
    kind: 'API',
    inputFormat: 'MIXED',
    cadenceCron: '0 5 1 */3 *', // quarterly on the 1st
    ownerContact: 'KKU Alumni & Career Services',
    notes: 'Graduate employment survey + Student Loan Fund repayments. Some cohort summaries arrive as PDF.',
    mocked: true,
  },
  {
    slug: 'kku-research',
    name: 'KKU Research Outputs',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 6 * * 0', // weekly on Sunday
    ownerContact: 'KKU Research & Graduate School',
    notes: 'Publications, patents, grants. Real wiring crosswalks to Scopus + OpenAlex in prompt 14.',
    mocked: true,
  },
  {
    slug: 'digital-transcript',
    name: 'Thailand Digital Transcript',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 1 * * *', // daily at 01:00
    ownerContact: 'KKU Digital Transcript Team (existing KKU system)',
    notes: 'Skill claims per student. Already live in production — wiring here mirrors the claims feed.',
    mocked: true,
  },

  // ── National Thai ──────────────────────────────────────────────────────
  {
    slug: 'mhesi-cisa',
    name: 'MHESI CISA (Accreditation)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 2 * * 1', // weekly Monday
    ownerContact: 'KKU Academic Standards & Quality Office',
    notes: 'Curriculum accreditation statuses. The existing CISA system already exposes an API — real wiring is cheap.',
    mocked: true,
  },
  {
    slug: 'nso-labor-force',
    name: 'NSO Labor Force Survey',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 8 10 * *', // monthly on the 10th (NSO publishes ~1st week)
    ownerContact: 'KKU Data Office (no formal agreement — public data)',
    notes: 'Quarterly labor force survey + annual employment statistics. Published as heavily-tabled PDF + occasional CSV. Routes through the prompt 03b PDF intake pipeline.',
    mocked: true,
  },
  {
    slug: 'tcas',
    name: 'TCAS / TGAT-TPAT',
    kind: 'PDF',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 9 15 5 *', // annual — results published mid-May
    ownerContact: 'KKU Admissions Office',
    notes: 'Annual national admission test scores + programme-level cutoffs. Mixture of PDF summaries and a partial API.',
    mocked: true,
  },
  {
    slug: 'tpqi',
    name: 'TPQI Occupational Standards',
    kind: 'PDF',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 7 * * 2', // weekly on Tuesday
    ownerContact: 'KKU TVET liaison',
    notes: 'Thailand Professional Qualification Institute standards. Portal has an API for metadata + PDF downloads for the standards themselves.',
    mocked: true,
  },
  {
    slug: 'jobthai',
    name: 'JobThai (Job postings)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 */6 * * *', // every 6 hours
    ownerContact: 'KKU Data Office (scraping agreement TBD)',
    notes: 'Job postings used for skill demand + salary signals. Real wiring goes through JobThai\'s commercial feed when the agreement is signed.',
    mocked: true,
  },
  {
    slug: 'jobsdb',
    name: 'JobsDB (Job postings)',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 */6 * * *', // every 6 hours
    ownerContact: 'KKU Data Office',
    notes: 'Broader regional coverage than JobThai. Commercial API — budget pending.',
    mocked: true,
  },
  {
    slug: 'mhesi-policy',
    name: 'MHESI Policy Announcements',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 6 * * *', // daily
    ownerContact: 'KKU Strategic Planning Office',
    notes: 'Ministry of Higher Education policy announcements — almost entirely PDF. Very noisy; the PDF intake pipeline filters.',
    mocked: true,
  },
  {
    slug: 'nesdc-reports',
    name: 'NESDC Economic Plans',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 7 * * 1', // weekly Monday
    ownerContact: 'KKU Strategic Planning Office',
    notes: 'National Economic & Social Development Council — 5-year plans + quarterly economic outlooks. Long PDFs (200+ pages) routed through 03b.',
    mocked: true,
  },
  {
    slug: 'nxpo-reports',
    name: 'NXPO Research/Innovation Policy',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 7 * * 3', // weekly Wednesday
    ownerContact: 'KKU Research & Innovation Office',
    notes: 'National Higher Education, Science, Research & Innovation Policy Council — R&D policy direction.',
    mocked: true,
  },
  {
    slug: 'boi-sectoral',
    name: 'BOI Sectoral Data',
    kind: 'PDF',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 8 5 * *', // monthly on the 5th
    ownerContact: 'KKU Industry Liaison Office',
    notes: 'Board of Investment — sector investment statistics. PDF reports + occasional Excel. Key input for S-curve + target industry analysis.',
    mocked: true,
  },
  {
    slug: 'eeco-reports',
    name: 'EECO (Eastern Economic Corridor)',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 8 15 * *', // monthly on the 15th
    ownerContact: 'KKU Industry Liaison Office',
    notes: 'Eastern Economic Corridor Office — industrial development plans. Less relevant to Khon Kaen geographically, but workforce signals carry over.',
    mocked: true,
  },

  // ── Regional / international ───────────────────────────────────────────
  {
    slug: 'wef-future-of-jobs',
    name: 'WEF Future of Jobs Report',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 10 1 5 *', // annual (May — when WEF typically publishes)
    ownerContact: 'KKU Data Office',
    notes: 'World Economic Forum annual report. Foundational for future-skill taxonomies. Always a long PDF.',
    mocked: true,
  },
  {
    slug: 'oecd-reports',
    name: 'OECD Sectoral Reports',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 10 * * 1', // weekly Monday
    ownerContact: 'KKU Data Office',
    notes: 'OECD skills + education outlook + sectoral reports. Thailand-specific reports pulled preferentially.',
    mocked: true,
  },
  {
    slug: 'world-bank',
    name: 'World Bank Data',
    kind: 'API',
    inputFormat: 'MIXED',
    cadenceCron: '0 11 * * 0', // weekly Sunday
    ownerContact: 'KKU Data Office',
    notes: 'Labor data, education indicators, demographic projections. World Bank has a free API + long-form PDFs for narrative reports.',
    mocked: true,
  },
  {
    slug: 'adb-gms',
    name: 'ADB Greater Mekong Subregion',
    kind: 'PDF',
    inputFormat: 'PDF',
    acceptsPdfUploads: true,
    cadenceCron: '0 11 * * 4', // weekly Thursday
    ownerContact: 'KKU Data Office',
    notes: 'Asian Development Bank — Greater Mekong Subregion reports. Critical for Laos/Myanmar/Cambodia peer context for some KKU programs.',
    mocked: true,
  },
  {
    slug: 'scopus',
    name: 'Scopus',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 12 * * 0', // weekly Sunday
    ownerContact: 'KKU Library (existing subscription)',
    notes: 'Elsevier Scopus — research output with citation counts. Requires API key. Subscribes via KKU Library.',
    mocked: true,
  },
  {
    slug: 'openalex',
    name: 'OpenAlex',
    kind: 'API',
    inputFormat: 'JSON',
    cadenceCron: '0 13 * * 0', // weekly Sunday
    ownerContact: 'KKU Data Office (public API, no agreement needed)',
    notes: 'Open scholarly metadata — backup + cross-check for Scopus. Free API with generous rate limits.',
    mocked: true,
  },
  {
    slug: 'peer-programs-scraper',
    name: 'Peer University Program Pages',
    kind: 'SCRAPE',
    inputFormat: 'MIXED',
    acceptsPdfUploads: true,
    cadenceCron: '0 14 * * 6', // weekly Saturday
    ownerContact: 'KKU Data Office',
    notes: 'Scrapes Thai + ASEAN peer universities\' program pages + downloads their brochure PDFs. Legal grey zone — stick to public catalogue pages.',
    mocked: true,
  },
] as const;

export function getCatalogEntry(slug: string): SourceCatalogEntry | undefined {
  return SOURCE_CATALOG.find((e) => e.slug === slug);
}
