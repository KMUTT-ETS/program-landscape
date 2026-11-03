import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { seedReference, tagSkillSectors } from '../src/seed-reference';

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the delegates the reference seed touches. */
function makeFake() {
  const store = {
    sector: new Map<string, Row>(),
    costMethodology: new Map<string, Row>(),
    externalAiSource: new Map<string, Row>(),
    skill: new Map<string, Row>(),
    skillSector: new Map<string, Row>(),
  };
  let n = 0;
  const upsertBy = (map: Map<string, Row>, key: string, create: Row, update: Row) => {
    const cur = map.get(key);
    if (cur) {
      Object.assign(cur, update);
      return cur;
    }
    const row = { id: `id${++n}`, ...create };
    map.set(key, row);
    return row;
  };
  const client = {
    sector: {
      upsert: async (a: { where: { code: string }; create: Row; update: Row }) =>
        upsertBy(store.sector, a.where.code, a.create, a.update),
      findMany: async () => [...store.sector.values()],
    },
    costMethodology: {
      findUnique: async (a: { where: { version: string } }) => store.costMethodology.get(a.where.version) ?? null,
      upsert: async (a: { where: { version: string }; create: Row; update: Row }) =>
        upsertBy(store.costMethodology, a.where.version, a.create, a.update),
    },
    externalAiSource: {
      upsert: async (a: { where: { slug: string }; create: Row; update: Row }) =>
        upsertBy(store.externalAiSource, a.where.slug, a.create, a.update),
    },
    skill: { findMany: async () => [...store.skill.values()] },
    skillSector: {
      upsert: async (a: {
        where: { skillId_sectorId: { skillId: string; sectorId: string } };
        create: Row;
        update: Row;
      }) => {
        const k = `${a.where.skillId_sectorId.skillId}:${a.where.skillId_sectorId.sectorId}`;
        return upsertBy(store.skillSector, k, a.create, a.update);
      },
    },
  };
  return { store, client: client as unknown as PrismaClient };
}

describe('seedReference', () => {
  it('is idempotent and never overwrites', async () => {
    const { store, client } = makeFake();
    const first = await seedReference(client);
    expect(first.sectors).toBe(8);
    expect(first.costMethodology).toBe('created');
    expect(store.sector.size).toBe(8);

    store.sector.get('SC-MED')!.demandMultiplier = 9.9;
    store.costMethodology.get('v1')!.description = 'edited by finance';
    store.externalAiSource.values().next().value!.status = 'ACTIVE';

    const second = await seedReference(client);
    expect(second.costMethodology).toBe('kept');
    expect(store.sector.size).toBe(8);
    expect(store.sector.get('SC-MED')!.demandMultiplier).toBe(9.9);
    expect(store.costMethodology.get('v1')!.description).toBe('edited by finance');
    expect(store.externalAiSource.values().next().value!.status).toBe('ACTIVE');
  });

  it('contains nothing KKU-named', async () => {
    const { store, client } = makeFake();
    await seedReference(client);
    const source = readFileSync(join(__dirname, '../src/seed-reference.ts'), 'utf8');
    const written = JSON.stringify([...store.sector.values(), ...store.costMethodology.values(), ...store.externalAiSource.values()]);
    expect(source).not.toMatch(/KKU|kku\.ac\.th|ขอนแก่น|มข\./);
    expect(written).not.toMatch(/KKU|kku\.ac\.th|ขอนแก่น|มข\./);
  });
});

describe('tagSkillSectors', () => {
  it('tags by keyword', async () => {
    const { store, client } = makeFake();
    await seedReference(client);
    store.skill.set('a', { id: 's1', code: 'ztest-a', nameEn: 'ztest solar panel design' });
    store.skill.set('b', { id: 's2', code: 'ztest-b', nameEn: 'ztest nursing care' });
    const { ensured } = await tagSkillSectors(client);
    const idOf = (c: string) => store.sector.get(c)!.id;
    const pairs = [...store.skillSector.values()].map((r) => `${r.skillId}:${r.sectorId}`);
    expect(pairs).toContain(`s1:${idOf('BCG-GREEN')}`);
    expect(pairs).toContain(`s2:${idOf('SC-MED')}`);
    expect(ensured).toBe(pairs.length);
    // re-run does not duplicate
    await tagSkillSectors(client);
    expect(store.skillSector.size).toBe(pairs.length);
  });
});
