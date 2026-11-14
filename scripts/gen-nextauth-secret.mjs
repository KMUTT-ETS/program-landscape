#!/usr/bin/env node
// Generates a fresh NEXTAUTH_SECRET and writes it into .env in place.
//
//   pnpm secret:nextauth                 # updates ./.env
//   pnpm secret:nextauth --file=.env.prod
//
// - Replaces an existing NEXTAUTH_SECRET line (commented-out lines are left alone),
//   or appends one if the key is missing. Every other line is preserved byte-for-byte,
//   including CRLF line endings.
// - The secret itself is never printed.
// - Rotating the secret signs every user out (existing JWTs stop verifying);
//   restart web + api afterwards so both pick up the same value.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = 'NEXTAUTH_SECRET';
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const fileArg = process.argv.slice(2).find((a) => a.startsWith('--file='));
const envPath = fileArg
  ? path.resolve(process.cwd(), fileArg.slice('--file='.length))
  : path.join(repoRoot, '.env');

if (!existsSync(envPath)) {
  console.error(`✗ ${envPath} not found. Copy .env.example to .env first.`);
  process.exit(1);
}

// 64 random bytes as hex: matches `openssl rand -hex 64` used in the deploy docs,
// and hex never contains `#`, quotes or `=` so it needs no quoting in dotenv.
const secret = randomBytes(64).toString('hex');

const original = readFileSync(envPath, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
const lines = original.split(/\r?\n/);
const keyLine = new RegExp(`^\\s*(export\\s+)?${KEY}\\s*=`);

let replaced = 0;
const updated = lines.map((line) => {
  const m = line.match(keyLine);
  if (!m) return line;
  replaced += 1;
  return `${m[1] ?? ''}${KEY}=${secret}`;
});

if (replaced === 0) {
  // Append before the trailing empty element (if the file ends with a newline).
  if (updated.length > 0 && updated[updated.length - 1] === '') {
    updated.splice(updated.length - 1, 0, `${KEY}=${secret}`);
  } else {
    updated.push(`${KEY}=${secret}`);
  }
}

writeFileSync(envPath, updated.join(eol));

const rel = path.relative(process.cwd(), envPath) || envPath;
console.log(
  replaced > 0
    ? `✓ Replaced ${KEY} in ${rel}${replaced > 1 ? ` (${replaced} lines)` : ''}.`
    : `✓ Added ${KEY} to ${rel}.`,
);
console.log('  Restart web + api so both use the new secret (existing sessions are signed out).');
