import { describe, expect, it } from 'vitest';
import { OrganizationNotConfiguredError } from '@kku/shared';
import { isOrganizationNotConfigured } from '../src/connectors/runner';

describe('isOrganizationNotConfigured', () => {
  it('treats a missing organisation profile as non-retryable', () => {
    expect(isOrganizationNotConfigured(new OrganizationNotConfiguredError())).toBe(true);
  });

  it('leaves other errors to BullMQ retries', () => {
    expect(isOrganizationNotConfigured(new Error('ECONNRESET'))).toBe(false);
  });
});
