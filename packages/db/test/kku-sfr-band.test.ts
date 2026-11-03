import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SfrBand } from '@prisma/client';

import { KKU_SFR_BANDS, backfillKkuSfrBands, type SfrBackfillClient } from '../src/kku-sfr-band';

interface Row {
  code: string;
  nameTh: string;
  sfrBand: SfrBand | null;
}

function fakeClient(rows: Row[]): SfrBackfillClient {
  return {
    faculty: {
      updateMany: async ({ where, data }: { where: { code: string; nameTh: string; sfrBand: null }; data: { sfrBand: SfrBand } }) => {
        let count = 0;
        for (const r of rows) {
          if (r.code === where.code && r.nameTh === where.nameTh && r.sfrBand === null) {
            r.sfrBand = data.sfrBand;
            count++;
          }
        }
        return { count };
      },
    },
  } as unknown as SfrBackfillClient;
}

const kku = (code: string): { code: string; nameTh: string } => {
  const e = KKU_SFR_BANDS.find((p) => p.code === code);
  if (!e) throw new Error(code);
  return { code: e.code, nameTh: e.nameTh };
};

describe('backfillKkuSfrBands', () => {
  it('sets bands on KKU-named faculties only', async () => {
    const rows: Row[] = [
      { ...kku('MD'), sfrBand: null },
      { ...kku('EN'), sfrBand: null },
      { code: 'EN', nameTh: 'Adopter Engineering', sfrBand: null },
    ];
    const res = await backfillKkuSfrBands(fakeClient(rows));
    expect(res.updated).toBe(2);
    expect(rows.map((r) => r.sfrBand)).toEqual(['CLINICAL', 'STEM_LAB', null]);
  });

  it('never overwrites a stored band', async () => {
    const rows: Row[] = [{ ...kku('MD'), sfrBand: 'HUMANITIES' }];
    const res = await backfillKkuSfrBands(fakeClient(rows));
    expect(res.updated).toBe(0);
    expect(rows[0]?.sfrBand).toBe('HUMANITIES');
  });
});

describe('faculty_sfr_band migration', () => {
  const sql = readFileSync(
    path.join(__dirname, '..', 'prisma', 'migrations', '20261103120000_faculty_sfr_band', 'migration.sql'),
    'utf8',
  );
  const updates = sql.split('UPDATE').slice(1);

  it('does not depend on the organisation profile', () => {
    expect(sql).not.toMatch(/organization_profile/);
  });

  it('every UPDATE is null-guarded', () => {
    expect(updates.length).toBe(5);
    for (const u of updates) expect(u).toContain('"sfr_band" IS NULL');
  });

  it('every UPDATE matches code and KKU Thai name; pairs equal the exported constant', () => {
    const found: Array<{ code: string; nameTh: string; band: string }> = [];
    for (const u of updates) {
      const band = /SET "sfr_band" = '(\w+)'/.exec(u)?.[1] ?? '';
      for (const m of u.matchAll(/\("code" = '(\w+)' AND "name_th" = '([^']+)'\)/g)) {
        found.push({ code: m[1] ?? '', nameTh: m[2] ?? '', band });
      }
    }
    const byCode = (a: { code: string }, b: { code: string }): number => a.code.localeCompare(b.code);
    expect([...found].sort(byCode)).toEqual([...KKU_SFR_BANDS].sort(byCode));
  });
});
