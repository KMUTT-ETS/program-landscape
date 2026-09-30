// Caller-IP allowlists for machine clients. Entries are bare addresses or
// CIDRs, IPv4 or IPv6. An empty list means "any address".
import { BlockList, isIP } from 'node:net';

interface ParsedEntry {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

function parseEntry(entry: string): ParsedEntry | null {
  const trimmed = entry.trim();
  const slash = trimmed.indexOf('/');
  const address = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const prefixRaw = slash === -1 ? null : trimmed.slice(slash + 1);
  const version = isIP(address);
  if (version === 0) return null;
  const max = version === 4 ? 32 : 128;
  if (prefixRaw !== null && !/^\d{1,3}$/.test(prefixRaw)) return null;
  const prefix = prefixRaw === null ? max : Number(prefixRaw);
  if (prefix > max) return null;
  return { address, prefix, family: version === 4 ? 'ipv4' : 'ipv6' };
}

export function isValidAllowlistEntry(entry: string): boolean {
  return parseEntry(entry) !== null;
}

/** Express reports IPv4 callers on a dual-stack socket as ::ffff:a.b.c.d. */
function unwrapMapped(ip: string): string {
  const tail = ip.startsWith('::ffff:') ? ip.slice(7) : null;
  return tail !== null && isIP(tail) === 4 ? tail : ip;
}

export function ipAllowed(ip: string | null | undefined, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!ip) return false;
  const addr = unwrapMapped(ip);
  const version = isIP(addr);
  if (version === 0) return false;
  const list = new BlockList();
  for (const entry of allowlist) {
    const parsed = parseEntry(entry);
    if (parsed) list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  return list.check(addr, version === 4 ? 'ipv4' : 'ipv6');
}
