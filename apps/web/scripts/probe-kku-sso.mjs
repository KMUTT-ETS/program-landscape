#!/usr/bin/env node
// Probe the KKU SSONext (UAT-Stage) endpoints from .env.
//
// KKU SSONext is a CUSTOM protocol — not standard OIDC. This probe verifies:
//   1. login endpoint reachability (GET /login?app=<AppID>)
//   2. token endpoint shape    (POST /auth.token with bogus code → ok:false)
//   3. profile endpoint exists (POST /user.profile with bogus token → 401)
//   4. status endpoint exists  (POST /auth.status with bogus token → 401)
//
// We can't end-to-end test without a real `code` from a live login round-trip;
// the user has to do that part in a browser. This probe just confirms the
// endpoints exist and accept our credentials shape.
//
// Run: node apps/web/scripts/probe-kku-sso.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(file) {
  const text = readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(path.resolve(__dirname, '../../../.env'));

// KKU SSONext requires: App ID + Client ID + Client Secret. The current .env
// uses OIDC-style names — we accept either set during the migration.
const appId = process.env.KKU_SSO_APP_ID ?? process.env.KKU_SSO_CLIENT_ID;
const clientId = process.env.KKU_SSO_CLIENT_ID;
const clientSecret = process.env.KKU_SSO_CLIENT_SECRET;
const redirectUrl = process.env.KKU_SSO_REDIRECT_URI;

const WEB_BASE = process.env.KKU_SSO_WEB_BASE ?? 'https://sso-uat-web.kku.ac.th';
const API_BASE = process.env.KKU_SSO_API_BASE ?? 'https://sso-uat-api.kku.ac.th';

console.log('─── KKU SSONext probe (UAT-Stage) ───');
console.log(`web base     : ${WEB_BASE}`);
console.log(`api base     : ${API_BASE}`);
console.log(`app id       : ${appId ?? '(missing)'}`);
console.log(`client id    : ${clientId ? clientId.slice(0, 8) + '…' + clientId.slice(-4) : '(missing)'}`);
console.log(`client secret: ${clientSecret ? '(' + clientSecret.length + ' chars)' : '(missing)'}`);
console.log(`redirect url : ${redirectUrl ?? '(missing)'}`);
console.log('');

if (!appId || !clientId || !clientSecret || !redirectUrl) {
  console.error('✗ missing required env values. Need:');
  console.error('   KKU_SSO_APP_ID (or reuse KKU_SSO_CLIENT_ID)');
  console.error('   KKU_SSO_CLIENT_ID');
  console.error('   KKU_SSO_CLIENT_SECRET');
  console.error('   KKU_SSO_REDIRECT_URI');
  process.exit(1);
}

let pass = 0;
let fail = 0;

async function probe(label, fn) {
  process.stdout.write(`  ${label.padEnd(28)} ... `);
  try {
    const result = await fn();
    console.log(`✓ ${result}`);
    pass += 1;
  } catch (err) {
    console.log(`✗ ${err?.message ?? err}`);
    fail += 1;
  }
}

console.log('1. login endpoint (browser-facing)');
await probe('GET /login?app=<AppID>', async () => {
  const url = `${WEB_BASE}/login?app=${encodeURIComponent(appId)}`;
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
  if (res.status === 200 || res.status === 302 || res.status === 301) {
    return `HTTP ${res.status} — login page reachable`;
  }
  if (res.status === 404) throw new Error('HTTP 404 — App ID likely not registered');
  throw new Error(`HTTP ${res.status}`);
});

console.log('');
console.log('2. token endpoint (machine-to-machine)');
await probe('POST /auth.token (bogus code)', async () => {
  const res = await fetch(`${API_BASE}/auth.token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: '00000000-0000-0000-0000-000000000000',
      redirectUrl,
      clientId,
      clientSecret,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} (expected 200 with ok:false)`);
  if (!body) throw new Error('empty/non-JSON body');
  if (body.ok === false && typeof body.error === 'string') {
    return `HTTP 200, ok:false, error="${body.error}" — endpoint speaks the protocol`;
  }
  if (body.ok === true) {
    return `HTTP 200, ok:true (unexpected — bogus code should fail). raw: ${JSON.stringify(body).slice(0, 120)}`;
  }
  throw new Error(`unexpected body shape: ${JSON.stringify(body).slice(0, 200)}`);
});

console.log('');
console.log('3. profile endpoint (token-gated)');
await probe('POST /user.profile (bogus tok)', async () => {
  const res = await fetch(`${API_BASE}/user.profile`, {
    method: 'POST',
    headers: { authorization: 'Bearer aaaaaaaaaaaaaaaaaa' },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401) return 'HTTP 401 — endpoint exists, rejects bogus token correctly';
  if (res.status === 200) {
    const body = await res.json().catch(() => null);
    if (body?.ok === false) return `HTTP 200, ok:false — endpoint exists`;
    return `HTTP 200 (unexpected: ${JSON.stringify(body).slice(0, 80)})`;
  }
  throw new Error(`HTTP ${res.status} (expected 401)`);
});

console.log('');
console.log('4. status endpoint (token-gated)');
await probe('POST /auth.status (bogus tok)', async () => {
  const res = await fetch(`${API_BASE}/auth.status`, {
    method: 'POST',
    headers: { authorization: 'Bearer aaaaaaaaaaaaaaaaaa' },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401) return 'HTTP 401 — endpoint exists, rejects bogus token correctly';
  throw new Error(`HTTP ${res.status} (expected 401)`);
});

console.log('');
console.log('─── summary ───');
console.log(`  passed: ${pass}`);
console.log(`  failed: ${fail}`);

if (fail === 0) {
  console.log('');
  console.log('✓ KKU SSONext endpoints are reachable and credentials parse.');
  console.log('  To test end-to-end, open this URL in a browser:');
  console.log('');
  console.log(`    ${WEB_BASE}/login?app=${encodeURIComponent(appId)}`);
  console.log('');
  console.log('  After signing in, KKU will redirect to:');
  console.log(`    ${redirectUrl}?code=<uuid>`);
  console.log('  Capture the `code` and POST it to /auth.token to receive accessToken + profile.');
}
