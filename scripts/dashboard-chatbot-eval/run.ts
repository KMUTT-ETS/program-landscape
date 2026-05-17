#!/usr/bin/env tsx
/**
 * Dashboard chatbot evaluation harness.
 *
 * Walks the 80 scenarios in scenarios.jsonl, fires each turn against the
 * local dev server's /analyst/chat endpoint with kind=DASHBOARD, and
 * reports:
 *   - Tool calls executed per turn
 *   - Whether the response mentions any sanity-check-violating value
 *   - Whether refuse / redirect expectations matched
 *   - Total elapsed time + token cost
 *
 * Run BEFORE invoking:
 *   pnpm dev                       # start web + api in another shell
 *   export DASH_CHAT_TOKEN=<JWT>   # NextAuth session token for an analyst user
 *
 * Then:
 *   pnpm dash-chatbot:eval
 *   pnpm dash-chatbot:eval --filter=S-T-      # only teaching-workload
 *   pnpm dash-chatbot:eval --limit=5          # first 5 scenarios
 *   pnpm dash-chatbot:eval --out=results.json # dump full transcript
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Scenario = {
  id: string;
  category: string;
  turns: string[];
  checks?: {
    sanityMax?: Record<string, number | string>;
    sanityMin?: Record<string, number>;
    expectedTool?: string;
    refuseTurn?: number | number[];
    redirectTurn?: number;
    mustNotRefuse?: boolean;
    regression?: string;
    historicalGap?: boolean;
  };
};

type TurnResult = {
  scenarioId: string;
  turnIndex: number;
  userText: string;
  assistantText: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  refused: boolean;
  durationMs: number;
  costUsd: number;
  failures: string[];
};

const ARGS = parseArgs(process.argv.slice(2));
const API_BASE = process.env.DASH_CHAT_API_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.DASH_CHAT_TOKEN;
const OUT = ARGS.out;
const FILTER = ARGS.filter;
const LIMIT = ARGS.limit ? Number(ARGS.limit) : Infinity;

if (!TOKEN) {
  console.error('ERROR: set DASH_CHAT_TOKEN (NextAuth JWT) before running.');
  console.error('  Inspect cookies in your browser → "next-auth.session-token"');
  process.exit(1);
}

function parseArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

function loadScenarios(): Scenario[] {
  const file = resolve(__dirname, 'scenarios.jsonl');
  const text = readFileSync(file, 'utf-8');
  const scenarios: Scenario[] = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l) as Scenario;
      } catch (err) {
        throw new Error(`scenarios.jsonl line ${i + 1}: ${(err as Error).message}`);
      }
    });
  return scenarios;
}

async function fireTurn(args: {
  conversationId: string | null;
  message: string;
}): Promise<{
  conversationId: string;
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  refused: boolean;
  durationMs: number;
  costUsd: number;
}> {
  const t0 = Date.now();
  const res = await fetch(`${API_BASE}/api/proxy/analyst/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `next-auth.session-token=${TOKEN}`,
    },
    body: JSON.stringify({
      conversationId: args.conversationId ?? undefined,
      message: args.message,
      kind: 'DASHBOARD',
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const env = (await res.json()) as {
    data: {
      conversationId: string;
      text: string;
      refused: boolean;
      evidence: { toolCalls: Array<{ name: string; input: Record<string, unknown> }> };
      costUsd: number;
    };
  };
  const d = env.data;
  return {
    conversationId: d.conversationId,
    text: d.text,
    toolCalls: d.evidence.toolCalls,
    refused: d.refused,
    durationMs: Date.now() - t0,
    costUsd: d.costUsd,
  };
}

const NUMBER_RX = /[\d,]+(?:\.\d+)?/g;

function findSanityViolations(
  text: string,
  bounds: NonNullable<Scenario['checks']>['sanityMax'],
): string[] {
  if (!bounds) return [];
  const violations: string[] = [];
  // Loose heuristic: scan all numbers in the answer text. If one of them
  // exceeds a known bound for this scenario's domain, flag.
  const nums = (text.match(NUMBER_RX) ?? []).map((s) => Number(s.replace(/,/g, '')));
  for (const [key, ceiling] of Object.entries(bounds)) {
    if (typeof ceiling === 'string') continue; // qualitative ("refuse")
    if (key === 'gpa') {
      // GPA values are < 5 — look for any "X.YZ" near "GPA" / "เกรด"
      const gpaRegion = text.match(/(?:gpa|เกรด|gpa เฉลี่ย)[\s:]*([\d.]+)/gi);
      if (gpaRegion) {
        for (const m of gpaRegion) {
          const v = Number(m.match(/[\d.]+/)?.[0]);
          if (Number.isFinite(v) && v > (ceiling as number)) {
            violations.push(`Reported GPA ${v} > ${ceiling}`);
          }
        }
      }
    } else if (key === 'percentage') {
      // "X%" anywhere in the answer
      const pcts = text.match(/(\d+(?:\.\d+)?)\s*%/g);
      if (pcts) {
        for (const p of pcts) {
          const v = Number(p.match(/[\d.]+/)?.[0]);
          if (Number.isFinite(v) && v > (ceiling as number)) {
            violations.push(`Reported percentage ${v}% > ${ceiling}`);
          }
        }
      }
    } else if (key === 'hrsPerWeek') {
      // "X ชั่วโมง/สัปดาห์" / "X hrs/week"
      const hr = text.match(/(\d+(?:\.\d+)?)\s*(?:ชั่วโมง\/สัปดาห์|hrs?\/week|hr per week)/gi);
      if (hr) {
        for (const m of hr) {
          const v = Number(m.match(/[\d.]+/)?.[0]);
          if (Number.isFinite(v) && v > (ceiling as number)) {
            violations.push(`Reported workload ${v} hrs/week > ${ceiling}`);
          }
        }
      }
    } else {
      // Generic: any number above ceiling, no context check
      for (const n of nums) {
        if (n > (ceiling as number)) {
          violations.push(`Number ${n} > ${ceiling} (key=${key})`);
          break;
        }
      }
    }
  }
  return violations;
}

async function runScenario(s: Scenario): Promise<TurnResult[]> {
  const results: TurnResult[] = [];
  let conversationId: string | null = null;
  for (let i = 0; i < s.turns.length; i += 1) {
    const userText = s.turns[i]!;
    const failures: string[] = [];
    try {
      const res = await fireTurn({ conversationId, message: userText });
      conversationId = res.conversationId;

      // Check expectations.
      const c = s.checks ?? {};
      const refuseExpectedFor = Array.isArray(c.refuseTurn)
        ? c.refuseTurn
        : c.refuseTurn !== undefined
          ? [c.refuseTurn]
          : [];
      const oneBasedTurn = i + 1;
      if (refuseExpectedFor.includes(oneBasedTurn) && !res.refused) {
        failures.push(`Turn ${oneBasedTurn} expected refusal but got reply`);
      }
      if (
        !refuseExpectedFor.includes(oneBasedTurn) &&
        c.mustNotRefuse &&
        res.refused
      ) {
        failures.push(`Turn ${oneBasedTurn} unexpectedly refused`);
      }
      // Sanity-check the answer text against domain bounds.
      const violations = findSanityViolations(res.text, c.sanityMax ?? {});
      failures.push(...violations);

      results.push({
        scenarioId: s.id,
        turnIndex: i,
        userText,
        assistantText: res.text,
        toolCalls: res.toolCalls,
        refused: res.refused,
        durationMs: res.durationMs,
        costUsd: res.costUsd,
        failures,
      });
    } catch (err) {
      results.push({
        scenarioId: s.id,
        turnIndex: i,
        userText,
        assistantText: `ERROR: ${(err as Error).message}`,
        toolCalls: [],
        refused: false,
        durationMs: 0,
        costUsd: 0,
        failures: [`fetch failed: ${(err as Error).message}`],
      });
    }
  }
  return results;
}

async function main(): Promise<void> {
  const all = loadScenarios();
  const scenarios = all
    .filter((s) => !FILTER || s.id.includes(FILTER))
    .slice(0, LIMIT);

  console.log(`▸ Running ${scenarios.length} scenarios (${all.length} total in the file)`);
  console.log(`▸ API base: ${API_BASE}`);

  const allResults: TurnResult[] = [];
  let pass = 0;
  let fail = 0;
  for (const s of scenarios) {
    process.stdout.write(`  [${s.id}] ${s.category.padEnd(18)} `);
    const turns = await runScenario(s);
    allResults.push(...turns);
    const scenarioFailures = turns.flatMap((t) => t.failures);
    if (scenarioFailures.length > 0) {
      fail += 1;
      console.log(`✗ ${scenarioFailures.length} issue(s)`);
      for (const f of scenarioFailures) console.log(`     ↳ ${f}`);
    } else {
      pass += 1;
      const cost = turns.reduce((acc, t) => acc + t.costUsd, 0);
      const dur = turns.reduce((acc, t) => acc + t.durationMs, 0);
      console.log(`✓ (${dur}ms, $${cost.toFixed(4)})`);
    }
  }

  const totalCost = allResults.reduce((acc, t) => acc + t.costUsd, 0);
  const totalDur = allResults.reduce((acc, t) => acc + t.durationMs, 0);
  console.log();
  console.log(`▸ Pass: ${pass} / ${scenarios.length}`);
  console.log(`▸ Total turns: ${allResults.length}`);
  console.log(`▸ Total spend: $${totalCost.toFixed(2)}`);
  console.log(`▸ Total wall time: ${(totalDur / 1000).toFixed(1)}s`);

  if (OUT) {
    writeFileSync(OUT, JSON.stringify(allResults, null, 2));
    console.log(`▸ Full transcript written to ${OUT}`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
