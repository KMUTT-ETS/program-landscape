#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Wrapper around `pnpm skills:normalise` for systemd-timer execution.
#
# What it does:
#   1. Resolve the project root (this script lives in `<root>/scripts/`)
#   2. Source the user's PATH so pnpm + node are findable from a non-login
#      systemd context (where ~/.bashrc / ~/.profile aren't sourced)
#   3. Run the normaliser against `--source=all --auto-promote --batch-size=25`
#   4. Capture stdout+stderr to a rotated log file with a date stamp
#   5. Exit non-zero only on actual failure (the script's own --auto-promote
#      handles AMBIGUOUS / NEW_PROPOSED gracefully — non-failure outcomes)
#
# Designed for both dev (user-level systemd unit) and prod (system-level).
# Same script, no env tweaks.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Resolve project root from this script's location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
cd "${PROJECT_ROOT}"

# Pick up pnpm from the user's standard install locations. Order matters:
# ~/.local/share/pnpm wins over a system pnpm.
export PATH="${HOME}/.local/share/pnpm:${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# Pick up node from nvm if installed (commonly the case on dev machines).
if [ -d "${HOME}/.nvm" ] && [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh" --no-use
  nvm use --silent default >/dev/null 2>&1 || true
fi

# Where to log. Default: <project>/logs/cron/. Override via $SKILLS_NORMALISE_LOG_DIR.
LOG_DIR="${SKILLS_NORMALISE_LOG_DIR:-${PROJECT_ROOT}/logs/cron}"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/skills-normalise-$(date -u +%Y%m%d-%H%M%S).log"

# Retain the last 12 logs (≈ 3 months at weekly cadence). Wrapped in
# `|| true` so pipefail doesn't trip when the directory is empty (the
# initial run of the timer hits this case).
( ls -1t "${LOG_DIR}"/skills-normalise-*.log 2>/dev/null || true ) | tail -n +13 | xargs -r rm --

# Header — appended to the log
{
  echo "─────────────────────────────────────────────────────────────"
  echo "skills:normalise — invoked $(date -u +%Y-%m-%dT%H:%M:%SZ) (UTC)"
  echo "                          $(TZ=Asia/Bangkok date +%Y-%m-%dT%H:%M:%S%z) (Asia/Bangkok)"
  echo "PROJECT_ROOT=${PROJECT_ROOT}"
  echo "PATH=${PATH}"
  echo "node=$(command -v node || echo MISSING) $(node --version 2>/dev/null || true)"
  echo "pnpm=$(command -v pnpm || echo MISSING) $(pnpm --version 2>/dev/null || true)"
  echo "─────────────────────────────────────────────────────────────"
} >>"${LOG_FILE}" 2>&1

# Run the actual command. Disable -e here so we can capture pnpm's exit
# code without the script aborting before the trailer runs.
set +e
pnpm skills:normalise --source=all --auto-promote --batch-size=25 >>"${LOG_FILE}" 2>&1
exit_code=$?
set -e

{
  echo "─────────────────────────────────────────────────────────────"
  echo "exit_code=${exit_code}"
} >>"${LOG_FILE}" 2>&1

echo "Logged to ${LOG_FILE} (exit ${exit_code})" >&2
exit "${exit_code}"
