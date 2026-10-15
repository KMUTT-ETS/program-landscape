import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KKU_REFERENCE_ORGANIZATION,
  OrganizationNotConfiguredError,
  OrganizationVersionConflictError,
  getInstitution,
  setOrganizationForTest,
} from '@kku/shared';
import {
  loadOrganization,
  organizationTagline,
  profileToInstitution,
  saveOrganizationIdentity,
  startOrganizationRefresh,
  type OrgClient,
} from '../src/organization';

type Row = {
  id: string; nameTh: string; nameEn: string; shortNameTh: string; shortNameEn: string;
  regionTh: string | null; regionEn: string | null; contactEmail: string | null; appUrl: string;
  version: number; updatedAt: Date; updatedBy: string | null;
};

const ROW: Row = {
  id: 'default',
  nameTh: 'มหาวิทยาลัยตัวอย่าง',
  nameEn: 'Example University',
  shortNameTh: 'มต.',
  shortNameEn: 'EXU',
  regionTh: null,
  regionEn: null,
  contactEmail: null,
  appUrl: 'https://landscape.example.ac.th',
  version: 1,
  updatedAt: new Date('2026-10-15T00:00:00Z'),
  updatedBy: null,
};

function fakeClient(initial: Row | null) {
  let row: Row | null = initial ? { ...initial } : null;
  const client = {
    organizationProfile: {
      findUnique: vi.fn(async () => (row ? { ...row } : null)),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'version' | 'updatedAt'> }) => {
        if (row) throw Object.assign(new Error('unique'), { code: 'P2002' });
        row = { ...ROW, ...data, id: 'default', version: 1, updatedAt: new Date() };
        return { ...row };
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { version: number }; data: Partial<Row> & { version: { increment: number } } }) => {
          if (!row || row.version !== where.version) return { count: 0 };
          const { version: _v, ...rest } = data;
          row = { ...row, ...rest, version: row.version + 1, updatedAt: new Date() };
          return { count: 1 };
        },
      ),
    },
    tcasAdmissionStat: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => []),
  };
  return {
    client: client as unknown as OrgClient,
    raw: client,
    setRow: (r: Row | null) => (row = r),
  };
}

beforeEach(() => setOrganizationForTest(undefined));
afterEach(() => {
  vi.useRealTimers();
  setOrganizationForTest(KKU_REFERENCE_ORGANIZATION);
});

describe('profileToInstitution', () => {
  it('maps columns and keeps a null contact email null (UA then omits it)', () => {
    expect(profileToInstitution(ROW)).toEqual({
      nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
      shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: null,
      appUrl: 'https://landscape.example.ac.th',
    });
  });
});

describe('organizationTagline', () => {
  it('keeps the product name fixed and puts the short name in the tagline', () => {
    expect(organizationTagline('EXU')).toBe('EXU Curriculum Intelligence Platform');
  });
});

describe('loadOrganization', () => {
  it('fills the cache from the row', async () => {
    const { client } = fakeClient(ROW);
    await loadOrganization(client);
    expect(getInstitution().nameEn).toBe('Example University');
  });

  it('marks the cache loaded-but-empty when no row exists', async () => {
    const { client } = fakeClient(null);
    expect(await loadOrganization(client)).toBeNull();
    expect(() => getInstitution()).toThrow(OrganizationNotConfiguredError);
  });
});

describe('saveOrganizationIdentity', () => {
  const input = {
    nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.', shortNameEn: 'EXU',
    regionTh: null, regionEn: null, contactEmail: null, appUrl: 'https://landscape.example.ac.th',
  };

  it('creates the first profile and refreshes this process cache', async () => {
    const { client } = fakeClient(null);
    await loadOrganization(client);
    const saved = await saveOrganizationIdentity({ ...input, expectedVersion: null }, 'u1', client);
    expect(saved.version).toBe(1);
    expect(getInstitution().shortNameEn).toBe('EXU');
  });

  it('rejects a create when a profile already exists (two first-time admins)', async () => {
    const { client } = fakeClient(ROW);
    await expect(
      saveOrganizationIdentity({ ...input, expectedVersion: null }, 'u1', client),
    ).rejects.toBeInstanceOf(OrganizationVersionConflictError);
  });

  it('bumps the version on update and rejects a stale expectedVersion', async () => {
    const { client } = fakeClient(ROW);
    const first = await saveOrganizationIdentity({ ...input, nameEn: 'A', expectedVersion: 1 }, 'u1', client);
    expect(first.version).toBe(2);
    await expect(
      saveOrganizationIdentity({ ...input, nameEn: 'B', expectedVersion: 1 }, 'u2', client),
    ).rejects.toBeInstanceOf(OrganizationVersionConflictError);
  });
});

describe('startOrganizationRefresh', () => {
  it('reloads when the version moves', async () => {
    vi.useFakeTimers();
    const { client, setRow } = fakeClient(ROW);
    await loadOrganization(client);
    const stop = startOrganizationRefresh(client, 1000);
    setRow({ ...ROW, nameEn: 'Renamed University', version: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(getInstitution().nameEn).toBe('Renamed University');
    stop();
  });

  it('keeps the last good identity when the database is unreachable', async () => {
    vi.useFakeTimers();
    const { client, raw } = fakeClient(ROW);
    await loadOrganization(client);
    const stop = startOrganizationRefresh(client, 1000);
    raw.organizationProfile.findUnique.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(getInstitution().nameEn).toBe('Example University');
    stop();
  });
});
