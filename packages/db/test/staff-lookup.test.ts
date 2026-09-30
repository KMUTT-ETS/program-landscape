import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fmFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
}));
vi.mock('../src/index', () => ({
  prisma: {
    facultyMember: { findFirst: mocks.fmFindFirst },
    user: { findFirst: mocks.userFindFirst },
  },
}));

import { hashCitizenId } from '@kku/shared';
import { resolveStaffForLookup } from '../src/staff-profile/lookup';

beforeEach(() => {
  mocks.fmFindFirst.mockReset();
  mocks.userFindFirst.mockReset();
});

describe('resolveStaffForLookup', () => {
  it('matches a citizen id on its hash, active records only by default', async () => {
    mocks.fmFindFirst.mockResolvedValueOnce({ id: 'fm1' });
    await expect(resolveStaffForLookup({ citizenId: '1101700203883' }, { includeInactive: false })).resolves.toBe('fm1');
    expect(mocks.fmFindFirst).toHaveBeenCalledWith({
      where: { citizenIdHash: hashCitizenId('1101700203883'), isActive: true },
      select: { id: true },
    });
  });

  it('drops the active filter when the client may see inactive staff', async () => {
    mocks.fmFindFirst.mockResolvedValueOnce({ id: 'fm1' });
    await resolveStaffForLookup({ citizenId: '1101700203883' }, { includeInactive: true });
    expect(mocks.fmFindFirst.mock.calls[0]![0].where).toEqual({ citizenIdHash: hashCitizenId('1101700203883') });
  });

  it('matches an email on kkuEmail, lowercased', async () => {
    mocks.fmFindFirst.mockResolvedValueOnce({ id: 'fm2' });
    await expect(resolveStaffForLookup({ email: ' Someone@KKU.ac.th ' }, { includeInactive: false })).resolves.toBe('fm2');
    expect(mocks.fmFindFirst.mock.calls[0]![0].where).toEqual({ kkuEmail: 'someone@kku.ac.th', isActive: true });
  });

  it('falls back to the signed-in user bridge when kkuEmail misses', async () => {
    mocks.fmFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'fm3' });
    mocks.userFindFirst.mockResolvedValueOnce({ employeeId: 'E42' });
    await expect(resolveStaffForLookup({ email: 'a@kku.ac.th' }, { includeInactive: false })).resolves.toBe('fm3');
    expect(mocks.fmFindFirst.mock.calls[1]![0].where).toEqual({ employeeId: 'E42', isActive: true });
  });

  it('returns null when nothing matches', async () => {
    mocks.fmFindFirst.mockResolvedValue(null);
    mocks.userFindFirst.mockResolvedValue(null);
    await expect(resolveStaffForLookup({ email: 'x@kku.ac.th' }, { includeInactive: false })).resolves.toBeNull();
  });
});
