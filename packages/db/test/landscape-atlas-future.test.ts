import { describe, expect, it } from 'vitest';
import { buildCoverage, buildFuture, buildScorecard, type ScorecardInput } from '../src/landscape-atlas/future';

const s = (over: Partial<ScorecardInput>): ScorecardInput => ({
  facultyId: 'f',
  code: 'F',
  nameTh: 'คณะ',
  nameEn: 'Faculty',
  aiReadiness: 50,
  dq: 50,
  dqStudents: 100,
  relevance: 50,
  ...over,
});

describe('buildScorecard', () => {
  it('averages only present columns, sorts by mean, and puts all-blank rows last', () => {
    const out = buildScorecard([
      s({ facultyId: 'blank', aiReadiness: null, dq: null, relevance: null }),
      s({ facultyId: 'lo', aiReadiness: 20, dq: null, relevance: 40 }),
      s({ facultyId: 'hi', aiReadiness: 90, dq: 80, relevance: 70 }),
    ]);
    expect(out.rows.map((r) => [r.id, r.mean, r.present])).toEqual([
      ['hi', 80, 3],
      ['lo', 30, 2],
      ['blank', null, 0],
    ]);
    expect(out.rows[1]!.cells).toEqual([20, null, 40]);
    expect(out.columns).toEqual(['AI readiness', 'Digital intelligence (DQ)', 'Relevance']);
  });

  it('gives no note when fewer than 4 faculties have at least 2 of 3 measures', () => {
    const out = buildScorecard([
      s({ facultyId: 'a', nameEn: 'A', aiReadiness: 90, dq: 90, relevance: 90 }),
      s({ facultyId: 'b', nameEn: 'B', aiReadiness: 10, dq: 10, relevance: null }),
      s({ facultyId: 'c', nameEn: 'C', aiReadiness: 5, dq: null, relevance: null }),
    ]);
    expect(out.note).toBeNull();
  });

  it('names the bottom 3 faculties, lowest first, when at least 4 qualify', () => {
    const out = buildScorecard(
      [90, 70, 50, 30, 10].map((v, i) =>
        s({ facultyId: 'ABCDE'[i]!, nameEn: 'ABCDE'[i]!, aiReadiness: v, dq: v, relevance: v }),
      ),
    );
    expect(out.note).toBe('Lowest on the measures available: E, D, C.');
  });
});

describe('buildCoverage', () => {
  it('counts programmes per faculty × sector, blank = not mapped, flags empty and thin sectors', () => {
    const out = buildCoverage({
      faculties: [{ id: 'f1', code: 'F1', nameTh: 'ก', nameEn: 'One' }],
      sectors: [
        { id: 's1', code: 'DIG', nameTh: 'ดิจิทัล', nameEn: 'Digital economy' },
        { id: 's2', code: 'GRN', nameTh: 'สีเขียว', nameEn: 'Green economy' },
      ],
      counts: [{ facultyId: 'f1', sectorId: 's1', programmes: 20 }],
    });
    expect(out.rows[0]!.cells).toEqual([20, null]);
    expect(out.columns.map((c) => [c.id, c.total])).toEqual([
      ['s1', 20],
      ['s2', 0],
    ]);
    expect(out.unmappedSectors).toEqual(['Green economy']);
    expect(out.thinSectors).toEqual(['Green economy']);
  });
});

describe('buildFuture answer', () => {
  it('reports thin sectors and names the unmapped ones', () => {
    const out = buildFuture(
      [],
      {
        faculties: [],
        sectors: [
          { id: 's1', code: 'A', nameTh: 'ก', nameEn: 'Digital economy' },
          { id: 's2', code: 'B', nameTh: 'ข', nameEn: 'Green economy' },
        ],
        counts: [],
      },
      'now',
      true,
    );
    expect(out.answer).toEqual({
      figure: '2 of 2',
      sentence:
        'national strategic sectors are fed by fewer than 15 programmes; Digital economy, Green economy by none we can map.',
    });
  });

  const fac = [{ id: 'f1', code: 'F1', nameTh: 'ก', nameEn: 'One' }];
  const secs = [
    { id: 's1', code: 'A', nameTh: 'ก', nameEn: 'Digital economy' },
    { id: 's2', code: 'B', nameTh: 'ข', nameEn: 'Green economy' },
  ];

  it('says all sectors are well fed when none is thin', () => {
    const out = buildFuture(
      [],
      {
        faculties: fac,
        sectors: secs,
        counts: [
          { facultyId: 'f1', sectorId: 's1', programmes: 15 },
          { facultyId: 'f1', sectorId: 's2', programmes: 20 },
        ],
      },
      'now',
      true,
    );
    expect(out.answer).toEqual({
      figure: '2 of 2',
      sentence: 'national strategic sectors are fed by 15 or more programmes.',
    });
  });

  it('uses the singular for exactly one thin sector that has some programmes', () => {
    const out = buildFuture(
      [],
      {
        faculties: fac,
        sectors: secs,
        counts: [
          { facultyId: 'f1', sectorId: 's1', programmes: 5 },
          { facultyId: 'f1', sectorId: 's2', programmes: 20 },
        ],
      },
      'now',
      true,
    );
    expect(out.answer).toEqual({
      figure: '1 of 2',
      sentence: 'national strategic sector is fed by fewer than 15 programmes.',
    });
  });

  it('non-university scope: counts sectors fed by any programme, no thin threshold', () => {
    const out = buildFuture(
      [],
      {
        faculties: fac,
        sectors: secs,
        counts: [{ facultyId: 'f1', sectorId: 's1', programmes: 2 }],
      },
      'now',
      false,
    );
    expect(out.answer).toEqual({
      figure: '1 of 2',
      sentence: 'national strategic sectors are fed by programmes in this scope; none mapped for Green economy.',
    });
  });

  it('non-university scope: all sectors fed ends with a full stop', () => {
    const out = buildFuture(
      [],
      {
        faculties: fac,
        sectors: secs,
        counts: [
          { facultyId: 'f1', sectorId: 's1', programmes: 1 },
          { facultyId: 'f1', sectorId: 's2', programmes: 1 },
        ],
      },
      'now',
      false,
    );
    expect(out.answer).toEqual({
      figure: '2 of 2',
      sentence: 'national strategic sectors are fed by programmes in this scope.',
    });
  });
});
