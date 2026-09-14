import { describe, expect, it } from 'vitest';
import { buildEvent, RecorderDedupe, DEDUPE_MS } from '../src/lib/usage-recorder-policy';

describe('buildEvent', () => {
  it('lifts programme id from the path and scope from the query', () => {
    // Program.id — the route resolves by id, never by code
    expect(
      buildEvent('/programs/clr2k9x0h0001abcd', new URLSearchParams('scope=faculty&scopeId=f1')),
    ).toEqual({
      path: '/programs/clr2k9x0h0001abcd',
      scope: 'faculty',
      scopeId: 'f1',
      programId: 'clr2k9x0h0001abcd',
    });
  });
  it('returns null for excluded paths', () => {
    for (const p of ['/signin', '/no-access', '/api/v1/x'])
      expect(buildEvent(p, new URLSearchParams())).toBeNull();
  });
  it('ignores an invalid scope', () => {
    expect(
      buildEvent('/cockpit', new URLSearchParams('scope=galaxy&scopeId=x'))?.scope,
    ).toBeUndefined();
  });
  it('keeps a scope that has no scopeId (university)', () => {
    expect(buildEvent('/cockpit', new URLSearchParams('scope=university'))).toEqual({
      path: '/cockpit',
      scope: 'university',
    });
  });
});

describe('RecorderDedupe', () => {
  it('sends the first event, suppresses an identical one within the window, allows it after', () => {
    expect(DEDUPE_MS).toBe(5000);
    const d = new RecorderDedupe();
    const e = { path: '/cockpit', scope: 'faculty' as const, scopeId: 'f1' };
    expect(d.shouldSend(e, 1000)).toBe(true);
    expect(d.shouldSend(e, 3000)).toBe(false);
    expect(d.shouldSend(e, 6001)).toBe(true);
  });
  it('a different scope on the same path is a new event', () => {
    const d = new RecorderDedupe();
    expect(d.shouldSend({ path: '/cockpit', scope: 'faculty', scopeId: 'f1' }, 1000)).toBe(true);
    expect(d.shouldSend({ path: '/cockpit', scope: 'faculty', scopeId: 'f2' }, 1001)).toBe(true);
  });
  it('an unrelated query change yields an identical event — one beacon, not two', () => {
    const a = buildEvent(
      '/gap-analysis',
      new URLSearchParams('scope=faculty&scopeId=f1&tab=skills'),
    );
    const b = buildEvent(
      '/gap-analysis',
      new URLSearchParams('scope=faculty&scopeId=f1&tab=sectors&lang=th'),
    );
    expect(a).toEqual(b);
    const d = new RecorderDedupe();
    expect(d.shouldSend(a!, 1000)).toBe(true);
    expect(d.shouldSend(b!, 1200)).toBe(false);
  });
  it("StrictMode's double effect inside the window is one beacon", () => {
    // React 18 dev mounts, unmounts and remounts; refs survive that simulated
    // remount, so the SAME RecorderDedupe instance sees both effect runs.
    const d = new RecorderDedupe();
    expect(d.shouldSend({ path: '/cockpit' }, 1000)).toBe(true);
    expect(d.shouldSend({ path: '/cockpit' }, 1000)).toBe(false);
  });
  it('two programmes on the same route are distinct events', () => {
    const d = new RecorderDedupe();
    expect(d.shouldSend({ path: '/programs/a', programId: 'a' }, 1000)).toBe(true);
    expect(d.shouldSend({ path: '/programs/b', programId: 'b' }, 1001)).toBe(true);
  });
});
