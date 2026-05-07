#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Discovery probe for the kku-publications source — internal Postgres mirror
// at 10.130.2.151 carrying the full collection of KKU publications harvested
// from Scopus (curated by KKU Library / Research Office).
//
// Under evaluation as a candidate replacement for the OpenAlex + Scopus-API
// combination currently powering the kku-research connector.
//
// This probe is READ-ONLY. It performs no writes, no DDL, no analyse. It
// exists to:
//   1. Verify the connection works after credentials land in .env.
//   2. Enumerate available schemas / tables so we know what shape the
//      publications data takes (column names, row counts, primary keys).
//   3. Sample 3-5 rows from candidate tables so we can design a real
//      transform without guessing.
//   4. Compare coverage vs the existing kku-research outputs (year span,
//      total paper count, Scopus-ID density, DOI density).
//
// PII guard: any sample query whose column list matches
//   email|phone|address|citizen|passport|tax_id|salary|password
// is refused. The mirror is contractually publication-metadata-only,
// but the guard is the trust boundary that catches the first time
// someone adds a column we shouldn't see.
//
// Usage:
//   pnpm publications:probe ping             # version + dbs + schemas
//   pnpm publications:probe tables           # tables + row counts (top 50)
//   pnpm publications:probe columns <table>  # column types of a table
//   pnpm publications:probe sample <table>   # 5 sample rows (PII-guarded)
//   pnpm publications:probe coverage         # year span + scopus-id / doi density
//   pnpm publications:probe all              # ping + tables + heuristic sample
//
// All output also written to apps/ingestion/test/fixtures/kku-publications/
// for repeatable inspection. Aggregate counts only — no row dumps that
// contain PII.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  query,
  withConnection,
  type PostgresConfig,
} from '../lib/postgres-client';

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const FIXTURE_DIR = path.resolve(__dirname, '../../test/fixtures/kku-publications');
const PII_PATTERN =
  /^(email|phone|address|citizen|passport|tax_id|salary|password|ssn|national_id|id_card|pid)$/i;

async function ensureDir(): Promise<void> {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
}

async function writeFixture(name: string, data: unknown): Promise<void> {
  await ensureDir();
  const target = path.join(FIXTURE_DIR, `${name}.json`);
  await fs.writeFile(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  → wrote ${path.relative(process.cwd(), target)}`);
}

function loadConfig(): PostgresConfig {
  return configFromEnv('KKU_PUBLICATIONS_DB');
}

// ─────────────────────────────────────────────────────────────────────
// ping — confirm connectivity + identify server / dbs / schemas
// ─────────────────────────────────────────────────────────────────────

interface DbRow {
  datname: string;
}
interface SchemaRow {
  schema_name: string;
}
interface VersionRow {
  version: string;
  current_database: string;
  current_user: string;
}

async function ping(): Promise<void> {
  console.log('[ping] connecting to KKU Publications mirror…');
  const cfg = loadConfig();
  console.log(
    `  host=${cfg.host}:${cfg.port}  database=${cfg.database}  user=${cfg.user}  ssl=${cfg.ssl}`,
  );
  await withConnection(cfg, async (client) => {
    const version = await query<VersionRow>(
      client,
      'SELECT version() AS version, current_database() AS current_database, current_user AS current_user',
    );
    console.log(`  server: ${version[0]?.version ?? '(unknown)'}`);
    console.log(`  current db: ${version[0]?.current_database}, current user: ${version[0]?.current_user}`);

    const dbs = await query<DbRow>(
      client,
      `SELECT datname FROM pg_database
       WHERE datistemplate = false
       ORDER BY datname`,
    );
    console.log(`  databases on server (${dbs.length}):`);
    for (const r of dbs) console.log(`    ${r.datname}`);

    const schemas = await query<SchemaRow>(
      client,
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
         AND schema_name NOT LIKE 'pg_%'
       ORDER BY schema_name`,
    );
    console.log(`  user schemas in ${cfg.database} (${schemas.length}):`);
    for (const r of schemas) console.log(`    ${r.schema_name}`);

    await writeFixture('ping', {
      capturedAt: new Date().toISOString(),
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      version: version[0]?.version,
      currentDatabase: version[0]?.current_database,
      currentUser: version[0]?.current_user,
      databases: dbs.map((r) => r.datname),
      schemas: schemas.map((r) => r.schema_name),
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// tables — inventory tables in user schemas with rough row counts
// ─────────────────────────────────────────────────────────────────────

interface TableRow {
  table_schema: string;
  table_name: string;
  table_type: string;
  approx_rows: string | null;
}

async function tables(): Promise<void> {
  console.log('[tables] inventory of user-schema tables + approximate row counts…');
  const cfg = loadConfig();
  await withConnection(cfg, async (client) => {
    const rows = await query<TableRow>(
      client,
      `SELECT t.table_schema,
              t.table_name,
              t.table_type,
              c.reltuples::bigint::text AS approx_rows
       FROM information_schema.tables t
       LEFT JOIN pg_class c
         ON c.relname = t.table_name
       LEFT JOIN pg_namespace n
         ON n.oid = c.relnamespace AND n.nspname = t.table_schema
       WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
         AND t.table_schema NOT LIKE 'pg_%'
       ORDER BY (c.reltuples) DESC NULLS LAST, t.table_schema, t.table_name
       LIMIT 200`,
    );
    console.log(`  found ${rows.length} tables (showing top 50 by approx row count):`);
    for (const r of rows.slice(0, 50)) {
      const cnt = r.approx_rows === null ? '?' : Number(r.approx_rows).toLocaleString();
      console.log(
        `    ${r.table_schema}.${r.table_name}  [${r.table_type}]  ≈${cnt} rows`,
      );
    }
    await writeFixture('tables', {
      capturedAt: new Date().toISOString(),
      tables: rows,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// columns — describe a specific table's columns
// ─────────────────────────────────────────────────────────────────────

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  ordinal_position: number;
  column_default: string | null;
  character_maximum_length: number | null;
}

function parseTableArg(arg: string | undefined): { schema: string; table: string } {
  if (!arg) {
    throw new Error(
      'usage: pnpm publications:probe columns <schema.table>  OR  <table> (defaults to public schema)',
    );
  }
  const parts = arg.split('.');
  if (parts.length === 1 && parts[0]) return { schema: 'public', table: parts[0] };
  if (parts.length === 2 && parts[0] && parts[1]) return { schema: parts[0], table: parts[1] };
  throw new Error(`unrecognised table arg: ${arg}`);
}

async function columns(arg: string | undefined): Promise<void> {
  const { schema, table } = parseTableArg(arg);
  console.log(`[columns] describing ${schema}.${table}…`);
  const cfg = loadConfig();
  await withConnection(cfg, async (client) => {
    const rows = await query<ColumnRow>(
      client,
      `SELECT column_name, data_type, is_nullable, ordinal_position,
              column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table],
    );
    if (rows.length === 0) {
      console.log(`  no such table: ${schema}.${table}`);
      return;
    }
    for (const r of rows) {
      const flag = r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      const len = r.character_maximum_length ? `(${r.character_maximum_length})` : '';
      const piiFlag = PII_PATTERN.test(r.column_name) ? '  ⚠️  POSSIBLE PII' : '';
      console.log(
        `    ${String(r.ordinal_position).padStart(2)}. ${r.column_name.padEnd(40)} ${r.data_type}${len}  ${flag}${piiFlag}`,
      );
    }
    const piiColumns = rows.filter((r) => PII_PATTERN.test(r.column_name));
    if (piiColumns.length > 0) {
      console.log(`  ⚠️  ${piiColumns.length} column(s) match the PII pattern; sample command will refuse this table.`);
    }
    await writeFixture(`columns-${schema}-${table}`, {
      capturedAt: new Date().toISOString(),
      schema,
      table,
      columns: rows,
      piiColumns: piiColumns.map((r) => r.column_name),
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// sample — small sample (5 rows) with PII guard
// ─────────────────────────────────────────────────────────────────────

async function sample(arg: string | undefined): Promise<void> {
  const { schema, table } = parseTableArg(arg);
  console.log(`[sample] sampling ${schema}.${table} (5 rows, PII-guarded)…`);
  const cfg = loadConfig();
  await withConnection(cfg, async (client) => {
    const cols = await query<ColumnRow>(
      client,
      `SELECT column_name, data_type, is_nullable, ordinal_position,
              column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table],
    );
    if (cols.length === 0) {
      console.log(`  no such table: ${schema}.${table}`);
      return;
    }
    const piiColumns = cols.filter((c) => PII_PATTERN.test(c.column_name));
    if (piiColumns.length > 0) {
      console.log(
        `  ⚠️  REFUSING sample: ${schema}.${table} has ${piiColumns.length} PII-pattern column(s): ${piiColumns
          .map((c) => c.column_name)
          .join(', ')}`,
      );
      console.log(
        '  If this is a false positive, edit probe-kku-publications.ts → PII_PATTERN.',
      );
      return;
    }
    // Quote schema/table to handle case-sensitive identifiers and Thai
    // names safely. pg parameterised queries don't bind identifiers.
    const ident = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    const rows = await query(client, `SELECT * FROM ${ident} LIMIT 5`);
    console.log(`  rows: ${rows.length}`);
    for (let i = 0; i < rows.length; i++) {
      console.log(`  --- row ${i + 1} ---`);
      const row = rows[i];
      if (!row) continue;
      for (const [k, v] of Object.entries(row)) {
        const s = v === null ? '(null)' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        console.log(`    ${k}: ${s.length > 200 ? s.slice(0, 197) + '…' : s}`);
      }
    }
    await writeFixture(`sample-${schema}-${table}`, {
      capturedAt: new Date().toISOString(),
      schema,
      table,
      columns: cols.map((c) => c.column_name),
      rows,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// coverage — year span + scopus-id / doi density on candidate tables
// ─────────────────────────────────────────────────────────────────────

interface CandidateTable {
  schema: string;
  table: string;
  yearColumn: string | null;
  doiColumn: string | null;
  scopusColumn: string | null;
  rowCount: number;
}

async function coverage(): Promise<void> {
  console.log('[coverage] looking for publication-shaped tables and computing year span / ID density…');
  const cfg = loadConfig();
  await withConnection(cfg, async (client) => {
    // Find tables whose name suggests publications.
    const candidates = await query<{ table_schema: string; table_name: string }>(
      client,
      `SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         AND table_schema NOT LIKE 'pg_%'
         AND (
           table_name ILIKE '%publication%' OR
           table_name ILIKE '%paper%' OR
           table_name ILIKE '%document%' OR
           table_name ILIKE '%scopus%' OR
           table_name ILIKE '%article%' OR
           table_name ILIKE '%journal%'
         )
       ORDER BY table_schema, table_name`,
    );
    console.log(`  candidate publication-shaped tables: ${candidates.length}`);
    for (const c of candidates) console.log(`    ${c.table_schema}.${c.table_name}`);

    const findings: CandidateTable[] = [];
    for (const c of candidates) {
      const cols = await query<{ column_name: string; data_type: string }>(
        client,
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2`,
        [c.table_schema, c.table_name],
      );
      const yearCol = cols.find((x) => /^(year|pub_year|publication_year)$/i.test(x.column_name))?.column_name ?? null;
      const doiCol = cols.find((x) => /^doi$/i.test(x.column_name))?.column_name ?? null;
      const scopusCol = cols.find(
        (x) =>
          /^(scopus_id|scopus_eid|eid|scopus_pub_id)$/i.test(x.column_name) ||
          /scopus/i.test(x.column_name),
      )?.column_name ?? null;
      const ident = `"${c.table_schema}"."${c.table_name}"`;
      const cnt = await query<{ n: string }>(client, `SELECT COUNT(*)::text AS n FROM ${ident}`);
      const rowCount = Number(cnt[0]?.n ?? 0);
      findings.push({
        schema: c.table_schema,
        table: c.table_name,
        yearColumn: yearCol,
        doiColumn: doiCol,
        scopusColumn: scopusCol,
        rowCount,
      });
      console.log(
        `  ${c.table_schema}.${c.table_name}: rows=${rowCount.toLocaleString()}  year=${yearCol ?? '(none)'}  doi=${doiCol ?? '(none)'}  scopus=${scopusCol ?? '(none)'}`,
      );
    }

    // For each candidate with a year column, get year distribution.
    const yearDistributions: Array<{
      schema: string;
      table: string;
      years: Array<{ year: number; count: number }>;
    }> = [];
    for (const f of findings) {
      if (!f.yearColumn) continue;
      const ident = `"${f.schema}"."${f.table}"`;
      const yearIdent = `"${f.yearColumn.replace(/"/g, '""')}"`;
      const yearRows = await query<{ year: number; count: string }>(
        client,
        `SELECT ${yearIdent}::int AS year, COUNT(*)::text AS count
         FROM ${ident}
         WHERE ${yearIdent} IS NOT NULL
         GROUP BY ${yearIdent}
         ORDER BY year DESC`,
      );
      const years = yearRows.map((y) => ({ year: Number(y.year), count: Number(y.count) }));
      yearDistributions.push({ schema: f.schema, table: f.table, years });
      const recent = years.slice(0, 5);
      console.log(`  ${f.schema}.${f.table} year distribution (last 5 yrs):`);
      for (const r of recent) console.log(`    ${r.year}: ${r.count.toLocaleString()}`);
    }

    // For each candidate, ID density.
    const idDensity: Array<{
      schema: string;
      table: string;
      total: number;
      withDoi: number | null;
      withScopus: number | null;
    }> = [];
    for (const f of findings) {
      const ident = `"${f.schema}"."${f.table}"`;
      let withDoi: number | null = null;
      if (f.doiColumn) {
        const doiIdent = `"${f.doiColumn.replace(/"/g, '""')}"`;
        const r = await query<{ n: string }>(
          client,
          `SELECT COUNT(*)::text AS n FROM ${ident} WHERE ${doiIdent} IS NOT NULL AND ${doiIdent} <> ''`,
        );
        withDoi = Number(r[0]?.n ?? 0);
      }
      let withScopus: number | null = null;
      if (f.scopusColumn) {
        const scIdent = `"${f.scopusColumn.replace(/"/g, '""')}"`;
        const r = await query<{ n: string }>(
          client,
          `SELECT COUNT(*)::text AS n FROM ${ident} WHERE ${scIdent} IS NOT NULL AND ${scIdent}::text <> ''`,
        );
        withScopus = Number(r[0]?.n ?? 0);
      }
      idDensity.push({
        schema: f.schema,
        table: f.table,
        total: f.rowCount,
        withDoi,
        withScopus,
      });
      const doiPct = withDoi !== null && f.rowCount > 0 ? `${((withDoi / f.rowCount) * 100).toFixed(1)}%` : 'n/a';
      const scopusPct = withScopus !== null && f.rowCount > 0 ? `${((withScopus / f.rowCount) * 100).toFixed(1)}%` : 'n/a';
      console.log(
        `  ${f.schema}.${f.table} ID density:  doi=${doiPct} (${withDoi?.toLocaleString() ?? '-'})  scopus=${scopusPct} (${withScopus?.toLocaleString() ?? '-'})`,
      );
    }

    await writeFixture('coverage', {
      capturedAt: new Date().toISOString(),
      candidates: findings,
      yearDistributions,
      idDensity,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// list-tables — full alphabetical list (uncapped) for orientation
// ─────────────────────────────────────────────────────────────────────

async function listTables(): Promise<void> {
  console.log('[list-tables] full table inventory (alphabetical)…');
  const cfg = loadConfig();
  await withConnection(cfg, async (client) => {
    const rows = await query<{ table_name: string }>(
      client,
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema='public'
       ORDER BY table_name`,
    );
    for (const r of rows) console.log(`  ${r.table_name}`);
    console.log(`  ── ${rows.length} tables`);
    await writeFixture('list-tables', { capturedAt: new Date().toISOString(), tables: rows });
  });
}

// ─────────────────────────────────────────────────────────────────────
// pubmed-link — figure out how PubMed papers link to KKU people
// ─────────────────────────────────────────────────────────────────────

async function pubmedLink(): Promise<void> {
  console.log('[pubmed-link] inspecting pubmed_authors → people resolution…');
  const cfg = loadConfig();
  await withConnection(cfg, async (client) => {
    const cols = await query<{ column_name: string; data_type: string }>(
      client,
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='pubmed_authors'
       ORDER BY ordinal_position`,
    );
    console.log('  pubmed_authors columns:');
    for (const c of cols) console.log(`    ${c.column_name}: ${c.data_type}`);

    const hasPersonId = cols.some((c) => c.column_name === 'person_id');
    if (hasPersonId) {
      const r = await query<{
        with_person: string;
        distinct_papers: string;
        distinct_people: string;
      }>(
        client,
        `SELECT
           COUNT(*) FILTER (WHERE person_id IS NOT NULL)::text AS with_person,
           COUNT(DISTINCT CASE WHEN person_id IS NOT NULL THEN pubmed_document_id END)::text AS distinct_papers,
           COUNT(DISTINCT person_id)::text AS distinct_people
         FROM pubmed_authors`,
      );
      const row = r[0];
      if (row) {
        console.log(
          `  pubmed_authors with person_id: ${Number(row.with_person).toLocaleString()} authorship rows | ` +
            `${Number(row.distinct_papers).toLocaleString()} distinct papers | ` +
            `${Number(row.distinct_people).toLocaleString()} distinct KKU people`,
        );
      }
    }

    // Same drill for ISI.
    const isiCols = await query<{ column_name: string; data_type: string }>(
      client,
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='isi_authors' ORDER BY ordinal_position`,
    );
    console.log('  isi_authors columns:');
    for (const c of isiCols) console.log(`    ${c.column_name}: ${c.data_type}`);
    const isiHasPerson = isiCols.some((c) => c.column_name === 'person_id');
    if (isiHasPerson) {
      const r = await query<{
        with_person: string;
        distinct_papers: string;
        distinct_people: string;
      }>(
        client,
        `SELECT
           COUNT(*) FILTER (WHERE person_id IS NOT NULL)::text AS with_person,
           COUNT(DISTINCT CASE WHEN person_id IS NOT NULL THEN isi_document_id END)::text AS distinct_papers,
           COUNT(DISTINCT person_id)::text AS distinct_people
         FROM isi_authors`,
      );
      const row = r[0];
      if (row) {
        console.log(
          `  isi_authors with person_id: ${Number(row.with_person).toLocaleString()} authorship rows | ` +
            `${Number(row.distinct_papers).toLocaleString()} distinct papers | ` +
            `${Number(row.distinct_people).toLocaleString()} distinct KKU people`,
        );
      }
    }

    // TCI is sparser; check if it has a person link.
    const tciCols = await query<{ column_name: string; data_type: string }>(
      client,
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='tci_authors' ORDER BY ordinal_position`,
    );
    console.log('  tci_authors columns:');
    for (const c of tciCols) console.log(`    ${c.column_name}: ${c.data_type}`);

    await writeFixture('pubmed-link', {
      capturedAt: new Date().toISOString(),
      pubmedAuthorsColumns: cols,
      isiAuthorsColumns: isiCols,
      tciAuthorsColumns: tciCols,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// faculty-rollup — translate faculty_id → KKU faculty name + per-source counts
// ─────────────────────────────────────────────────────────────────────

async function facultyRollup(): Promise<void> {
  console.log('[faculty-rollup] KKU faculties with cached per-source paper counts…');
  const cfg = loadConfig();
  await withConnection(cfg, async (client) => {
    const rows = await query<{
      id: number;
      name_en: string | null;
      name: string | null;
      abb: string | null;
      workflow_state: string | null;
      faculty_group: string | null;
      scopus: number;
      pubmed: number;
      isi: number;
      tci: number;
    }>(
      client,
      `SELECT id, name_en, name, abb, workflow_state, faculty_group,
              COALESCE(scopus_document_count_tmp, 0) AS scopus,
              COALESCE(pubmed_document_count_tmp, 0) AS pubmed,
              COALESCE(isi_document_count_tmp, 0)    AS isi,
              COALESCE(tci_document_count_tmp, 0)    AS tci
       FROM faculties
       WHERE university_id = 1
       ORDER BY scopus DESC NULLS LAST, name_en`,
    );
    console.log(`  ${rows.length} faculties (university_id=1):`);
    console.log(`    ${'id'.padEnd(4)} ${'state'.padEnd(11)} ${'group'.padEnd(11)} ${'abb'.padEnd(8)} ${'scopus'.padStart(7)} ${'pubmed'.padStart(7)} ${'isi'.padStart(6)} ${'tci'.padStart(5)}  name`);
    for (const r of rows) {
      const cleanName = (r.name_en && r.name_en.trim()) || (r.name && r.name.trim()) || '(unnamed)';
      console.log(
        `    ${String(r.id).padEnd(4)} ${(r.workflow_state ?? '').padEnd(11)} ${(r.faculty_group ?? '').padEnd(11)} ${(r.abb ?? '').padEnd(8)} ${String(r.scopus).padStart(7)} ${String(r.pubmed).padStart(7)} ${String(r.isi).padStart(6)} ${String(r.tci).padStart(5)}  ${cleanName.slice(0, 60)}`,
      );
    }
    await writeFixture('faculty-rollup', { capturedAt: new Date().toISOString(), faculties: rows });
  });
}

// ─────────────────────────────────────────────────────────────────────
// kku-summary — opinionated assessment of KKU coverage in this DB
// ─────────────────────────────────────────────────────────────────────

async function kkuSummary(): Promise<void> {
  console.log('[kku-summary] computing KKU-scoped aggregates across sources…');
  const cfg = loadConfig();
  await withConnection(cfg, async (client) => {
    const out: Record<string, unknown> = {};

    // 1. Identify KKU's affiliation row(s) on Scopus.
    console.log('  → scopus_affiliations matching "Khon Kaen"…');
    const kkuAff = await query<{
      affiliation_id: string;
      name: string;
      city: string | null;
      country: string | null;
    }>(
      client,
      `SELECT affiliation_id, name, city, country
       FROM scopus_affiliations
       WHERE name ILIKE '%khon kaen%' OR name ILIKE '%khonkaen%' OR parent_name ILIKE '%khon kaen%'
       ORDER BY name
       LIMIT 50`,
    );
    console.log(`     matched ${kkuAff.length} affiliation row(s):`);
    for (const a of kkuAff.slice(0, 15)) {
      console.log(`     ${a.affiliation_id.padEnd(12)} | ${a.country ?? '?'} | ${a.name}`);
    }
    out.scopusKkuAffiliations = kkuAff;

    // 2. Headline counts: people / faculties / departments / students.
    console.log('  → KKU person/faculty/department counts…');
    const peopleCount = await query<{ n: string }>(client, `SELECT COUNT(*)::text AS n FROM people`);
    const peopleByUni = await query<{ university_id: number; n: string }>(
      client,
      `SELECT university_id, COUNT(*)::text AS n FROM people GROUP BY university_id ORDER BY n DESC NULLS LAST LIMIT 5`,
    );
    const faculties = await query<{ n: string }>(client, `SELECT COUNT(DISTINCT faculty_id)::text AS n FROM people WHERE faculty_id IS NOT NULL`);
    const depts = await query<{ n: string }>(client, `SELECT COUNT(DISTINCT department_id)::text AS n FROM people WHERE department_id IS NOT NULL`);
    const students = await query<{ n: string }>(client, `SELECT COUNT(*)::text AS n FROM students`);
    console.log(`     people: ${Number(peopleCount[0]?.n ?? 0).toLocaleString()}`);
    console.log(`     people by university_id (top 5):`);
    for (const r of peopleByUni) console.log(`       university_id=${r.university_id}: ${Number(r.n).toLocaleString()}`);
    console.log(`     distinct faculty_ids: ${Number(faculties[0]?.n ?? 0).toLocaleString()}`);
    console.log(`     distinct department_ids: ${Number(depts[0]?.n ?? 0).toLocaleString()}`);
    console.log(`     students: ${Number(students[0]?.n ?? 0).toLocaleString()}`);
    out.peopleCount = Number(peopleCount[0]?.n ?? 0);
    out.peopleByUniversity = peopleByUni.map((r) => ({ universityId: r.university_id, count: Number(r.n) }));
    out.distinctFaculties = Number(faculties[0]?.n ?? 0);
    out.distinctDepartments = Number(depts[0]?.n ?? 0);
    out.students = Number(students[0]?.n ?? 0);

    // 3. KKU paper counts per source (via the cached *_count_tmp totals on people).
    console.log('  → KKU paper totals (cached on people._count_tmp columns)…');
    const sourceTotals = await query<{
      scopus_total: string;
      pubmed_total: string;
      isi_total: string;
      tci_total: string;
    }>(
      client,
      `SELECT
         COALESCE(SUM(scopus_document_count_tmp), 0)::text AS scopus_total,
         COALESCE(SUM(pubmed_document_count_tmp), 0)::text AS pubmed_total,
         COALESCE(SUM(isi_document_count_tmp), 0)::text    AS isi_total,
         COALESCE(SUM(tci_document_count_tmp), 0)::text    AS tci_total
       FROM people`,
    );
    const t = sourceTotals[0];
    if (t) {
      console.log(`     Scopus authorships: ${Number(t.scopus_total).toLocaleString()}`);
      console.log(`     PubMed authorships: ${Number(t.pubmed_total).toLocaleString()}`);
      console.log(`     ISI/WoS authorships: ${Number(t.isi_total).toLocaleString()}`);
      console.log(`     TCI authorships:    ${Number(t.tci_total).toLocaleString()}`);
      out.cachedAuthorshipTotals = {
        scopus: Number(t.scopus_total),
        pubmed: Number(t.pubmed_total),
        isi: Number(t.isi_total),
        tci: Number(t.tci_total),
      };
    }

    // 4. Distinct KKU papers per source (via affiliation/person joins).
    console.log('  → distinct KKU papers per source via authorship join…');
    const scopusKku = await query<{ n: string }>(
      client,
      `SELECT COUNT(DISTINCT document_id)::text AS n
       FROM scopus_author_documents
       WHERE person_id IS NOT NULL`,
    );
    console.log(`     distinct Scopus papers with KKU person: ${Number(scopusKku[0]?.n ?? 0).toLocaleString()}`);
    out.scopusDistinctPapers = Number(scopusKku[0]?.n ?? 0);

    // PubMed stores comma-sep KKU person IDs in a text column.
    const pubmedKku = await query<{ n: string }>(
      client,
      `SELECT COUNT(*)::text AS n
       FROM pubmed_documents
       WHERE person_ids IS NOT NULL AND person_ids <> ''`,
    );
    console.log(`     distinct PubMed papers with KKU person_ids: ${Number(pubmedKku[0]?.n ?? 0).toLocaleString()}`);
    out.pubmedDistinctPapers = Number(pubmedKku[0]?.n ?? 0);

    // 5. Year distribution of KKU papers via scopus_document_person_counts (already aggregated).
    console.log('  → KKU Scopus papers by year (from scopus_document_person_counts)…');
    const scopusYearly = await query<{ year: number; n: string }>(
      client,
      `SELECT year::int AS year, SUM(document_count)::text AS n
       FROM scopus_document_person_counts
       WHERE year IS NOT NULL
       GROUP BY year
       ORDER BY year DESC
       LIMIT 20`,
    );
    for (const r of scopusYearly.slice(0, 12)) {
      console.log(`     ${r.year}: ${Number(r.n).toLocaleString()} (person×paper authorships)`);
    }
    out.scopusYearlyAuthorships = scopusYearly.map((r) => ({ year: r.year, count: Number(r.n) }));

    // 6. Top KKU faculties by Scopus output, last 10 years.
    console.log('  → top KKU faculties by Scopus papers (recent decade)…');
    const facultyTop = await query<{ faculty_id: number; n: string }>(
      client,
      `SELECT faculty_id, SUM(document_count)::text AS n
       FROM scopus_document_faculty_counts
       WHERE faculty_id IS NOT NULL AND year >= 2015
       GROUP BY faculty_id
       ORDER BY SUM(document_count) DESC
       LIMIT 15`,
    );
    for (const r of facultyTop) console.log(`     faculty_id=${r.faculty_id}: ${Number(r.n).toLocaleString()}`);
    out.topFacultiesByScopusOutput = facultyTop.map((r) => ({ facultyId: r.faculty_id, count: Number(r.n) }));

    // 7. workflow_state distribution on scopus_documents.
    console.log('  → workflow_state distribution on scopus_documents…');
    const wf = await query<{ workflow_state: string | null; n: string }>(
      client,
      `SELECT workflow_state, COUNT(*)::text AS n FROM scopus_documents GROUP BY workflow_state ORDER BY n DESC NULLS LAST LIMIT 10`,
    );
    for (const r of wf) console.log(`     ${r.workflow_state ?? '(null)'}: ${Number(r.n).toLocaleString()}`);
    out.scopusWorkflowStates = wf.map((r) => ({ state: r.workflow_state, count: Number(r.n) }));

    // 8. Freshness check.
    console.log('  → most recent updated_at across the four document tables…');
    const fresh = await query<{ source: string; latest: string | null; rows: string }>(
      client,
      `SELECT 'scopus' AS source, MAX(updated_at)::text AS latest, COUNT(*)::text AS rows FROM scopus_documents
       UNION ALL SELECT 'pubmed', MAX(updated_at)::text, COUNT(*)::text FROM pubmed_documents
       UNION ALL SELECT 'isi',    MAX(updated_at)::text, COUNT(*)::text FROM isi_documents
       UNION ALL SELECT 'tci',    MAX(updated_at)::text, COUNT(*)::text FROM tci_documents`,
    );
    for (const r of fresh) console.log(`     ${r.source.padEnd(8)} latest updated_at=${r.latest ?? '(none)'}  rows=${Number(r.rows).toLocaleString()}`);
    out.lastUpdatedPerSource = fresh.map((r) => ({ source: r.source, latest: r.latest, rows: Number(r.rows) }));

    // 9. ID density on scopus_documents (DOI + EID).
    console.log('  → Scopus document ID density…');
    const scDoi = await query<{ total: string; with_doi: string; with_eid: string }>(
      client,
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE doi IS NOT NULL AND doi <> '')::text AS with_doi,
              COUNT(*) FILTER (WHERE eid IS NOT NULL AND eid <> '')::text AS with_eid
       FROM scopus_documents`,
    );
    if (scDoi[0]) {
      const total = Number(scDoi[0].total);
      const withDoi = Number(scDoi[0].with_doi);
      const withEid = Number(scDoi[0].with_eid);
      console.log(`     total=${total.toLocaleString()}  with_doi=${withDoi.toLocaleString()} (${((withDoi / total) * 100).toFixed(1)}%)  with_eid=${withEid.toLocaleString()} (${((withEid / total) * 100).toFixed(1)}%)`);
      out.scopusDocumentIdDensity = { total, withDoi, withEid };
    }

    // 10. People → faculty/department resolution coverage.
    console.log('  → KKU people resolution coverage…');
    const peopleResolved = await query<{
      with_faculty: string;
      with_dept: string;
      with_pid: string;
      total: string;
    }>(
      client,
      `SELECT
         COUNT(*) FILTER (WHERE faculty_id IS NOT NULL)::text    AS with_faculty,
         COUNT(*) FILTER (WHERE department_id IS NOT NULL)::text AS with_dept,
         COUNT(*) FILTER (WHERE pid IS NOT NULL AND pid <> '')::text AS with_pid,
         COUNT(*)::text                                          AS total
       FROM people`,
    );
    if (peopleResolved[0]) {
      const total = Number(peopleResolved[0].total);
      const wf = Number(peopleResolved[0].with_faculty);
      const wd = Number(peopleResolved[0].with_dept);
      const wp = Number(peopleResolved[0].with_pid);
      console.log(`     total=${total.toLocaleString()}  with_faculty=${wf.toLocaleString()} (${((wf / total) * 100).toFixed(1)}%)  with_dept=${wd.toLocaleString()} (${((wd / total) * 100).toFixed(1)}%)  with_pid=${wp.toLocaleString()} (${((wp / total) * 100).toFixed(1)}%)`);
      out.peopleResolution = { total, withFaculty: wf, withDept: wd, withPid: wp };
    }

    // 11. PID format check — without exposing raw values. Length distribution only.
    console.log('  → people.pid length distribution (values not displayed) …');
    const pidLen = await query<{ len: number; n: string }>(
      client,
      `SELECT length(pid) AS len, COUNT(*)::text AS n FROM people WHERE pid IS NOT NULL GROUP BY length(pid) ORDER BY n DESC LIMIT 5`,
    );
    for (const r of pidLen) console.log(`     length=${r.len}: ${Number(r.n).toLocaleString()} rows`);
    out.peoplePidLengthDistribution = pidLen.map((r) => ({ length: r.len, count: Number(r.n) }));

    await writeFixture('kku-summary', {
      capturedAt: new Date().toISOString(),
      ...out,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    printUsage();
    process.exit(1);
  }
  try {
    switch (cmd) {
      case 'ping':
        await ping();
        break;
      case 'tables':
        await tables();
        break;
      case 'columns':
        await columns(rest[0]);
        break;
      case 'sample':
        await sample(rest[0]);
        break;
      case 'coverage':
        await coverage();
        break;
      case 'kku-summary':
        await kkuSummary();
        break;
      case 'list-tables':
        await listTables();
        break;
      case 'pubmed-link':
        await pubmedLink();
        break;
      case 'faculty-rollup':
        await facultyRollup();
        break;
      case 'all':
        await ping();
        console.log();
        await tables();
        console.log();
        await kkuSummary();
        break;
      default:
        printUsage();
        process.exit(1);
    }
    console.log('\n[done]');
  } catch (err) {
    console.error('[error]', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

function printUsage(): void {
  console.log(`Usage:
  pnpm publications:probe ping             # version + dbs + schemas
  pnpm publications:probe tables           # tables + row counts (top 50)
  pnpm publications:probe columns <table>  # column types of <schema.table>
  pnpm publications:probe sample <table>   # 5 sample rows (PII-guarded)
  pnpm publications:probe coverage         # year span + scopus-id / doi density
  pnpm publications:probe kku-summary      # KKU-scoped aggregates across sources
  pnpm publications:probe all              # ping + tables + kku-summary`);
}

void main();
