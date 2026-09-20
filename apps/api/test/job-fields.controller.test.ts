import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@kku/db';
import { ApiError } from '@kku/shared';
import { AUDIT_LOG_META, PERMISSION_META } from '../src/common/decorators';
import type { CacheService } from '../src/common/cache.service';
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
  latestDemandRunId: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const actual = await vi.importActual<typeof import('@kku/db')>('@kku/db');
  return {
    Prisma: actual.Prisma,
    listJobFields: mocks.listJobFields,
    listProgramJobFields: mocks.listProgramJobFields,
    setJobFieldStatus: mocks.setJobFieldStatus,
    renameJobField: mocks.renameJobField,
    mergeJobFields: mocks.mergeJobFields,
    setProgramJobFieldStatus: mocks.setProgramJobFieldStatus,
    addProgramJobField: mocks.addProgramJobField,
    latestDemandRunId: mocks.latestDemandRunId,
  };
});

import { JobFieldsController, MergeBody, RenameBody } from '../src/job-fields/job-fields.controller';

const meta = <T,>(key: string, method: (...args: never[]) => unknown): T | undefined =>
  Reflect.getMetadata(key, method) as T | undefined;

function p2025(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('record not found', { code: 'P2025', clientVersion: 'test' });
}

function p2003(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('foreign key violation', { code: 'P2003', clientVersion: 'test' });
}

function makeController(): { controller: JobFieldsController; purge: ReturnType<typeof vi.fn> } {
  const purge = vi.fn(async () => 1);
  const controller = new JobFieldsController({ purge } as unknown as CacheService);
  return { controller, purge };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('JobFieldsController decorators', () => {
  const mutations: Array<keyof JobFieldsController> = ['approve', 'reject', 'rename', 'merge', 'addAssignment', 'approveAssignment', 'rejectAssignment'];
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
});

describe('bodies', () => {
  it('rename requires both names', () => {
    expect(() => new ZodValidationPipe(RenameBody).transform({ nameTh: 'x' }, {} as never)).toThrow();
  });
  it('merge requires intoId', () => {
    expect(() => new ZodValidationPipe(MergeBody).transform({}, {} as never)).toThrow();
    expect(() => new ZodValidationPipe(MergeBody).transform({ intoId: 'f1' }, {} as never)).not.toThrow();
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
