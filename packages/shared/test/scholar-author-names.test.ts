import { describe, expect, it } from 'vitest';
import { parseScholarAuthorName, splitScholarAuthorLine } from '../src/scholar/author-names';
import { formatAuthorApa } from '../src/staff-profile/types';

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
  it('reads a full Latin name as given (every token but the family) + family', () => {
    expect(parseScholarAuthorName('Denpong Soodphakdee')).toEqual({ family: 'Soodphakdee', given: 'Denpong', initials: null });
    expect(parseScholarAuthorName('Geoffrey Hinton')).toEqual({ family: 'Hinton', given: 'Geoffrey', initials: null });
    expect(parseScholarAuthorName('George E Dahl')).toEqual({ family: 'Dahl', given: 'George E', initials: null });
    expect(parseScholarAuthorName('Tara N Sainath')).toEqual({ family: 'Sainath', given: 'Tara N', initials: null });
    expect(parseScholarAuthorName('Abdel-rahman Mohamed')).toEqual({
      family: 'Mohamed',
      given: 'Abdel-rahman',
      initials: null,
    });
  });
  it('keeps lowercase particles before the last token in the family name', () => {
    expect(parseScholarAuthorName('Laurens van der Maaten')).toEqual({
      family: 'van der Maaten',
      given: 'Laurens',
      initials: null,
    });
    expect(parseScholarAuthorName('Ludwig von Mises')).toEqual({ family: 'von Mises', given: 'Ludwig', initials: null });
  });
  it('keeps the initials-first branch unchanged', () => {
    expect(parseScholarAuthorName('D Soodphakdee')).toEqual({ family: 'Soodphakdee', given: null, initials: 'D.' });
  });
  it('keeps a Thai name whole as the family so it renders verbatim', () => {
    expect(parseScholarAuthorName('เด่นพงษ์ สุดภักดี')).toEqual({ family: 'เด่นพงษ์ สุดภักดี', given: null, initials: null });
    // Scholar sometimes splits Thai names on combining marks; never guess a split.
    expect(parseScholarAuthorName(' พัชรา ภร ณ์ จิ รา นุ วัฒน วงษ์ ')).toEqual({
      family: 'พัชรา ภร ณ์ จิ รา นุ วัฒน วงษ์',
      given: null,
      initials: null,
    });
  });
  it('renders through formatAuthorApa as APA family, initials', () => {
    const apa = (n: string) => formatAuthorApa(parseScholarAuthorName(n));
    expect(apa('George E Dahl')).toBe('Dahl, G. E.');
    expect(apa('Tara N Sainath')).toBe('Sainath, T. N.');
    expect(apa('Geoffrey Hinton')).toBe('Hinton, G.');
    expect(apa('GE Hinton')).toBe('Hinton, G. E.');
    expect(apa('D Soodphakdee')).toBe('Soodphakdee, D.');
    expect(apa('L van der Maaten')).toBe('van der Maaten, L.');
    expect(apa('Laurens van der Maaten')).toBe('van der Maaten, L.');
    expect(apa('เด่นพงษ์ สุดภักดี')).toBe('เด่นพงษ์ สุดภักดี');
    expect(apa('พัชรา ภร ณ์ จิ รา นุ วัฒน วงษ์')).toBe('พัชรา ภร ณ์ จิ รา นุ วัฒน วงษ์');
  });
  it('keeps a single token as the family name', () => {
    expect(parseScholarAuthorName('Hinton')).toEqual({ family: 'Hinton', given: null, initials: null });
  });
});
