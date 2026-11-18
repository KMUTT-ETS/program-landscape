#!/usr/bin/env node
// One command for workshop participants who do not code:
//
//   pnpm workshop:start   # build, set up and start the whole app in Docker
//   pnpm workshop:stop    # stop it (the data is kept for next time)
//
// Drives docker-compose.workshop.yml. Dependency-free on purpose: it runs
// before (and instead of) `pnpm install`, so it may only use Node built-ins.
// Works on Windows, WSL2, macOS and Linux.
//
// What `start` does, in order:
//   1. checks Docker is installed and running
//   2. creates .env from .env.example if it is missing, generates
//      NEXTAUTH_SECRET if it is empty, and offers to store an AI key
//   3. builds the images one at a time (in parallel they can exhaust a
//      16 GB laptop's memory)
//   4. starts everything; the compose file runs migrations, data-source
//      registration, buckets and the reference seed before the app
//   5. waits until the web app answers, then prints the address to open
//
// Secrets are never printed.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(root, 'docker-compose.workshop.yml');
const envPath = path.join(root, '.env');
const envExample = path.join(root, '.env.example');

// Heavy images first and one at a time; the small ones build together.
const BUILD_STEPS = [['web'], ['api'], ['ingestion'], ['postgres', 'gotenberg', 'markitdown']];
const SETUP_SERVICES = ['migrate', 'first-boot'];

const say = (msg = '') => console.log(msg);
const step = (msg) => console.log(`\n▶ ${msg}`);
function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function run(cmd, args, { quiet = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  return { ok: res.status === 0 && !res.error, error: res.error, stdout: res.stdout ?? '' };
}

const compose = (args, opts) => run('docker', ['compose', '-f', composeFile, ...args], opts);

// ── .env handling ────────────────────────────────────────────────────────
function readEnv() {
  const values = {};
  if (!existsSync(envPath)) return values;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    values[m[1]] = v;
  }
  return values;
}

// Replace KEY=… in place (or append it), keeping every other line as it was.
function setEnv(key, value) {
  const original = readFileSync(envPath, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  const re = new RegExp(`^\\s*(export\\s+)?${key}\\s*=`);
  let found = false;
  const updated = lines.map((line) => {
    if (!re.test(line)) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) {
    if (updated.length && updated[updated.length - 1] === '') updated.splice(-1, 0, `${key}=${value}`);
    else updated.push(`${key}=${value}`);
  }
  writeFileSync(envPath, updated.join(eol));
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function prepareEnv() {
  step('Checking the settings file (.env)');
  if (!existsSync(envPath)) {
    copyFileSync(envExample, envPath);
    say('  Created .env from .env.example.');
  }
  let env = readEnv();

  if (!env.NEXTAUTH_SECRET) {
    setEnv('NEXTAUTH_SECRET', randomBytes(64).toString('hex'));
    say('  Generated a sign-in secret.');
  }

  const hasKey = env.GOOGLE_AI_API_KEY || env.OPENROUTER_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY;
  if ((!env.AI_PROVIDER || env.AI_PROVIDER === 'stub' || !hasKey) && process.stdin.isTTY) {
    say('  No AI key is set yet. The app starts without one, but the analysis');
    say('  pipeline needs it. A Google Gemini key is the simplest choice.');
    const key = await ask('  Paste your Gemini key and press Enter (or just press Enter to skip): ');
    if (key) {
      if (!/^[A-Za-z0-9_-]{20,}$/.test(key)) fail('That does not look like a Gemini key. Run the command again and paste only the key.');
      setEnv('AI_PROVIDER', 'google');
      setEnv('GOOGLE_AI_API_KEY', key);
      say('  Saved the key to .env.');
    } else {
      say('  Skipped. Add it later in .env (AI_PROVIDER=google, GOOGLE_AI_API_KEY=…) and run this command again.');
    }
  } else if (hasKey) {
    say(`  AI provider: ${env.AI_PROVIDER}.`);
  }
  env = readEnv();
  return env;
}

// ── Docker checks ────────────────────────────────────────────────────────
function checkDocker() {
  step('Checking Docker');
  const v = run('docker', ['--version'], { quiet: true });
  if (!v.ok) {
    fail(
      'Docker is not installed, or this terminal cannot see it.\n' +
        '  Install Docker Desktop. On Windows, open Docker Desktop → Settings → Resources →\n' +
        '  WSL integration, switch on your Ubuntu distribution, then open a new terminal.',
    );
  }
  if (!run('docker', ['info'], { quiet: true }).ok) {
    fail('Docker is installed but not running. Start Docker Desktop, wait until it says "running", then try again.');
  }
  if (!run('docker', ['compose', 'version'], { quiet: true }).ok) {
    fail('Docker Compose v2 is missing. Update Docker Desktop to the latest version.');
  }
  say('  Docker is running.');
}

// ── Wait for the web app ─────────────────────────────────────────────────
async function waitForWeb(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

function showLogs(services) {
  say('\n── Last log lines ──');
  compose(['logs', '--no-color', '--tail', '60', ...services]);
}

// ── Commands ─────────────────────────────────────────────────────────────
async function start() {
  say('Program Landscape — workshop start');
  checkDocker();
  const env = await prepareEnv();
  const port = process.env.WORKSHOP_WEB_PORT || env.WORKSHOP_WEB_PORT || '3000';

  step('Building the app (the first time takes 20–40 minutes; later runs take a minute or two)');
  for (const services of BUILD_STEPS) {
    say(`  Building ${services.join(', ')} …`);
    if (!compose(['build', ...services]).ok) {
      fail(
        `Building ${services.join(', ')} failed. Read the red lines above.\n` +
          '  "no space left on device": free disk space (25 GB needed).\n' +
          '  "killed" or exit code 137: give Docker more memory (8 GB or more).\n' +
          '  Network errors: check the internet connection and run the command again.',
      );
    }
  }

  step('Starting the app and preparing the database');
  if (!compose(['up', '-d', '--remove-orphans']).ok) {
    showLogs([...SETUP_SERVICES, 'api']);
    fail('Starting failed. The log lines above show why; show them to a facilitator.');
  }

  step(`Waiting for the app at http://localhost:${port}`);
  if (!(await waitForWeb(`http://localhost:${port}/api/auth/providers`, 5 * 60_000))) {
    showLogs(['web', 'api']);
    fail('The app did not answer within 5 minutes. Show the log lines above to a facilitator.');
  }

  say(`
✓ Program Landscape is running.

  Open http://localhost:${port} in Chrome, Edge or Firefox.

  First time? Open http://localhost:${port}/setup at once and create the
  administrator account — the first person to open that page becomes the admin.

  Stop it:      pnpm workshop:stop     (your data is kept)
  Start again:  pnpm workshop:start
`);
}

function stop() {
  say('Program Landscape — workshop stop');
  checkDocker();
  if (!compose(['down']).ok) fail('Stopping failed. Read the lines above.');
  say('\n✓ Stopped. Your data is kept; run `pnpm workshop:start` to continue.');
}

const command = process.argv[2] ?? 'start';
if (command === 'start') await start();
else if (command === 'stop') stop();
else fail(`Unknown command "${command}". Use "start" or "stop".`);
