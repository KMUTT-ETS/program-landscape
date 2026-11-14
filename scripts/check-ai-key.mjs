#!/usr/bin/env node
// Checks that the AI provider configured in .env actually answers, before the
// pipeline needs it. Makes one small request per check (a few tokens at most).
//
//   pnpm ai:check-key                    # reads ./.env
//   pnpm ai:check-key --file=.env.prod
//
// Checks, for the configured AI_PROVIDER:
//   google      completion with GOOGLE_AI_API_KEY, then embeddings
//   openrouter  key status and remaining credit, a completion, then embeddings
//               (Google when GOOGLE_AI_API_KEY is set, else AI_OPENROUTER_EMBEDDING_MODEL,
//               which must return 1536 dimensions)
//   anthropic   key status, then embeddings through Google
//   stub        fails: stub makes no AI calls, so the pipeline cannot run
//
// The key is never printed. It is sent in a header, never in a URL.
// Exit code 0 = every check passed, 1 = a check failed or the config is incomplete.
// Uses only Node built-ins, so it works before `pnpm install`.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileArg = process.argv.slice(2).find((a) => a.startsWith('--file='));
const envPath = fileArg
  ? path.resolve(process.cwd(), fileArg.slice('--file='.length))
  : path.join(repoRoot, '.env');

// Must match the code defaults in packages/shared/src/ai/providers/.
const GOOGLE_COMPLETION_DEFAULT = 'gemini-3.5-flash';
const GOOGLE_EMBEDDING_DEFAULT = 'gemini-embedding-001';
const OPENROUTER_COMPLETION_DEFAULT = 'google/gemini-2.5-flash';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const EMBEDDING_DIMENSIONS = 1536; // vector(1536) in packages/db/prisma/schema.prisma
const TIMEOUT_MS = 60_000;

function parseEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0) {
      value = value.slice(1, value.indexOf(quote, 1));
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    env[m[1]] = value;
  }
  return env;
}

if (!existsSync(envPath)) {
  console.error(`✗ ${envPath} not found. Copy .env.example to .env first.`);
  process.exit(1);
}

const env = parseEnv(readFileSync(envPath, 'utf8'));
const get = (k) => (env[k] ?? '').trim();
const secrets = ['GOOGLE_AI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY']
  .map(get)
  .filter((v) => v.length >= 8);

// Error bodies should never echo a key, but strip any that do before printing.
function scrub(text) {
  let out = String(text ?? '');
  for (const s of secrets) out = out.split(s).join('[REDACTED]');
  return out.replace(/\s+/g, ' ').trim().slice(0, 240);
}

let failed = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg, hint) => {
  failed += 1;
  console.log(`✗ ${msg}`);
  if (hint) console.log(`  ${hint}`);
};

async function request(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON; keep the text for the message
    }
    return { status: res.status, json, text };
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : err?.message;
    return { status: 0, json: null, text: reason };
  }
}

function explain(res) {
  const detail = scrub(res.json?.error?.message ?? res.json?.message ?? res.text);
  switch (res.status) {
    case 0:
      return `network error: ${detail}. Check the internet connection or proxy.`;
    case 400:
      return /API key|API_KEY/i.test(detail)
        ? `the key was refused (${detail}). Copy the key again, without spaces or quotes.`
        : `bad request: ${detail}`;
    case 401:
    case 403:
      return `the key was refused (HTTP ${res.status}): ${detail}`;
    case 402:
      return `no credit left (HTTP 402). Add credit to the account: ${detail}`;
    case 404:
      return `model not found (HTTP 404). Check the model name in .env: ${detail}`;
    case 429:
      return `quota or rate limit reached (HTTP 429). Wait, or check the account's limits: ${detail}`;
    default:
      return `HTTP ${res.status}: ${detail}`;
  }
}

async function checkGoogleCompletion(key) {
  const model = get('AI_GOOGLE_COMPLETION_MODEL') || GOOGLE_COMPLETION_DEFAULT;
  const res = await request(`${GOOGLE_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
      // Same as the app: thinking off, so the answer comes back fast.
      generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (res.status === 200) ok(`Google completion answers (model ${model})`);
  else fail(`Google completion failed (model ${model}): ${explain(res)}`);
}

async function checkGoogleEmbedding(key) {
  const model = get('AI_GOOGLE_EMBEDDING_MODEL') || GOOGLE_EMBEDDING_DEFAULT;
  const res = await request(`${GOOGLE_BASE_URL}/models/${encodeURIComponent(model)}:embedContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      content: { parts: [{ text: 'curriculum' }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  });
  const dims = res.json?.embedding?.values?.length;
  if (res.status !== 200) fail(`Google embeddings failed (model ${model}): ${explain(res)}`);
  else if (dims !== EMBEDDING_DIMENSIONS)
    fail(`Google embeddings returned ${dims} dimensions, expected ${EMBEDDING_DIMENSIONS} (model ${model})`);
  else ok(`Google embeddings answer (model ${model}, ${dims} dimensions)`);
}

async function checkOpenRouter(key) {
  const auth = { authorization: `Bearer ${key}` };
  const status = await request(`${OPENROUTER_BASE_URL}/key`, { headers: auth });
  if (status.status !== 200) {
    fail(`OpenRouter key check failed: ${explain(status)}`);
    return false;
  }
  const data = status.json?.data ?? {};
  const remaining = data.limit_remaining;
  if (typeof remaining === 'number' && remaining <= 0) {
    fail('OpenRouter key is valid but has no credit left', 'Add credit, or raise the key limit, at openrouter.ai.');
    return false;
  }
  ok(
    typeof remaining === 'number'
      ? `OpenRouter key is valid (USD ${remaining.toFixed(2)} left on its limit)`
      : 'OpenRouter key is valid (no spending limit set on the key)',
  );

  const model = get('AI_OPENROUTER_COMPLETION_MODEL') || OPENROUTER_COMPLETION_DEFAULT;
  const res = await request(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_tokens: 16,
    }),
  });
  if (res.status === 200) ok(`OpenRouter completion answers (model ${model})`);
  else fail(`OpenRouter completion failed (model ${model}): ${explain(res)}`);
  return true;
}

async function checkOpenRouterEmbedding(key) {
  const model = get('AI_OPENROUTER_EMBEDDING_MODEL');
  const res = await request(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: 'curriculum', dimensions: EMBEDDING_DIMENSIONS }),
  });
  const dims = res.json?.data?.[0]?.embedding?.length;
  if (res.status !== 200) fail(`OpenRouter embeddings failed (model ${model}): ${explain(res)}`);
  else if (dims !== EMBEDDING_DIMENSIONS)
    fail(
      `OpenRouter embeddings returned ${dims} dimensions, expected ${EMBEDDING_DIMENSIONS} (model ${model})`,
      'Pick a 1536-dimension model, e.g. openai/text-embedding-3-small.',
    );
  else ok(`OpenRouter embeddings answer (model ${model}, ${dims} dimensions)`);
}

async function checkAnthropic(key) {
  const res = await request('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  });
  if (res.status === 200) ok('Anthropic key is valid');
  else fail(`Anthropic key check failed: ${explain(res)}`);
}

const provider = (get('AI_PROVIDER') || 'google').toLowerCase();
const relPath = path.relative(process.cwd(), envPath);
const rel = relPath && !relPath.startsWith('..') ? relPath : envPath;
console.log(`Checking AI_PROVIDER=${provider} from ${rel}\n`);

const googleKey = get('GOOGLE_AI_API_KEY');

switch (provider) {
  case 'stub':
    fail(
      'AI_PROVIDER=stub makes no AI calls, so the curriculum pipeline cannot run.',
      'Set AI_PROVIDER=google (with GOOGLE_AI_API_KEY) or AI_PROVIDER=openrouter (with OPENROUTER_API_KEY).',
    );
    break;

  case 'google':
    if (!googleKey) {
      fail('AI_PROVIDER=google but GOOGLE_AI_API_KEY is empty.');
      break;
    }
    await checkGoogleCompletion(googleKey);
    await checkGoogleEmbedding(googleKey);
    break;

  case 'openrouter': {
    const key = get('OPENROUTER_API_KEY');
    if (!key) {
      fail('AI_PROVIDER=openrouter but OPENROUTER_API_KEY is empty.');
      break;
    }
    const usable = await checkOpenRouter(key);
    if (googleKey) await checkGoogleEmbedding(googleKey);
    else if (get('AI_OPENROUTER_EMBEDDING_MODEL')) {
      if (usable) await checkOpenRouterEmbedding(key);
    } else
      fail(
        'No embeddings configured: with OpenRouter and no GOOGLE_AI_API_KEY, set AI_OPENROUTER_EMBEDDING_MODEL.',
        'Use a 1536-dimension model, e.g. AI_OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small.',
      );
    break;
  }

  case 'anthropic': {
    const key = get('ANTHROPIC_API_KEY');
    if (!key) {
      fail('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty.');
      break;
    }
    await checkAnthropic(key);
    if (googleKey) await checkGoogleEmbedding(googleKey);
    else fail('No embeddings configured: AI_PROVIDER=anthropic needs GOOGLE_AI_API_KEY for embeddings.');
    break;
  }

  default:
    fail(`AI_PROVIDER=${provider} is not one this check knows (google, openrouter, anthropic, stub).`);
}

console.log(failed === 0 ? '\nAI key check passed.' : `\nAI key check failed (${failed} problem${failed > 1 ? 's' : ''}).`);
process.exit(failed === 0 ? 0 : 1);
