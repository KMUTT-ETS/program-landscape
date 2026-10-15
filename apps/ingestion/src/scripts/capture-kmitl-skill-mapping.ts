#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Discovery-only capture for the kmitl-skill-mapping connector.
//
// KMITL Skill Mapping API — server-to-server, Method 1 token (direct).
// Output JSON fixtures land in apps/ingestion/test/fixtures/kmitl-skill-mapping/.
// All fixtures are aggregate-only (career/group/skill counts + percentages).
// A no-PII guard runs before each fixture lands; any field containing
// `email|phone|name` outside the allowed entity-name fields aborts capture.
//
// Usage:
//   pnpm kmitl:capture ping              # auth + base URL smoke test
//   pnpm kmitl:capture groups            # GET /groups → list of all groups
//   pnpm kmitl:capture group-sample      # GET /groups/{first} → one full group payload
//   pnpm kmitl:capture career-sample     # GET /career then /career/{first} → one career
//   pnpm kmitl:capture skills            # GET /skills
//   pnpm kmitl:capture industries        # GET /industries
//   pnpm kmitl:capture universities      # GET /universities
//   pnpm kmitl:capture all               # everything above
//
// Reads from .env:
//   KMITL_SKILL_MAPPING_BASE_URL  (default https://skill.kmitl.ac.th/api/v1)
//   KMITL_SKILL_MAPPING_CLIENT_ID
//   KMITL_SKILL_MAPPING_SECRET_KEY
//
// Phase A stub — data-fetching subcommands print a "credentials missing"
// notice and exit 0 if env keys are unset, so the script is safe to run
// before credentials are issued. Full implementation lands in Phase B.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

// Same shape as outboundUserAgent() in packages/shared/src/institution.ts.
// Inlined because this script imports nothing from the workspace, so it
// runs as a plain compiled file on the prod server.
function outboundUserAgent(purpose: string): string {
  const appUrl = process.env.APP_PUBLIC_URL?.trim() || 'https://program-landscape.kku.ac.th';
  const contact =
    process.env.INSTITUTION_CONTACT_EMAIL?.trim() || process.env.OPENALEX_MAILTO?.trim();
  return `Program-Landscape/1.0 ${purpose} (+${appUrl}${contact ? `; ${contact}` : ''})`;
}

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const FIXTURE_DIR = path.resolve(__dirname, '../../test/fixtures/kmitl-skill-mapping');
const DEFAULT_BASE_URL = 'https://skill.kmitl.ac.th/api/v1';

interface Credentials {
  baseUrl: string;
  clientId: string;
  secretKey: string;
}

function readCredentials(): Credentials | null {
  const baseUrl = process.env.KMITL_SKILL_MAPPING_BASE_URL || DEFAULT_BASE_URL;
  const clientId = process.env.KMITL_SKILL_MAPPING_CLIENT_ID;
  const secretKey = process.env.KMITL_SKILL_MAPPING_SECRET_KEY;
  if (!clientId || !secretKey) return null;
  return { baseUrl, clientId, secretKey };
}

function buildDirectToken(creds: Credentials): string {
  return Buffer.from(`${creds.clientId}:${creds.secretKey}`, 'utf8').toString('base64');
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
}

// PII guard — KMITL contractually returns aggregate-only data, but we double
// check on the way out. Any object key matching /email|phone|address|tax_id|
// citizen_id/i aborts the capture. The `name` field is allowed only on
// known taxonomy entities (university, industry, career, skill, group).
const PII_FIELD_PATTERNS = [/email/i, /phone/i, /address/i, /tax_id/i, /citizen/i, /passport/i];
function assertNoPii(payload: unknown, location: string): void {
  const stack: Array<{ value: unknown; path: string }> = [{ value: payload, path: location }];
  while (stack.length) {
    const { value, path: p } = stack.pop()!;
    if (Array.isArray(value)) {
      for (const [idx, v] of value.entries()) stack.push({ value: v, path: `${p}[${idx}]` });
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (PII_FIELD_PATTERNS.some((rx) => rx.test(k))) {
          throw new Error(`[no-PII guard] field "${k}" at ${p}.${k} matches a forbidden pattern; aborting capture.`);
        }
        stack.push({ value: v, path: `${p}.${k}` });
      }
    }
  }
}

async function writeFixture(name: string, data: unknown): Promise<void> {
  assertNoPii(data, name);
  const target = path.join(FIXTURE_DIR, `${name}.json`);
  await fs.writeFile(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  → wrote ${path.relative(process.cwd(), target)}`);
}

async function httpGet(creds: Credentials, pathSegment: string): Promise<unknown> {
  const url = `${creds.baseUrl.replace(/\/$/, '')}/${pathSegment.replace(/^\//, '')}`;
  const token = buildDirectToken(creds);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': outboundUserAgent('discovery'),
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ─── subcommands ─────────────────────────────────────────────────────────────

async function ping(creds: Credentials): Promise<void> {
  console.log(`pinging ${creds.baseUrl}/`);
  const data = await httpGet(creds, '/');
  console.log('  response:', JSON.stringify(data, null, 2));
  await writeFixture('ping', data);
}

async function captureGroups(creds: Credentials): Promise<void> {
  console.log('GET /groups');
  const data = await httpGet(creds, '/groups');
  await writeFixture('groups', data);
}

async function captureGroupSample(creds: Credentials): Promise<void> {
  console.log('GET /groups → pick first → GET /groups/{id}');
  const groups = (await httpGet(creds, '/groups')) as Array<{ id: number; name: string }>;
  const first = groups[0];
  if (!Array.isArray(groups) || !first) {
    throw new Error('Expected /groups to return a non-empty array');
  }
  const detail = await httpGet(creds, `/groups/${first.id}`);
  await writeFixture('group-detail-sample', { groupId: first.id, groupName: first.name, payload: detail });
}

async function captureCareerSample(creds: Credentials): Promise<void> {
  // PDF guideline 1.9.1-OBT documents `/career` (singular); live API uses
  // `/careers` (plural). Confirmed via probe 2026-05-01. Don't trust the PDF
  // path on its own.
  console.log('GET /careers → pick first → GET /careers/{id}');
  const careers = (await httpGet(creds, '/careers')) as Array<{ id: number; name: string }>;
  const first = careers[0];
  if (!Array.isArray(careers) || !first) {
    throw new Error('Expected /careers to return a non-empty array');
  }
  const detail = await httpGet(creds, `/careers/${first.id}`);
  await writeFixture('careers', careers.slice(0, 50));
  await writeFixture('career-detail-sample', { careerId: first.id, careerName: first.name, payload: detail });
}

async function captureSkills(creds: Credentials): Promise<void> {
  console.log('GET /skills');
  const data = await httpGet(creds, '/skills');
  await writeFixture('skills', data);
}

async function captureIndustries(creds: Credentials): Promise<void> {
  console.log('GET /industries');
  const data = await httpGet(creds, '/industries');
  await writeFixture('industries', data);
}

async function captureUniversities(creds: Credentials): Promise<void> {
  console.log('GET /universities');
  const data = await httpGet(creds, '/universities');
  await writeFixture('universities', data);
}

const SUBCOMMANDS: Record<string, (c: Credentials) => Promise<void>> = {
  ping,
  groups: captureGroups,
  'group-sample': captureGroupSample,
  'career-sample': captureCareerSample,
  skills: captureSkills,
  industries: captureIndustries,
  universities: captureUniversities,
};

async function main(): Promise<void> {
  const sub = process.argv[2];
  if (!sub) {
    console.error('Usage: pnpm kmitl:capture <subcommand>');
    console.error('  subcommands: ' + Object.keys(SUBCOMMANDS).concat(['all']).join(', '));
    process.exit(1);
  }

  const creds = readCredentials();
  if (!creds) {
    console.log('⚠ KMITL credentials missing — set KMITL_SKILL_MAPPING_CLIENT_ID and KMITL_SKILL_MAPPING_SECRET_KEY in .env.');
    console.log('  (This is expected in Phase A; rerun once credentials are issued.)');
    process.exit(0);
  }

  await ensureDir();

  const order = sub === 'all'
    ? ['ping', 'groups', 'group-sample', 'career-sample', 'skills', 'industries', 'universities']
    : [sub];

  for (const name of order) {
    const fn = SUBCOMMANDS[name];
    if (!fn) {
      console.error(`unknown subcommand: ${name}`);
      process.exit(1);
    }
    try {
      await fn(creds);
    } catch (err) {
      console.error(`✗ ${name} failed:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
