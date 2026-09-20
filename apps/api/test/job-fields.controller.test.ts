import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@kku/db';
import { ApiError, type SessionUser } from '@kku/shared';
import { AUDIT_LOG_META, PERMISSION_META } from '../src/common/decorators';
import type { CacheService } from '../src/common/cache.service';
import type { AiJobsQueueService } from '../src/ai-jobs/ai-jobs-queue.service';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

// Mutations must be audit-logged, gated on data_sources:configure, and must
// purge the gap-map cache; the review page is what makes a PROPOSED field
// Council-grade, so an approval that stays invisible for five minutes reads
// as "the button did nothing". A bad id must read as 404/400, not a bare
// 500 — and a failed write must never purge the cache it didn't change.

const mocks = vi.hoisted(() => ({
  listJobFields: vi.fn(),
  listProgramJobFields: vi.fn(),
  setJobFieldStatus: vi.fn(),
  renameJobField: vi.fn(),
  mergeJobFields: vi.fn(),
  setProgramJobFieldStatus: vi.fn(),
  addProgramJobField: vi.fn(),
  bulkApproveJobFields: vi.fn(),
  bulkApproveProgramJobFields: vi.fn(),
  latestDemandRunId: vi.fn(),
  synonymSourcesForField: vi.fn(),
  synonymSourcesForAllFields: vi.fn(),
  jobThaiLinkState: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const actual = await vi.importActual<typeof import('@kku/db')>('@kku/db');
  return {
    Prisma: actual.Prisma,
    JOB_FIELDS_BULK_APPROVE_MAX: actual.JOB_FIELDS_BULK_APPROVE_MAX,
    PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX: actual.PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX,
    listJobFields: mocks.listJobFields,
    listProgramJobFields: mocks.listProgramJobFields,
    setJobFieldStatus: mocks.setJobFieldStatus,
    renameJobField: mocks.renameJobField,
    mergeJobFields: mocks.mergeJobFields,
    setProgramJobFieldStatus: mocks.setProgramJobFieldStatus,
    addProgramJobField: mocks.addProgramJobField,
    bulkApproveJobFields: mocks.bulkApproveJobFields,
    bulkApproveProgramJobFields: mocks.bulkApproveProgramJobFields,
    latestDemandRunId: mocks.latestDemandRunId,
    synonymSourcesForField: mocks.synonymSourcesForField,
    synonymSourcesForAllFields: mocks.synonymSourcesForAllFields,
    jobThaiLinkState: mocks.jobThaiLinkState,
  };
});

import { BulkApproveAssignmentsBody, BulkApproveBody, JobFieldsController, MergeBody, RenameBody } from '../src/job-fields/job-fields.controller';
import { JOB_FIELDS_BULK_APPROVE_MAX, PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX } from '@kku/db';

const meta = <T,>(key: string, method: (...args: never[]) => unknown): T | undefined =>
  Reflect.getMetadata(key, method) as T | undefined;

function p2025(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('record not found', { code: 'P2025', clientVersion: 'test' });
}

function p2003(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('foreign key violation', { code: 'P2003', clientVersion: 'test' });
}

interface FakeAiJobs {
  enqueue: ReturnType<typeof vi.fn>;
  countRunning: ReturnType<typeof vi.fn>;
  latestOutcome: ReturnType<typeof vi.fn>;
}

function makeController(): { controller: JobFieldsController; purge: ReturnType<typeof vi.fn>; aiJobs: FakeAiJobs } {
  const purge = vi.fn(async () => 1);
  const aiJobs: FakeAiJobs = {
    enqueue: vi.fn(async () => 'job-1'),
    countRunning: vi.fn(async () => 0),
    latestOutcome: vi.fn(async () => null),
  };
  const controller = new JobFieldsController(
    { purge } as unknown as CacheService,
    aiJobs as unknown as AiJobsQueueService,
  );
  return { controller, purge, aiJobs };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('JobFieldsController decorators', () => {
  const mutations: Array<keyof JobFieldsController> = [
    'approve',
    'reject',
    'rename',
    'merge',
    'bulkApprove',
    'addAssignment',
    'approveAssignment',
    'rejectAssignment',
    'bulkApproveAssignments',
    'rebuildLinks',
    'refreshAll',
  ];
  for (const name of mutations) {
    it(`${name} is audit-logged and gated on data_sources:configure`, () => {
      const method = JobFieldsController.prototype[name] as (...args: never[]) => unknown;
      expect(meta<{ action: string }>(AUDIT_LOG_META, method)?.action).toMatch(/^(job_field|program_job_field)\./);
      expect(meta<string>(PERMISSION_META, method)).toBe('data_sources:configure');
    });
  }
  it('list is gated on data_sources:read', () => {
    expect(meta<string>(PERMISSION_META, JobFieldsController.prototype.list)).toBe('data_sources:read');
  });
  it('synonymSources is gated on data_sources:read, like the other reads', () => {
    expect(meta<string>(PERMISSION_META, JobFieldsController.prototype.synonymSources)).toBe('data_sources:read');
  });
  it('refreshStatus is gated on data_sources:read, like the other reads', () => {
    expect(meta<string>(PERMISSION_META, JobFieldsController.prototype.refreshStatus)).toBe('data_sources:read');
  });
  // A free, deterministic link rebuild and a full refresh that spends real
  // AI money must never look the same to someone reading the audit log.
  it('rebuildLinks and refreshAll are audited as two DISTINCT actions', () => {
    const rebuildAction = meta<{ action: string }>(AUDIT_LOG_META, JobFieldsController.prototype.rebuildLinks)?.action;
    const refreshAction = meta<{ action: string }>(AUDIT_LOG_META, JobFieldsController.prototype.refreshAll)?.action;
    expect(rebuildAction).toBe('job_field.rebuild_links');
    expect(refreshAction).toBe('job_field.refresh_all');
    expect(rebuildAction).not.toBe(refreshAction);
  });
});

describe('JobFieldsController.synonymSources', () => {
  it('with no fieldId, returns the bulk attribution for every field', async () => {
    const { controller } = makeController();
    mocks.synonymSourcesForAllFields.mockResolvedValue([{ fieldId: 'f1', synonym: 'บัญชี', sources: ['jobthai'] }]);

    const result = await controller.synonymSources({});

    expect(mocks.synonymSourcesForAllFields).toHaveBeenCalledTimes(1);
    expect(mocks.synonymSourcesForField).not.toHaveBeenCalled();
    expect(result).toEqual([{ fieldId: 'f1', synonym: 'บัญชี', sources: ['jobthai'] }]);
  });

  it('with a fieldId, calls the single-field lookup and stamps the id onto each row', async () => {
    const { controller } = makeController();
    mocks.synonymSourcesForField.mockResolvedValue([{ synonym: 'รัฐประศาสนศาสตร์', sources: ['job-108'] }]);

    const result = await controller.synonymSources({ fieldId: 'f1' });

    expect(mocks.synonymSourcesForField).toHaveBeenCalledWith('f1');
    expect(mocks.synonymSourcesForAllFields).not.toHaveBeenCalled();
    expect(result).toEqual([{ fieldId: 'f1', synonym: 'รัฐประศาสนศาสตร์', sources: ['job-108'] }]);
  });
});

describe('bodies', () => {
  it('rename requires both names', () => {
    expect(() => new ZodValidationPipe(RenameBody).transform({ nameTh: 'x' }, {} as never)).toThrow();
  });
  it('merge requires intoId', () => {
    expect(() => new ZodValidationPipe(MergeBody).transform({}, {} as never)).toThrow();
    expect(() => new ZodValidationPipe(MergeBody).transform({ intoId: 'f1' }, {} as never)).not.toThrow();
  });
  it('bulk-approve requires at least one id and refuses an over-size batch with a clear message', () => {
    const parse = (ids: unknown) => new ZodValidationPipe(BulkApproveBody).transform({ ids }, {} as never);
    expect(() => parse([])).toThrow();
    expect(parse(['f1', 'f2'])).toEqual({ ids: ['f1', 'f2'] });
    const tooMany = Array.from({ length: JOB_FIELDS_BULK_APPROVE_MAX + 1 }, (_, i) => `f${i}`);
    const err = ((): ApiError => {
      try {
        parse(tooMany);
        throw new Error('expected parse to throw');
      } catch (e) {
        return e as ApiError;
      }
    })();
    expect(err).toBeInstanceOf(ApiError);
    const issues = (err.details as { issues: Array<{ message: string }> }).issues;
    expect(issues[0]?.message).toMatch(new RegExp(`at most ${JOB_FIELDS_BULK_APPROVE_MAX} fields per bulk approval`));
    const atCap = Array.from({ length: JOB_FIELDS_BULK_APPROVE_MAX }, (_, i) => `f${i}`);
    expect(() => parse(atCap)).not.toThrow();
  });

  it('bulk-approve-assignments requires at least one id and refuses an over-size batch with a clear message', () => {
    const parse = (ids: unknown) => new ZodValidationPipe(BulkApproveAssignmentsBody).transform({ ids }, {} as never);
    expect(() => parse([])).toThrow();
    expect(parse(['a1', 'a2'])).toEqual({ ids: ['a1', 'a2'] });
    const tooMany = Array.from({ length: PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX + 1 }, (_, i) => `a${i}`);
    const err = ((): ApiError => {
      try {
        parse(tooMany);
        throw new Error('expected parse to throw');
      } catch (e) {
        return e as ApiError;
      }
    })();
    expect(err).toBeInstanceOf(ApiError);
    const issues = (err.details as { issues: Array<{ message: string }> }).issues;
    expect(issues[0]?.message).toMatch(new RegExp(`at most ${PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX} assignments per bulk approval`));
    const atCap = Array.from({ length: PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX }, (_, i) => `a${i}`);
    expect(() => parse(atCap)).not.toThrow();
  });
});

describe('JobFieldsController.approve', () => {
  it('calls setJobFieldStatus and purges the cache exactly once, after the write', async () => {
    const { controller, purge } = makeController();
    const order: string[] = [];
    mocks.setJobFieldStatus.mockImplementation(async () => {
      order.push('write');
    });
    purge.mockImplementation(async () => {
      order.push('purge');
      return 1;
    });

    const result = await controller.approve('f1');

    expect(mocks.setJobFieldStatus).toHaveBeenCalledWith('f1', 'APPROVED');
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith('gap:map:*');
    expect(order).toEqual(['write', 'purge']);
    expect(result).toEqual({ id: 'f1', reviewStatus: 'APPROVED' });
  });

  it('does not purge when the write rejects', async () => {
    const { controller, purge } = makeController();
    mocks.setJobFieldStatus.mockRejectedValue(new Error('boom'));

    await expect(controller.approve('f1')).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });

  it('a P2025 becomes ApiError NOT_FOUND', async () => {
    const { controller, purge } = makeController();
    mocks.setJobFieldStatus.mockRejectedValue(p2025());

    const err = await controller.approve('missing').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect(purge).not.toHaveBeenCalled();
  });
});

describe('JobFieldsController.reject', () => {
  it('calls setJobFieldStatus(REJECTED) and purges once after the write', async () => {
    const { controller, purge } = makeController();
    mocks.setJobFieldStatus.mockResolvedValue(undefined);

    const result = await controller.reject('f1');

    expect(mocks.setJobFieldStatus).toHaveBeenCalledWith('f1', 'REJECTED');
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'f1', reviewStatus: 'REJECTED' });
  });

  it('does not purge when the write rejects', async () => {
    const { controller, purge } = makeController();
    mocks.setJobFieldStatus.mockRejectedValue(new Error('boom'));

    await expect(controller.reject('f1')).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });
});

describe('JobFieldsController.rename', () => {
  it('calls renameJobField with the body and purges once after the write', async () => {
    const { controller, purge } = makeController();
    mocks.renameJobField.mockResolvedValue(undefined);
    const body = { nameTh: 'บัญชี', nameEn: 'Accounting' };

    const result = await controller.rename('f1', body);

    expect(mocks.renameJobField).toHaveBeenCalledWith('f1', body);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'f1', ...body });
  });

  it('does not purge when the write rejects', async () => {
    const { controller, purge } = makeController();
    mocks.renameJobField.mockRejectedValue(new Error('boom'));

    await expect(controller.rename('f1', { nameTh: 'a', nameEn: 'b' })).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });

  it('a P2025 from renameJobField becomes ApiError NOT_FOUND', async () => {
    const { controller, purge } = makeController();
    mocks.renameJobField.mockRejectedValue(p2025());

    const err = await controller.rename('missing', { nameTh: 'a', nameEn: 'b' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect(purge).not.toHaveBeenCalled();
  });
});

describe('JobFieldsController.merge', () => {
  it('calls mergeJobFields and purges once after the write, returning id = intoId', async () => {
    const { controller, purge } = makeController();
    mocks.mergeJobFields.mockResolvedValue({ synonymsMoved: 2, assignmentsMoved: 1, assignmentsPromoted: 0 });

    const result = await controller.merge('from1', { intoId: 'into1' });

    expect(mocks.mergeJobFields).toHaveBeenCalledWith('from1', 'into1');
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: 'into1',
      from: 'from1',
      into: 'into1',
      synonymsMoved: 2,
      assignmentsMoved: 1,
      assignmentsPromoted: 0,
    });
  });

  it('does not purge when the write rejects', async () => {
    const { controller, purge } = makeController();
    mocks.mergeJobFields.mockRejectedValue(new Error('boom'));

    await expect(controller.merge('from1', { intoId: 'into1' })).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });

  it('self-merge throws ApiError VALIDATION_FAILED and never calls mergeJobFields', async () => {
    const { controller, purge } = makeController();

    const err = await controller.merge('f1', { intoId: 'f1' }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_FAILED');
    expect(mocks.mergeJobFields).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
  });

  it('a P2025 from mergeJobFields becomes ApiError NOT_FOUND', async () => {
    const { controller, purge } = makeController();
    mocks.mergeJobFields.mockRejectedValue(p2025());

    const err = await controller.merge('from1', { intoId: 'into1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect(purge).not.toHaveBeenCalled();
  });
});

describe('JobFieldsController.bulkApprove', () => {
  it('calls bulkApproveJobFields with a deduplicated id list and purges once after the write', async () => {
    const { controller, purge } = makeController();
    mocks.bulkApproveJobFields.mockResolvedValue({ approved: 2 });

    const result = await controller.bulkApprove({ ids: ['f1', 'f2', 'f1'] });

    expect(mocks.bulkApproveJobFields).toHaveBeenCalledTimes(1);
    expect(mocks.bulkApproveJobFields).toHaveBeenCalledWith(['f1', 'f2']);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ids: ['f1', 'f2'], approved: 2 });
  });

  it('does not purge when the write rejects — a partial approval must not appear applied', async () => {
    const { controller, purge } = makeController();
    mocks.bulkApproveJobFields.mockRejectedValue(new Error('boom'));

    await expect(controller.bulkApprove({ ids: ['f1', 'f2'] })).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });

  it('a NOT_FOUND from bulkApproveJobFields (some id no longer exists) propagates untouched', async () => {
    const { controller, purge } = makeController();
    mocks.bulkApproveJobFields.mockRejectedValue(new ApiError('NOT_FOUND', 'bulk approve: 1 of 2 selected fields no longer exist — no field was approved'));

    const err = await controller.bulkApprove({ ids: ['f1', 'f2'] }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect(purge).not.toHaveBeenCalled();
  });
});

describe('JobFieldsController.bulkApproveAssignments', () => {
  it('calls bulkApproveProgramJobFields with a deduplicated id list and purges once after the write', async () => {
    const { controller, purge } = makeController();
    mocks.bulkApproveProgramJobFields.mockResolvedValue({ approved: 2 });

    const result = await controller.bulkApproveAssignments({ ids: ['a1', 'a2', 'a1'] });

    expect(mocks.bulkApproveProgramJobFields).toHaveBeenCalledTimes(1);
    expect(mocks.bulkApproveProgramJobFields).toHaveBeenCalledWith(['a1', 'a2']);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ids: ['a1', 'a2'], approved: 2 });
  });

  it('does not purge when the write rejects — a partial approval must not appear applied', async () => {
    const { controller, purge } = makeController();
    mocks.bulkApproveProgramJobFields.mockRejectedValue(new Error('boom'));

    await expect(controller.bulkApproveAssignments({ ids: ['a1', 'a2'] })).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });

  it('a NOT_FOUND from bulkApproveProgramJobFields (some id no longer exists) propagates untouched, and nothing was applied', async () => {
    const { controller, purge } = makeController();
    mocks.bulkApproveProgramJobFields.mockRejectedValue(
      new ApiError('NOT_FOUND', 'bulk approve: 1 of 2 selected assignments no longer exist — no assignment was approved'),
    );

    const err = await controller.bulkApproveAssignments({ ids: ['a1', 'a2'] }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect(purge).not.toHaveBeenCalled();
  });
});

describe('JobFieldsController.addAssignment', () => {
  it('passes the run id from latestDemandRunId and purges once after the write', async () => {
    const { controller, purge } = makeController();
    mocks.latestDemandRunId.mockResolvedValue('run-1');
    mocks.addProgramJobField.mockResolvedValue('assignment-1');

    const result = await controller.addAssignment({ programId: 'p1', fieldId: 'f1' });

    expect(mocks.latestDemandRunId).toHaveBeenCalledTimes(1);
    expect(mocks.addProgramJobField).toHaveBeenCalledWith('p1', 'f1', 'run-1');
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'assignment-1', programId: 'p1', fieldId: 'f1', reviewStatus: 'APPROVED' });
  });

  it('does not purge when the write rejects', async () => {
    const { controller, purge } = makeController();
    mocks.latestDemandRunId.mockResolvedValue(null);
    mocks.addProgramJobField.mockRejectedValue(new Error('boom'));

    await expect(controller.addAssignment({ programId: 'p1', fieldId: 'f1' })).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });

  it('a P2003 (unknown programme/field id) becomes ApiError VALIDATION_FAILED', async () => {
    const { controller, purge } = makeController();
    mocks.latestDemandRunId.mockResolvedValue(null);
    mocks.addProgramJobField.mockRejectedValue(p2003());

    const err = await controller.addAssignment({ programId: 'bad', fieldId: 'f1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_FAILED');
    expect(purge).not.toHaveBeenCalled();
  });
});

describe('JobFieldsController.approveAssignment', () => {
  it('calls setProgramJobFieldStatus and purges once after the write', async () => {
    const { controller, purge } = makeController();
    mocks.setProgramJobFieldStatus.mockResolvedValue(undefined);

    const result = await controller.approveAssignment('a1');

    expect(mocks.setProgramJobFieldStatus).toHaveBeenCalledWith('a1', 'APPROVED');
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'a1', reviewStatus: 'APPROVED' });
  });

  it('does not purge when the write rejects', async () => {
    const { controller, purge } = makeController();
    mocks.setProgramJobFieldStatus.mockRejectedValue(new Error('boom'));

    await expect(controller.approveAssignment('a1')).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });

  it('a P2025 becomes ApiError NOT_FOUND', async () => {
    const { controller, purge } = makeController();
    mocks.setProgramJobFieldStatus.mockRejectedValue(p2025());

    const err = await controller.approveAssignment('missing').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect(purge).not.toHaveBeenCalled();
  });
});

describe('JobFieldsController.rejectAssignment', () => {
  it('calls setProgramJobFieldStatus(REJECTED) and purges once after the write', async () => {
    const { controller, purge } = makeController();
    mocks.setProgramJobFieldStatus.mockResolvedValue(undefined);

    const result = await controller.rejectAssignment('a1');

    expect(mocks.setProgramJobFieldStatus).toHaveBeenCalledWith('a1', 'REJECTED');
    expect(purge).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'a1', reviewStatus: 'REJECTED' });
  });

  it('does not purge when the write rejects', async () => {
    const { controller, purge } = makeController();
    mocks.setProgramJobFieldStatus.mockRejectedValue(new Error('boom'));

    await expect(controller.rejectAssignment('a1')).rejects.toThrow('boom');
    expect(purge).not.toHaveBeenCalled();
  });
});

// Derived-layer rebuild triggers. NOTE: these tests only prove the endpoints
// enqueue the right kind and that the status GET reports what the queue
// says — they never enqueue a REAL job (aiJobs.enqueue is a mock, no BullMQ
// connection exists in this test process) and never spend AI money.
describe('JobFieldsController.rebuildLinks', () => {
  it('enqueues RUN_JOBTHAI_LINK_REBUILD, MANUAL, with the caller as triggeredByUserId', async () => {
    const { controller, aiJobs } = makeController();
    aiJobs.enqueue.mockResolvedValue('job-42');

    const result = await controller.rebuildLinks({ userId: 'u1' } as SessionUser);

    expect(aiJobs.enqueue).toHaveBeenCalledTimes(1);
    expect(aiJobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'RUN_JOBTHAI_LINK_REBUILD', trigger: 'MANUAL', triggeredByUserId: 'u1' }),
    );
    expect(result).toEqual({ jobId: 'job-42' });
  });
});

describe('JobFieldsController.refreshAll', () => {
  it('enqueues RUN_JOBTHAI_FULL_REFRESH, MANUAL, with the caller as triggeredByUserId', async () => {
    const { controller, aiJobs } = makeController();
    aiJobs.enqueue.mockResolvedValue('job-43');

    const result = await controller.refreshAll({ userId: 'u2' } as SessionUser);

    expect(aiJobs.enqueue).toHaveBeenCalledTimes(1);
    expect(aiJobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'RUN_JOBTHAI_FULL_REFRESH', trigger: 'MANUAL', triggeredByUserId: 'u2' }),
    );
    expect(result).toEqual({ jobId: 'job-43' });
  });

  it('enqueues a DIFFERENT kind than rebuildLinks', async () => {
    const { controller, aiJobs } = makeController();

    await controller.rebuildLinks({ userId: 'u1' } as SessionUser);
    await controller.refreshAll({ userId: 'u1' } as SessionUser);

    const kinds = aiJobs.enqueue.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).toEqual(['RUN_JOBTHAI_LINK_REBUILD', 'RUN_JOBTHAI_FULL_REFRESH']);
  });
});

describe('JobFieldsController.refreshStatus', () => {
  it('reports each kind\'s in-flight state independently, plus the live link state', async () => {
    const { controller, aiJobs } = makeController();
    aiJobs.countRunning.mockImplementation(async (kind: string) => (kind === 'RUN_JOBTHAI_FULL_REFRESH' ? 1 : 0));
    aiJobs.latestOutcome.mockImplementation(async (kind: string) =>
      kind === 'RUN_JOBTHAI_LINK_REBUILD'
        ? { status: 'SUCCEEDED', message: 'wrote 1716 program_jobthai_links across 82 programme(s)', partial: false, finishedAt: '2026-09-20T00:00:00Z' }
        : null,
    );
    mocks.jobThaiLinkState.mockResolvedValue({ totalLinks: 1716, linkedProgrammes: 82, methodologyVersion: 'jobthai-bridge.v3' });

    const result = await controller.refreshStatus();

    expect(result.linkRebuildRunning).toBe(false);
    expect(result.fullRefreshRunning).toBe(true);
    expect(result.linkState).toEqual({ totalLinks: 1716, linkedProgrammes: 82, methodologyVersion: 'jobthai-bridge.v3' });
    expect(result.lastLinkRebuild?.status).toBe('SUCCEEDED');
    expect(result.lastFullRefresh).toBeNull();
  });

  it('surfaces a partial full-refresh outcome distinctly', async () => {
    const { controller, aiJobs } = makeController();
    aiJobs.countRunning.mockResolvedValue(0);
    aiJobs.latestOutcome.mockImplementation(async (kind: string) =>
      kind === 'RUN_JOBTHAI_FULL_REFRESH'
        ? { status: 'SUCCEEDED', partial: true, message: 'fields: FAILED — provider outage', finishedAt: '2026-09-20T01:00:00Z' }
        : null,
    );
    mocks.jobThaiLinkState.mockResolvedValue({ totalLinks: 1716, linkedProgrammes: 82, methodologyVersion: 'jobthai-bridge.v3' });

    const result = await controller.refreshStatus();

    expect(result.lastFullRefresh?.partial).toBe(true);
    expect(result.lastFullRefresh?.status).toBe('SUCCEEDED');
  });
});
