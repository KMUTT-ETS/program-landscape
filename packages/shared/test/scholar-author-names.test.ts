import { describe, expect, it } from 'vitest';
import { parseScholarAuthorName, splitScholarAuthorLine } from '../src/scholar/author-names';

describe('splitScholarAuthorLine', () => {
  it('splits a complete list', () => {
    expect(splitScholarAuthorLine('A Krizhevsky, I Sutskever, GE Hinton')).toEqual({
      names: ['A Krizhevsky', 'I Sutskever', 'GE Hinton'],
      complete: true,
    });
  });
  it('marks a list Scholar shortened with a trailing "..." or "…"', () => {
    expect(splitScholarAuthorLine('G Hinton, L Deng, D Yu, ...')).toEqual({
      names: ['G Hinton', 'L Deng', 'D Yu'],
      complete: false,
    });
    expect(splitScholarAuthorLine('G Hinton, L Deng …')).toEqual({ names: ['G Hinton', 'L Deng'], complete: false });
  });
  it('returns null for an empty line', () => {
    expect(splitScholarAuthorLine('')).toBeNull();
    expect(splitScholarAuthorLine('  ')).toBeNull();
    expect(splitScholarAuthorLine('...')).toBeNull();
  });
});

describe('parseScholarAuthorName', () => {
  it('reads leading capital initials as initials and the rest as the family name', () => {
    expect(parseScholarAuthorName('GE Hinton')).toEqual({ family: 'Hinton', given: null, initials: 'G.E.' });
    expect(parseScholarAuthorName('L van der Maaten')).toEqual({ family: 'van der Maaten', given: null, initials: 'L.' });
    expect(parseScholarAuthorName('R Müller')).toEqual({ family: 'Müller', given: null, initials: 'R.' });
  });
  it('reads a full name (no initials token) as given + family', () => {
    expect(parseScholarAuthorName('เด่นพงษ์ สุดภักดี')).toEqual({ family: 'สุดภักดี', given: 'เด่นพงษ์', initials: null });
    expect(parseScholarAuthorName('Denpong Soodphakdee')).toEqual({ family: 'Soodphakdee', given: 'Denpong', initials: null });
  });
  it('keeps a single token as the family name', () => {
    expect(parseScholarAuthorName('Hinton')).toEqual({ family: 'Hinton', given: null, initials: null });
  });
});
