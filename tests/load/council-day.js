// k6 load scenario A — Council day
//
// Models a typical Council meeting day: 30 concurrent users mostly
// reading dashboards (cockpit, gap-analysis, programs detail) + 4
// concurrent Council-Pack PDF exports (the heavy path).
//
// Pass thresholds (per docs/hardening/18-e2e-load.report.md):
//   p95 < 1500 ms across all read endpoints
//   error rate == 0 % across all read endpoints
//   PDF export p95 < 30 s, error rate 0 %  (export is allowed to be slow)
//
// Usage:
//   K6_BASE_URL=https://staging.program-landscape.kku.ac.th \
//   K6_JWT=eyJhbGciOi...   \
//   k6 run tests/load/council-day.js
//
// JWT issuance: in dev/staging, sign in once via Playwright then read
// the `__Secure-authjs.session-token` cookie value. Document the
// extraction step in 18-e2e-load.report.md §"How to run".

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// ──────────────────────────────────────────────────────────────────────
// Per-endpoint metrics — k6's default `http_req_duration` aggregates
// across ALL requests; per-endpoint Trends let us slice the report by
// route in the summary.
// ──────────────────────────────────────────────────────────────────────
const cockpitDuration = new Trend('cockpit_duration_ms', true);
const gapDuration = new Trend('gap_duration_ms', true);
const programDuration = new Trend('program_duration_ms', true);
const exportDuration = new Trend('export_duration_ms', true);
const readErrors = new Rate('read_errors');
const exportErrors = new Rate('export_errors');

// ──────────────────────────────────────────────────────────────────────
// Configuration via environment.
// ──────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3000';
const JWT = __ENV.K6_JWT || '';
const COOKIE = JWT ? `__Secure-authjs.session-token=${JWT}` : '';

// ──────────────────────────────────────────────────────────────────────
// k6 scenarios — Council-day shape.
//
// Two parallel scenarios:
//   `dashboard_readers`: 30 VU, 5 minutes steady-state with 30 s
//       ramp-up + ramp-down. Each VU loops through cockpit / gap /
//       programs reads.
//   `pdf_exporters`: 4 VU, sustained, slower iteration cadence.
//       Each iteration POSTs an export and waits for the result.
// ──────────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    dashboard_readers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 30 },
        { duration: '5m', target: 30 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      exec: 'readDashboards',
    },
    pdf_exporters: {
      executor: 'constant-vus',
      vus: 4,
      duration: '6m',
      exec: 'exportCouncilPack',
      startTime: '15s', // let dashboards warm up first
    },
  },
  thresholds: {
    // Per-endpoint Trend p95 thresholds — fail the run if breached.
    cockpit_duration_ms: ['p(95)<1500'],
    gap_duration_ms: ['p(95)<1500'],
    program_duration_ms: ['p(95)<1500'],
    // PDF export gets a more generous budget — Gotenberg + Chromium
    // render time dominates; 30 s is the operator-stated SLO.
    export_duration_ms: ['p(95)<30000'],
    // Error rates — must be zero on the read path.
    read_errors: ['rate==0'],
    export_errors: ['rate==0'],
    // Global guard: total HTTP error rate < 1 %. Catches anything not
    // tagged with our custom Rates.
    http_req_failed: ['rate<0.01'],
  },
  // Don't print every request to stdout — only the summary.
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

// ──────────────────────────────────────────────────────────────────────
// Helpers.
// ──────────────────────────────────────────────────────────────────────
function authHeaders() {
  const h = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (COOKIE) h['Cookie'] = COOKIE;
  return h;
}

// ──────────────────────────────────────────────────────────────────────
// Scenario A — dashboard reader iteration.
//
// One VU loop = three reads (cockpit, gap-analysis, a random program
// detail) with a 1-3 s think time between, modelling a Council member
// scanning views.
// ──────────────────────────────────────────────────────────────────────
export function readDashboards() {
  group('cockpit', () => {
    const r = http.get(`${BASE_URL}/api/v1/cockpit/heatmap?scope=university`, {
      headers: authHeaders(),
      tags: { endpoint: 'cockpit' },
    });
    cockpitDuration.add(r.timings.duration);
    const ok = check(r, { 'cockpit 200': (res) => res.status === 200 });
    readErrors.add(!ok);
  });

  sleep(1 + Math.random() * 2);

  group('gap-analysis', () => {
    const r = http.get(`${BASE_URL}/api/v1/gap-analysis/skills?scope=university`, {
      headers: authHeaders(),
      tags: { endpoint: 'gap' },
    });
    gapDuration.add(r.timings.duration);
    const ok = check(r, { 'gap 200': (res) => res.status === 200 });
    readErrors.add(!ok);
  });

  sleep(1 + Math.random() * 2);

  group('program detail', () => {
    // Pick a random KKU-SEQ program ID. With ~228 seeded programs the
    // hot-cache probability after a few iterations is high; this is the
    // realistic Council scan pattern (a few favourites, sometimes a
    // long-tail look-up).
    const seq = String(1 + Math.floor(Math.random() * 228)).padStart(4, '0');
    const r = http.get(
      `${BASE_URL}/api/v1/programs/KKU-SEQ-${seq}/overview`,
      { headers: authHeaders(), tags: { endpoint: 'program' } },
    );
    programDuration.add(r.timings.duration);
    // 404 is acceptable for sparse program IDs in the seeded fixture set.
    const ok = check(r, {
      'program 200 or 404': (res) => res.status === 200 || res.status === 404,
    });
    readErrors.add(!ok);
  });

  sleep(2 + Math.random() * 3);
}

// ──────────────────────────────────────────────────────────────────────
// Scenario A — PDF exporter iteration.
//
// One iteration = one Council-Pack export. Cadence is paced (~1
// per minute per VU) so we don't pathologically queue Gotenberg.
// ──────────────────────────────────────────────────────────────────────
export function exportCouncilPack() {
  const start = Date.now();
  const r = http.post(
    `${BASE_URL}/api/v1/cockpit/export`,
    JSON.stringify({
      scope: 'university',
      templateId: 'council-pack',
      exportReason: 'k6 load scenario A',
    }),
    { headers: authHeaders(), tags: { endpoint: 'export' }, timeout: '60s' },
  );
  exportDuration.add(Date.now() - start);
  const ok = check(r, {
    'export 200 or 201': (res) => res.status === 200 || res.status === 201,
  });
  exportErrors.add(!ok);

  // Pace exports — 4 VU × 1/minute = ~4 exports/min sustained.
  sleep(60);
}
