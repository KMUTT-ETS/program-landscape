#!/usr/bin/env bash
# preflight.sh — single command that answers "are we go for production?"
#
# Aggregates 9 objective gates from prompts 01–19. Exit 0 means GO;
# any FAIL exits non-zero. WARN does not block — it surfaces in the
# summary so the operator can decide.
#
# Usage:
#   ./scripts/preflight.sh                        # human-readable summary
#   ./scripts/preflight.sh --json > preflight.json
#   ./scripts/preflight.sh --quiet                # CI mode: only summary line
#
# deploy.sh runs this as phase 0. To override (emergency only), set
# OVERRIDE_REASON=... and pass --skip-preflight to deploy.sh; the
# override is audited.

set -uo pipefail   # NOT -e — we want to keep collecting verdicts after a single failure

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARDENING_DIR="$REPO_ROOT/docs/hardening"
STATE_DIR="${BACKUP_VERIFY_STATE_DIR:-/var/lib/program-landscape}"
DR_DRILLS_DIR="${DR_DRILLS_DIR:-/opt/program-landscape/dr-drills}"
MARKER_DIR="$REPO_ROOT/.preflight"

JSON=0
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --json)  JSON=1 ;;
    --quiet) QUIET=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

declare -a GATE_NAMES
declare -a GATE_VERDICTS
declare -a GATE_DETAILS

record() {
  GATE_NAMES+=("$1")
  GATE_VERDICTS+=("$2")
  GATE_DETAILS+=("$3")
}

# Is REPO_ROOT an actual git checkout? On the prod server this script runs
# from an unpacked release bundle, which is not a repo and carries no
# `.preflight/` markers — so every repo-scoped gate below is unanswerable
# there. Answering them anyway produced two bad outcomes on the v1.8.9
# deploy: three gates that WARN on every deploy forever regardless of
# whether the tests actually passed, and — worse — `no_secrets_in_head`
# reporting PASS because `git ls-files` had failed and left its output
# empty. A gate that cannot fail is not a gate; it manufactures assurance.
#
# These gates belong to the BUILD host, where they are real. Here they
# report SKIP: not counted as a pass, not nagged about as a warning.
in_git_repo() {
  git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

# Records SKIP and returns 0 when the gate cannot be evaluated here.
skip_unless_repo() {
  if in_git_repo; then
    return 1
  fi
  record "$1" "SKIP" "not checkable from a deployed bundle — gate belongs to the build host"
  return 0
}

log() { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }

# ── Gate 1: every prompt 01–19 has a report file ─────────────────────
gate_reports_present() {
  local missing=()
  for n in $(seq -w 1 19); do
    local matches
    matches="$(ls "$HARDENING_DIR/${n}-"*.report.md 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$matches" -eq 0 ]; then
      missing+=("prompt $n")
    fi
  done
  if [ ${#missing[@]} -eq 0 ]; then
    record "reports_present" "PASS" "all 19 prompts have a *.report.md"
  else
    record "reports_present" "FAIL" "missing reports: ${missing[*]}"
  fi
}

# ── Gate 2: every report's acceptance-criteria table has no
#           DEFERRED row without an explicit owner ──────────────────
#
# Convention: a deferred row in the "Acceptance criteria check" table
# carries DEFERRED in the status cell. The grace condition: the row
# (or the immediately following body section) explicitly names an
# owner + ETA. We match:
#   - "DEFERRED" in a table row → must be paired with "owner:" elsewhere
#     in the report, OR with the literal "operator gate" / "operator runs"
#     phrase (those are by-design deferrals to staging, not unowned gaps).
gate_no_unowned_deferrals() {
  local violators=()
  for f in "$HARDENING_DIR"/*.report.md; do
    local base
    base="$(basename "$f")"
    [[ "$base" == "20-readiness.report.md" ]] && continue   # this very file
    if grep -q "DEFERRED" "$f"; then
      # Tolerate the deferral if any of the following is also present:
      #   - "operator gate" / "operator runs" / "operator's"
      #   - "follow-up for prompt" (chain of work)
      #   - "documented as a follow-up"
      #   - "deferred to prompt"
      if grep -qiE "operator gate|operator runs|operator'?s gate|follow-up for prompt|documented as a follow-up|deferred to prompt|prompt-19 follow-up|prompt 19 follow-up" "$f"; then
        : # owned-by-process deferral, OK
      else
        violators+=("$base")
      fi
    fi
  done
  if [ ${#violators[@]} -eq 0 ]; then
    record "no_unowned_deferrals" "PASS" "every DEFERRED tagged to operator gate or named follow-up"
  else
    record "no_unowned_deferrals" "FAIL" "unowned deferrals in: ${violators[*]}"
  fi
}

# ── Gate 3: dependency-vuln audit fresh + clean ─────────────────────
gate_deps_audit() {
  skip_unless_repo "deps_audit" && return
  local marker="$MARKER_DIR/deps-audit-ok"
  if [ ! -f "$marker" ]; then
    record "deps_audit" "WARN" "no marker — run: pnpm audit --prod && touch .preflight/deps-audit-ok"
    return
  fi
  local age_h=$(( ( $(date +%s) - $(stat -c %Y "$marker") ) / 3600 ))
  if [ "$age_h" -gt 24 ]; then
    record "deps_audit" "WARN" "marker is $age_h h old (>24h) — re-run pnpm audit"
  else
    record "deps_audit" "PASS" "audit clean as of $age_h h ago"
  fi
}

# ── Gate 4: no secrets in HEAD ──────────────────────────────────────
#
# We rely on the prompt-03 finding that the repo is clean as of audit
# time. The cheap pre-flight is: ensure no .env file is tracked + the
# usual key-shaped patterns aren't present in tracked files. A dirtier
# scan with gitleaks belongs in CI; this is the last-mile gate.
gate_no_secrets_in_head() {
  skip_unless_repo "no_secrets_in_head" && return
  cd "$REPO_ROOT"
  local hits
  # Tracked .env / id_rsa / private key / dropped credential file
  hits="$(git ls-files | grep -E '^(\.env|.*\.pem|.*id_rsa.*|.*\.p12|.*credentials\.json|.*service-account.*\.json)$' | grep -v "^\.env\..*example$" | grep -v "^\.env\..*example\..*$" || true)"
  if [ -n "$hits" ]; then
    record "no_secrets_in_head" "FAIL" "tracked secret-shaped files: $(echo "$hits" | tr '\n' ' ')"
    return
  fi

  # In-tree pattern scan — quick + dirty regex over tracked files.
  # Catches sloppy cuts & pastes; CI gitleaks catches the rest.
  local pattern_hits
  pattern_hits="$(
    git grep -nIEi '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|sk_live_[0-9A-Za-z]{24,}|-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----)' \
      -- ':!docs/hardening/**' ':!docs/**' ':!*.md' 2>/dev/null || true
  )"
  if [ -n "$pattern_hits" ]; then
    record "no_secrets_in_head" "FAIL" "$(echo "$pattern_hits" | head -3 | tr '\n' '|')"
  else
    record "no_secrets_in_head" "PASS" "no tracked secret-shaped files or in-tree key patterns"
  fi
}

# ── Gate 5: tests pass ──────────────────────────────────────────────
#
# Fast version — relies on the marker file written when CI last passed.
# Don't actually run pnpm test inside preflight (~3+ minutes); operator
# runs `pnpm test && touch .preflight/tests-ok` after a green run.
gate_tests() {
  skip_unless_repo "tests" && return
  local marker="$MARKER_DIR/tests-ok"
  if [ ! -f "$marker" ]; then
    record "tests" "WARN" "no marker — run: pnpm test && touch .preflight/tests-ok"
    return
  fi
  local age_h=$(( ( $(date +%s) - $(stat -c %Y "$marker") ) / 3600 ))
  if [ "$age_h" -gt 24 ]; then
    record "tests" "WARN" "tests-ok marker is $age_h h old (>24h)"
  else
    record "tests" "PASS" "tests passed $age_h h ago"
  fi
}

# ── Gate 6: backup verification GREEN for last 7 nights ─────────────
gate_backup_verification() {
  local f="$STATE_DIR/backup-verification.json"
  if [ ! -f "$f" ]; then
    record "backup_verification" "WARN" "no $f — has the verifier timer run yet?"
    return
  fi
  local status age_h
  status="$(python3 -c "import json; print(json.load(open('$f'))['status'])" 2>/dev/null || echo UNKNOWN)"
  age_h="$(( ( $(date +%s) - $(stat -c %Y "$f") ) / 3600 ))"
  if [ "$status" != "OK" ]; then
    record "backup_verification" "FAIL" "latest verifier verdict: $status"
  elif [ "$age_h" -gt 26 ]; then
    record "backup_verification" "FAIL" "verifier hasn't run in $age_h h (timer stuck?)"
  else
    record "backup_verification" "PASS" "verifier OK $age_h h ago"
  fi
}

# ── Gate 7: restore-drill green within last 30 days ────────────────
gate_restore_drill() {
  local idx="$DR_DRILLS_DIR/index.tsv"
  if [ ! -f "$idx" ]; then
    record "restore_drill" "WARN" "no $idx — run scripts/dr/restore-drill.sh once"
    return
  fi
  # TSV columns: ts, backup, size, total, result.
  #   OK      — dump restored AND the app was smoke-tested against it
  #   DB-ONLY — dump restored + asserted; restore-drill.sh phases 5-6 are
  #             unimplemented, so the application half is unproven.
  # DB-ONLY deliberately WARNs: it must never read as a full rehearsal, but
  # it must not FAIL either, or an honest partial drill would block deploys
  # harder than never having run one.
  local ok_ts partial_ts ref_ts label
  ok_ts="$(grep -E '\sOK$' "$idx" | tail -1 | cut -f1)"
  partial_ts="$(grep -E '\sDB-ONLY$' "$idx" | tail -1 | cut -f1)"
  if [ -n "$ok_ts" ]; then
    ref_ts="$ok_ts"; label="OK"
  elif [ -n "$partial_ts" ]; then
    ref_ts="$partial_ts"; label="DB-ONLY"
  else
    record "restore_drill" "FAIL" "no successful rows in drill index"
    return
  fi

  # restore-drill.sh stamps %Y-%m-%dT%H-%M-%S, so the TIME half is
  # hyphen-separated. The old `${ts//T/ }` left "13-30-00", which `date -d`
  # rejects; the || echo 0 fallback then aged every drill to ~21000 days and
  # this gate FAILED unconditionally. Restore the colons before parsing.
  local d_part t_part last_epoch now_epoch age_d
  d_part="${ref_ts%%T*}"
  t_part="${ref_ts#*T}"
  t_part="${t_part//-/:}"
  last_epoch="$(date -d "$d_part $t_part" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  if [ "$last_epoch" = "0" ]; then
    record "restore_drill" "WARN" "unparseable drill timestamp: $ref_ts"
    return
  fi
  age_d=$(( (now_epoch - last_epoch) / 86400 ))
  if [ "$age_d" -gt 30 ]; then
    record "restore_drill" "FAIL" "last $label drill is $age_d d old (>30d)"
  elif [ "$label" = "DB-ONLY" ]; then
    record "restore_drill" "WARN" "db restore proven ${age_d} d ago; app-against-restore NOT exercised (restore-drill phases 5-6 unimplemented)"
  else
    record "restore_drill" "PASS" "last drill OK ${age_d} d ago"
  fi
}

# ── Gate 8: e2e + k6 baselines (ops-marked) ──────────────────────────
#
# These run on staging, not in this script. Operator drops marker files
# after a green run.
gate_e2e_k6() {
  skip_unless_repo "e2e_k6_staging" && return
  local e2e_marker="$MARKER_DIR/e2e-staging-ok"
  local k6_marker="$MARKER_DIR/k6-baseline-ok"
  local missing=()
  [ -f "$e2e_marker" ] || missing+=("e2e-staging-ok")
  [ -f "$k6_marker" ] || missing+=("k6-baseline-ok")
  if [ ${#missing[@]} -gt 0 ]; then
    record "e2e_k6_staging" "WARN" "missing markers: ${missing[*]}"
    return
  fi
  local e2e_age_d k6_age_d
  e2e_age_d=$(( ( $(date +%s) - $(stat -c %Y "$e2e_marker") ) / 86400 ))
  k6_age_d=$(( ( $(date +%s) - $(stat -c %Y "$k6_marker") ) / 86400 ))
  if [ "$e2e_age_d" -gt 7 ] || [ "$k6_age_d" -gt 7 ]; then
    record "e2e_k6_staging" "WARN" "e2e ${e2e_age_d}d / k6 ${k6_age_d}d (>7d)"
  else
    record "e2e_k6_staging" "PASS" "e2e ${e2e_age_d}d / k6 ${k6_age_d}d"
  fi
}

# ── Gate 9: external-API IP allowlists only behind a pinned real-IP ──
#
# ApiKeyGuard checks a client's IP allowlist against the address nginx
# resolves from X-Forwarded-For. That address is only as trustworthy as
# `set_real_ip_from`: while it trusts a range wider than the KKU reverse
# proxy itself, any host inside that range can connect straight to :8443
# and name whatever address it likes. So API_CLIENT_IP_ALLOWLIST=enabled is
# refused unless every set_real_ip_from (nginx.conf AND conf.d/*.conf) is a
# single host and the set equals KKU_PROXY_IPS exactly.
#
# Inputs (overridable for tests):
#   PREFLIGHT_ENV_FILE   — the deployed env file. deploy.sh's ENV_FILE,
#                          $DEPLOY_ROOT/.env.prod (root:root 0600 on prod,
#                          so it is read through sudo when not readable).
#   PREFLIGHT_NGINX_DIR  — the nginx config this bundle is about to deploy,
#                          $REPO_ROOT/infra/nginx (deploy.sh runs this
#                          script from the unpacked bundle, and
#                          docker-compose.prod.yml mounts exactly
#                          infra/nginx/nginx.conf + infra/nginx/conf.d).
# Only the two keys are ever extracted from the env file — never print it.
_preflight_env_value() {
  # $1 = env file, $2 = key. Last assignment wins (as with compose env_file).
  # Returns 1 when the file cannot be read at all, so an unreadable file can
  # never pass as "switch unset".
  local file="$1" key="$2" line pattern
  pattern="^[[:space:]]*(export[[:space:]]+)?${key}="
  if [ -r "$file" ]; then
    line="$(grep -E "$pattern" "$file" 2>/dev/null | tail -1)"
  elif sudo -n test -r "$file" 2>/dev/null; then
    # -n: never prompt. With no cached credentials this fails and the gate
    # FAILs, telling the operator to run `sudo -v` first.
    line="$(sudo -n grep -E "$pattern" "$file" 2>/dev/null | tail -1)"
  else
    return 1
  fi
  line="${line#*=}"
  line="${line%%#*}"                              # trailing comment
  line="$(printf '%s' "$line" | tr -d "\"'\r" | xargs 2>/dev/null)"   # quotes + outer blanks
  printf '%s' "$line"
}

# Every nginx directive in the given files, one per line, whitespace
# collapsed. Parsed by STATEMENT, not by line: nginx lets a directive span
# lines (`set_real_ip_from\n    10.0.0.0/8;`), and a line-based grep would
# miss the value and report a false PASS. Comments are stripped first; `{`
# and `}` end a statement as well as `;`, so `server { set_real_ip_from …`
# yields the directive on its own. Quotes are dropped from values.
_preflight_nginx_statements() {
  sed -e 's/#.*//' "$@" 2>/dev/null \
    | tr '\n\t\r' '   ' \
    | tr '{};' '\n\n\n' \
    | tr -d "\"'" \
    | awk 'NF { $1 = $1; print }'
}

# Strip a /32 (IPv4) or /128 (IPv6) suffix; lowercase. Prints nothing for a
# range, so the caller can tell a single host from a CIDR.
_preflight_single_host() {
  local v
  v="$(printf '%s' "$1" | tr 'A-Z' 'a-z')"
  case "$v" in
    */32|*/128) v="${v%/*}" ;;
    */*) return 1 ;;
  esac
  [ -n "$v" ] || return 1
  printf '%s' "$v"
}

gate_external_api_real_ip() {
  local deploy_root="${DEPLOY_ROOT:-/opt/program-landscape}"
  local env_file="${PREFLIGHT_ENV_FILE:-$deploy_root/.env.prod}"
  local nginx_dir="${PREFLIGHT_NGINX_DIR:-$REPO_ROOT/infra/nginx}"

  local switch=""
  if [ -e "$env_file" ]; then
    if ! switch="$(_preflight_env_value "$env_file" API_CLIENT_IP_ALLOWLIST)"; then
      record "external_api_real_ip" "FAIL" "cannot read $env_file (even via sudo) — API_CLIENT_IP_ALLOWLIST unverifiable; run 'sudo -v' first"
      return
    fi
  fi
  if [ "$switch" != "enabled" ]; then
    record "external_api_real_ip" "PASS" "ip allowlists off"
    return
  fi

  local proxies_raw
  proxies_raw="$(_preflight_env_value "$env_file" KKU_PROXY_IPS)"
  if [ -z "$proxies_raw" ]; then
    record "external_api_real_ip" "FAIL" "API_CLIENT_IP_ALLOWLIST=enabled but KKU_PROXY_IPS is empty"
    return
  fi

  local -a proxies=() trusted=()
  local p h
  # Spaces or commas: "10.1.2.3 10.1.2.4" and "10.1.2.3,10.1.2.4" both work.
  for p in ${proxies_raw//,/ }; do
    if ! h="$(_preflight_single_host "$p")"; then
      record "external_api_real_ip" "FAIL" "KKU_PROXY_IPS entry '$p' is a range, not a single proxy address"
      return
    fi
    proxies+=("$h")
  done

  local conf_files=("$nginx_dir/nginx.conf")
  local f
  for f in "$nginx_dir"/conf.d/*.conf; do
    [ -f "$f" ] && conf_files+=("$f")
  done
  if [ ! -f "$nginx_dir/nginx.conf" ]; then
    record "external_api_real_ip" "FAIL" "API_CLIENT_IP_ALLOWLIST=enabled but $nginx_dir/nginx.conf not found"
    return
  fi

  local statements
  statements="$(_preflight_nginx_statements "${conf_files[@]}")"

  # Only nginx.conf + conf.d/*.conf are scanned, so an `include` of anything
  # else could carry a set_real_ip_from this gate never sees. Refuse it.
  local inc
  while read -r inc; do
    [ -n "$inc" ] || continue
    case "$inc" in
      # Exactly the two paths docker-compose.prod.yml mounts (relative
      # forms resolve against /etc/nginx, the nginx prefix).
      "include mime.types"|"include /etc/nginx/mime.types") ;;
      "include conf.d/*.conf"|"include /etc/nginx/conf.d/*.conf") ;;
      *)
        record "external_api_real_ip" "FAIL" "nginx '$inc' — only mime.types and conf.d/*.conf includes can be checked; inline it before enabling ip allowlists"
        return
        ;;
    esac
  done < <(printf '%s\n' "$statements" | awk '$1 == "include"')

  local stmt v
  local -a parts
  while read -r stmt; do
    [ -n "$stmt" ] || continue
    read -r -a parts <<<"$stmt"      # word-split without globbing
    if [ "${#parts[@]}" -ne 2 ]; then
      record "external_api_real_ip" "FAIL" "malformed '$stmt' — set_real_ip_from takes exactly one address"
      return
    fi
    v="${parts[1]}"
    if ! h="$(_preflight_single_host "$v")"; then
      record "external_api_real_ip" "FAIL" "set_real_ip_from $v trusts a range — pin it to the KKU proxy address(es) before enabling ip allowlists"
      return
    fi
    trusted+=("$h")
  done < <(printf '%s\n' "$statements" | awk '$1 == "set_real_ip_from"')

  if [ ${#trusted[@]} -eq 0 ]; then
    record "external_api_real_ip" "FAIL" "API_CLIENT_IP_ALLOWLIST=enabled but nginx has no set_real_ip_from"
    return
  fi

  local want got
  want="$(printf '%s\n' "${proxies[@]}" | sort -u | tr '\n' ' ')"
  got="$(printf '%s\n' "${trusted[@]}" | sort -u | tr '\n' ' ')"
  if [ "$want" != "$got" ]; then
    record "external_api_real_ip" "FAIL" "set_real_ip_from { ${got% } } != KKU_PROXY_IPS { ${want% } }"
    return
  fi
  local n
  n="$(printf '%s\n' "${proxies[@]}" | sort -u | wc -l | tr -d ' ')"
  record "external_api_real_ip" "PASS" "ip allowlists on; real-ip pinned to $n proxy address(es)"
}

# Sourced (e.g. by apps/api/test/build-release.test.ts, to exercise one gate
# against fixture files)? Stop here: define the gates, run none of them.
# Executed directly, this is a no-op and behaviour is unchanged.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

# ─── Run all gates ────────────────────────────────────────────────────
gate_reports_present
gate_no_unowned_deferrals
gate_deps_audit
gate_no_secrets_in_head
gate_tests
gate_backup_verification
gate_restore_drill
gate_e2e_k6
gate_external_api_real_ip

# ─── Tally ───────────────────────────────────────────────────────────
PASS=0; WARN=0; FAIL=0; SKIP=0
for v in "${GATE_VERDICTS[@]}"; do
  case "$v" in PASS) PASS=$((PASS+1)) ;; WARN) WARN=$((WARN+1)) ;; FAIL) FAIL=$((FAIL+1)) ;; SKIP) SKIP=$((SKIP+1)) ;; esac
done

# ─── Output ──────────────────────────────────────────────────────────
if [ "$JSON" = "1" ]; then
  printf '{\n'
  printf '  "summary": { "pass": %d, "warn": %d, "fail": %d, "skip": %d },\n' "$PASS" "$WARN" "$FAIL" "$SKIP"
  printf '  "gates": [\n'
  for i in "${!GATE_NAMES[@]}"; do
    sep=","
    [ "$i" = "$((${#GATE_NAMES[@]} - 1))" ] && sep=""
    # JSON-escape the detail string (basic — backslashes + quotes).
    detail="${GATE_DETAILS[$i]//\\/\\\\}"
    detail="${detail//\"/\\\"}"
    printf '    { "name": "%s", "verdict": "%s", "detail": "%s" }%s\n' \
      "${GATE_NAMES[$i]}" "${GATE_VERDICTS[$i]}" "$detail" "$sep"
  done
  printf '  ]\n}\n'
else
  if [ "$QUIET" = "0" ]; then
    log "════════════════════════════════════════════════════════════════"
    log "Pre-flight check — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    log "════════════════════════════════════════════════════════════════"
    for i in "${!GATE_NAMES[@]}"; do
      v="${GATE_VERDICTS[$i]}"
      case "$v" in
        PASS) sym='✓' ;;
        WARN) sym='⚠' ;;
        FAIL) sym='✗' ;;
        SKIP) sym='–' ;;
      esac
      printf '  %s  %-25s %s\n' "$sym" "${GATE_NAMES[$i]}" "${GATE_DETAILS[$i]}"
    done
    log "────────────────────────────────────────────────────────────────"
  fi
  if [ "$FAIL" -gt 0 ]; then
    log "PREFLIGHT FAIL — $FAIL gate(s) failed, $WARN warn, $PASS pass, $SKIP skipped"
  elif [ "$WARN" -gt 0 ]; then
    log "PREFLIGHT PASS-WITH-WARN — $WARN warn, $PASS pass, $SKIP skipped"
  else
    log "PREFLIGHT GO — $PASS gates green, $SKIP skipped"
  fi
fi

# Non-zero exit on any FAIL. WARN does not block.
[ "$FAIL" -eq 0 ]
