import { describe, it, expect } from 'vitest';
import { parseDescribe } from '../src/lib/release-version';

// The version beside the sidebar copyright line. In dev there is no release
// to name, so it is derived from `git describe --tags --dirty`: the tag when
// HEAD sits cleanly on one, otherwise the next patch — what the next build
// would be called.

describe('parseDescribe', () => {
  it('uses the tag verbatim when HEAD sits cleanly on one', () => {
    expect(parseDescribe('v1.8.6')).toBe('1.8.6');
    expect(parseDescribe('1.8.6')).toBe('1.8.6');
  });

  it('bumps the patch when there are commits after the tag', () => {
    // The real state of this repo on 2026-09-04: 53 commits past v1.8.5,
    // heading for v1.8.6.
    expect(parseDescribe('v1.8.5-53-g036efef')).toBe('1.8.6');
  });

  it('bumps once, not per commit', () => {
    // A guard against reading the commit count as the patch offset —
    // 53 commits past v1.8.5 is v1.8.6, never v1.8.58.
    expect(parseDescribe('v1.8.5-53-g036efef')).toBe('1.8.6');
    expect(parseDescribe('v1.8.5-1-gabc1234')).toBe('1.8.6');
  });

  it('treats a dirty tree as changed even when it sits on a tag', () => {
    // Sitting on v1.8.6 with uncommitted work is NOT v1.8.6 — shipping that
    // label would name a release that does not contain what is on screen.
    expect(parseDescribe('v1.8.6-dirty')).toBe('1.8.7');
    expect(parseDescribe('v1.8.5-53-g036efef-dirty')).toBe('1.8.6');
  });

  it('carries the minor and major through untouched', () => {
    expect(parseDescribe('v2.0.9-4-gdeadbee')).toBe('2.0.10');
    expect(parseDescribe('v10.4.0')).toBe('10.4.0');
  });

  it('returns undefined when the tree cannot be named', () => {
    // `git describe --always` on a repo with no tags yields a bare hash;
    // empty output means git said nothing. Neither is an error worth
    // surfacing — the label is just omitted.
    expect(parseDescribe('')).toBeUndefined();
    expect(parseDescribe('   ')).toBeUndefined();
    expect(parseDescribe('g036efef')).toBeUndefined();
    expect(parseDescribe('not-a-version')).toBeUndefined();
  });
});
