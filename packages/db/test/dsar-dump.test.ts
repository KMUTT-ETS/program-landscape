import { describe, expect, it, vi, type Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { dumpByCitizenHash, dumpByUserId } from '../../../scripts/pdpa/dsar-dump';

type Fn = Mock<(...args: unknown[]) => Promise<unknown>>;

/** A client whose every model method resolves empty unless overridden. */
function stubDb(overrides: Record<string, Record<string, Fn>> = {}) {
  const models = new Map<string, Record<string, Fn>>();
  const model = (name: string) => {
    if (!models.has(name)) {
      models.set(name, {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        ...overrides[name],
      });
    }
    return models.get(name)!;
  };
  const db = new Proxy({}, { get: (_t, name: string) => model(name) }) as unknown as PrismaClient;
  return { db, model };
}

describe('dumpByCitizenHash', () => {
  it('reaches the staff cache and the API call log through the staff records', async () => {
    const { db, model } = stubDb({
      facultyMember: { findMany: vi.fn(async () => [{ id: 'fm1' }, { id: 'fm2' }]) },
      apiRequestLog: { findMany: vi.fn(async () => [{ id: 'r1', client: { name: 'HR portal' } }]) },
    });
    const out = await dumpByCitizenHash(db, 'abc');
    expect(model('staffPublicationsCache').findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { facultyMemberId: { in: ['fm1', 'fm2'] } } }),
    );
    expect(model('apiRequestLog').findMany).toHaveBeenCalledWith({
      where: { facultyMemberId: { in: ['fm1', 'fm2'] } },
      orderBy: { createdAt: 'asc' },
      include: { client: { select: { name: true } } },
    });
    expect(out.apiRequestLogs).toEqual([{ id: 'r1', client: { name: 'HR portal' } }]);
    expect(out).toHaveProperty('staffPublicationsCache');
  });

  it('does not query by an empty id list when the hash matches no staff record', async () => {
    const { db, model } = stubDb();
    const out = await dumpByCitizenHash(db, 'abc');
    expect(model('apiRequestLog').findMany).not.toHaveBeenCalled();
    expect(out.apiRequestLogs).toEqual([]);
    expect(out.staffPublicationsCache).toEqual([]);
  });

  it('includes grant memberships found by the lead hash or through the staff records', async () => {
    const { db, model } = stubDb({
      facultyMember: { findMany: vi.fn(async () => [{ id: 'fm1' }]) },
      researchServiceProjectMember: { findMany: vi.fn(async () => [{ id: 'g1' }]) },
    });
    const out = await dumpByCitizenHash(db, 'abc');
    expect(model('researchServiceProjectMember').findMany).toHaveBeenCalledWith({
      where: { OR: [{ citizenIdHash: 'abc' }, { facultyMemberId: { in: ['fm1'] } }] },
      orderBy: { id: 'asc' },
      include: { project: true },
    });
    expect(out.researchServiceProjectMembers).toEqual([{ id: 'g1' }]);
  });

  it('still finds an unmatched lead row by hash when no staff record matches', async () => {
    const { db, model } = stubDb({
      researchServiceProjectMember: { findMany: vi.fn(async () => [{ id: 'g2' }]) },
    });
    const out = await dumpByCitizenHash(db, 'abc');
    expect(model('researchServiceProjectMember').findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ citizenIdHash: 'abc' }] } }),
    );
    expect(out.researchServiceProjectMembers).toEqual([{ id: 'g2' }]);
  });
});

describe('dumpByUserId', () => {
  it('bridges by employeeId across active and inactive records, without the resolver', async () => {
    const resolve = vi.fn(async () => 'fm-name');
    const staffRows = vi.fn(async () => [{ id: 'fm1' }, { id: 'fm-old' }]);
    const { db, model } = stubDb({
      user: { findUnique: vi.fn(async () => ({ id: 'u1', employeeId: 'E1', name: 'x' })) },
      facultyMember: { findMany: staffRows },
    });
    const out = await dumpByUserId(db, 'u1', resolve);
    expect(staffRows).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: 'E1' } }));
    expect(resolve).not.toHaveBeenCalled();
    expect(out.staffRecord).toEqual({ facultyMemberIds: ['fm1', 'fm-old'], matchedBy: 'employeeId' });
    expect(model('apiRequestLog').findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { facultyMemberId: { in: ['fm1', 'fm-old'] } } }),
    );
  });

  it('falls back to the profile resolver, and says so', async () => {
    const resolve = vi.fn(async () => 'fm-name');
    const { db, model } = stubDb({
      user: { findUnique: vi.fn(async () => ({ id: 'u1', employeeId: null, name: 'รศ. สมชาย' })) },
    });
    const out = await dumpByUserId(db, 'u1', resolve);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ employeeId: null, name: 'รศ. สมชาย' }));
    expect(out.staffRecord).toEqual({ facultyMemberIds: ['fm-name'], matchedBy: 'profile-resolver' });
    expect(model('staffPublicationsCache').findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { facultyMemberId: { in: ['fm-name'] } } }),
    );
  });

  it('reaches no staff data for an unknown user', async () => {
    const resolve = vi.fn(async () => 'fm-name');
    const { db, model } = stubDb();
    const out = await dumpByUserId(db, 'nobody', resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(model('apiRequestLog').findMany).not.toHaveBeenCalled();
    expect(out.staffRecord).toEqual({ facultyMemberIds: [], matchedBy: null });
    expect(model('researchServiceProjectMember').findMany).not.toHaveBeenCalled();
    expect(out.researchServiceProjectMembers).toEqual([]);
  });

  it('includes grant memberships reached through the user\'s staff records', async () => {
    const { db, model } = stubDb({
      user: { findUnique: vi.fn(async () => ({ id: 'u1', employeeId: 'E1', name: 'x' })) },
      facultyMember: { findMany: vi.fn(async () => [{ id: 'fm1' }]) },
      researchServiceProjectMember: { findMany: vi.fn(async () => [{ id: 'g1' }]) },
    });
    const out = await dumpByUserId(db, 'u1');
    expect(model('researchServiceProjectMember').findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ facultyMemberId: { in: ['fm1'] } }] } }),
    );
    expect(out.researchServiceProjectMembers).toEqual([{ id: 'g1' }]);
  });
});
