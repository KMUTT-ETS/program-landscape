// scripts/load/ai-cap-probe.ts
//
// Synthetic load probe — hammers a quota-gated endpoint with the same
// JWT until the AiQuotaGuard returns 429, then reports.
//
// Usage:
//   pnpm tsx scripts/load/ai-cap-probe.ts \
//     --jwt "<bearer>" \
//     --endpoint http://localhost:4000/api/v1/analyst/chat \
//     --body '{"conversationId":null,"prompt":"hi"}' \
//     [--max 200] [--concurrency 4]
//
// Exits 0 once a 429 with code RATE_LIMITED is observed (caps work as
// designed). Exits 1 if `--max` requests pass without hitting the cap
// (unexpected — the route isn't quota-gated, or caps are misconfigured,
// or AiQuotaGuard is fail-open).
//
// This is intentionally a single-user probe — to verify the per-role
// aggregate cap, run multiple instances with different JWTs in
// parallel from a shell loop:
//   for jwt in $JWT1 $JWT2 $JWT3; do
//     pnpm tsx scripts/load/ai-cap-probe.ts --jwt "$jwt" &
//   done
//   wait

interface Args {
  jwt: string;
  endpoint: string;
  body: string;
  max: number;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = { max: 200, concurrency: 4, body: '{}' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case '--jwt': a.jwt = next; i++; break;
      case '--endpoint': a.endpoint = next; i++; break;
      case '--body': a.body = next; i++; break;
      case '--max': a.max = Number(next); i++; break;
      case '--concurrency': a.concurrency = Number(next); i++; break;
      case '--help':
      case '-h':
        printUsage(); process.exit(0);
    }
  }
  if (!a.jwt || !a.endpoint) {
    printUsage();
    process.exit(2);
  }
  return a as Args;
}

function printUsage(): void {
  process.stdout.write(
    [
      'Usage:',
      '  pnpm tsx scripts/load/ai-cap-probe.ts --jwt <token> --endpoint <url> [--body <json>] [--max 200] [--concurrency 4]',
      '',
      'Exits 0 when AiQuotaGuard fires (RATE_LIMITED).',
      '',
    ].join('\n'),
  );
}

interface ProbeResult {
  request: number;
  status: number;
  errorCode?: string;
  details?: unknown;
  latencyMs: number;
}

async function probe(args: Args, requestNumber: number): Promise<ProbeResult> {
  const started = Date.now();
  const res = await fetch(args.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.jwt}`,
    },
    body: args.body,
  });
  const latencyMs = Date.now() - started;
  let errorCode: string | undefined;
  let details: unknown;
  // Parse only when JSON; tolerate non-JSON for upstream errors.
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      const json = (await res.json()) as { error?: { code?: string; details?: unknown } };
      errorCode = json.error?.code;
      details = json.error?.details;
    } catch {
      // ignore
    }
  }
  return { request: requestNumber, status: res.status, errorCode, details, latencyMs };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(
    `→ probing ${args.endpoint} (concurrency=${args.concurrency}, max=${args.max})\n`,
  );

  let nextRequest = 1;
  let succeeded = 0;
  let cappedAt: ProbeResult | null = null;

  // Run `concurrency` workers in parallel until cap fires or `max`
  // requests have been issued.
  async function worker(): Promise<void> {
    while (cappedAt === null && nextRequest <= args.max) {
      const n = nextRequest++;
      try {
        const r = await probe(args, n);
        if (r.status === 429 && r.errorCode === 'RATE_LIMITED') {
          cappedAt = cappedAt ?? r;
          process.stdout.write(
            `[#${r.request}] 429 RATE_LIMITED ${JSON.stringify(r.details)} (${r.latencyMs}ms)\n`,
          );
        } else if (r.status >= 200 && r.status < 300) {
          succeeded += 1;
          if (succeeded % 5 === 0) {
            process.stdout.write(`[#${r.request}] ${r.status} ok (${r.latencyMs}ms) — ${succeeded} succeeded so far\n`);
          }
        } else {
          process.stdout.write(`[#${r.request}] ${r.status} ${r.errorCode ?? 'unknown'} (${r.latencyMs}ms)\n`);
        }
      } catch (err) {
        process.stderr.write(
          `[#${n}] network error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  process.stdout.write('\n');
  if (cappedAt) {
    process.stdout.write(
      `PASS — AiQuotaGuard fired after ${cappedAt.request - 1} successful requests.\n` +
        `       ${JSON.stringify(cappedAt.details, null, 2)}\n`,
    );
    process.exit(0);
  }
  process.stdout.write(
    `FAIL — completed ${args.max} requests without hitting the cap (${succeeded} succeeded). ` +
      `Either the route isn't quota-gated, the caps are misconfigured, or AiQuotaGuard is fail-open.\n`,
  );
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`ai-cap-probe failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
