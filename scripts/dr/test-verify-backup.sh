#!/usr/bin/env bash
# Regression suite for verify-backup.sh's audit-log assertion.
#
#     bash scripts/dr/test-verify-backup.sh
#
# Runs the REAL verify-backup.sh against fake `sudo`, `docker` and `zcat` on
# PATH, so no Postgres, container or prod path is touched. The fake docker
# answers the restored-dump queries and the live-DB query from env vars, which
# lets each case set "newest audit row in the dump" vs "newest audit row the
# live DB had before the dump" independently.
#
# The cases that matter:
#   - quiet weekend: no audited activity for days, dump == live → OK.
#     (The old wall-clock rule reported this as FAILED and blocked a deploy,
#     prod 2026-10-03.)
#   - stalled dump: live has newer rows than the dump → FAILED.
#   - live DB unreachable: restore proven, comparison skipped → OK, and the
#     verdict says it was skipped.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/verify-backup.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin" "$WORK/root/backups" "$WORK/root/current" "$WORK/root/secrets" "$WORK/state"
echo "2.1.0" > "$WORK/root/current/VERSION"
echo "pl_user" > "$WORK/root/secrets/postgres_user"
echo "POSTGRES_DB=program_landscape" > "$WORK/root/.env.prod"
echo "dump" > "$WORK/root/backups/20261003-193155.sql.gz"

# sudo: just run the command (honours -E by ignoring it).
cat > "$WORK/bin/sudo" <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = "-E" ] && shift
exec "$@"
EOF

# zcat: emit nothing useful; the fake docker accepts any restore input.
cat > "$WORK/bin/zcat" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
EOF

# docker: route by sub-command and by which SQL is asked.
cat > "$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
args="$*"
case "$args" in
  "run "*|"rm "*) exit 0 ;;
  *pg_isready*) exit 0 ;;
  *pg_restore*) cat >/dev/null; exit 0 ;;
  "compose exec"*)
    [ "${FAKE_LIVE_DOWN:-0}" = "1" ] && exit 1
    echo "$FAKE_LIVE_AUDIT_MAX"; exit 0 ;;
esac
# psql against the restored dump
case "$args" in
  *information_schema.tables*) echo 151 ;;
  *"KKU-SEQ"*) echo 301 ;;
  *"NOW() - MAX(created_at)"*) echo "$FAKE_DUMP_AGE_H" ;;
  *"EXTRACT(EPOCH FROM MAX(created_at))"*) echo "$FAKE_DUMP_AUDIT_MAX" ;;
  *departments*) echo 0 ;;
  *) echo "" ;;
esac
EOF
chmod +x "$WORK/bin/"*

run_case() {
  local name="$1" expect_status="$2" expect_detail="$3"; shift 3
  rm -f "$WORK/state/backup-verification.json"
  set +e
  env PATH="$WORK/bin:$PATH" DEPLOY_ROOT="$WORK/root" BACKUP_VERIFY_STATE_DIR="$WORK/state" \
      PG_IMAGE="fake:1" "$@" bash "$SCRIPT" >"$WORK/out.log" 2>&1
  set -e
  local status detail
  status="$(python3 -c "import json;print(json.load(open('$WORK/state/backup-verification.json'))['status'])" 2>/dev/null || echo MISSING)"
  detail="$(python3 -c "import json;d=json.load(open('$WORK/state/backup-verification.json'));print(d.get('detail','')+' | '+d.get('auditLogCheck',''))" 2>/dev/null || echo "")"
  if [ "$status" = "$expect_status" ] && [[ "$detail" == *"$expect_detail"* ]]; then
    echo "PASS  $name ($status — $detail)"
  else
    echo "FAIL  $name: expected $expect_status containing '$expect_detail', got $status — $detail"
    sed 's/^/      /' "$WORK/out.log" | tail -15
    FAILS=$((FAILS + 1))
  fi
}

FAILS=0
NOW=$(date +%s)
DAY=86400

# Quiet weekend: newest audit row 3 days old in BOTH the dump and live.
run_case "quiet weekend passes" OK "dump matches live" \
  FAKE_DUMP_AGE_H=72 FAKE_DUMP_AUDIT_MAX=$((NOW - 3 * DAY)) FAKE_LIVE_AUDIT_MAX=$((NOW - 3 * DAY))

# Stalled dump: live had a row 5 h before the dump; the dump stops 2 days back.
run_case "stalled dump fails" FAILED "missing audit rows" \
  FAKE_DUMP_AGE_H=48 FAKE_DUMP_AUDIT_MAX=$((NOW - 2 * DAY)) FAKE_LIVE_AUDIT_MAX=$((NOW - 5 * 3600))

# Busy day, dump current: dump newer than (or equal to) the live cut-off.
run_case "current dump passes" OK "dump matches live" \
  FAKE_DUMP_AGE_H=0 FAKE_DUMP_AUDIT_MAX=$((NOW - 600)) FAKE_LIVE_AUDIT_MAX=$((NOW - 4000))

# Live DB unreachable: restore proven, comparison skipped, verdict says so.
run_case "live unreachable is OK but flagged" OK "skipped" \
  FAKE_DUMP_AGE_H=30 FAKE_DUMP_AUDIT_MAX=$((NOW - 30 * 3600)) FAKE_LIVE_DOWN=1 FAKE_LIVE_AUDIT_MAX=0

# Empty audit table in the dump still fails.
run_case "empty audit_logs fails" FAILED "audit_logs table empty" \
  FAKE_DUMP_AGE_H= FAKE_DUMP_AUDIT_MAX=0 FAKE_LIVE_AUDIT_MAX=0

if [ "$FAILS" -gt 0 ]; then echo "$FAILS case(s) failed"; exit 1; fi
echo "all cases passed"
