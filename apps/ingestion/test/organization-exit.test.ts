import { describe, expect, it } from 'vitest';
import { OrganizationNotConfiguredError, OrganizationNotLoadedError } from '@kku/shared';
import {
  ORGANIZATION_NOT_CONFIGURED_EXIT,
  organizationErrorForExitCode,
  scriptExitCode,
} from '../src/lib/organization-exit';

describe('script exit code ↔ OrganizationNotConfiguredError', () => {
  it('uses EX_CONFIG (78)', () => {
    expect(ORGANIZATION_NOT_CONFIGURED_EXIT).toBe(78);
  });

  it('exits 78 for a missing organisation profile, 1 for anything else', () => {
    expect(scriptExitCode(new OrganizationNotConfiguredError())).toBe(78);
    // A bundled child carries its own copy of the class; match on name too.
    const foreign = Object.assign(new Error('x'), { name: 'OrganizationNotConfiguredError' });
    expect(scriptExitCode(foreign)).toBe(78);
    expect(scriptExitCode(new OrganizationNotLoadedError())).toBe(1);
    expect(scriptExitCode(new Error('ECONNRESET'))).toBe(1);
    expect(scriptExitCode('string')).toBe(1);
  });

  it('maps a child exit code back to the error (only 78)', () => {
    expect(organizationErrorForExitCode(78)).toBeInstanceOf(OrganizationNotConfiguredError);
    expect(organizationErrorForExitCode(0)).toBeNull();
    expect(organizationErrorForExitCode(1)).toBeNull();
  });
});
