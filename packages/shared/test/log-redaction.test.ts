import { describe, expect, it } from 'vitest';
import {
  REDACT_PATHS,
  scrubLogObject,
  scrubString,
} from '../src/observability/log-redaction';

describe('REDACT_PATHS', () => {
  it('covers the standard request/response surface', () => {
    expect(REDACT_PATHS).toContain('req.headers.authorization');
    expect(REDACT_PATHS).toContain('req.headers.cookie');
    expect(REDACT_PATHS).toContain('req.body.password');
  });

  it('includes the PDPA top-level wildcards', () => {
    for (const path of [
      '*.password',
      '*.secret',
      '*.token',
      '*.apiKey',
      '*.citizenId',
      '*.nationalId',
      '*.phone',
      '*.dateOfBirth',
    ]) {
      expect(REDACT_PATHS).toContain(path);
    }
  });
});

describe('scrubLogObject', () => {
  it('redacts every sensitive key at any depth', () => {
    const input = {
      requestId: 'r-1',
      user: {
        name: 'A',
        password: 'super-secret',
        nested: { citizenId: '1234567890123' },
      },
      headers: { authorization: 'Bearer xyz', cookie: 'x=1' },
      data: [{ token: 'abc' }, { phone: '0801234567' }],
    };
    const out = scrubLogObject(input);
    expect((out as { user: { password: string } }).user.password).toBe('[REDACTED]');
    expect((out as { user: { nested: { citizenId: string } } }).user.nested.citizenId).toBe(
      '[REDACTED]',
    );
    expect((out as { headers: { authorization: string } }).headers.authorization).toBe(
      '[REDACTED]',
    );
    expect((out as { headers: { cookie: string } }).headers.cookie).toBe('[REDACTED]');
    expect((out as { data: { token?: string }[] }).data[0]?.token).toBe('[REDACTED]');
    expect((out as { data: { phone?: string }[] }).data[1]?.phone).toBe('[REDACTED]');
    // Non-sensitive value passes through.
    expect((out as { requestId: string }).requestId).toBe('r-1');
  });

  it('redacts a 13-digit Thai ID found inside a bare string value', () => {
    const out = scrubLogObject({
      message: 'fetched record for 1234567890123 successfully',
    }) as { message: string };
    expect(out.message).toBe('[REDACTED]');
  });

  it('does not mutate the input object', () => {
    const input = { password: 'p', nested: { token: 't' } };
    scrubLogObject(input);
    expect(input.password).toBe('p');
    expect(input.nested.token).toBe('t');
  });

  it('passes through Buffer / Date untouched', () => {
    const buf = Buffer.from('hello');
    const date = new Date('2026-01-01T00:00:00Z');
    const out = scrubLogObject({ buf, date }) as { buf: Buffer; date: Date };
    expect(out.buf).toBe(buf);
    expect(out.date).toBe(date);
  });

  it('handles null / undefined / arrays of primitives', () => {
    expect(scrubLogObject(null)).toBe(null);
    expect(scrubLogObject(undefined)).toBe(undefined);
    expect(scrubLogObject([1, 2, 3])).toEqual([1, 2, 3]);
    expect(scrubLogObject('plain string')).toBe('plain string');
  });

  it('catches snake_case + UPPER_CASE variants of the same key', () => {
    const out = scrubLogObject({
      Citizen_Id: '1234567890123',
      ACCESS_TOKEN: 'aaa',
      api_key: 'bbb',
    }) as Record<string, string>;
    expect(out.Citizen_Id).toBe('[REDACTED]');
    expect(out.ACCESS_TOKEN).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
  });

  it('terminates at MAX_RECURSION_DEPTH on a self-cycle', () => {
    const cycle: Record<string, unknown> = { name: 'root' };
    cycle.self = cycle;
    // Should not blow the stack.
    expect(() => scrubLogObject(cycle)).not.toThrow();
  });
});

describe('scrubString', () => {
  it('replaces every 13-digit run with [REDACTED:THAI_ID]', () => {
    expect(scrubString('id=1234567890123 and 9876543210000')).toBe(
      'id=[REDACTED:THAI_ID] and [REDACTED:THAI_ID]',
    );
  });

  it('leaves shorter runs alone', () => {
    expect(scrubString('id=1234567')).toBe('id=1234567');
  });
});
