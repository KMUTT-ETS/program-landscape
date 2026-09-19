import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/index';
import { academicYearContextSync, getAcademicYearContext } from '../src/academic-year';
import { computeGapMap, scopeProgramIds } from '../src/gap-map';
import { GAP_MAP_VERSION, GAP_VERDICTS } from '../src/gap-map-rules';
import { realDataSql } from '../src/data-quality';
import { eligiblePostingLevels } from '../src/jobthai-bridge';

const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

// These run against whatever dev holds after Task 4 populated the taxonomy.
// They assert invariants, not particular numbers.
//
// The first call builds the programme health index cold (297 programmes,
// measured 6 s on dev); later calls are memoised and run under 2 s.
const DB_TIMEOUT_MS = 60_000;

// Same academic year `computeGapMap` reads, resolved once so the independent
// recomputation below cannot drift from it across a year boundary.
const CURRENT_AY_BE: number = postgresUp
  ? (await getAcademicYearContext()).currentAcademicYearBE
  : academicYearContextSync().currentAcademicYearBE;

describe.skipIf(!postgresUp)('computeGapMap at university scope', () => {
  it('reconciles: verdict counts sum to rows, faculty strip matches, demand shares sum to 1, every row stamped', async () => {
    const map = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    expect(map.methodologyVersion).toBe(GAP_MAP_VERSION);
    const total = GAP_VERDICTS.reduce((n, v) => n + map.verdictCounts[v], 0);
    expect(total).toBe(map.rows.length);
    if (map.rows.length > 0) {
      // Both sides are normalised by their field-level sums (field-mentions /
      // field-graduates), so each share set sums to 1 even though postings
      // and programmes may be counted in several rows.
      expect(map.reconciliation.demandShareSum).toBeCloseTo(1, 3);
      if (map.reconciliation.fieldGraduatesTotal > 0) expect(map.reconciliation.supplyShareSum).toBeCloseTo(1, 3);
      expect(map.reconciliation.multiFieldPostings).toBeGreaterThanOrEqual(0);
      expect(map.reconciliation.multiFieldPostings).toBeLessThanOrEqual(map.reconciliation.fieldPostings);
      expect(map.reconciliation.fieldMentions).toBeGreaterThanOrEqual(map.reconciliation.fieldPostings);
      for (const f of map.facultyStrip) {
        const inStrip = GAP_VERDICTS.reduce((n, v) => n + f.counts[v], 0);
        const fromRows = map.rows.filter((r) => r.facultyIds.includes(f.facultyId)).length;
        expect(inStrip).toBe(fromRows);
      }
      for (const r of map.rows) {
        // White space = no SCORED programme; a row holding only postgraduate
        // programmes is still a white space and still lists them.
        expect(r.programmes.filter((p) => p.scored).length === 0).toBe(r.verdict === 'white-space');
        if (r.verdict === 'too-few-postings') expect(r.postings).toBeLessThan(20);
        // A missing supply figure is a data gap, never a measured zero:
        // 'supply-unknown' never carries a ratio, and the with-supply
        // count can never exceed the scored-programme count.
        expect(r.programmesWithSupply).toBeLessThanOrEqual(r.programmeCount);
        if (r.verdict === 'supply-unknown') expect(r.ratio).toBeNull();
      }
    }
    expect(map.reconciliation.anyFieldPostings).toBeGreaterThanOrEqual(0);
    expect(map.taxonomy.approved + map.taxonomy.proposed).toBe(map.rows.length);
  }, DB_TIMEOUT_MS);

  it('field-mentions derived from the province rows agrees with an independent one-pass per-posting recount', async () => {
    // Task 7 fix 2 collapsed the separate demand-per-field query into a
    // derivation from the province query (every posting has exactly one
    // province, so summing per-(field,province) postings over provinces
    // equals the distinct-posting count per field). Cross-check that
    // against a one-pass per-posting field count computed independently.
    const map = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    const BACHELOR_LEVELS = eligiblePostingLevels('BACHELOR');
    const rows = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COALESCE(SUM(n_fields), 0)::int AS total FROM (
        SELECT jp.id, COUNT(DISTINCT f.id)::int AS n_fields
        FROM job_postings jp
        JOIN job_field_taxonomy f ON jp.required_fields_raw && f.synonyms
        WHERE f.review_status IN ('APPROVED', 'PROPOSED')
          AND jp.source = 'jobthai'
          AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS}::text[])
          AND ${realDataSql('jp')}
        GROUP BY jp.id
      ) per_posting
    `);
    expect(rows[0]?.total ?? 0).toBe(map.reconciliation.fieldMentions);
  }, DB_TIMEOUT_MS);

  it('postgraduate programmes are listed but never scored', async () => {
    const map = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    for (const r of map.rows)
      for (const p of r.programmes) {
        if (p.level !== 'BACHELOR') expect(p.scored).toBe(false);
      }
  }, DB_TIMEOUT_MS);

  it('faculty scope never yields a white space that university scope does not', async () => {
    const uni = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    const faculty = await prisma.faculty.findFirst({
      where: { programs: { some: { programJobFields: { some: {} } } } },
      select: { id: true },
    });
    if (!faculty) return;
    const fac = await computeGapMap({ scope: 'faculty', scopeId: faculty.id, thresholds: { under: 0.5, over: 2 } });
    for (const r of fac.rows) {
      expect(r.kkuTotal).not.toBeNull();
      const uniRow = uni.rows.find((u) => u.slug === r.slug)!;
      expect(r.kkuTotal!.verdict).toBe(uniRow.verdict);
      // The real invariant: no faculty can supply what the whole
      // university does not. If NO faculty anywhere has a scored
      // programme for this field (university-scope white space), this
      // faculty's own row for the same field must be a white space too.
      if (uniRow.verdict === 'white-space') expect(r.verdict).toBe('white-space');
    }
  }, DB_TIMEOUT_MS);

  it('scopeProgramIds returns null for university and ids for a faculty', async () => {
    expect(await scopeProgramIds('university', null)).toBeNull();
    const f = await prisma.faculty.findFirst({ select: { id: true } });
    if (f) expect(Array.isArray(await scopeProgramIds('faculty', f.id))).toBe(true);
  }, DB_TIMEOUT_MS);
});

// ── Graduates per year (the supply numerator) ────────────────────────────────
// The figure is the mean of the entry cohorts that COULD have graduated, over
// however many of them there are. Each rule below is asserted against the real
// dev record rather than an inserted fixture (the no-mock-data rule), by
// recomputing the same quantity independently and comparing.
describe.skipIf(!postgresUp)('computeGapMap graduates per year', () => {
  async function eligibleCohorts(): Promise<
    Map<string, { total: number; cohorts: number; inWindow: number }>
  > {
    const rows = await prisma.$queryRaw<
      Array<{ program_id: string; total: number; cohorts: number; in_window: number }>
    >(Prisma.sql`
      WITH ctx AS (SELECT ${CURRENT_AY_BE}::int AS current_ay),
      latest_be AS (
        SELECT MAX(entry_year_be) AS max_be FROM alumni_cohort_statuses acs0
        WHERE acs0.status_bucket = 'GRADUATED' AND ${realDataSql('acs0')}
      ),
      per_cohort AS (
        SELECT acs.program_id,
               acs.entry_year_be,
               SUM(acs.count)::float AS graduates,
               (acs.entry_year_be + COALESCE(pr.duration_years, 4)) <= ctx.current_ay AS eligible
        FROM alumni_cohort_statuses acs
        JOIN programs pr ON pr.id = acs.program_id
        CROSS JOIN latest_be
        CROSS JOIN ctx
        WHERE acs.status_bucket = 'GRADUATED'
          AND acs.entry_year_be >= latest_be.max_be - 5
          AND ${realDataSql('acs')}
        GROUP BY acs.program_id, acs.entry_year_be, eligible
      )
      SELECT program_id,
             COALESCE(SUM(graduates) FILTER (WHERE eligible), 0)::float AS total,
             COUNT(*) FILTER (WHERE eligible)::int AS cohorts,
             COUNT(*)::int AS in_window
      FROM per_cohort GROUP BY program_id
    `);
    return new Map(
      rows.map((r) => [r.program_id, { total: Number(r.total), cohorts: r.cohorts, inWindow: r.in_window }]),
    );
  }

  it('averages only the cohorts that could have graduated, and divides by how many there were', async () => {
    const map = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    const cohorts = await eligibleCohorts();
    const alumni = new Map<string, number>();
    for (const r of map.rows)
      for (const p of r.programmes)
        if (p.supplySource === 'alumni' && p.gradsPerYear != null) alumni.set(p.programId, p.gradsPerYear);
    expect(alumni.size).toBeGreaterThan(0);

    let sawTooYoungExcluded = false;
    let sawShortWindow = false;
    for (const [id, grads] of alumni) {
      const c = cohorts.get(id);
      expect(c, `no eligible cohorts behind an alumni figure for ${id}`).toBeDefined();
      // The divisor is the cohort count, never a hard-coded 5.
      expect(c!.cohorts).toBeGreaterThan(0);
      expect(grads).toBeCloseTo(c!.total / c!.cohorts, 6);
      if (c!.inWindow > c!.cohorts) sawTooYoungExcluded = true;
      if (c!.cohorts < 5) sawShortWindow = true;
    }
    // The two rules have to actually bite on this record, or the assertions
    // above are vacuous: at least one programme must have a cohort inside the
    // window that is too young to have graduated, and at least one must be
    // averaged over fewer than the five the old divisor assumed.
    expect(sawTooYoungExcluded).toBe(true);
    expect(sawShortWindow).toBe(true);
  }, DB_TIMEOUT_MS);

  it('an unfinished academic year is not a measured zero — the programme comes out null', async () => {
    const map = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    const seen = new Map<string, { grads: number | null; source: string | null }>();
    for (const r of map.rows)
      for (const p of r.programmes) seen.set(p.programId, { grads: p.gradsPerYear, source: p.supplySource });

    // No figure may read zero: a zero could only arrive from an academic year
    // whose graduations have not been recorded yet, which is the defect this
    // rule exists to prevent.
    for (const [id, v] of seen) expect(v.grads, `zero graduates-per-year for ${id}`).not.toBe(0);

    // A programme with no eligible alumni cohort whose enrolment rows are all
    // zero must be null (→ `supply-unknown`), not a zero standing in for one.
    const zeroOnly = await prisma.$queryRaw<Array<{ program_id: string }>>(Prisma.sql`
      SELECT em.program_id
      FROM enrollment_metrics em
      WHERE ${realDataSql('em')}
        AND em.program_id = ANY(${[...seen.keys()]}::text[])
      GROUP BY em.program_id
      HAVING MAX(em.graduated_on_time) = 0
    `);
    const nulled = zeroOnly.filter((r) => seen.get(r.program_id)?.source == null);
    expect(nulled.length).toBeGreaterThan(0);
    for (const r of nulled) expect(seen.get(r.program_id)!.grads).toBeNull();
  }, DB_TIMEOUT_MS);

  it('reports what the supply total rests on', async () => {
    const map = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    const scored = new Set<string>();
    const withSupply = new Set<string>();
    const proxy = new Set<string>();
    for (const r of map.rows)
      for (const p of r.programmes)
        if (p.scored) {
          scored.add(p.programId);
          if (p.gradsPerYear != null) withSupply.add(p.programId);
          if (p.supplySource === 'enrolment-proxy') proxy.add(p.programId);
        }
    expect(map.reconciliation.scoredProgrammes).toBe(scored.size);
    expect(map.reconciliation.scoredWithSupply).toBe(withSupply.size);
    expect(map.reconciliation.supplyFromProxy).toBe(proxy.size);
    expect(map.reconciliation.scoredWithSupply).toBeLessThanOrEqual(map.reconciliation.scoredProgrammes);
    expect(map.reconciliation.supplyFromProxy).toBeLessThanOrEqual(map.reconciliation.scoredWithSupply);
  }, DB_TIMEOUT_MS);
});

// Provenance gating is structural: every demand query must gate postings with
// realDataSql('jp'), and every supply read must gate with realDataWhere() /
// realDataSql(). An untagged batch is then invisible by construction (spec §9).
// Reading the source beats inserting a fake posting, which the no-mock-data
// rule forbids even inside a rolled-back transaction.
describe('computeGapMap provenance gating', () => {
  const src = readFileSync(path.join(__dirname, '..', 'src', 'gap-map.ts'), 'utf8');
  it('gates every job_postings read', () => {
    const joins = (src.match(/JOIN job_postings jp|FROM job_postings jp/g) ?? []).length;
    const gates = (src.match(/realDataSql\('jp'\)/g) ?? []).length;
    expect(joins).toBeGreaterThan(0);
    expect(gates).toBeGreaterThanOrEqual(joins);
  });
  it('gates alumni, enrolment, cohort and link reads', () => {
    expect(src).toContain("realDataSql('acs')");
    expect(src).toContain("realDataSql('em')");
    // Bounded (not `[\s\S]*?`, which is satisfiable by ANY later
    // realDataWhere() anywhere in the file, however far away): the real
    // call's where-clause gate sits ~126 chars after the opening paren.
    expect(src).toMatch(/studentCohortDistribution\.groupBy\([\s\S]{0,160}?realDataWhere\(\)/);
    expect(src).toMatch(/programJobThaiLink\.findMany\(\{\s*where: realDataWhere\(\)/);
  });
});

// The three supply rules again, structurally — they live in SQL, so a
// green DB test only proves them on the record dev happens to hold. These
// assert the clauses themselves, and fail the moment one is dropped.
describe('computeGapMap supply-window rules', () => {
  const src = readFileSync(path.join(__dirname, '..', 'src', 'gap-map.ts'), 'utf8');
  it('anchors the window on graduation, not on enrolment', () => {
    expect(src).toMatch(/latest_be AS \([\s\S]{0,200}?status_bucket = 'GRADUATED'/);
  });
  it('excludes entry cohorts too young to have graduated', () => {
    expect(src).toMatch(/entry_year_be \+ COALESCE\(pr\.duration_years[\s\S]{0,80}?<= \$\{currentAcademicYearBE\}/);
  });
  it('divides by the cohort count, never a hard-coded 5', () => {
    expect(src).toContain('SUM(graduates) / COUNT(*)::float');
    expect(src).not.toContain('/ 5.0');
  });
  it('never takes the enrolment proxy from a year with no recorded graduations', () => {
    expect(src).toMatch(/latest_grad AS \([\s\S]{0,240}?em\.graduated_on_time > 0/);
  });
});
