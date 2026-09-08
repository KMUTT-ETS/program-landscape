import { describe, expect, it } from 'vitest';
import {
  normalisePersonName,
  personNameKey,
  personNameMatchesAny,
  personNameTokens,
  personNamesMatch,
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
