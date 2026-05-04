#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Remove mock-seeded data so the analyses reflect ONLY real data flowing
// through the live connectors (kku-registry, kku-hr, kku-finance,
// kku-research, kmitl-skill-mapping) and the curated workflow (sheet seed
// → curriculum PDFs → digest → ProgramSkill).
//
// What this DOES delete (mock-seeded):
//   • council_decisions + descendants (decision_milestones/approvers/outcome_reviews/annotations)
//   • scenarios + scenario_runs + scenario_results
//   • peer_sets + peer_set_members + peer_programs + peer_program_skills + peer_rankings
//   • trend_signals (and notifications/signal_subscriptions referencing them — cascade)
//   • job_postings + job_posting_skills (mock JobThai/JobsDB connector)
//   • occupation_demand (mock seed)
//   • forecast_runs (synthetic back-test data)
//
// What this DOES NOT touch (real / load-bearing):
//   • Programs / Faculties / Departments / Users / Skills taxonomy
//   • Real curriculum PDFs (pdf_documents) + program_documents links
//   • AI extractions (ai_extractions) — PROGRAM_DIGEST + PROPOSED_SKILL
//   • AI inferences (ai_inferences) — LLM-call audit trail
//   • Real connector outputs:
//       enrollment_metrics, student_demographics (kku-registry)
//       financial_metrics, faculty_budgets         (kku-finance)
//       faculty_members, faculty_compensation      (kku-hr)
//       research_outputs                            (kku-research)
//       kmitl_careers, kmitl_career_skill_demands, kmitl_skill_growths (LinkedIn via MHESI/KMITL)
//   • Skill aliases (real AI normalisation decisions)
//   • Public Thailand reference data: sectors, skill_sectors, demographic_projections
//   • Ingestion runs (real evidence of connector activity, even mock-connector runs)
//
// Usage:
//   pnpm tsx apps/ingestion/src/scripts/remove-mock-data.ts            # dry-run
//   pnpm tsx apps/ingestion/src/scripts/remove-mock-data.ts --apply    # commit
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

const APPLY = process.argv.includes('--apply');

interface TableSpec {
  table: string;
  description: string;
}

// Order matters: descendants before parents. FK CASCADE may not be set on
// every relation — explicit child-first delete is the safe default.
const MOCK_TABLES: TableSpec[] = [
  // Council decisions + descendants
  { table: 'decision_outcome_reviews', description: 'Sample outcome-review rows tied to seeded decisions' },
  { table: 'decision_approvers',       description: 'Sample approvers tied to seeded decisions' },
  { table: 'decision_milestones',      description: 'Sample milestones tied to seeded decisions' },
  { table: 'council_decisions',        description: '3 sample decisions seeded for prompt 12 demo' },

  // Scenarios + descendants
  { table: 'scenario_results',         description: 'Sample scenario results' },
  { table: 'scenario_runs',            description: 'Sample scenario runs' },
  { table: 'scenarios',                description: '4 seeded scenario templates from prompt 09' },

  // Peer benchmarking — all mock-seeded for prompt 10
  { table: 'peer_rankings',            description: '27 seeded THE/QS/SCImago rows (mock)' },
  { table: 'peer_program_skills',      description: '60 seeded peer-program-skill rows (mock)' },
  { table: 'peer_set_members',         description: '22 seeded peer-set membership rows' },
  { table: 'peer_sets',                description: '3 seeded system peer sets' },
  { table: 'peer_programs',            description: '12 seeded mock peer programs' },

  // Trends — all mock-seeded for prompt 07. Notifications + signal subs
  // cascade from the FK to trend_signals.
  { table: 'notifications',            description: 'Notifications referencing mock signals' },
  { table: 'signal_subscriptions',     description: 'Subscription rows for mock signals' },
  { table: 'trend_signals',            description: '29 seeded mock signals from prompt 07' },

  // Mock connector data (jobthai/jobsdb deprecated; mock seeds for tests)
  { table: 'job_posting_skills',       description: 'Skill rollups from mock job postings' },
  { table: 'job_postings',             description: 'Mock seed job postings (real connector deprecated)' },

  // Mock NSO/labour-market seed
  { table: 'occupation_demand',        description: '192 mock seed rows for prompt 08 forecasting tests' },

  // Synthetic forecast back-tests
  { table: 'forecast_runs',            description: '9 synthetic back-tests for prompt 08 demo' },

  // Misc mock content
  { table: 'employer_feedback',        description: 'Mock employer feedback (currently 0)' },
  { table: 'graduate_outcomes',        description: 'Mock graduate outcomes (currently 0)' },
  { table: 'policy_documents',         description: 'Mock policy docs (currently 0; real path is via uploaded PDFs)' },
  { table: 'labor_market_forecasts',   description: 'Forecasting rollup table (currently 0)' },

  // Annotations created via seeds (kind=signal_review, kind=disagreement)
  // — leave the table; analyst-created rows are real but currently 0.
];

// Conditional deletes — rows identified by a column value rather than the
// whole table. Each entry returns the count deleted; reported in the same
// "[Deleting]" block alongside whole-table deletes.
const CONDITIONAL_DELETES: Array<{
  label: string;
  description: string;
  countSql: string;
  deleteSql: string;
}> = [
  {
    label: 'faculty_members (non-hr_ prefix)',
    description: 'Synthetic "Faculty Member 1 (EN-CPE)" rows seeded by prompt 01. Real kku-hr rows have employee_code starting with "hr_".',
    countSql: `SELECT COUNT(*)::bigint AS count FROM "faculty_members" WHERE "employee_code" NOT LIKE 'hr_%'`,
    deleteSql: `DELETE FROM "faculty_members" WHERE "employee_code" NOT LIKE 'hr_%'`,
  },
  {
    label: 'pdf_documents (non-CURRICULUM)',
    description: 'Mock policy/report/peer/minutes PDFs seeded by prompt 02. Real ones land via /upload.',
    countSql: `SELECT COUNT(*)::bigint AS count FROM "pdf_documents" WHERE "source_category" != 'CURRICULUM'`,
    deleteSql: `DELETE FROM "pdf_documents" WHERE "source_category" != 'CURRICULUM'`,
  },
];

async function tableCount(table: string): Promise<number> {
  // Use $queryRawUnsafe — table names must be hardcoded (non-user-input).
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
  );
  return Number(rows[0]?.count ?? 0n);
}

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? 'APPLY (will delete)' : 'DRY RUN'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // BEFORE
  console.log('\n[Before]');
  let totalBefore = 0;
  const beforeCounts = new Map<string, number>();
  for (const { table } of MOCK_TABLES) {
    const n = await tableCount(table);
    beforeCounts.set(table, n);
    totalBefore += n;
  }
  for (const { table, description } of MOCK_TABLES) {
    const n = beforeCounts.get(table) ?? 0;
    if (n > 0) console.log(`  ${table.padEnd(40)} ${String(n).padStart(6)}  ${description}`);
  }
  // Conditional deletes (e.g., subset of a table by column value)
  const conditionalCounts = new Map<string, number>();
  for (const cd of CONDITIONAL_DELETES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(cd.countSql);
    const n = Number(rows[0]?.count ?? 0n);
    conditionalCounts.set(cd.label, n);
    totalBefore += n;
    if (n > 0) console.log(`  ${cd.label.padEnd(40)} ${String(n).padStart(6)}  ${cd.description}`);
  }
  console.log(`  ${'TOTAL'.padEnd(40)} ${String(totalBefore).padStart(6)}`);

  if (totalBefore === 0) {
    console.log('\nNothing to remove.');
    return;
  }

  if (!APPLY) {
    console.log('\n(dry-run; pass --apply to actually delete)');
    console.log('\nAfter --apply, the following analyses will draw exclusively from real data:');
    console.log('  • Cockpit health-score (kku-registry + kku-finance + kmitl LinkedIn)');
    console.log('  • Program Deep-Dive (curriculum digest + kku-research + faculty + alignment)');
    console.log('  • Gap Analyzer (LinkedIn demand × ProgramSkill supply)');
    console.log('  • Benchmarking — will be empty until real peer-data connectors land');
    console.log('  • Trends Radar — will be empty until real trend connectors flip live');
    console.log('  • Decision Workspace — will be empty until first real decision is captured');
    console.log('  • Scenarios — will be empty until first real scenario is created');
    return;
  }

  // APPLY phase
  console.log('\n[Deleting]');
  let totalDeleted = 0;
  await prisma.$transaction(async (tx) => {
    for (const { table } of MOCK_TABLES) {
      const before = beforeCounts.get(table) ?? 0;
      if (before === 0) continue;
      const result = await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
      console.log(`  ${table.padEnd(40)} -${String(result).padStart(6)}`);
      totalDeleted += Number(result);
    }
    for (const cd of CONDITIONAL_DELETES) {
      const before = conditionalCounts.get(cd.label) ?? 0;
      if (before === 0) continue;
      const result = await tx.$executeRawUnsafe(cd.deleteSql);
      console.log(`  ${cd.label.padEnd(40)} -${String(result).padStart(6)}`);
      totalDeleted += Number(result);
    }
  });

  console.log('\n[After]');
  let totalAfter = 0;
  for (const { table } of MOCK_TABLES) {
    const n = await tableCount(table);
    if (n > 0) {
      console.log(`  ${table.padEnd(30)} ${String(n).padStart(6)}  (RESIDUAL — investigate)`);
    }
    totalAfter += n;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Deleted: ${totalDeleted} rows across ${MOCK_TABLES.filter((t) => (beforeCounts.get(t.table) ?? 0) > 0).length} tables`);
  console.log(`Residual: ${totalAfter} (should be 0)`);

  // Quick sanity: confirm real-data tables are intact
  const survivors = await prisma.$transaction([
    prisma.program.count(),
    prisma.enrollmentMetric.count(),
    prisma.financialMetric.count(),
    prisma.facultyMember.count(),
    prisma.kmitlCareerSkillDemand.count(),
    prisma.researchOutput.count(),
    prisma.skillAlias.count(),
    prisma.aiExtraction.count(),
    prisma.pdfDocument.count(),
  ]);
  console.log('\n[Real-data survivors]');
  console.log(`  programs:                   ${survivors[0]}`);
  console.log(`  enrollment_metrics:         ${survivors[1]}`);
  console.log(`  financial_metrics:          ${survivors[2]}`);
  console.log(`  faculty_members:            ${survivors[3]}`);
  console.log(`  kmitl_career_skill_demands: ${survivors[4]}`);
  console.log(`  research_outputs:           ${survivors[5]}`);
  console.log(`  skill_aliases:              ${survivors[6]}`);
  console.log(`  ai_extractions:             ${survivors[7]}`);
  console.log(`  pdf_documents:              ${survivors[8]}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
