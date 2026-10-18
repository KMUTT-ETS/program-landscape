import 'reflect-metadata';

import type { SessionUser } from '@kku/shared';
import { describe, expect, it, vi } from 'vitest';

import { AUDIT_LOG_META, PERMISSION_META } from '../src/common/decorators';
import { ImportController } from '../src/import/import.controller';
import type { ImportService } from '../src/import/import.service';

const user = { userId: 'user-1', role: 'SYSTEM_ADMIN' } as SessionUser;

function stubService(overrides: Partial<Record<keyof ImportService, unknown>> = {}) {
  return {
    uploadFile: vi.fn(async () => ({
      batchId: 'b1', deduplicated: false, rowCount: 1, inserted: 1, updated: 0, deleted: 0,
    })),
    getTemplate: vi.fn(async () => ({ filename: 'faculties-template-2026-10-18.xlsx', bytes: Buffer.from('x') })),
    listDatasets: vi.fn(async () => []),
    getDataset: vi.fn(async () => ({ slug: 'faculties' })),
    startOver: vi.fn(async () => ({ rowsDeleted: 2, batchesCleared: 1 })),
    ...overrides,
  } as unknown as ImportService & Record<string, ReturnType<typeof vi.fn>>;
}

function permissionOf(method: string): string | undefined {
  const handler = (ImportController.prototype as unknown as Record<string, () => void>)[method];
  return Reflect.getMetadata(PERMISSION_META, handler) as string | undefined;
}

function auditOf(method: string): { action: string; entityType: string } | undefined {
  const handler = (ImportController.prototype as unknown as Record<string, () => void>)[method];
  return Reflect.getMetadata(AUDIT_LOG_META, handler) as { action: string; entityType: string } | undefined;
}

describe('ImportController — upload', () => {
  it('rejects a request with no file, naming the expected field', async () => {
    const service = stubService();
    const controller = new ImportController(service);
    await expect(
      controller.upload('faculties', undefined, { allowShrink: false }, user),
    ).rejects.toThrow(/file/);
  });

  it('recovers a latin1-encoded Thai filename', async () => {
    const service = stubService();
    const controller = new ImportController(service);
    const thai = 'คณะ.xlsx';
    const mangled = Buffer.from(thai, 'utf8').toString('latin1');

    await controller.upload('faculties', { originalname: mangled, buffer: Buffer.from('x') }, { allowShrink: false }, user);

    const call = service.uploadFile.mock.calls[0]?.[0] as { originalFilename: string };
    expect(call.originalFilename).toBe(thai);
  });

  it('passes allowShrink through from the query', async () => {
    const service = stubService();
    const controller = new ImportController(service);
    await controller.upload('faculties', { originalname: 'a.xlsx', buffer: Buffer.from('x') }, { allowShrink: true }, user);

    const call = service.uploadFile.mock.calls[0]?.[0] as { allowShrink: boolean; uploadedByUserId: string };
    expect(call.allowShrink).toBe(true);
    expect(call.uploadedByUserId).toBe('user-1');
  });
});

describe('ImportController — template', () => {
  it('sets a download filename and the spreadsheet content type', async () => {
    const service = stubService();
    const controller = new ImportController(service);
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      send: vi.fn(),
    };

    await controller.template('faculties', {}, res as never);

    expect(headers['Content-Disposition']).toContain('faculties-template-2026-10-18.xlsx');
    expect(headers['Content-Type']).toContain('spreadsheetml');
    expect(res.send).toHaveBeenCalled();
  });
});

describe('ImportController — start over', () => {
  it('forwards the confirmation name', async () => {
    const service = stubService();
    const controller = new ImportController(service);
    await controller.startOver('faculties', { confirmName: 'Faculties' }, user);
    expect(service.startOver).toHaveBeenCalledWith('faculties', 'Faculties', 'user-1');
  });
});

describe('ImportController — guards', () => {
  it('gates each handler with the intended permission', () => {
    expect(permissionOf('list')).toBe('data_sources:read');
    expect(permissionOf('detail')).toBe('data_sources:read');
    expect(permissionOf('template')).toBe('data_sources:read');
    expect(permissionOf('upload')).toBe('data_sources:configure');
    // Destructive, so NOT the permission routine uploads use.
    expect(permissionOf('startOver')).toBe('imports:destroy');
  });

  it('audit-logs both mutating handlers', () => {
    expect(auditOf('upload')).toEqual({ action: 'import.upload', entityType: 'ImportBatch' });
    expect(auditOf('startOver')).toEqual({ action: 'import.start_over', entityType: 'ImportBatch' });
  });

  it('does not audit-log the read handlers', () => {
    expect(auditOf('list')).toBeUndefined();
    expect(auditOf('template')).toBeUndefined();
  });
});
