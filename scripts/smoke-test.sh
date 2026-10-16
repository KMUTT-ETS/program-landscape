#!/usr/bin/env bash
# smoke-test.sh — post-deploy health probes on the prod stack.
#
# Meant to run on the prod host (localhost self-signed cert, so -k).
# deploy.sh + rollback.sh invoke this automatically and exit non-zero
# if any check fails. Safe to run by hand for operational checks.

set -u  # we intentionally accumulate failures instead of exiting on the first one

BASE_HTTPS="${BASE_HTTPS:-https://localhost:8443}"
BASE_HTTP="${BASE_HTTP:-http://localhost:8080}"

FAILS=0
log() { printf '\033[1;34m[smoke]\033[0m %s\n' "$*"; }
ok()  { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAILS=$((FAILS+1)); }

check() {
  local label="$1"
  local cmd="$2"
  local output
  if output=$(eval "$cmd" 2>&1); then
    ok "$label"
  else
    bad "$label — ${output:-(no output)}"
  fi
}

log "=== smoke test ==="
log "Base HTTPS: $BASE_HTTPS"

# ── nginx health ──────────────────────────────────────────────────────
check "GET $BASE_HTTPS/healthz → 200" \
  "curl -fsS -k --http1.1 -H 'Host: program-landscape.kku.ac.th' -m 5 -o /dev/null -w '%{http_code}' '$BASE_HTTPS/healthz' | grep -qx 200"

# ── HTTP → HTTPS redirect ─────────────────────────────────────────────
check "GET $BASE_HTTP/ → 301" \
  "curl -fsS -k --http1.1 -H 'Host: program-landscape.kku.ac.th' -m 5 -o /dev/null -w '%{http_code}' '$BASE_HTTP/' | grep -qx 301"

# ── API readiness ─────────────────────────────────────────────────────
check "GET $BASE_HTTPS/api/v1/ready → status=ok" \
  "curl -fsS -k --http1.1 -H 'Host: program-landscape.kku.ac.th' -m 15 '$BASE_HTTPS/api/v1/ready' | grep -q '\"status\":\"ok\"'"

# ── Organisation identity is seeded ───────────────────────────────────
# Never a failure: a fresh non-KKU install legitimately has no profile until
# its admin fills in /admin/organization (the API answers 409 then, so the
# body is read without -f). Reachability is already covered by /ready above.
ORG_BODY="$(curl -sS -k --http1.1 -H 'Host: program-landscape.kku.ac.th' -m 10 "$BASE_HTTPS/api/v1/organization" 2>/dev/null || true)"
if echo "$ORG_BODY" | grep -q '"configured":true'; then
  ok "GET $BASE_HTTPS/api/v1/organization → configured"
else
  printf '  \033[1;33mWARNING: organisation profile not configured — fill in /admin/organization (KKU: deploy with ORG_SEED_KKU=1)\033[0m\n'
fi

# ── API public auth route ─────────────────────────────────────────────
check "GET $BASE_HTTPS/api/auth/providers → 200" \
  "curl -fsS -k --http1.1 -H 'Host: program-landscape.kku.ac.th' -m 10 -o /dev/null -w '%{http_code}' '$BASE_HTTPS/api/auth/providers' | grep -qx 200"

# ── SPA shell ─────────────────────────────────────────────────────────
check "GET $BASE_HTTPS/signin → 200" \
  "curl -fsS -k --http1.1 -H 'Host: program-landscape.kku.ac.th' -m 10 -o /dev/null -w '%{http_code}' '$BASE_HTTPS/signin' | grep -qx 200"

# ── Security headers ──────────────────────────────────────────────────
HEADERS="$(curl -fsSI -k --http1.1 -H 'Host: program-landscape.kku.ac.th' -m 5 "$BASE_HTTPS/signin" 2>/dev/null || true)"
for h in \
  "strict-transport-security" \
  "x-content-type-options" \
  "x-frame-options" \
  "content-security-policy"; do
  echo "$HEADERS" | tr '[:upper:]' '[:lower:]' | grep -q "^$h:" && \
    ok "header present: $h" || \
    bad "header missing: $h"
done

# ── Cert fingerprint ──────────────────────────────────────────────────
FPR="$(echo | openssl s_client -connect localhost:8443 -servername program-landscape.kku.ac.th 2>/dev/null \
        | openssl x509 -noout -fingerprint -sha256 2>/dev/null || true)"
if [ -n "$FPR" ]; then
  ok "TLS cert fingerprint: $FPR"
else
  bad "could not read TLS cert fingerprint"
fi

# ── Docker compose health ─────────────────────────────────────────────
# Accept anything that's currently `Up ...` AND has either `healthy` or
# `health: starting`. ingestion takes ~60s for BullMQ workers to settle
# and nginx ~10-30s; flagging them as "unhealthy" during that window
# was the recurring smoke false-positive.
if command -v docker >/dev/null 2>&1; then
  STATUSES="$(docker compose ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -v '^$' || true)"
  UNHEALTHY=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      *"(healthy)"*|*"(health: starting)"*) : ;;  # OK
      *) UNHEALTHY="${UNHEALTHY:+$UNHEALTHY$'\n'}$line" ;;
    esac
  done <<< "$STATUSES"
  if [ -z "$UNHEALTHY" ]; then
    ok "all containers up (healthy or still warming)"
  else
    bad "unhealthy containers:"
    echo "$UNHEALTHY" | sed 's/^/    /'
  fi
fi

if [ "$FAILS" -gt 0 ]; then
  log "=== smoke test FAILED — $FAILS check(s) ==="
  exit 1
fi

log "=== smoke test OK ==="
exit 0
