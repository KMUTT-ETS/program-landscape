import { createHash } from 'node:crypto';

// Stable SHA-256 of any JSON-serialisable value. Keys are sorted so
// `{a:1,b:2}` hashes the same as `{b:2,a:1}`, which lets us detect
// repeated identical requests regardless of argument ordering.
export function stableHash(value: unknown): string {
  const canonical = JSON.stringify(value, replacer);
  return createHash('sha256').update(canonical).digest('hex');
}

function replacer(_key: string, v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = obj[k];
        return acc;
      }, {});
  }
  return v;
}
