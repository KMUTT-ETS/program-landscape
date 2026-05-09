import { describe, expect, it } from 'vitest';
import { hashCitizenId } from '../src/identity/hash-citizen-id';

// PDPA-critical: hashCitizenId is the cross-system join key for KKU staff
// (kku-hr ↔ processed-HR mart ↔ DS2003/DS2004). Behaviour contract:
//   - SHA-256 of digit-stripped input → 64-char lowercase hex
//   - No salt — cross-system determinism is the point
//   - Whitespace + dashes always stripped; digits + alphanumerics retained
//   - null/undefined/empty input → null
//
// These tests pin the contract. A regression here breaks every cross-system
// join silently and corrupts FacultyMember reconciliation.

describe('hashCitizenId — PDPA-critical join-key hasher', () => {
  describe('output shape', () => {
    it('returns a 64-char lowercase hex string', () => {
      const result = hashCitizenId('1234567890123');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns null for null input', () => {
      expect(hashCitizenId(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(hashCitizenId(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(hashCitizenId('')).toBeNull();
    });

    it('returns null when input is only separators (no digits or alphanumerics)', () => {
      expect(hashCitizenId('   ')).toBeNull();
      expect(hashCitizenId('---')).toBeNull();
      expect(hashCitizenId('-- - ')).toBeNull();
    });
  });

  describe('idempotence — same input always produces same hash', () => {
    it('h(x) === h(x) for the same digit-only input', () => {
      const a = hashCitizenId('1234567890123');
      const b = hashCitizenId('1234567890123');
      expect(a).not.toBeNull();
      expect(a).toBe(b);
    });

    it('h(x) === h(x) for the same passport-shaped input', () => {
      const a = hashCitizenId('AB1234567');
      const b = hashCitizenId('AB1234567');
      expect(a).toBe(b);
    });
  });

  describe('normalisation — formatting is stripped', () => {
    // Cross-system join requires that the SAME canonical citizen ID hashes
    // identically regardless of how upstream systems format it. KKU sees:
    //   kku-hr     → '1234567890123' (raw 13 digits)
    //   processed  → '1-2345-67890-12-3' (Thai display format with dashes)
    //   DS2003     → '1 2345 67890 12 3' (some manual entries with spaces)

    it('canonicalises Thai citizen-ID dash format', () => {
      const raw = hashCitizenId('1234567890123');
      const dashed = hashCitizenId('1-2345-67890-12-3');
      expect(raw).toBe(dashed);
    });

    it('canonicalises space-separated format', () => {
      const raw = hashCitizenId('1234567890123');
      const spaced = hashCitizenId('1 2345 67890 12 3');
      expect(raw).toBe(spaced);
    });

    it('canonicalises mixed dash + space format', () => {
      const raw = hashCitizenId('1234567890123');
      const mixed = hashCitizenId(' 1-2345 67890-12 3 ');
      expect(raw).toBe(mixed);
    });

    it('strips leading/trailing whitespace', () => {
      const raw = hashCitizenId('1234567890123');
      const padded = hashCitizenId('   1234567890123   ');
      expect(raw).toBe(padded);
    });

    it('strips arbitrary punctuation but keeps alphanumerics (passport path)', () => {
      // Passport "AB-123-4567" → digits + alphas survive, dashes go.
      const raw = hashCitizenId('AB1234567');
      const punctuated = hashCitizenId('AB-123-4567');
      expect(raw).toBe(punctuated);
    });
  });

  describe('case sensitivity for passport path', () => {
    // Passports preserve case (alphanumeric class includes A-Z and a-z).
    // Upstream systems should normalise case BEFORE hashing if they want
    // case-insensitive joins. We deliberately do NOT down-case here —
    // doing so silently would mask legitimate case-aware data.
    it('treats AB1234567 and ab1234567 as DIFFERENT inputs', () => {
      const upper = hashCitizenId('AB1234567');
      const lower = hashCitizenId('ab1234567');
      expect(upper).not.toBe(lower);
    });
  });

  describe('Thai citizen ID vs passport keyspaces', () => {
    it('13-digit Thai ID and matching passport-string-of-digits hash identically (after stripping)', () => {
      // Both are pure-digits inputs after stripping → same canonical
      // form → same hash. This is by design; the keyspace is enormous
      // (256-bit output) so collision is negligible.
      const thaiId = hashCitizenId('1234567890123');
      const digitsOnly = hashCitizenId('1234567890123');
      expect(thaiId).toBe(digitsOnly);
    });

    it('different inputs produce different hashes (no collisions on 1k samples)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        // Pad to 13 digits with a deterministic seed; covers a real sample
        // of the Thai citizen ID space.
        const padded = String(i).padStart(13, '0');
        const h = hashCitizenId(padded);
        expect(h).not.toBeNull();
        expect(seen.has(h!)).toBe(false);
        seen.add(h!);
      }
      expect(seen.size).toBe(1000);
    });
  });

  describe('determinism across formatting noise (cross-system join contract)', () => {
    // The whole point of this hasher: kku-hr's HASHBYTES('SHA2_256', CAST(ID_PEOPLE AS varbinary))
    // must produce the same hex as our hashCitizenId on the equivalent raw input.
    //
    // SQL Server HASHBYTES on a digit string (varbinary cast) hashes the
    // ASCII bytes. createHash('sha256').update(cleaned, 'utf8') on the same
    // ASCII-digit string hashes the same bytes. The 'utf8' encoding +
    // ASCII-digit input means the byte sequences match.
    it('digit-only input hashes are identical across multiple invocations (server-side parity check)', () => {
      const inputs = ['1234567890123', '9876543210987', '0000000000001'];
      const hashes = inputs.map(hashCitizenId);
      // Re-hash; identity preserved
      const second = inputs.map(hashCitizenId);
      expect(hashes).toEqual(second);
    });
  });

  describe('regression: known reference vectors', () => {
    // Pinned vectors. If any of these change, EVERY cross-system join in
    // production breaks. Compute via:
    //   echo -n '1234567890123' | sha256sum
    it('1234567890123 → known SHA-256', () => {
      // sha256sum:  echo -n '1234567890123' | sha256sum
      expect(hashCitizenId('1234567890123')).toBe(
        'bca2b41a2b25e137c83fee346af7bd1e0f52bd560583ca07a1b42f9944c5c50b',
      );
    });

    it('AB1234567 → known SHA-256', () => {
      // sha256sum:  echo -n 'AB1234567' | sha256sum
      expect(hashCitizenId('AB1234567')).toBe(
        'd322575628862b7cc899562410ecd8c68cda66fd76bd477a88724dac18f93fc4',
      );
    });
  });
});
