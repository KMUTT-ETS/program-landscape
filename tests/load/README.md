# Load tests — k6

Two scenarios that model the production access pattern:

| Scenario | File | Pass thresholds |
|---|---|---|
| **A — Council day** | `council-day.js` | 30 readers + 4 PDF exporters. Read p95 < 1500 ms, errors 0 %. |
| **B — Ingestion overlap** | `ingestion-overlap.js` | A + the 4 a.m. cron. Read p95 < 2500 ms, errors < 0.5 %. |

Thresholds are encoded inside each script's `options.thresholds` block — k6 exits non-zero on
breach, so CI can use the exit code as the pass/fail gate.

## How to run

### Prereqs
```bash
# k6 binary (or the docker image)
brew install k6                    # macOS
sudo snap install k6               # Ubuntu
docker pull grafana/k6:0.55.0      # any platform
```

### Get a session JWT
The endpoints under test require an authenticated session cookie. From an authenticated
browser session against the target environment:

1. Sign in (dev creds in dev/staging; KKU SSO in production).
2. Open DevTools → Application → Cookies for the target origin.
3. Copy the value of `__Secure-authjs.session-token` (cookie name is `authjs.session-token`
   without the `__Secure-` prefix on plain HTTP dev environments).

For scenario B, you also need an admin JWT (any user with `ingestion:trigger` permission —
SUPER_ADMIN or SYSTEM_ADMIN).

### Run scenario A — Council day
```bash
K6_BASE_URL=https://staging.program-landscape.kku.ac.th \
K6_JWT=eyJhbGciOi...council-user-cookie... \
k6 run tests/load/council-day.js
```

### Run scenario B — ingestion overlap
```bash
K6_BASE_URL=https://staging.program-landscape.kku.ac.th \
K6_JWT=eyJhbGciOi...council-user-cookie... \
K6_ADMIN_JWT=eyJhbGciOi...admin-user-cookie... \
k6 run tests/load/ingestion-overlap.js
```

### Capture a JSON report
```bash
k6 run --summary-export=docs/hardening/18-e2e-load.bench/scenario-a.json \
  tests/load/council-day.js
```

## Reading the output

k6 prints per-metric stats at the end:
```
✓ cockpit_duration_ms.....: avg=312ms  p(50)=287ms  p(95)=798ms  p(99)=1.2s   max=2.1s
✓ gap_duration_ms.........: avg=429ms  p(50)=391ms  p(95)=1.05s  p(99)=1.8s   max=3.4s
✗ export_duration_ms......: avg=12.3s  p(50)=11.8s  p(95)=33s    p(99)=44s    max=58s
```

A `✗` next to a metric line means the threshold for that metric was breached → process exits
with code 99. CI gates on this exit code.

## Custom Trends

Each script defines per-endpoint `Trend` metrics (`cockpit_duration_ms` etc.) on top of k6's
default `http_req_duration`. The default reports a single aggregate across every request type;
the per-endpoint Trends let the report say "cockpit p95 is X, gap p95 is Y" without
post-processing the JSON.

Endpoint tags (`tags: { endpoint: 'cockpit' }`) are also set on every request so the JSON
export can be sliced by tag in downstream tooling (Grafana Cloud, etc.).

## Out of scope

- Distributed k6 (multiple workers). Single-node k6 saturates 30 VU + 4 PDFs comfortably; only
  needed if we go past ~500 VU.
- Soak / endurance test (24-h run). First-week-in-prod ops follow-up.
- Browser-based k6 scenarios (xk6-browser) — not needed; we already have Playwright for UI
  paths and k6 for API throughput.
