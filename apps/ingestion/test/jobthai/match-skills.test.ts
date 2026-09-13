import { describe, expect, it } from 'vitest';

import {
  matchSkillTerms,
  rollUpOccupationSkills,
  includesAsWord,
  isThaiTerm,
  MIN_TERM_LENGTH_LATIN,
  MIN_TERM_LENGTH_THAI,
} from '../../src/jobthai/match-skills';

describe('matchSkillTerms', () => {
  const terms = [
    { skillId: 's-excel', term: 'excel' },
    { skillId: 's-autocad', term: 'autocad' },
    { skillId: 's-acct', term: 'บัญชี' },
  ];

  it('finds English terms case-insensitively', () => {
    expect(matchSkillTerms('สามารถใช้ Microsoft Excel ได้', terms)).toContain('s-excel');
  });

  it('finds Thai terms', () => {
    expect(matchSkillTerms('มีประสบการณ์ด้านบัญชี', terms)).toContain('s-acct');
  });

  it('returns each skill once even when its term appears repeatedly', () => {
    const out = matchSkillTerms('excel excel excel', terms);
    expect(out.filter((s) => s === 's-excel')).toHaveLength(1);
  });

  it('returns nothing for text with no matches — not a zero-weight row', () => {
    expect(matchSkillTerms('ขับรถส่งของ', terms)).toEqual([]);
  });

  it('returns nothing for empty text', () => {
    expect(matchSkillTerms('', terms)).toEqual([]);
  });

  it('keeps short English acronyms matchable', () => {
    expect(MIN_TERM_LENGTH_LATIN).toBe(3);
  });

  it('requires a higher floor for Thai, which cannot be word-bounded', () => {
    expect(MIN_TERM_LENGTH_THAI).toBeGreaterThan(MIN_TERM_LENGTH_LATIN);
  });
});

// These are the FALSE POSITIVES a plain substring match produced over the real
// corpus. Each one is a term that matched inside a longer, unrelated word.
describe('includesAsWord — the false positives measured on real postings', () => {
  it('does not match the MICROS POS product inside Microsoft (was 26% of postings)', () => {
    expect(includesAsWord('สามารถใช้ microsoft office', 'micros')).toBe(false);
  });

  it('does not match Opera Performance inside "operation"', () => {
    expect(includesAsWord('production operation control', 'opera')).toBe(false);
  });

  it('does not match STEM education inside "system"', () => {
    expect(includesAsWord('erp system administration', 'stem')).toBe(false);
  });

  it('does not match Radio Access Network inside "brand"', () => {
    expect(includesAsWord('brand management', 'ran')).toBe(false);
  });

  it('does not match Git inside "digital"', () => {
    expect(includesAsWord('digital marketing', 'git')).toBe(false);
  });

  it('still matches a genuine standalone acronym', () => {
    expect(includesAsWord('experience with git and sql', 'git')).toBe(true);
    expect(includesAsWord('experience with git and sql', 'sql')).toBe(true);
  });

  it('matches at the start and end of the text', () => {
    expect(includesAsWord('git rebase', 'git')).toBe(true);
    expect(includesAsWord('we use git', 'git')).toBe(true);
  });

  it('treats + and # as word characters so C does not match inside C++', () => {
    expect(includesAsWord('c++ developer', 'c')).toBe(false);
    expect(includesAsWord('c++ developer', 'c++')).toBe(true);
  });
});

describe('isThaiTerm', () => {
  it('detects Thai script', () => {
    expect(isThaiTerm('การตลาด')).toBe(true);
    expect(isThaiTerm('marketing')).toBe(false);
  });
});

describe('rollUpOccupationSkills', () => {
  it('computes share as postings-with-skill over the occupation total', () => {
    const out = rollUpOccupationSkills({
      occupationPostingCount: 4,
      matches: [
        { postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
        { postingId: 'p2', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
        { postingId: 'p3', skillId: 's2', extractedBy: 'ALIAS_MATCHED' },
      ],
    });
    expect(out.find((r) => r.skillId === 's1')).toMatchObject({ postingCount: 2, share: 0.5 });
    expect(out.find((r) => r.skillId === 's2')).toMatchObject({ postingCount: 1, share: 0.25 });
  });

  it('counts a skill once per posting even when matched twice in the text', () => {
    const out = rollUpOccupationSkills({
      occupationPostingCount: 1,
      matches: [
        { postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
        { postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ postingCount: 1, share: 1 });
  });

  it('emits nothing for an occupation with no matches', () => {
    expect(rollUpOccupationSkills({ occupationPostingCount: 10, matches: [] })).toEqual([]);
  });

  it('prefers the deterministic provenance when both kinds matched', () => {
    const out = rollUpOccupationSkills({
      occupationPostingCount: 2,
      matches: [
        { postingId: 'p1', skillId: 's1', extractedBy: 'EMBEDDING_MATCHED' },
        { postingId: 'p2', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
      ],
    });
    expect(out[0]!.extractedBy).toBe('ALIAS_MATCHED');
  });

  it('guards against a zero denominator rather than emitting NaN', () => {
    const out = rollUpOccupationSkills({
      occupationPostingCount: 0,
      matches: [{ postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' }],
    });
    expect(out[0]!.share).toBe(0);
  });
});
