import { describe, expect, it, vi, beforeEach } from 'vitest';

// Verifies the tool executor routes tool names to the right compute path
// and fails gracefully. Mocks prisma at the minimal surface each handler
// touches. Intentionally does NOT test the engine internals — those have
// their own tests under packages/shared/test and packages/db/test.

const mocks = vi.hoisted(() => ({
  programFindMany: vi.fn(),
  skillFindMany: vi.fn(),
  trendFindMany: vi.fn(),
  queryRaw: vi.fn(),
  queryRawUnsafe: vi.fn(),
  researchFindMany: vi.fn(),
  programFindUnique: vi.fn(),
  programFacultyMFindMany: vi.fn(),
  programSkillFindMany: vi.fn(),
  enrollmentFindMany: vi.fn(),
  financialFindMany: vi.fn(),
  demoFindMany: vi.fn(),
  facultyFindUnique: vi.fn(),
  policyDocFindUnique: vi.fn(),
  peerProgramFindUnique: vi.fn(),
  peerProgramFindMany: vi.fn(),
  peerSetMemberFindMany: vi.fn(),
  programFindUniqueOrThrow: vi.fn(),
  enrollmentMetricFindMany: vi.fn(),
  trendSignalFindUnique: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const actual = await vi.importActual<typeof import('@kku/db')>('@kku/db');
  return {
    ...actual,
    prisma: {
      program: {
        findMany: mocks.programFindMany,
        findUnique: mocks.programFindUnique,
        findUniqueOrThrow: mocks.programFindUniqueOrThrow,
      },
      skill: { findMany: mocks.skillFindMany },
      trendSignal: {
        findMany: mocks.trendFindMany,
        findUnique: mocks.trendSignalFindUnique,
      },
      researchOutput: { findMany: mocks.researchFindMany },
      programFaculty: { findMany: mocks.programFacultyMFindMany },
      programSkill: { findMany: mocks.programSkillFindMany },
      enrollmentMetric: { findMany: mocks.enrollmentFindMany },
      financialMetric: { findMany: mocks.financialFindMany },
      demographicProjection: { findMany: mocks.demoFindMany },
      faculty: { findUnique: mocks.facultyFindUnique },
      policyDocument: { findUnique: mocks.policyDocFindUnique },
      peerProgram: {
        findUnique: mocks.peerProgramFindUnique,
        findMany: mocks.peerProgramFindMany,
      },
      peerSetMember: { findMany: mocks.peerSetMemberFindMany },
      $queryRaw: mocks.queryRaw,
      $queryRawUnsafe: mocks.queryRawUnsafe,
    },
  };
});

import { QueryGapsInputSchema } from '@kku/shared';
import { AnalystToolExecutor } from '../src/analyst/tool-executor.service';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('AnalystToolExecutor — query_programs', () => {
  it('returns shaped program list', async () => {
    mocks.programFindMany.mockResolvedValue([
      {
        id: 'p1',
        code: 'CPE-BSc',
        nameEn: 'Computer Engineering',
        nameTh: 'วิศวกรรมคอมพิวเตอร์',
        level: 'BACHELOR',
        status: 'ACTIVE',
        faculty: { id: 'f1', code: 'EN', nameEn: 'Engineering' },
        department: { id: 'd1', nameEn: 'CPE' },
        enrollmentMetrics: [{ academicYear: 2024, enrolled: 120, graduatedOnTime: 28 }],
      },
    ]);
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({
      id: 'c1',
      name: 'query_programs',
      input: { scope: 'university', limit: 10 },
    });
    const parsed = JSON.parse(result) as { count: number; programs: Array<{ code: string }> };
    expect(parsed.count).toBe(1);
    expect(parsed.programs[0]?.code).toBe('CPE-BSc');
  });

  it('handles empty result', async () => {
    mocks.programFindMany.mockResolvedValue([]);
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({
      id: 'c1',
      name: 'query_programs',
      input: { scope: 'university' },
    });
    expect(JSON.parse(result)).toEqual({ count: 0, programs: [] });
  });
});

describe('AnalystToolExecutor — routing', () => {
  it('returns error JSON for unknown tool', async () => {
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({ id: 'c1', name: 'nonexistent_tool', input: {} });
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toMatch(/Unknown tool/);
  });

  it('returns error JSON when input fails schema validation', async () => {
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({
      id: 'c1',
      name: 'query_gaps',
      input: { dimension: 'INVALID' }, // not in enum
    });
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toBeTruthy();
  });
});

describe('AnalystToolExecutor — get_methodology', () => {
  it('returns health-score methodology with version', async () => {
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({
      id: 'c1',
      name: 'get_methodology',
      input: { metricName: 'health-score' },
    });
    const parsed = JSON.parse(result) as { name: string; version: string; summary: string };
    expect(parsed.name).toBe('health-score');
    expect(parsed.version).toMatch(/health-score/);
    expect(parsed.summary).toMatch(/Equal-weighted/);
  });

  it('returns forecasting methodology', async () => {
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({
      id: 'c1',
      name: 'get_methodology',
      input: { metricName: 'forecasting' },
    });
    const parsed = JSON.parse(result) as { version: string };
    expect(parsed.version).toMatch(/forecasting/);
  });
});

describe('AnalystToolExecutor — cite_source', () => {
  it('formats program citation', async () => {
    mocks.programFindUnique.mockResolvedValue({
      code: 'CPE-BSc',
      nameEn: 'Computer Engineering',
      nameTh: 'วิศวกรรมคอมพิวเตอร์',
    });
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({
      id: 'c1',
      name: 'cite_source',
      input: { entityType: 'program', entityId: 'p1' },
    });
    const parsed = JSON.parse(result) as { citation: string };
    expect(parsed.citation).toMatch(/CPE-BSc/);
    expect(parsed.citation).toMatch(/Computer Engineering/);
  });

  it('handles missing program gracefully', async () => {
    mocks.programFindUnique.mockResolvedValue(null);
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({
      id: 'c1',
      name: 'cite_source',
      input: { entityType: 'program', entityId: 'does-not-exist' },
    });
    const parsed = JSON.parse(result) as { citation: string };
    expect(parsed.citation).toMatch(/not found/);
  });
});

describe('AnalystToolExecutor — generate_chart', () => {
  it('validates + returns chart spec', async () => {
    const exec = new AnalystToolExecutor();
    const result = await exec.execute({
      id: 'c1',
      name: 'generate_chart',
      input: {
        type: 'line',
        title: 'Enrollment trend',
        data: [{ year: 2020, value: 100 }, { year: 2021, value: 110 }],
        xKey: 'year',
        yKey: 'value',
      },
    });
    const parsed = JSON.parse(result) as { ok: boolean; chart: { title: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.chart.title).toBe('Enrollment trend');
  });
});

describe('AnalystToolExecutor — query_gaps (gap map)', () => {
  it('rejects the retired lens dimensions', async () => {
    const exec = new AnalystToolExecutor();
    for (const dimension of ['skills', 'occupations', 'sectors', 'risks', 'opportunities']) {
      const parsed = JSON.parse(
        await exec.execute({ id: 'c1', name: 'query_gaps', input: { dimension } }),
      ) as { error?: string };
      expect(parsed.error, `dimension "${dimension}" should no longer be accepted`).toBeTruthy();
    }
  });

  it('accepts every verdict the map can return, plus "map"', () => {
    // Six verdicts, not five: 'supply-unknown' is a field that HAS KKU
    // programmes but none with a graduate figure — a missing measurement,
    // not a shortfall — and 'too-few-postings' is a demand signal too thin
    // to judge. The model must be able to ask for both by name, or it will
    // read them off `verdictCounts` with no way to see which fields they are.
    for (const dimension of [
      'map',
      'white-space',
      'under-served',
      'served',
      'over-served',
      'supply-unknown',
      'too-few-postings',
    ]) {
      expect(QueryGapsInputSchema.safeParse({ dimension }).success, dimension).toBe(true);
    }
  });

  it('has no programme scope — the map is never computed for one programme', () => {
    expect(QueryGapsInputSchema.safeParse({ dimension: 'map', scope: 'program', scopeId: 'p1' }).success).toBe(false);
  });

  it('refuses thresholds that are not an ordered pair', () => {
    expect(QueryGapsInputSchema.safeParse({ dimension: 'map', under: 2, over: 0.5 }).success).toBe(false);
    expect(QueryGapsInputSchema.safeParse({ dimension: 'map', under: 0.8, over: 1.5 }).success).toBe(true);
  });
});
