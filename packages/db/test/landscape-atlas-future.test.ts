import { describe, expect, it } from 'vitest';
import {
  buildCoverage,
  buildFuture,
  buildScorecard,
  type ScorecardInput,
  type ScorecardProgrammeInput,
} from '../src/landscape-atlas/future';

const prog = (over: Partial<ScorecardProgrammeInput>): ScorecardProgrammeInput => ({
  programId: 'p',
  code: 'P',
  nameTh: 'หลักสูตร',
  nameEn: 'Programme',
  level: 'BACHELOR',
  facultyId: 'f',
  facultyNameTh: 'คณะ',
  facultyNameEn: 'Faculty',
  aiReadiness: 50,
  relevance: 50,
  dq: 50,
  dqStudents: 100,
  ...over,
});

const input = (programmes: ScorecardProgrammeInput[], over: Partial<ScorecardInput> = {}): ScorecardInput => ({
  programmes,
  facultyDq: new Map(),
  totalDq: { value: null, students: 0 },
  scopeLevel: 'university',
  ...over,
});

describe('buildScorecard tree', () => {
  it('nests faculty → level → programme, levels in fixed order, only levels that exist', () => {
    const out = buildScorecard(
      input([
        prog({ programId: 'd1', level: 'DOCTORAL' }),
        prog({ programId: 'm1', level: 'MASTER' }),
        prog({ programId: 'b1', level: 'BACHELOR' }),
        prog({ programId: 'h1', level: 'HIGHER_GRAD_DIPLOMA' }),
      ]),
    );
    expect(out.rows).toHaveLength(1);
    const f = out.rows[0]!;
    expect(f.kind).toBe('faculty');
    expect(f.children.map((l) => [l.kind, l.label])).toEqual([
      ['level', 'Bachelor'],
      ['level', 'Master'],
      ['level', 'Doctoral'],
      ['level', 'Higher grad diploma'],
    ]);
    const b = f.children[0]!.children;
    expect(b.map((p) => [p.kind, p.id, p.href, p.children.length])).toEqual([['programme', 'b1', '/programs/b1', 0]]);
    expect(out.columns).toEqual(['AI readiness', 'Digital intelligence (DQ)', 'Relevance']);
  });

  it('programme DQ only for bachelor; level DQ = faculty rollup on Bachelor only', () => {
    const out = buildScorecard(
      input(
        [
          prog({ programId: 'b1', level: 'BACHELOR', dq: 72 }),
          prog({ programId: 'm1', level: 'MASTER', dq: 99 }),
        ],
        { facultyDq: new Map([['f', { value: 64, students: 300 }]]) },
      ),
    );
    const f = out.rows[0]!;
    expect(f.cells[1]).toBe(64);
    const [bach, mast] = f.children;
    expect(bach!.cells[1]).toBe(64);
    expect(mast!.cells[1]).toBeNull();
    expect(bach!.children[0]!.cells[1]).toBe(72);
    expect(mast!.children[0]!.cells[1]).toBeNull();
  });

  it('faculty AI/relevance are means over programmes, not over level means', () => {
    const out = buildScorecard(
      input([
        prog({ programId: 'b1', level: 'BACHELOR', aiReadiness: 10, relevance: 10 }),
        prog({ programId: 'b2', level: 'BACHELOR', aiReadiness: 20, relevance: 20 }),
        prog({ programId: 'b3', level: 'BACHELOR', aiReadiness: 30, relevance: 30 }),
        prog({ programId: 'm1', level: 'MASTER', aiReadiness: 100, relevance: null }),
      ]),
    );
    const f = out.rows[0]!;
    // programmes: (10+20+30+100)/4 = 40 ; level means would give (20+100)/2 = 60
    expect(f.cells[0]).toBe(40);
    expect(f.cells[2]).toBe(20);
    expect(f.children[1]!.cells[2]).toBeNull();
  });

  it('sorts programmes by mean desc then label; null-mean last', () => {
    const out = buildScorecard(
      input([
        prog({ programId: 'x', nameTh: 'ข', aiReadiness: null, relevance: null, dq: null }),
        prog({ programId: 'lo', nameTh: 'ก', aiReadiness: 10, relevance: 10, dq: 10 }),
        prog({ programId: 'hi', nameTh: 'ค', aiReadiness: 90, relevance: 90, dq: 90 }),
      ]),
    );
    expect(out.rows[0]!.children[0]!.children.map((p) => [p.id, p.mean, p.present])).toEqual([
      ['hi', 90, 3],
      ['lo', 10, 3],
      ['x', null, 0],
    ]);
  });

  it('sorts faculties by mean desc and puts all-blank faculties last', () => {
    const out = buildScorecard(
      input([
        prog({ programId: '1', facultyId: 'blank', aiReadiness: null, relevance: null }),
        prog({ programId: '2', facultyId: 'lo', aiReadiness: 20, relevance: 40 }),
        prog({ programId: '3', facultyId: 'hi', aiReadiness: 90, relevance: 70 }),
      ], {
        facultyDq: new Map([['hi', { value: 80, students: 10 }]]),
      }),
    );
    expect(out.rows.map((r) => [r.id, r.mean, r.present])).toEqual([
      ['hi', 80, 3],
      ['lo', 30, 2],
      ['blank', null, 0],
    ]);
    expect(out.rows[1]!.cells).toEqual([20, null, 40]);
  });

  it('total row: means over all programmes, total DQ, label by scope, not expandable', () => {
    const programmes = [
      prog({ programId: 'a1', facultyId: 'a', aiReadiness: 10, relevance: 50 }),
      prog({ programId: 'a2', facultyId: 'a', aiReadiness: 20, relevance: null }),
      prog({ programId: 'a3', facultyId: 'a', aiReadiness: 30, relevance: null }),
      prog({ programId: 'b1', facultyId: 'b', aiReadiness: 100, relevance: 70 }),
    ];
    const out = buildScorecard(input(programmes, { totalDq: { value: 61, students: 900 } }));
    // over programmes: AI (10+20+30+100)/4 = 40 ; faculty means would give (20+100)/2 = 60
    expect(out.total.kind).toBe('total');
    expect(out.total.label).toBe('University average');
    expect(out.total.cells).toEqual([40, 61, 60]);
    expect(out.total.mean).toBe(53.7);
    expect(out.total.present).toBe(3);
    expect(out.total.children).toEqual([]);
    for (const [level, label] of [
      ['faculty', 'Faculty average'],
      ['department', 'Department average'],
      ['program', 'Programme average'],
    ] as const) {
      expect(buildScorecard(input(programmes, { scopeLevel: level })).total.label).toBe(label);
    }
  });

  it('missing values stay null, never 0', () => {
    const out = buildScorecard(input([prog({ aiReadiness: null, relevance: null, dq: null })]));
    expect(out.total.cells).toEqual([null, null, null]);
    expect(out.total.mean).toBeNull();
    expect(out.rows[0]!.cells).toEqual([null, null, null]);
    expect(out.rows[0]!.children[0]!.cells).toEqual([null, null, null]);
  });

  it('gives no note when fewer than 4 faculties have at least 2 of 3 measures', () => {
    const out = buildScorecard(
      input([
        prog({ programId: '1', facultyId: 'a', facultyNameEn: 'A', aiReadiness: 90, relevance: 90 }),
        prog({ programId: '2', facultyId: 'b', facultyNameEn: 'B', aiReadiness: 10, relevance: null }),
        prog({ programId: '3', facultyId: 'c', facultyNameEn: 'C', aiReadiness: 5, relevance: null }),
      ]),
    );
    expect(out.note).toBeNull();
  });

  it('names the bottom 3 faculties, lowest first, when at least 4 qualify', () => {
    const out = buildScorecard(
      input(
        [90, 70, 50, 30, 10].map((v, i) =>
          prog({ programId: `p${i}`, facultyId: 'ABCDE'[i]!, facultyNameEn: 'ABCDE'[i]!, aiReadiness: v, relevance: v }),
        ),
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
      input([]),
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
      input([]),
      {
        faculties: fac,
        sectors: secs,
        counts: [
          { facultyId: 'f1', sectorId: 's1', programmes: 15 },
          { facultyId: 'f1', sectorId: 's2', programmes: 20 },
        ],
      },
      'now',
    );
    expect(out.answer).toEqual({
      figure: '2 of 2',
      sentence: 'national strategic sectors are fed by 15 or more programmes.',
    });
  });

  it('uses the singular for exactly one thin sector that has some programmes', () => {
    const out = buildFuture(
      input([]),
      {
        faculties: fac,
        sectors: secs,
        counts: [
          { facultyId: 'f1', sectorId: 's1', programmes: 5 },
          { facultyId: 'f1', sectorId: 's2', programmes: 20 },
        ],
      },
      'now',
    );
    expect(out.answer).toEqual({
      figure: '1 of 2',
      sentence: 'national strategic sector is fed by fewer than 15 programmes.',
    });
  });

  it('non-university scope: counts sectors fed by any programme, no thin threshold', () => {
    const out = buildFuture(
      input([], { scopeLevel: 'faculty' }),
      {
        faculties: fac,
        sectors: secs,
        counts: [{ facultyId: 'f1', sectorId: 's1', programmes: 2 }],
      },
      'now',
    );
    expect(out.answer).toEqual({
      figure: '1 of 2',
      sentence: 'national strategic sectors are fed by programmes in this scope; none mapped for Green economy.',
    });
  });

  it('non-university scope: all sectors fed ends with a full stop', () => {
    const out = buildFuture(
      input([], { scopeLevel: 'faculty' }),
      {
        faculties: fac,
        sectors: secs,
        counts: [
          { facultyId: 'f1', sectorId: 's1', programmes: 1 },
          { facultyId: 'f1', sectorId: 's2', programmes: 1 },
        ],
      },
      'now',
    );
    expect(out.answer).toEqual({
      figure: '2 of 2',
      sentence: 'national strategic sectors are fed by programmes in this scope.',
    });
  });
});
