import { describe, expect, it, vi } from 'vitest';

import { SKILL_TAXONOMY_LOCK_KEY, withSkillTaxonomyLock, type LockClient } from '../src/program-skills/taxonomy-lock';

describe('withSkillTaxonomyLock', () => {
  it('takes the advisory lock on the constant key before running the work, and returns its result', async () => {
    const order: string[] = [];
    const executeRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push(`lock:${strings.join('?')}:${String(values[0])}`);
      return 1;
    });
    const client: LockClient = {
      $transaction: async (fn) => fn({ $executeRaw: executeRaw }),
    };
    const result = await withSkillTaxonomyLock(async () => {
      order.push('work');
      return 42;
    }, client);

    expect(result).toBe(42);
    expect(order).toHaveLength(2);
    expect(order[0]).toContain('pg_advisory_xact_lock');
    expect(order[0]).toContain(SKILL_TAXONOMY_LOCK_KEY);
    expect(order[1]).toBe('work');
  });

  it('does not run the work when the lock cannot be taken', async () => {
    const work = vi.fn();
    const client: LockClient = {
      $transaction: async (fn) =>
        fn({ $executeRaw: async () => { throw new Error('lock failed'); } }),
    };
    await expect(withSkillTaxonomyLock(work, client)).rejects.toThrow('lock failed');
    expect(work).not.toHaveBeenCalled();
  });
});
