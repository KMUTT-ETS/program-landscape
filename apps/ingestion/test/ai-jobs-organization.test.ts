import { describe, expect, it } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { OrganizationNotConfiguredError } from '@kku/shared';
import { runAiJobHandler } from '../src/ai-jobs/queue';
import type { AiJobHandler } from '../src/ai-jobs/handlers';

const ctx = { entityId: 'e1', trigger: 'MANUAL' } as unknown as Parameters<AiJobHandler>[0];

describe('runAiJobHandler', () => {
  it('turns a missing organisation profile into an UnrecoverableError', async () => {
    const handler: AiJobHandler = async () => {
      throw new OrganizationNotConfiguredError();
    };
    await expect(runAiJobHandler(handler, ctx)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('passes other errors through unchanged so BullMQ retries them', async () => {
    const boom = new Error('ECONNRESET');
    const handler: AiJobHandler = async () => {
      throw boom;
    };
    await expect(runAiJobHandler(handler, ctx)).rejects.toBe(boom);
  });

  it('returns the handler outcome on success', async () => {
    const handler: AiJobHandler = async () => ({ status: 'OK' }) as never;
    await expect(runAiJobHandler(handler, ctx)).resolves.toEqual({ status: 'OK' });
  });
});
