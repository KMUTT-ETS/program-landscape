import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KKU_REFERENCE_ORGANIZATION,
  OrganizationNotConfiguredError,
  OrganizationVersionConflictError,
  getInstitution,
  setOrganizationForTest,
} from '@kku/shared';
import {
  brandAssetUrls,
  ensureOrganizationLoaded,
  loadOrganization,
  organizationTagline,
  profileToInstitution,
  saveOrganizationBrand,
  saveOrganizationIdentity,
  setOrganizationAsset,
  startOrganizationRefresh,
  type OrgClient,
} from '../src/organization';

type Row = {
  id: string; nameTh: string; nameEn: string; shortNameTh: string; shortNameEn: string;
  regionTh: string | null; regionEn: string | null; contactEmail: string | null; appUrl: string;
  version: number; updatedAt: Date; updatedBy: string | null;
  logoLightKey: string | null; logoDarkKey: string | null; faviconKey: string | null;
  primaryColor: string | null; secondaryColor: string | null; brandTokensJson: unknown;
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
  logoLightKey: null,
  logoDarkKey: null,
  faviconKey: null,
  primaryColor: null,
  secondaryColor: null,
  brandTokensJson: null,
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
        async ({ where, data }: { where: { version?: number }; data: Partial<Row> & { version: { increment: number } } }) => {
          if (!row || (where.version !== undefined && row.version !== where.version)) return { count: 0 };
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

describe('startOrganizationRefresh — stale poll', () => {
  it('does not overwrite a save that landed while the poll was reading', async () => {
    vi.useFakeTimers();
    const { client, raw } = fakeClient(ROW);
    await loadOrganization(client);
    const stop = startOrganizationRefresh(client, 1000);
    // The poll's read is held open; it resolves with the pre-save row (v1
    // renamed elsewhere would still be "old" relative to the save below).
    let releasePoll: (row: Row) => void = () => undefined;
    raw.organizationProfile.findUnique.mockImplementationOnce(
      () => new Promise<Row>((resolve) => (releasePoll = resolve)),
    );
    await vi.advanceTimersByTimeAsync(1000);
    // A save lands while the poll is in flight.
    await saveOrganizationIdentity(
      {
        nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Saved University', shortNameTh: 'มต.', shortNameEn: 'EXU',
        regionTh: null, regionEn: null, contactEmail: null, appUrl: 'https://landscape.example.ac.th',
        expectedVersion: 1,
      },
      'u1',
      client,
    );
    // The poll now returns a stale snapshot with a different version.
    releasePoll({ ...ROW, nameEn: 'Stale Poll University', version: 7 });
    await vi.advanceTimersByTimeAsync(0);
    expect(getInstitution().nameEn).toBe('Saved University');
    stop();
  });
});

describe('ensureOrganizationLoaded', () => {
  it('loads from the client when the cache was never loaded, then reads succeed', async () => {
    const { client, raw } = fakeClient(ROW);
    expect(() => getInstitution()).toThrow();
    await ensureOrganizationLoaded(client);
    expect(getInstitution().nameEn).toBe('Example University');
    expect(raw.organizationProfile.findUnique).toHaveBeenCalledTimes(1);
  });

  it('is a no-op once loaded and shares one in-flight load across callers', async () => {
    const { client, raw } = fakeClient(ROW);
    await Promise.all([ensureOrganizationLoaded(client), ensureOrganizationLoaded(client)]);
    await ensureOrganizationLoaded(client);
    expect(raw.organizationProfile.findUnique).toHaveBeenCalledTimes(1);
  });

  it('retries on the next call after a failed load', async () => {
    const { client, raw } = fakeClient(ROW);
    raw.organizationProfile.findUnique.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(ensureOrganizationLoaded(client)).rejects.toThrow('ECONNREFUSED');
    await ensureOrganizationLoaded(client);
    expect(getInstitution().nameEn).toBe('Example University');
  });
});

describe('saveOrganizationBrand', () => {
  it('stores colours and tokens under the version lock', async () => {
    const { client } = fakeClient(ROW);
    const tokens = { light: { 'accent-default': '70.0% 0.150 45' }, dark: {} } as unknown as Parameters<typeof saveOrganizationBrand>[1];
    const saved = await saveOrganizationBrand({ primaryColor: '#f26522', secondaryColor: null, expectedVersion: 1 }, tokens, 'u1', client);
    expect(saved.version).toBe(2);
    expect(saved.primaryColor).toBe('#f26522');
    expect(saved.brandTokensJson).toEqual(tokens);
    await expect(
      saveOrganizationBrand({ primaryColor: null, secondaryColor: null, expectedVersion: 1 }, null, 'u2', client),
    ).rejects.toBeInstanceOf(OrganizationVersionConflictError);
  });

  it('refuses when no profile exists', async () => {
    const { client } = fakeClient(null);
    await expect(
      saveOrganizationBrand({ primaryColor: null, secondaryColor: null, expectedVersion: 1 }, null, 'u1', client),
    ).rejects.toBeInstanceOf(OrganizationNotConfiguredError);
  });
});

describe('setOrganizationAsset', () => {
  it('sets and clears a key, bumping the version each time', async () => {
    const { client } = fakeClient(ROW);
    const a = await setOrganizationAsset('logo-light', 'logo-light/abc.png', 'u1', client);
    expect(a.logoLightKey).toBe('logo-light/abc.png');
    expect(a.version).toBe(2);
    const b = await setOrganizationAsset('logo-light', null, 'u1', client);
    expect(b.logoLightKey).toBeNull();
    expect(b.version).toBe(3);
  });

  it('refuses when no profile exists', async () => {
    const { client } = fakeClient(null);
    await expect(setOrganizationAsset('favicon', 'favicon/x.png', 'u1', client)).rejects.toBeInstanceOf(
      OrganizationNotConfiguredError,
    );
  });
});

describe('brandAssetUrls', () => {
  it('returns version-stamped same-origin URLs only for assets that exist', () => {
    expect(brandAssetUrls({ logoLightKey: 'k', logoDarkKey: null, faviconKey: 'f', version: 7 })).toEqual({
      logoLightUrl: '/brand/logo-light?v=7',
      logoDarkUrl: null,
      faviconUrl: '/brand/favicon?v=7',
    });
  });
});
