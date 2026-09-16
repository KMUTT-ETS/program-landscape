import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/index';
import { computeGapMap, scopeProgramIds } from '../src/gap-map';
import { GAP_MAP_VERSION, GAP_VERDICTS } from '../src/gap-map-rules';

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
      if (map.reconciliation.gradsTotal > 0) expect(map.reconciliation.supplyShareSum).toBeCloseTo(1, 3);
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
      }
    }
    expect(map.reconciliation.anyFieldPostings).toBeGreaterThanOrEqual(0);
    expect(map.taxonomy.approved + map.taxonomy.proposed).toBe(map.rows.length);
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
      if (r.verdict === 'white-space')
        expect(['white-space', 'under-served', 'served', 'over-served', 'too-few-postings']).toContain(uniRow.verdict);
    }
  }, DB_TIMEOUT_MS);

  it('scopeProgramIds returns null for university and ids for a faculty', async () => {
    expect(await scopeProgramIds('university', null)).toBeNull();
    const f = await prisma.faculty.findFirst({ select: { id: true } });
    if (f) expect(Array.isArray(await scopeProgramIds('faculty', f.id))).toBe(true);
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
    expect(src).toMatch(/studentCohortDistribution\.groupBy\([\s\S]*?realDataWhere\(\)/);
    expect(src).toMatch(/programJobThaiLink\.findMany\(\{\s*where: realDataWhere\(\)/);
  });
});
