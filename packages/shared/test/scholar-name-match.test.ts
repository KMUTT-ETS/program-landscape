import { describe, expect, it } from 'vitest';
import {
  matchesScholarAuthorName,
  normalisePersonName,
  personNameKey,
  personNameMatchesAny,
  personNameTokens,
  personNamesMatch,
  scholarNameMatchesAny,
} from '../src/scholar/name-match';

describe('normalisePersonName', () => {
  it('case-folds, strips diacritics, turns punctuation into spaces, collapses whitespace', () => {
    expect(normalisePersonName('  Sômchai   Jai-dee ')).toBe('somchai jai dee');
    expect(normalisePersonName('S.Jaidee')).toBe('s jaidee');
    expect(normalisePersonName('ผศ.ดร. สมชาย ใจดี')).toBe('ผศ ดร สมชาย ใจดี');
  });

  it('returns an empty string for empty or punctuation-only input', () => {
    expect(normalisePersonName('')).toBe('');
    expect(normalisePersonName('  ...  ')).toBe('');
  });
});

describe('personNameTokens / personNameKey', () => {
  it('is order-insensitive and duplicate-free', () => {
    expect(personNameTokens('Somchai Jaidee')).toEqual(['jaidee', 'somchai']);
    expect(personNameKey('Jaidee Somchai')).toBe(personNameKey('Somchai Jaidee'));
    expect(personNameKey('Smith Smith John')).toBe('john smith');
  });
});

describe('personNamesMatch', () => {
  it('matches the same name written in either order', () => {
    expect(personNamesMatch('Somchai Jaidee', 'Jaidee, Somchai')).toBe(true);
  });

  it('matches across diacritics, case and punctuation', () => {
    expect(personNamesMatch('SÔMCHAI JAI-DEE', 'somchai jai dee')).toBe(true);
  });

  it('ignores a middle initial when enough substantial tokens remain', () => {
    expect(personNamesMatch('Geoffrey E Hinton', 'Geoffrey Hinton')).toBe(true);
    expect(personNamesMatch('Geoffrey E. Hinton', 'Hinton Geoffrey')).toBe(true);
  });

  it('REFUSES conflicting initials — the same surname with different middles is two people', () => {
    // Every one of these matched before the subset rule. The bind path is
    // where it bites: staff record "Wei L Zhang", an admin pastes Wei Q
    // Zhang's profile, and a stranger's papers land on a Council-facing
    // facultyMemberId.
    expect(personNamesMatch('Geoffrey E Hinton', 'Geoffrey R Hinton')).toBe(false);
    expect(personNamesMatch('Wei L Zhang', 'Wei Q Zhang')).toBe(false);
    expect(personNamesMatch('Somchai A Jaidee', 'Somchai B Jaidee')).toBe(false);
    // Single-letter given names are real, not just initials.
    expect(personNamesMatch('Nguyen Van A', 'Nguyen Van B')).toBe(false);
    expect(personNamesMatch('A B Smith', 'C D Smith')).toBe(false);
  });

  it('REFUSES a spelled-out middle name against its own initial, and says why', () => {
    // The commonest real variant of all, and still a refusal: the tolerance
    // is for a MISSING token, not an abbreviated one. Letting an initial
    // stand for any word starting with that letter is what would make
    // "Wei L Zhang" swallow both "Wei Liang Zhang" and "Wei Lin Zhang".
    // Visible at bind time; a human corrects one of the two records.
    expect(personNamesMatch('Geoffrey Everest Hinton', 'Geoffrey E Hinton')).toBe(false);
  });

  it('still matches when one side merely OMITS the initial the other states', () => {
    expect(personNamesMatch('Geoffrey E Hinton', 'Geoffrey Hinton')).toBe(true);
    expect(personNamesMatch('Nguyen Van A', 'Nguyen Van A')).toBe(true);
    // Both initials present and agreeing is still the same person.
    expect(personNamesMatch('Wei L Zhang', 'Zhang Wei L.')).toBe(true);
  });

  it('does NOT let two different people collapse onto a shared surname', () => {
    // Both reduce to {smith} once initials are dropped — the two-token floor
    // is what stops this being a match.
    expect(personNamesMatch('A Smith', 'B Smith')).toBe(false);
    expect(personNamesMatch('A. Smith', 'A. Smith')).toBe(true); // identical is still identical
  });

  it('refuses partial names — no initial expansion, no nickname guessing', () => {
    expect(personNamesMatch('S Jaidee', 'Somchai Jaidee')).toBe(false);
    expect(personNamesMatch('Somchai Jaidee', 'Somchai Jaidee Junior')).toBe(false);
    expect(personNamesMatch('Bob Jaidee', 'Robert Jaidee')).toBe(false);
  });

  it('never matches an empty name, including against another empty name', () => {
    expect(personNamesMatch('', '')).toBe(false);
    expect(personNamesMatch('   ', 'Somchai Jaidee')).toBe(false);
    expect(personNamesMatch('Somchai Jaidee', '...')).toBe(false);
  });
});

describe('personNameMatchesAny', () => {
  it('accepts a match against any listed alias, and rejects an empty list', () => {
    expect(personNameMatchesAny('Somchai Jaidee', ['Other Person', 'Jaidee Somchai'])).toBe(true);
    expect(personNameMatchesAny('Somchai Jaidee', ['Other Person'])).toBe(false);
    expect(personNameMatchesAny('Somchai Jaidee', [])).toBe(false);
  });
});

describe('matchesScholarAuthorName', () => {
  it('accepts an initial against the word it abbreviates — the commonest real variant', () => {
    // The case `personNamesMatch` refuses, and which our own code-quality
    // review called out. Scholar abbreviates given names as house style; a
    // staff record spells them out.
    expect(matchesScholarAuthorName('Geoffrey Everest Hinton', 'Geoffrey E Hinton')).toBe(true);
    // And in the other direction, because either side may be the abbreviated one.
    expect(matchesScholarAuthorName('Geoffrey E Hinton', 'Geoffrey Everest Hinton')).toBe(true);
  });

  it('REFUSES conflicting initials — the mis-attribution case', () => {
    // Both sides state an initial and the statements disagree: two people.
    expect(matchesScholarAuthorName('Wei L Zhang', 'Wei Q Zhang')).toBe(false);
    expect(matchesScholarAuthorName('Geoffrey E Hinton', 'Geoffrey R Hinton')).toBe(false);
  });

  it('strips academic titles from the query side', () => {
    expect(matchesScholarAuthorName('Asst. Prof. Somchai Jaidee', 'Somchai Jaidee')).toBe(true);
    expect(matchesScholarAuthorName('Assoc. Prof. Somchai Jaidee', 'Somchai Jaidee')).toBe(true);
    expect(matchesScholarAuthorName('Prof. Dr. Somchai Jaidee', 'Somchai Jaidee')).toBe(true);
    expect(matchesScholarAuthorName('Somchai Jaidee, PhD', 'Somchai Jaidee')).toBe(true);
  });

  it('strips `A/P` BEFORE normalisation, so it never becomes two initials', () => {
    // The ordering guard. If normalisation ran first, "A/P" would tokenise to
    // ["a","p"] and the positional rule would read them as initials against
    // the real given name.
    expect(matchesScholarAuthorName('A/P Lim Wei', 'Lim Wei')).toBe(true);
    expect(matchesScholarAuthorName('A / P Lim Wei', 'Lim Wei')).toBe(true);
    // And the damage that ordering prevents: with "a" and "p" left in place as
    // leading tokens, "A/P Lim Wei" would match a DIFFERENT person whose
    // given names merely start with those letters.
    expect(matchesScholarAuthorName('A/P Lim Wei', 'Anan Prasert Lim Wei')).toBe(false);
  });

  it('REFUSES a different surname, whatever the given names do', () => {
    expect(matchesScholarAuthorName('Somchai Jaidee', 'Somchai Jaidak')).toBe(false);
    expect(matchesScholarAuthorName('Wei L Zhang', 'Wei L Zhao')).toBe(false);
    expect(matchesScholarAuthorName('Geoffrey E Hinton', 'Geoffrey E Hint')).toBe(false);
    // No prefix tolerance on the surname: a single-letter surname does not
    // stand in for a spelled-out one.
    expect(matchesScholarAuthorName('Somchai J', 'Somchai Jaidee')).toBe(false);
  });

  it('accepts a Scholar name that omits a middle name, but not one that adds a token', () => {
    expect(matchesScholarAuthorName('Geoffrey Everest Hinton', 'Geoffrey Hinton')).toBe(true);
    // An extra given-name token on the Scholar side is information the staff
    // record does not corroborate.
    expect(matchesScholarAuthorName('Geoffrey Hinton', 'Geoffrey Everest Hinton')).toBe(false);
  });

  it('reads the comma-inverted Scholar form, which is how profiles present names', () => {
    // Measured on a real KKU professor, 2026-09-09: the profile header reads
    // "Chindaprasirt, P". Without comma handling the positional rule takes
    // "p" for the surname and refuses a correct binding.
    expect(matchesScholarAuthorName('Prinya Chindaprasirt', 'Chindaprasirt, P')).toBe(true);
    expect(matchesScholarAuthorName('Somchai Jaidee', 'Jaidee, Somchai')).toBe(true);
    // The inversion is not a licence to reorder freely — only the comma-marked
    // swap is offered, and the conflicting-initial refusal survives it.
    expect(matchesScholarAuthorName('Wei L Zhang', 'Zhang, Wei Q')).toBe(false);
    expect(matchesScholarAuthorName('Prinya Chindaprasirt', 'Chindaprasirt, S')).toBe(false);
  });

  it('matches the abbreviated byline form Scholar prints inside a result', () => {
    // `P Chindaprasirt` is what the per-author anchor in a `div.gs_a` byline
    // carries; case (a) of the resolution decision leans on this.
    expect(matchesScholarAuthorName('Prinya Chindaprasirt', 'P Chindaprasirt')).toBe(true);
    expect(matchesScholarAuthorName('Prinya Chindaprasirt', 'S Chindaprasirt')).toBe(false);
  });

  it('compares Thai names instead of reducing them to nothing', () => {
    // DIVERGENCE 1 from the reference, whose `[^a-zA-Z]` strip empties any
    // Thai name so it can never match even itself.
    expect(matchesScholarAuthorName('สมชาย ใจดี', 'สมชาย ใจดี')).toBe(true);
    expect(matchesScholarAuthorName('สมชาย ใจดี', 'สมหญิง ใจดี')).toBe(false);
    // KNOWN LIMITATION, asserted so it is not mistaken for a bug later: the
    // noise list is Latin-only, so a THAI honorific is not stripped and the
    // leading "ผศ"/"ดร" tokens refuse the match. Every current caller feeds
    // this matcher `FacultyMember.nameEn`, so the Thai-titled form does not
    // arise; widening the list is a change to make when a caller needs it,
    // not speculatively.
    expect(matchesScholarAuthorName('ผศ.ดร. สมชาย ใจดี', 'สมชาย ใจดี')).toBe(false);
  });

  it('never matches a name that reduces to fewer than two tokens', () => {
    // DIVERGENCE 2. The reference refuses only the empty case, which leaves a
    // bare surname matching everyone who shares it, and lets a name whose
    // second token is a noise word collapse onto another such name.
    expect(matchesScholarAuthorName('Geoffrey Everest Hinton', 'Hinton')).toBe(false);
    expect(matchesScholarAuthorName('Hinton', 'Hinton')).toBe(false);
    // "Ma" and "Ba" are real surnames that the noise list eats. Refusing both
    // is a visible false refusal; matching them would be an invisible false
    // match between two different people.
    expect(matchesScholarAuthorName('Yong Ma', 'Yong Ba')).toBe(false);
    expect(matchesScholarAuthorName('Yong Ma', 'Yong Ma')).toBe(false);
    expect(matchesScholarAuthorName('', '')).toBe(false);
    expect(matchesScholarAuthorName('Somchai Jaidee', '')).toBe(false);
    expect(matchesScholarAuthorName('Prof. Dr.', 'Somchai Jaidee')).toBe(false);
  });

  it('does not let the initial tolerance run on romanised single-letter given names', () => {
    // The `kkupub_*` population: `Nguyen Van A` and `Nguyen Van B` are two
    // people, and the surname anchor is what keeps them apart.
    expect(matchesScholarAuthorName('Nguyen Van A', 'Nguyen Van B')).toBe(false);
    expect(matchesScholarAuthorName('A Van Nguyen', 'B Van Nguyen')).toBe(false);
  });
});

describe('scholarNameMatchesAny', () => {
  it('accepts a match against any name we hold, and rejects an empty list', () => {
    expect(scholarNameMatchesAny('Geoffrey E Hinton', ['Someone Else', 'Geoffrey Everest Hinton'])).toBe(
      true,
    );
    expect(scholarNameMatchesAny('Geoffrey E Hinton', ['Someone Else'])).toBe(false);
    expect(scholarNameMatchesAny('Geoffrey E Hinton', [])).toBe(false);
  });
});
