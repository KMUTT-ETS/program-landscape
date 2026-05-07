#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Backfill FacultyMember rows from kku-publications.people
//
// Why this exists:
//   The kku-research v2 connector (apps/ingestion/src/connectors/sources/
//   kku-research/connector.ts) resolves authorships against the FacultyMember
//   table. As of 2026-05-07 our FacultyMember snapshot has ~2,428 rows
//   (mostly from the kku-hr connector, which only covers 5 of 36 KKU
//   faculties). Match rate hit 57.1% — the unmatched 42.9% are KKU
//   researchers in the 32 unmapped faculties.
//
//   This script bridges the gap: imports kku-publications.people rows
//   that aren't already in FacultyMember, so the kku-research connector's
//   next run can resolve them.
//
// Posture & guardrails:
//   - kku-hr stays AUTHORITATIVE for who's currently employed at KKU.
//     This script never overwrites a kku-hr row — if a FacultyMember
//     already exists by exact (lowercased nameEn) or exact nameTh, we
//     skip the kku-publications row.
//   - employeeCode prefix `kkupub_<id>` distinguishes backfilled rows
//     from kku-hr's `hr_*` rows. (FacultyMember.employeeCode is @unique.)
//   - rank = LECTURER as a placeholder. The publications mirror doesn't
//     carry rank info; LECTURER is the safest default — won't promote
//     anyone to a position they don't have.
//   - isActive = true if author has a paper in last 2 years (per the
//     kku-publications mirror), else false. Heuristic but defensible
//     during the 30-day green-history window — fine-grained current
//     employment status will be reconciled when more kku-hr faculties
//     are mapped.
//   - Filter: only people with a paper in the last 5 years AND faculty_id
//     non-null. Excludes retired faculty whose only papers predate the
//     window, and external collaborators with no faculty mapping.
//
// Idempotency:
//   - Re-running this script never adds duplicates: existing FacultyMember
//     rows (by name OR by `kkupub_<id>` employeeCode) are detected and
//     skipped. Idempotent across runs.
//
// Usage:
//   pnpm research:backfill-people              # dry-run, prints report only
//   pnpm research:backfill-people --apply      # actually inserts rows
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma, type FacultyRank } from '@kku/db';
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

const apply = process.argv.includes('--apply');
// Filter: include any person with a paper in the kku-research window. Default
// KKU_RESEARCH_YEAR_FROM=2015. This matches the connector's coverage so every
// paper that lands in ResearchOutput has a corresponding FacultyMember row
// to resolve to (modulo name-format mismatches the connector handles via
// nameEn-lowercased / nameTh-exact matching).
const FILTER_YEAR_FROM = Number(process.env.KKU_RESEARCH_YEAR_FROM ?? 2015);
const RECENCY_YEARS_FOR_ACTIVE = 2; // mark isActive=true if paper in last 2y

interface KkuPubPerson {
  id: number;
  firstname_en: string | null;
  lastname_en: string | null;
  firstname: string | null;
  lastname: string | null;
  faculty_id: number | null;
  scopus_doc_count: number;
  pubmed_doc_count: number;
  recent_scopus_year: number | null;
  recent_pubmed_year: number | null;
  faculty_name_en: string | null;
}

async function main(): Promise<void> {
  console.log(`[backfill-faculty] mode=${apply ? 'APPLY (will insert)' : 'DRY-RUN'}`);

  const cfg: PostgresConfig = configFromEnv('KKU_PUBLICATIONS_DB');
  const currentYear = new Date().getUTCFullYear();
  const yearFilter = FILTER_YEAR_FROM;
  const yearActive = currentYear - RECENCY_YEARS_FOR_ACTIVE;
  console.log(`  candidate filter: papers >= ${yearFilter}; isActive=true if papers >= ${yearActive}`);

  // 1. Load existing FacultyMember snapshot — for dedup.
  const existing = await prisma.facultyMember.findMany({
    select: { id: true, nameEn: true, nameTh: true, employeeCode: true },
  });
  const existingByNameEn = new Set<string>();
  const existingByNameTh = new Set<string>();
  const existingByCode = new Set<string>();
  for (const m of existing) {
    if (m.nameEn) existingByNameEn.add(m.nameEn.trim().toLowerCase());
    if (m.nameTh) existingByNameTh.add(m.nameTh.trim());
    if (m.employeeCode) existingByCode.add(m.employeeCode);
  }
  console.log(`  existing FacultyMember rows: ${existing.length}`);

  // 2. Load Faculty table for FK resolution (name_en exact match).
  const faculties = await prisma.faculty.findMany({ select: { id: true, nameEn: true } });
  const facultyByNameEn = new Map<string, string>();
  for (const f of faculties) {
    if (f.nameEn) facultyByNameEn.set(f.nameEn.trim().toLowerCase(), f.id);
  }
  console.log(`  Faculty rows for FK resolution: ${faculties.length}`);

  // 3. Pull kku-publications.people with paper-recency join.
  //    Three independent queries, merged in JS — much faster on Postgres
  //    9.5 than the per-row correlated subqueries: each GROUP BY runs once
  //    against an indexed FK rather than 10k+ times scanning fact tables.
  const { people, scopusRecency, pubmedRecency } = await withConnection(
    cfg,
    async (client) => {
      const peopleRows = await query<{
        id: number;
        firstname_en: string | null;
        lastname_en: string | null;
        firstname: string | null;
        lastname: string | null;
        faculty_id: number | null;
        scopus_doc_count: number;
        pubmed_doc_count: number;
        faculty_name_en: string | null;
      }>(
        client,
        `SELECT
           p.id,
           p.firstname_en,
           p.lastname_en,
           p.firstname,
           p.lastname,
           p.faculty_id,
           COALESCE(p.scopus_document_count_tmp, 0) AS scopus_doc_count,
           COALESCE(p.pubmed_document_count_tmp,  0) AS pubmed_doc_count,
           f.name_en AS faculty_name_en
         FROM people p
         LEFT JOIN faculties f ON f.id = p.faculty_id
         WHERE p.university_id = 1
           AND p.faculty_id IS NOT NULL`,
      );
      const sRecency = await query<{ person_id: number; recent_year: number }>(
        client,
        `SELECT ad.person_id, MAX(EXTRACT(YEAR FROM d.cover_date))::int AS recent_year
         FROM scopus_author_documents ad
         JOIN scopus_documents d ON d.document_id = ad.document_id
         WHERE d.workflow_state = 'enabled' AND ad.person_id IS NOT NULL
         GROUP BY ad.person_id`,
      );
      const pRecency = await query<{ person_id: number; recent_year: number }>(
        client,
        `SELECT pa.person_id, MAX(d.year) AS recent_year
         FROM pubmed_authors pa
         JOIN pubmed_documents d ON d.id = pa.pubmed_document_id
         WHERE pa.person_id IS NOT NULL AND d.year IS NOT NULL
         GROUP BY pa.person_id`,
      );
      return {
        people: peopleRows,
        scopusRecency: sRecency,
        pubmedRecency: pRecency,
      };
    },
  );

  const scopusYearByPerson = new Map<number, number>();
  for (const r of scopusRecency) scopusYearByPerson.set(r.person_id, r.recent_year);
  const pubmedYearByPerson = new Map<number, number>();
  for (const r of pubmedRecency) pubmedYearByPerson.set(r.person_id, r.recent_year);

  const candidates: KkuPubPerson[] = people.map((p) => ({
    id: p.id,
    firstname_en: p.firstname_en,
    lastname_en: p.lastname_en,
    firstname: p.firstname,
    lastname: p.lastname,
    faculty_id: p.faculty_id,
    scopus_doc_count: p.scopus_doc_count,
    pubmed_doc_count: p.pubmed_doc_count,
    recent_scopus_year: scopusYearByPerson.get(p.id) ?? null,
    recent_pubmed_year: pubmedYearByPerson.get(p.id) ?? null,
    faculty_name_en: p.faculty_name_en,
  }));
  console.log(`  kku-publications candidates (university_id=1, faculty_id non-null): ${candidates.length}`);

  // 4. Filter + classify.
  const stats = {
    total: candidates.length,
    skippedByName: 0,
    skippedByCode: 0,
    skippedNoRecentPaper: 0,
    skippedFacultyUnmapped: 0,
    skippedMissingName: 0,
    importableActive: 0,
    importableInactive: 0,
    perFaculty: new Map<string, { active: number; inactive: number }>(),
    unmappedFacultyNames: new Map<string, number>(),
  };

  type Row = {
    employeeCode: string;
    nameEn: string;
    nameTh: string;
    facultyId: string;
    rank: FacultyRank;
    isActive: boolean;
  };
  const rowsToInsert: Row[] = [];

  for (const c of candidates) {
    const employeeCode = `kkupub_${c.id}`;
    if (existingByCode.has(employeeCode)) {
      stats.skippedByCode++;
      continue;
    }
    // Filter: must have a paper in last RECENCY_YEARS_FOR_FILTER years.
    const mostRecentPaper = Math.max(c.recent_scopus_year ?? 0, c.recent_pubmed_year ?? 0);
    if (mostRecentPaper < yearFilter) {
      stats.skippedNoRecentPaper++;
      continue;
    }

    const fnEn = (c.firstname_en ?? '').trim();
    const lnEn = (c.lastname_en ?? '').trim();
    const fnTh = (c.firstname ?? '').trim();
    const lnTh = (c.lastname ?? '').trim();
    const nameEn = (fnEn && lnEn) ? `${fnEn} ${lnEn}` : '';
    const nameTh = (fnTh && lnTh) ? `${fnTh} ${lnTh}` : '';

    if (!nameEn && !nameTh) {
      stats.skippedMissingName++;
      continue;
    }

    // Dedup against existing FacultyMember by name (lowercased nameEn or
    // exact nameTh). kku-hr is authoritative — never overwrite.
    if (nameEn && existingByNameEn.has(nameEn.toLowerCase())) {
      stats.skippedByName++;
      continue;
    }
    if (nameTh && existingByNameTh.has(nameTh)) {
      stats.skippedByName++;
      continue;
    }

    // Resolve faculty FK via name_en exact match (lowercased).
    const facultyKey = (c.faculty_name_en ?? '').trim().toLowerCase();
    const facultyId = facultyKey ? facultyByNameEn.get(facultyKey) : undefined;
    if (!facultyId) {
      stats.skippedFacultyUnmapped++;
      const k = c.faculty_name_en ?? '(null)';
      stats.unmappedFacultyNames.set(k, (stats.unmappedFacultyNames.get(k) ?? 0) + 1);
      continue;
    }

    const isActive = mostRecentPaper >= yearActive;
    if (isActive) stats.importableActive++;
    else stats.importableInactive++;
    const bucket = stats.perFaculty.get(c.faculty_name_en ?? '?') ?? { active: 0, inactive: 0 };
    if (isActive) bucket.active++; else bucket.inactive++;
    stats.perFaculty.set(c.faculty_name_en ?? '?', bucket);

    rowsToInsert.push({
      employeeCode,
      nameEn: nameEn || nameTh, // falls back to Thai name if English missing
      nameTh: nameTh || nameEn,
      facultyId,
      rank: 'LECTURER' as FacultyRank,
      isActive,
    });
  }

  // 5. Report.
  console.log('\n[backfill-faculty] summary:');
  console.log(`  total candidates:                 ${stats.total.toLocaleString()}`);
  console.log(`  skipped — already exists by code: ${stats.skippedByCode.toLocaleString()}`);
  console.log(`  skipped — already exists by name: ${stats.skippedByName.toLocaleString()}`);
  console.log(`  skipped — no recent paper:        ${stats.skippedNoRecentPaper.toLocaleString()}`);
  console.log(`  skipped — faculty unmapped:       ${stats.skippedFacultyUnmapped.toLocaleString()}`);
  console.log(`  skipped — missing name fields:    ${stats.skippedMissingName.toLocaleString()}`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  importable (isActive=true):       ${stats.importableActive.toLocaleString()}`);
  console.log(`  importable (isActive=false):      ${stats.importableInactive.toLocaleString()}`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  total importable:                 ${rowsToInsert.length.toLocaleString()}`);

  if (stats.perFaculty.size > 0) {
    console.log('\n  by faculty (mapped):');
    const sorted = [...stats.perFaculty.entries()].sort((a, b) => (b[1].active + b[1].inactive) - (a[1].active + a[1].inactive));
    for (const [name, counts] of sorted.slice(0, 15)) {
      console.log(`    ${name.padEnd(56)} active=${String(counts.active).padStart(4)}  inactive=${String(counts.inactive).padStart(4)}`);
    }
    if (sorted.length > 15) console.log(`    ... and ${sorted.length - 15} more faculties`);
  }

  if (stats.unmappedFacultyNames.size > 0) {
    console.log('\n  unmapped faculty names (need manual seed in our Faculty table):');
    const sorted = [...stats.unmappedFacultyNames.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, n] of sorted.slice(0, 15)) console.log(`    ${name}  (${n} people)`);
    if (sorted.length > 15) console.log(`    ... and ${sorted.length - 15} more`);
  }

  // 6. Apply.
  if (!apply) {
    console.log('\n[dry-run] no changes made. Pass --apply to actually insert rows.');
    return;
  }

  console.log(`\n[apply] inserting ${rowsToInsert.length.toLocaleString()} FacultyMember rows…`);
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK);
    const result = await prisma.facultyMember.createMany({
      data: chunk.map((r) => ({
        employeeCode: r.employeeCode,
        nameEn: r.nameEn,
        nameTh: r.nameTh,
        facultyId: r.facultyId,
        rank: r.rank,
        isActive: r.isActive,
      })),
      skipDuplicates: true,
    });
    inserted += result.count;
    if ((i + CHUNK) % 500 === 0 || i + CHUNK >= rowsToInsert.length) {
      console.log(`  ${Math.min(i + CHUNK, rowsToInsert.length).toLocaleString()} / ${rowsToInsert.length.toLocaleString()} inserted`);
    }
  }
  console.log(`\n[done] inserted ${inserted.toLocaleString()} FacultyMember rows.`);
  console.log(`Run \`CONNECTOR_KKU_RESEARCH_MODE=real pnpm connector:run kku-research\` to re-link papers to the new FacultyMember rows.`);
}

main()
  .catch((err) => {
    console.error('[error]', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
