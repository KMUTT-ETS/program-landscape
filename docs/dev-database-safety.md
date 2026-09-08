# Dev safety: the database, and secrets in `.env`

The dev database is not a scratch database. It holds real production-derived
data — 297 programmes, ~81k research outputs, curriculum digests, course
extractions — much of which exists nowhere else in reproducible form, and it is
shared with a second operator. Losing it costs days.

Production was already protected: `prisma migrate deploy` is the only migration
path in `scripts/deploy.sh`, `db:migrate:safe` takes a `pg_dump` first,
`scripts/migration-linter.ts` blocks `DROP TABLE` / `DROP COLUMN` / renames in
CI, and nightly backups run under a systemd timer with `verify-backup.sh`
restoring them into a throwaway container to prove they work.

Dev had none of that. This document describes the three layers added on
2026-09-08 to close the gap.

## What went wrong

On 2026-09-06 an agent working on a schema task ran:

```
prisma migrate diff --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$DATABASE_URL"
```

`migrate diff --from-migrations` needs a shadow database to replay migrations
into, and Prisma treats a shadow database as **disposable**: it drops it,
replays every migration, reads the resulting schema, and moves on. Pointed at
`DATABASE_URL`, that is the working database. It dropped `_prisma_migrations`,
replayed 112 migrations, and left an empty schema.

The command reads like a diff. Nothing warned. Recovery meant restoring the
prod dump `pre-deploy-1.9.1.sql.gz`; the dev-only delta (roughly 55 programmes'
pre-v2.3 course rows) was lost.

## Layer 1 — refuse the command class

`scripts/dev-guard/db-destructive-guard.py`, wired as a `PreToolUse` hook on
`Bash` in `.claude/settings.json`. It reads the pending command and denies it
outright — no prompt, no approval path — when it matches one of:

| Blocked | Why |
|---|---|
| `--shadow-database-url` | The exact 2026-09-06 footgun. Prisma drops whatever it points at. |
| `prisma migrate reset` | Drops every table and re-seeds. |
| `prisma db push` | Force-syncs the schema; silently drops columns and tables the schema no longer declares. |
| `prisma migrate dev` | On any drift it offers a full reset — and agents accept it. |
| `prisma migrate diff --from-migrations` | Needs a shadow database, which Prisma resets. |
| `dropdb` | Never an agent action here. |
| `docker compose down -v` / `--volumes` | Deletes the Postgres and MinIO volumes: every row and every uploaded PDF. |
| `pnpm db:reset` | Runs `docker compose down -v` as its first step. |
| `DROP DATABASE` / `DROP SCHEMA` / `TRUNCATE` | Only when the command is actually executing SQL (`psql`, `prisma`, `$executeRaw`, `$queryRaw`, `pg_restore`) — so `grep -rn "TRUNCATE" packages/db` still works. |

**Deny, never ask.** An approval prompt is a prompt an agent can talk its way
past, and a busy operator approves by reflex. A denial costs one message
("hand this to the operator"); a wrong approval costs the database.

The guard is written in Python, not `jq` or Node: `jq` is not installed on this
machine and Node lives under nvm, so neither is guaranteed on a hook's `PATH`.
A guard that silently no-ops because its parser is missing is worse than no
guard. `/usr/bin/python3` is always present; if it ever is not, the hook errors
visibly rather than passing everything through.

### Expected false positives

Matching is on the raw command string, so a command that merely *mentions* a
blocked phrase is blocked too — writing a heredoc that documents
`prisma migrate reset`, for example. That is deliberate. Tightening the match
to "not inside quotes" would create exactly the loophole an agent would find.
Use the `Write` tool for such files instead of a shell heredoc.

### Running a blocked command legitimately

Hand it to the operator to run in their own terminal (`! <command>` in a Claude
Code session runs it directly). Do not edit the guard to get past it.

### The same guard blocks `.env` secret spills

Added 2026-09-08, after **two live credentials leaked into session transcripts
in a single day**:

- `KMITL_SKILL_MAPPING_SECRET_KEY` — `set -a; . ./.env` on a line whose value
  had an unquoted leading space, so the shell parsed it as `KEY=` followed by
  the key *as a command* and echoed the whole thing as "command not found".
- `SCRAPINGBEE_API_KEY` — a `grep` on `.env`, which prints whole lines.

Both had to be rotated. A transcript is not a private place: it is written to
disk, may sync to claude.ai, and is read back into context on every resume.

The guard therefore refuses, on `Bash`, `Read` and `Grep`:

| Blocked | Safe instead |
|---|---|
| `. .env` / `source .env` (any `set -a` form) | a script that parses the file and prints only what it needs |
| `cat` / `head` / `tail` / `less` / `more` / `strings` / `xxd` / `od` / `bat` on `.env` | `cut -d= -f1 .env` for key names |
| `grep` / `rg` on `.env` without `-c`, `-l`, `-L` or `-q` | `grep -c '^SOME_KEY=' .env` to test that one is set |
| `Read` or `Grep` tool pointed at `.env` | same as above |

`.env.example` and `.env.prod.example` are deliberately **not** matched — they
hold `REPLACE_ME` placeholders, not secrets.

### Testing the guard

`scripts/dev-guard/guard-cases.json` holds real `(tool, tool_input)` payloads
and the verdict each must get. Run it after any change to the rules:

```bash
python3 scripts/dev-guard/test-guard.py \
  scripts/dev-guard/guard-cases.json \
  scripts/dev-guard/db-destructive-guard.py
```

The ALLOW cases matter as much as the DENY ones. A guard that refuses ordinary
work gets switched off, and a switched-off guard protects nothing — so every
exemption worth keeping (`cut -d= -f1 .env`, `migrate deploy`, `docker compose
down` without `-v`) is pinned by a case.

## Layer 2 — give Prisma a shadow database that is safe to destroy

`SHADOW_DATABASE_URL` now points at `program_landscape_shadow`, a dedicated
throwaway database, and `packages/db/prisma/schema.prisma` declares
`shadowDatabaseUrl = env("SHADOW_DATABASE_URL")`. Without that declaration the
env var is inert and the flag has to be passed by hand — which is the whole
problem.

Set in `.env` and documented in `.env.example`. Create it once with:

```bash
docker exec program-landscape-postgres createdb -U kku program_landscape_shadow
```

Production is unaffected: `prisma migrate deploy` never needs a shadow
database, and Prisma only resolves the env var when one is actually required —
verified with the variable unset.

## Layer 3 — dev backups

`scripts/dev-guard/dev-backup.sh` takes a compressed custom-format `pg_dump`
(~290 MB against a 1.7 GB database) into `~/program-landscape-dev-backups`,
**outside the repo**, so no git operation, `pnpm clean`, or container teardown
can take it along. Retention is 7 days, and pruning never removes the last
remaining snapshot — age-only pruning would leave nothing at all after an idle
fortnight.

Each dump is checked with `pg_restore --list` before it is kept: an archive
with fewer than 50 `TABLE DATA` entries is deleted rather than stored, because
a dump that restores nothing is worse than no dump — it hides the failure.

Two triggers:

- **Nightly**, 02:30 with a 10-minute jitter, via a `systemd --user` timer with
  `Persistent=true` so a run missed while the machine was asleep catches up.
  Install with `./scripts/dev-guard/dev-backup.sh --install`.

  A user timer only runs while the user has a live session. On WSL2 that means
  "whenever WSL is up with a shell open", which combined with `Persistent=true`
  is usually enough. To make it run regardless, one command, once:
  `sudo loginctl enable-linger denpong` (it needs root, so it is not part of
  `--install`).
- **At session start**, via an async `SessionStart` hook running
  `--if-stale`, which snapshots only if the newest is more than 20 h old and
  exits silently when the stack is down. The threat here is agent activity, not
  the passage of time, so a snapshot immediately before an agent session is
  worth more than one at a fixed hour.

```bash
./scripts/dev-guard/dev-backup.sh            # snapshot now
./scripts/dev-guard/dev-backup.sh --status   # what is on disk, timer state
./scripts/dev-guard/dev-backup.sh --install  # install the nightly timer
```

### Restoring

Restore into a **fresh** database and swap; never restore over a live one.

```bash
docker exec program-landscape-postgres createdb -U kku program_landscape_restore
docker exec -i program-landscape-postgres \
  pg_restore --no-owner --no-acl -U kku -d program_landscape_restore \
  < ~/program-landscape-dev-backups/dev-YYYYMMDD-HHMMSS.dump
```

Then stop the dev stack (`pnpm dev` holds connections and a rename or drop will
fail with `database ... is being accessed by other users`), rename, and restart.

## What this does not cover

- **MinIO.** Uploaded PDFs and generated outputs are not in the dev snapshot.
  They are reproducible from `/home/denpong/kku_programs` and from prod, so the
  cost of losing them is hours, not days — but it is a real gap.
- **Verification by restore.** Prod's `verify-backup.sh` restores each nightly
  dump into a throwaway container and asserts on the result. Dev checks only the
  archive table of contents. Worth upgrading if dev snapshots ever become the
  primary recovery path.
- **Non-agent mistakes.** The `PreToolUse` hook only sees commands an agent
  runs. An operator typing the same command in their own terminal is
  unprotected; layer 3 is what covers that case.
