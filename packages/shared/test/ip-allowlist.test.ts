import { describe, expect, it } from 'vitest';
import { ipAllowed, isValidAllowlistEntry } from '../src/net/ip-allowlist';

describe('ipAllowed', () => {
  it('allows everyone when the list is empty', () => {
    expect(ipAllowed('203.0.113.9', [])).toBe(true);
    expect(ipAllowed(undefined, [])).toBe(true);
  });
  it('matches IPv4 CIDRs and bare addresses', () => {
    expect(ipAllowed('10.101.5.7', ['10.101.0.0/16'])).toBe(true);
    expect(ipAllowed('10.102.5.7', ['10.101.0.0/16'])).toBe(false);
    expect(ipAllowed('10.101.118.80', ['10.101.118.80'])).toBe(true);
  });
  it('unwraps IPv4-mapped IPv6, which is what Express reports', () => {
    expect(ipAllowed('::ffff:10.101.5.7', ['10.101.0.0/16'])).toBe(true);
  });
  it('matches IPv6 prefixes', () => {
    expect(ipAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
  });
  it('refuses an unknown caller address when a list is set', () => {
    expect(ipAllowed(undefined, ['10.0.0.0/8'])).toBe(false);
    expect(ipAllowed('not-an-ip', ['10.0.0.0/8'])).toBe(false);
  });
});

describe('isValidAllowlistEntry', () => {
  it('accepts addresses and CIDRs', () => {
    for (const e of ['10.0.0.0/8', '10.1.2.3', '2001:db8::/32', '::1']) {
      expect(isValidAllowlistEntry(e)).toBe(true);
    }
  });
  it('rejects malformed entries', () => {
    for (const e of ['10.0.0.0/33', '10.0.0/8', '10.0.0.0/', '10.0.0.0/8x', 'host.kku.ac.th', '']) {
      expect(isValidAllowlistEntry(e)).toBe(false);
    }
  });
});
