import { describe, expect, it } from 'vitest';
import { ProgramDetailDataSchema } from '../../src/templates/program-detail/schema';
import FIXTURE from './fixture.json';

// The fixture is a real payload captured from buildProgramDetailData()
// against KKU-SEQ-0065 (Civil Engineering, id cmon1wyw1003lzh90a5cdurkf) —
// a data-rich program chosen deliberately so most sections have real data
// rather than nulls. Faculty roster names were scrubbed to 'REDACTED'
// before commit; the fixture only exercises shape, not identity.
//
// This file grows one `describe` block per converted field group as
// Task 2's per-section commits land. Each numeric field converted away
// from a pre-formatted string must be proven to:
//   1. accept a real number
//   2. accept null (data absent — the '—' placeholder case)
//   3. reject a pre-formatted string (the whole point of the refactor)
//   4. reject NaN (z.number() alone accepts NaN; .finite() is required)

describe('ProgramDetailDataSchema', () => {
  it('accepts a real captured payload', () => {
    const parsed = ProgramDetailDataSchema.safeParse(FIXTURE);
    if (!parsed.success) console.error(parsed.error.issues.slice(0, 10));
    expect(parsed.success).toBe(true);
  });
});
