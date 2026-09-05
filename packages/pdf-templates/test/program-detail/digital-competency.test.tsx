import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderDigitalCompetencySection } from '../../src/templates/program-detail/sections/digital-competency';
import {
  ProgramDetailDataSchema,
  type ProgramDetailData,
} from '../../src/templates/program-detail/schema';

// The four DQ states are the whole point of this section: three of them
// look superficially like "no number to show", and collapsing any two
// would make the report state something false about the programme.

const MINIMAL_BASE = {
  programCode: 'KKU-SEQ-9999',
  nameTh: 'หลักสูตรทดสอบวิศวกรรมทดสอบ',
  nameEn: 'Test Program in Testing Engineering',
  level: 'Bachelor',
  status: 'ACTIVE',
  facultyTh: 'คณะทดสอบ',
  facultyEn: 'Faculty of Testing',
  dateLabel: '2026-01-01',
  generatedAtLabel: 'January 1, 2026 at 9:00 AM',
  methodologyVersion: 'health-score.v3.8',
};

function parse(overrides: Record<string, unknown> = {}): ProgramDetailData {
  return ProgramDetailDataSchema.parse({ ...MINIMAL_BASE, ...overrides });
}

const OK_PAYLOAD = {
  status: 'ok',
  rawMean: 62.4,
  driverScore: 55,
  scoredStudents: 128,
  passRatePct: 41.2,
  minCellStudents: 6,
  passMark: 70,
  modules: [
    { moduleNo: 1, label: 'Digital Citizen', mean: 70.1, universityMean: 66.2 },
    { moduleNo: 2, label: 'Digital Creativity', mean: 48.9, universityMean: 59.4 },
  ],
  weakest: [{ label: 'Digital Creativity', mean: 48.9 }],
  methodologyVersion: 'student-dq.v2',
};

describe('renderDigitalCompetencySection', () => {
  it('renders nothing when the programme has no DQ payload at all', () => {
    expect(renderDigitalCompetencySection(parse())).toBeNull();
  });

  // The distinction this section exists to protect: a master's programme
  // must show no score AND no empty box, because DQ is an undergraduate
  // instrument. An empty box would invite "why did they score nothing?".
  it('renders nothing — not an empty state — when DQ does not apply', () => {
    const data = parse({
      digitalCompetency: { ...OK_PAYLOAD, status: 'not-applicable', scoredStudents: 0 },
    });
    expect(renderDigitalCompetencySection(data)).toBeNull();
  });

  it('says the programme was never covered when there is no data', () => {
    const data = parse({
      digitalCompetency: { ...OK_PAYLOAD, status: 'no-data', scoredStudents: 0, rawMean: null },
    });
    const html = renderToStaticMarkup(renderDigitalCompetencySection(data)!);
    expect(html).toContain('Digital competency');
    expect(html).toMatch(/no scored students|never/i);
  });

  // Below the floor the COUNT is reported and the score is not — telling a
  // programme with four tested students that it was never tested is the
  // false claim this branch prevents.
  it('states the tested-student count but withholds the score below the floor', () => {
    const data = parse({
      digitalCompetency: {
        ...OK_PAYLOAD,
        status: 'below-floor',
        scoredStudents: 4,
        rawMean: null,
        passRatePct: null,
      },
    });
    const html = renderToStaticMarkup(renderDigitalCompetencySection(data)!);
    expect(html).toContain('4 students');
    expect(html).toContain('withheld');
    // The suppression floor is quoted from the payload, not hardcoded here.
    expect(html).toContain('6');
  });

  it('renders headline stats, every module row and the weakest modules when ok', () => {
    const data = parse({ digitalCompetency: OK_PAYLOAD });
    const html = renderToStaticMarkup(renderDigitalCompetencySection(data)!);
    expect(html).toContain('Digital competency');
    // Both the programme mean and the university comparison must appear —
    // the radar alone cannot carry the second series.
    expect(html).toContain('Digital Citizen');
    expect(html).toContain('Digital Creativity');
    // formatScore renders whole numbers, the same convention every
    // other section uses.
    expect(html).toContain('66');
    expect(html).toContain('Weakest modules');
    expect(html).toContain('128');
    // Pass mark is disclosed wherever the pass rate is shown.
    expect(html).toContain('70');
  });

  // Guards the contradiction found while building this: with fewer than
  // three modules the Radar falls back to an empty state reading "no
  // per-module results", directly above a table listing those results.
  it('drops the chart below the radar minimum without claiming there is no data', () => {
    const data = parse({
      digitalCompetency: {
        ...OK_PAYLOAD,
        modules: [
          { moduleNo: 1, label: 'Digital Citizen', mean: 70.1, universityMean: 66.2 },
          { moduleNo: 2, label: 'Digital Creativity', mean: 48.9, universityMean: 59.4 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderDigitalCompetencySection(data)!);
    expect(html).toContain('Digital Citizen');
    expect(html).toContain('Digital Creativity');
    expect(html).not.toContain('chart-empty');
    expect(html).not.toMatch(/No per-module results/i);
  });

  it('shows a module with no result as a dash rather than a zero', () => {
    const data = parse({
      digitalCompetency: {
        ...OK_PAYLOAD,
        modules: [{ moduleNo: 3, label: 'Digital Rights', mean: null, universityMean: 61.0 }],
        weakest: [],
      },
    });
    const html = renderToStaticMarkup(renderDigitalCompetencySection(data)!);
    expect(html).toContain('Digital Rights');
    expect(html).not.toMatch(/>0<|>0\.0</);
  });
});
