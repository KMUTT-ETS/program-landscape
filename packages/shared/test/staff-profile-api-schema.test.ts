import { describe, expect, it } from 'vitest';
import { StaffProfileLookupSchema } from '../src/staff-profile/api-schema';

describe('StaffProfileLookupSchema', () => {
  it('accepts a valid citizen id and normalises it', () => {
    const r = StaffProfileLookupSchema.safeParse({ citizenId: '1-1017-00203-88-3' });
    expect(r.success && r.data).toEqual({ citizenId: '1101700203883' });
  });
  it('rejects a citizen id failing the checksum', () => {
    expect(StaffProfileLookupSchema.safeParse({ citizenId: '1101700203884' }).success).toBe(false);
  });
  it('accepts an email and lowercases it', () => {
    const r = StaffProfileLookupSchema.safeParse({ email: ' Someone@KKU.ac.th ' });
    expect(r.success && r.data).toEqual({ email: 'someone@kku.ac.th' });
  });
  it('rejects both identifiers, neither, and unknown keys', () => {
    expect(StaffProfileLookupSchema.safeParse({ citizenId: '1101700203883', email: 'a@kku.ac.th' }).success).toBe(false);
    expect(StaffProfileLookupSchema.safeParse({}).success).toBe(false);
    expect(StaffProfileLookupSchema.safeParse({ email: 'a@kku.ac.th', extra: 1 }).success).toBe(false);
  });
});
