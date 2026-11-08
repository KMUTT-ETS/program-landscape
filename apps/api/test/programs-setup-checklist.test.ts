import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PERMISSION_META, PROVENANCE_META } from '../src/common/decorators';

const mocks = vi.hoisted(() => ({ programSetupChecklist: vi.fn() }));

vi.mock('@kku/db', async () => {
  const actual = await vi.importActual<typeof import('@kku/db')>('@kku/db');
  return { ...actual, programSetupChecklist: mocks.programSetupChecklist };
});

const { ProgramsAdminController } = await import('../src/programs/programs-admin.controller');

describe('GET /admin/programs/:id/setup-checklist', () => {
  beforeEach(() => mocks.programSetupChecklist.mockReset());
  const controller = new ProgramsAdminController({} as never);

  it('is gated on programs:manage:all and carries provenance', () => {
    const handler = ProgramsAdminController.prototype.setupChecklist;
    expect(Reflect.getMetadata(PERMISSION_META, handler)).toBe('programs:manage:all');
    expect(Reflect.getMetadata(PROVENANCE_META, handler)).toBeDefined();
  });

  it('returns the checklist for the programme id', async () => {
    const checklist = { programId: 'p1', items: [], summary: { ok: 0, empty: 0, notApplicable: 0, degraded: 0 } };
    mocks.programSetupChecklist.mockResolvedValue(checklist);
    await expect(controller.setupChecklist('p1')).resolves.toBe(checklist);
    expect(mocks.programSetupChecklist).toHaveBeenCalledWith('p1');
  });

  it('404s on an unknown programme', async () => {
    mocks.programSetupChecklist.mockResolvedValue(null);
    await expect(controller.setupChecklist('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
