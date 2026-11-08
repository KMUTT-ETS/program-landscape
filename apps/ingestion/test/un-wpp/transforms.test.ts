import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  WppSchemaError,
  aggregateWppLines,
  gunzipLines,
  parseCsvLine,
} from '../../src/connectors/sources/un-wpp/transforms';

const HEADER =
  'LocID,ISO3_code,Location,VarID,Variant,Time,AgeGrp,AgeGrpStart,AgeGrpSpan,PopMale,PopFemale,PopTotal';
const line = (iso: string, variant: string, year: number, age: number, total: string, loc = 'Thailand'): string =>
  `764,${iso},${loc},2,${variant},${year},${age},${age},1,1,1,${total}`;

function gz(lines: string[], bom = true): Readable {
  const text = (bom ? '﻿' : '') + lines.join('\n') + '\n';
  return Readable.from([gzipSync(Buffer.from(text, 'utf8'))]);
}

const FILTER = { iso3: 'THA', fromYear: 2026, toYear: 2051 };

describe('UN WPP transforms', () => {
  it('parses quoted fields with commas and doubled quotes', () => {
    expect(parseCsvLine('1,"Korea, Rep. of","say ""hi""",4')).toEqual(['1', 'Korea, Rep. of', 'say "hi"', '4']);
  });

  it('aggregates single ages into cohorts', async () => {
    const rows = await aggregateWppLines(
      gunzipLines(
        gz([
          HEADER,
          line('THA', 'Medium', 2026, 15, '10'),
          line('THA', 'Medium', 2026, 17, '20'),
          line('THA', 'Medium', 2026, 18, '1'),
          line('THA', 'Medium', 2026, 22, '2'),
          line('THA', 'Medium', 2026, 23, '3'),
          line('THA', 'Medium', 2026, 29, '4'),
          line('THA', 'Medium', 2026, 30, '999'),
          line('THA', 'Medium', 2026, 14, '999'),
        ]),
      ),
      FILTER,
    );
    expect(rows).toEqual([
      { year: 2026, ageCohort: '15-17', population: 30_000 },
      { year: 2026, ageCohort: '18-22', population: 3_000 },
      { year: 2026, ageCohort: '23-29', population: 7_000 },
    ]);
  });

  it('multiplies thousands and rounds to persons', async () => {
    const rows = await aggregateWppLines(
      gunzipLines(gz([HEADER, line('THA', 'Medium', 2030, 18, '1234.567')])),
      FILTER,
    );
    expect(rows).toEqual([{ year: 2030, ageCohort: '18-22', population: 1_234_567 }]);
  });

  it('ignores other countries, other variants, out-of-window years and the BOM', async () => {
    const rows = await aggregateWppLines(
      gunzipLines(
        gz([
          HEADER,
          line('VNM', 'Medium', 2026, 18, '500', 'Viet Nam'),
          line('THA', 'High', 2026, 18, '500'),
          line('THA', 'Medium', 2025, 18, '500'),
          line('THA', 'Medium', 2052, 18, '500'),
          line('THA', 'Medium', 2026, 18, '5'),
        ]),
      ),
      FILTER,
    );
    expect(rows).toEqual([{ year: 2026, ageCohort: '18-22', population: 5_000 }]);
  });

  it('reports a missing column as schema drift', async () => {
    await expect(
      aggregateWppLines(gunzipLines(gz(['A,B', '1,2'])), FILTER),
    ).rejects.toBeInstanceOf(WppSchemaError);
  });
});
