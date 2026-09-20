import { describe, expect, it, vi, beforeEach } from 'vitest';

// Coverage for the two /admin/job-fields derived-layer rebuild handlers:
// RUN_JOBTHAI_LINK_REBUILD (free, deterministic — planJobThaiLinks +
// writeJobThaiLinks) and RUN_JOBTHAI_FULL_REFRESH (spends real AI money —
// refreshJobThaiDerived, which also runs the field-taxonomy build). Both
// functions are mocked here rather than exercised for real: this suite
// proves the HANDLERS wire runId resolution, the written plan, and the
// partial/full outcome distinction correctly — it is not a test of
// planJobThaiLinks/refreshJobThaiDerived themselves (covered elsewhere),
// and it never touches Prisma or the AI provider for real.
const mocks = vi.hoisted(() => ({
  latestDemandRunId: vi.fn(),
  planJobThaiLinks: vi.fn(),
  writeJobThaiLinks: vi.fn(),
  refreshJobThaiDerived: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  Prisma: { JsonNull: null, InputJsonValue: null },
  prisma: {},
  refreshAiModelCatalog: vi.fn(),
  runScholarFetch: vi.fn(),
  latestDemandRunId: mocks.latestDemandRunId,
}));

vi.mock('../src/jobthai/refresh', () => ({
  planJobThaiLinks: mocks.planJobThaiLinks,
  writeJobThaiLinks: mocks.writeJobThaiLinks,
  refreshJobThaiDerived: mocks.refreshJobThaiDerived,
}));

import { buildHandlers } from '../src/ai-jobs/handlers';
import type { AiService } from '@kku/shared';

function fakeAi(): AiService {
  return {
    providerId: 'mock',
    complete: vi.fn(),
    embed: vi.fn(),
    extractStructured: vi.fn(),
    translate: vi.fn(),
    vision: vi.fn(),
  };
}

// A real-shaped cuid — the same length/format as an actual Prisma cuid —
// so a test asserting the outcome message never contains it is meaningful.
const RUN_ID = 'ckabcdefghijklmnopqrstuvwx';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('RUN_JOBTHAI_LINK_REBUILD handler', () => {
  it('FAILs, and never plans, with no SUCCEEDED taxonomy run to attribute to', async () => {
    mocks.latestDemandRunId.mockResolvedValue(null);
    const handlers = buildHandlers({ ai: fakeAi(), autoApproveThreshold: 0.85 });

    const outcome = await handlers.RUN_JOBTHAI_LINK_REBUILD({
      entityId: '__all__',
      trigger: 'MANUAL',
      triggeredByUserId: null,
    });

    expect(outcome.status).toBe('FAILED');
    expect(mocks.planJobThaiLinks).not.toHaveBeenCalled();
    expect(mocks.writeJobThaiLinks).not.toHaveBeenCalled();
  });

  it('writes the plan against the resolved run and reports counts — never the runId — in the message', async () => {
    mocks.latestDemandRunId.mockResolvedValue(RUN_ID);
    mocks.planJobThaiLinks.mockResolvedValue({
      planned: [{ programId: 'p1' }],
      linkedProgrammes: 82,
      clearingFloor: 55,
    });
    mocks.writeJobThaiLinks.mockResolvedValue(1716);
    const handlers = buildHandlers({ ai: fakeAi(), autoApproveThreshold: 0.85 });

    const outcome = await handlers.RUN_JOBTHAI_LINK_REBUILD({
      entityId: '__all__',
      trigger: 'MANUAL',
      triggeredByUserId: 'u1',
    });

    expect(mocks.writeJobThaiLinks).toHaveBeenCalledWith([{ programId: 'p1' }], RUN_ID);
    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.message).toContain('1716');
    expect(outcome.message).toContain('82');
    expect(outcome.message ?? '').not.toContain(RUN_ID);
  });
});

describe('RUN_JOBTHAI_FULL_REFRESH handler', () => {
  it('FAILs, and never refreshes, with no SUCCEEDED taxonomy run to attribute to', async () => {
    mocks.latestDemandRunId.mockResolvedValue(null);
    const handlers = buildHandlers({ ai: fakeAi(), autoApproveThreshold: 0.85 });

    const outcome = await handlers.RUN_JOBTHAI_FULL_REFRESH({
      entityId: '__all__',
      trigger: 'MANUAL',
      triggeredByUserId: null,
    });

    expect(outcome.status).toBe('FAILED');
    expect(mocks.refreshJobThaiDerived).not.toHaveBeenCalled();
  });

  it('reports a full (non-partial) success when the field-taxonomy step completes', async () => {
    mocks.latestDemandRunId.mockResolvedValue(RUN_ID);
    mocks.refreshJobThaiDerived.mockResolvedValue({
      derive: {},
      linksWritten: 1716,
      linkedProgrammes: 82,
      clearingFloor: 55,
      fields: { taxonomy: { creates: 2, synonymAdds: 3 }, assignments: { rule: 10, ai: 5 } },
      durationMs: 12_345,
    });
    const handlers = buildHandlers({ ai: fakeAi(), autoApproveThreshold: 0.85 });

    const outcome = await handlers.RUN_JOBTHAI_FULL_REFRESH({
      entityId: '__all__',
      trigger: 'MANUAL',
      triggeredByUserId: 'u1',
    });

    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.partial).toBeFalsy();
    expect(outcome.message ?? '').not.toContain(RUN_ID);
  });

  it('reports partial=true when the field-taxonomy step failed (fields comes back null)', async () => {
    mocks.latestDemandRunId.mockResolvedValue(RUN_ID);
    mocks.refreshJobThaiDerived.mockResolvedValue({
      derive: {},
      linksWritten: 1716,
      linkedProgrammes: 82,
      clearingFloor: 55,
      fields: null,
      durationMs: 12_345,
    });
    const handlers = buildHandlers({ ai: fakeAi(), autoApproveThreshold: 0.85 });

    const outcome = await handlers.RUN_JOBTHAI_FULL_REFRESH({
      entityId: '__all__',
      trigger: 'MANUAL',
      triggeredByUserId: 'u1',
    });

    // Still SUCCEEDED (links + occupations landed) — `partial` is the
    // signal that distinguishes this from an ordinary full success, not
    // the top-level status.
    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.partial).toBe(true);
    expect(outcome.message).toMatch(/FAILED/);
  });
});
