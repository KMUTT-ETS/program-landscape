import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authorsFromScholarColumn } from '../src/staff-profile/profile';

describe('authorsFromScholarColumn', () => {
  it('turns a stored complete list into AuthorName[]', () => {
    expect(authorsFromScholarColumn({ names: ['GE Hinton', 'A Krizhevsky'], complete: true, fetchedAt: 'x' })).toEqual({
      authors: [
        { family: 'Hinton', given: null, initials: 'G.E.' },
        { family: 'Krizhevsky', given: null, initials: 'A.' },
      ],
      complete: true,
    });
  });
  it('keeps a shortened list marked incomplete', () => {
    expect(authorsFromScholarColumn({ names: ['D Soodphakdee'], complete: false, fetchedAt: 'x' })?.complete).toBe(false);
  });
  it('ignores the detail-attempt bookkeeping stored beside the list', () => {
    expect(
      authorsFromScholarColumn({
        names: ['D Soodphakdee'],
        complete: false,
        fetchedAt: 'x',
        detailAttempts: 3,
        detailAttemptedAt: '2026-10-01T00:00:00.000Z',
      }),
    ).toEqual({ authors: [{ family: 'Soodphakdee', given: null, initials: 'D.' }], complete: false });
  });
  it('returns null for anything that is not a stored list', () => {
    for (const v of [null, undefined, 'x', { names: 'a' }, { names: [], complete: true }]) {
      expect(authorsFromScholarColumn(v)).toBeNull();
    }
  });
});

describe('the DOI-bridge pass keeps authors already known', () => {
  it('does not reset a paper whose authors came from Scholar', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'staff-profile', 'profile.ts'), 'utf8');
    expect(src).not.toMatch(/\{\s*\.\.\.p,\s*authors:\s*\[\],\s*authorsAreComplete:\s*false\s*\}/);
  });
});
