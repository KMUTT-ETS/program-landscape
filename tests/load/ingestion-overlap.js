// k6 load scenario B — ingestion overlap
//
// Same Council-day VU profile (30 readers + 4 PDF exporters) but with
// a third scenario simulating the 4 a.m. ingestion cron. The cron
// scenario hits the manual-trigger endpoint to fan out per-source
// ingestion jobs — this stresses Postgres + BullMQ + the registry
// connector at the same time real users are reading.
//
// Pass thresholds (relaxed vs scenario A):
//   p95 < 2500 ms across all read endpoints
//   error rate < 0.5 % across all read endpoints
//   PDF export p95 < 60 s, error rate < 1 %  (degraded but acceptable)
//
// Usage:
//   K6_BASE_URL=https://staging.program-landscape.kku.ac.th \
//   K6_JWT=eyJhbGciOi...  \
//   K6_ADMIN_JWT=eyJhbGciOi...  \   (admin JWT for the ingestion trigger)
//   k6 run tests/load/ingestion-overlap.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const cockpitDuration = new Trend('cockpit_duration_ms', true);
const gapDuration = new Trend('gap_duration_ms', true);
const programDuration = new Trend('program_duration_ms', true);
const exportDuration = new Trend('export_duration_ms', true);
const ingestionDuration = new Trend('ingestion_trigger_duration_ms', true);
const readErrors = new Rate('read_errors');
const exportErrors = new Rate('export_errors');
const ingestionErrors = new Rate('ingestion_errors');

const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3000';
const JWT = __ENV.K6_JWT || '';
const ADMIN_JWT = __ENV.K6_ADMIN_JWT || JWT; // fallback to user JWT if no admin

// Connectors safe to fire repeatedly during a load test. All MOCKED
// connectors no-op cheaply (return canned data); we deliberately pick
// from this list rather than `kku-research` etc. which would actually
// hit upstream APIs.
const MOCK_SAFE_CONNECTORS = [
  'jobthai',
  'jobsdb',
  'tcas-applications',
  'world-bank-skills',
  'ilo-statistics',
];

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
      startTime: '15s',
    },
    ingestion_cron: {
      executor: 'constant-vus',
      // Single VU repeatedly firing connector triggers — models the
      // 4 a.m. cron as a sustained background pressure source.
      vus: 1,
      duration: '5m',
      exec: 'triggerIngestion',
      startTime: '45s', // start after readers warm up
    },
  },
  thresholds: {
    cockpit_duration_ms: ['p(95)<2500'],
    gap_duration_ms: ['p(95)<2500'],
    program_duration_ms: ['p(95)<2500'],
    export_duration_ms: ['p(95)<60000'],
    ingestion_trigger_duration_ms: ['p(95)<5000'],
    read_errors: ['rate<0.005'],
    export_errors: ['rate<0.01'],
    ingestion_errors: ['rate<0.05'],
    http_req_failed: ['rate<0.02'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

function userHeaders() {
  const h = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (JWT) h['Cookie'] = `__Secure-authjs.session-token=${JWT}`;
  return h;
}
function adminHeaders() {
  const h = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (ADMIN_JWT) h['Cookie'] = `__Secure-authjs.session-token=${ADMIN_JWT}`;
  return h;
}

// ── Scenario B — read iteration (identical to scenario A) ───────────
export function readDashboards() {
  group('cockpit', () => {
    const r = http.get(`${BASE_URL}/api/v1/cockpit/heatmap?scope=university`, {
      headers: userHeaders(),
      tags: { endpoint: 'cockpit' },
    });
    cockpitDuration.add(r.timings.duration);
    readErrors.add(!check(r, { 'cockpit 200': (res) => res.status === 200 }));
  });

  sleep(1 + Math.random() * 2);

  group('gap-analysis', () => {
    const r = http.get(`${BASE_URL}/api/v1/gap-analysis/skills?scope=university`, {
      headers: userHeaders(),
      tags: { endpoint: 'gap' },
    });
    gapDuration.add(r.timings.duration);
    readErrors.add(!check(r, { 'gap 200': (res) => res.status === 200 }));
  });

  sleep(1 + Math.random() * 2);

  group('program detail', () => {
    const seq = String(1 + Math.floor(Math.random() * 228)).padStart(4, '0');
    const r = http.get(
      `${BASE_URL}/api/v1/programs/KKU-SEQ-${seq}/overview`,
      { headers: userHeaders(), tags: { endpoint: 'program' } },
    );
    programDuration.add(r.timings.duration);
    readErrors.add(
      !check(r, { 'program 200/404': (res) => res.status === 200 || res.status === 404 }),
    );
  });

  sleep(2 + Math.random() * 3);
}

// ── Scenario B — Council Pack export iteration ──────────────────────
export function exportCouncilPack() {
  const start = Date.now();
  const r = http.post(
    `${BASE_URL}/api/v1/cockpit/export`,
    JSON.stringify({
      scope: 'university',
      templateId: 'council-pack',
      exportReason: 'k6 load scenario B',
    }),
    { headers: userHeaders(), tags: { endpoint: 'export' }, timeout: '90s' },
  );
  exportDuration.add(Date.now() - start);
  exportErrors.add(
    !check(r, { 'export 200/201': (res) => res.status === 200 || res.status === 201 }),
  );
  sleep(60);
}

// ── Scenario B — ingestion-cron simulation ──────────────────────────
//
// Cycles through the safe-list of mocked connectors, hitting the
// admin trigger endpoint. Real connectors aren't called; the goal is
// to model the BullMQ + Postgres pressure of the cron loop, not
// to actually re-ingest data.
export function triggerIngestion() {
  const slug =
    MOCK_SAFE_CONNECTORS[Math.floor(Math.random() * MOCK_SAFE_CONNECTORS.length)];
  const start = Date.now();
  const r = http.post(
    `${BASE_URL}/api/v1/data-sources/${slug}/runs`,
    JSON.stringify({}),
    { headers: adminHeaders(), tags: { endpoint: 'ingestion_trigger' }, timeout: '15s' },
  );
  ingestionDuration.add(Date.now() - start);
  ingestionErrors.add(
    !check(r, {
      'trigger 200/201/202': (res) =>
        res.status === 200 || res.status === 201 || res.status === 202,
    }),
  );
  // Pace cron triggers — one per ~10 s simulates a 4 a.m. fan-out
  // across ~20 connectors over 3-4 minutes, matching the real schedule.
  sleep(10);
}
