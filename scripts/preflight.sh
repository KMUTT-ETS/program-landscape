#!/usr/bin/env bash
# preflight.sh — single command that answers "are we go for production?"
#
# Aggregates 8 objective gates from prompts 01–19. Exit 0 means GO;
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

# ─── Run all gates ────────────────────────────────────────────────────
gate_reports_present
gate_no_unowned_deferrals
gate_deps_audit
gate_no_secrets_in_head
gate_tests
gate_backup_verification
gate_restore_drill
gate_e2e_k6

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
