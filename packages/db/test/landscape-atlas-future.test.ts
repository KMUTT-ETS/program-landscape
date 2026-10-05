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

  it('names the lowest faculties that have at least 2 of 3 measures', () => {
    const out = buildScorecard([
      s({ facultyId: 'a', nameEn: 'A', aiReadiness: 90, dq: 90, relevance: 90 }),
      s({ facultyId: 'b', nameEn: 'B', aiReadiness: 10, dq: 10, relevance: null }),
      s({ facultyId: 'c', nameEn: 'C', aiReadiness: 5, dq: null, relevance: null }),
    ]);
    expect(out.note).toBe('Lowest on the measures available: B, A.');
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
    );
    expect(out.answer).toEqual({
      figure: '2 of 2',
      sentence:
        '2 of 2 national strategic sectors are fed by fewer than 15 programmes; Digital economy, Green economy by none we can map.',
    });
  });
});
