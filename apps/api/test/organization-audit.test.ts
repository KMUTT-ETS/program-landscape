import { describe, expect, it, vi } from 'vitest';
import { lastValueFrom, of } from 'rxjs';

const mocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({}) }));
vi.mock('@kku/db', () => ({
  prisma: { auditLog: { create: mocks.create } },
  Prisma: { JsonNull: null },
}));

import { AuditLogInterceptor } from '../src/common/audit-log.interceptor';
import { OrganizationAdminController } from '../src/organization/organization.controller';

const USER = { userId: 'u1' } as never;
const ASSET = { kind: 'logo-light', storageKey: 'logo-light/abc.png', sha256: 'abc', bytes: 10, contentType: 'image/png' };

async function audited(run: (req: Record<string, unknown>) => Promise<unknown>) {
  mocks.create.mockClear();
  const req: Record<string, unknown> = { body: {}, params: { kind: 'logo-light' }, headers: {}, socket: {} };
  const interceptor = new AuditLogInterceptor({ getAllAndOverride: () => ({ action: 'x', entityType: 'OrganizationProfile' }) } as never);
  const ctx = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as never;
  const result = await run(req);
  await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(result) }));
  return mocks.create.mock.calls[0][0].data;
}

describe('organization asset audit rows', () => {
  const service = {
    uploadAsset: vi.fn().mockResolvedValue({ id: 'default', profile: { id: 'default' }, asset: ASSET }),
    removeAsset: vi.fn().mockResolvedValue({ id: 'default', profile: { id: 'default' }, asset: { kind: 'logo-light' } }),
  };
  const controller = new OrganizationAdminController(service as never);

  it('records kind, key and sha256 for an upload, against the profile id', async () => {
    const data = await audited((req) =>
      controller.uploadAsset({ kind: 'logo-light' }, { buffer: Buffer.alloc(1) } as never, USER, req as never),
    );
    expect(data.entityId).toBe('default');
    expect(data.payloadJson).toMatchObject({ kind: 'logo-light', sha256: 'abc', storageKey: 'logo-light/abc.png' });
  });

  it('records kind for a removal', async () => {
    const data = await audited((req) => controller.removeAsset({ kind: 'logo-light' }, USER, req as never));
    expect(data.entityId).toBe('default');
    expect(data.payloadJson).toEqual({ kind: 'logo-light' });
  });
});
