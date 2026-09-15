import { describe, expect, it, vi } from 'vitest';
import { AUDIT_LOG_META, PERMISSION_META } from '../src/common/decorators';
import { JobFieldsController, MergeBody, RenameBody } from '../src/job-fields/job-fields.controller';
import type { CacheService } from '../src/common/cache.service';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

// Mutations must be audit-logged, gated on data_sources:configure, and must
// purge the gap-map cache; the review page is what makes a PROPOSED field
// Council-grade, so an approval that stays invisible for five minutes reads
// as "the button did nothing".

const meta = <T,>(key: string, method: (...args: never[]) => unknown): T | undefined =>
  Reflect.getMetadata(key, method) as T | undefined;

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

describe('JobFieldsController cache purge', () => {
  it('purges gap:map:* after an approval', async () => {
    const purge = vi.fn(async () => 1);
    const c = new JobFieldsController({ purge } as unknown as CacheService);
    vi.spyOn(c as unknown as { setStatus: (id: string, s: string) => Promise<void> }, 'setStatus').mockResolvedValue(undefined);
    await c.approve('f1');
    expect(purge).toHaveBeenCalledWith('gap:map:*');
  });
});

describe('bodies', () => {
  it('rename requires both names', () => {
    expect(() => new ZodValidationPipe(RenameBody).transform({ nameTh: 'x' }, {} as never)).toThrow();
  });
  it('merge requires intoId (a self-merge is refused by mergeJobFields itself)', () => {
    expect(() => new ZodValidationPipe(MergeBody).transform({}, {} as never)).toThrow();
    expect(() => new ZodValidationPipe(MergeBody).transform({ intoId: 'f1' }, {} as never)).not.toThrow();
  });
});
