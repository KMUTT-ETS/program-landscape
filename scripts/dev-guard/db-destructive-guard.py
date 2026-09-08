#!/usr/bin/env python3
"""Claude Code PreToolUse hook on Bash — refuse commands that can silently
destroy the DEV database.

Wired from .claude/settings.json; runs on every Bash tool call.

WHY THIS EXISTS
    On 2026-09-06 an agent ran

        prisma migrate diff --from-migrations ... --shadow-database-url "$DATABASE_URL"

    Prisma treats the shadow database as disposable: it DROPPED and replayed the
    live dev database. Recovery took a restore from a prod dump and lost the dev
    delta. Nothing in the repo or in Prisma warned first — the command reads as
    a read-only diff.

POSTURE
    Deny, don't ask. A denial is cheap (hand the command to the operator); an
    accidental approval is not. Every rule below names a command with no
    legitimate agent-initiated use on this project.

WHY PYTHON AND NOT jq
    jq is not installed on this machine and node lives under nvm, so its
    presence on a hook's PATH is not guaranteed. A guard that silently
    no-ops because its parser is missing is worse than no guard. /usr/bin/python3
    is always there; if it ever is not, this hook errors visibly rather than
    passing everything through.

Reads the hook payload on stdin, prints a PreToolUse deny verdict on stdout.
Always exits 0 — a non-zero exit surfaces as a hook *error*, not a clean refusal.
"""

import json
import re
import sys

# (compiled pattern(s), reason). A rule fires when every pattern matches the
# command. Matching is case-insensitive.
RULES: list[tuple[list[str], str]] = [
    (
        [r"--shadow-database-url"],
        "BLOCKED: --shadow-database-url. Prisma DROPS and replays whatever database "
        "this points at; pointed at DATABASE_URL it wiped the dev database on "
        "2026-09-06. SHADOW_DATABASE_URL is already set in .env to a dedicated "
        "throwaway database — never pass this flag by hand. If a schema diff is "
        "genuinely needed, hand the command to the operator.",
    ),
    (
        [r"\bprisma\b", r"\bmigrate\s+reset\b"],
        "BLOCKED: prisma migrate reset. Drops every table and re-seeds. The dev "
        "database holds real production-derived data. Hand this to the operator.",
    ),
    (
        [r"\bprisma\b", r"\bdb\s+push\b"],
        "BLOCKED: prisma db push. Force-syncs the schema and silently drops columns "
        "and tables the schema no longer declares. Hand-write a migration under "
        "packages/db/prisma/migrations/ and apply it with 'prisma migrate deploy'.",
    ),
    (
        [r"\bprisma\b", r"\bmigrate\s+dev\b"],
        "BLOCKED: prisma migrate dev. On any drift it offers a full database reset — "
        "and agents accept it. Use 'prisma migrate deploy' with a hand-written "
        "migration instead.",
    ),
    (
        [r"\bmigrate\s+diff\b", r"--from-migrations"],
        "BLOCKED: prisma migrate diff --from-migrations. Requires a shadow database, "
        "which Prisma resets. Diff schema-to-schema instead "
        "(--from-schema-datamodel / --to-schema-datamodel), or hand it to the operator.",
    ),
    (
        [r"\bdropdb\b"],
        "BLOCKED: dropdb. Never an agent-initiated action here — hand it to the operator.",
    ),
    (
        [r"docker\s+compose\b(?:(?!\s*[;&|]).)*\bdown\b(?:(?!\s*[;&|]).)*(?:-v\b|--volumes\b)"],
        "BLOCKED: docker compose down -v. Deletes the Postgres and MinIO volumes — "
        "every row and every uploaded PDF. Use 'docker compose down' (no -v) to stop "
        "containers.",
    ),
    (
        [r"\bpnpm\s+(?:run\s+)?db:reset\b"],
        "BLOCKED: pnpm db:reset. It runs 'docker compose down -v' first, deleting the "
        "Postgres and MinIO volumes.",
    ),
]

# Raw SQL rules only fire when the command actually *executes* SQL — so that
# `grep -rn "TRUNCATE" packages/db` stays allowed.
SQL_EXECUTION_CONTEXT = r"(\bpsql\b|\bprisma\b|\$executeRaw|\$queryRaw|\bpg_restore\b)"
SQL_RULES: list[tuple[str, str]] = [
    (
        r"\bDROP\s+DATABASE\b",
        "BLOCKED: DROP DATABASE. Never an agent-initiated action here — hand it to the "
        "operator.",
    ),
    (
        r"\bDROP\s+SCHEMA\b",
        "BLOCKED: DROP SCHEMA. Never an agent-initiated action here — hand it to the "
        "operator.",
    ),
    (
        r"\bTRUNCATE\b",
        "BLOCKED: TRUNCATE. The dev database holds real production-derived data and "
        "there is no dev-side undo. If a table genuinely needs emptying, hand the "
        "statement to the operator.",
    ),
]


def find_violation(command: str) -> str | None:
    for patterns, reason in RULES:
        if all(re.search(p, command, re.IGNORECASE | re.DOTALL) for p in patterns):
            return reason
    if re.search(SQL_EXECUTION_CONTEXT, command, re.IGNORECASE):
        for pattern, reason in SQL_RULES:
            if re.search(pattern, command, re.IGNORECASE | re.DOTALL):
                return reason
    return None


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        command = payload.get("tool_input", {}).get("command") or ""
    except Exception:
        # Malformed payload: never block real work because the parse hiccuped.
        return
    if not command:
        return
    reason = find_violation(command)
    if reason is None:
        return
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
