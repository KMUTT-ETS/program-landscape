# 19 — Backup & restore drill automation

> **Mode:** code change + operator-doc. Verification scripts + admin tile + systemd unit ship
> from this dev box; the first end-to-end restore-drill timing measurement is the operator
> gate (requires the prod compose + a real backup).
> **Plan:** [`19-backup-dr.plan.md`](./19-backup-dr.plan.md).
> **Files changed:** **2 modified + 9 new.** Net diff: **+919 / 0** (all infra).
> **Tests:** apps/api 53/53 still passing. Pre-existing tsc strict-null in
> `analyst/tool-executor.service.ts:95` fixed in passing (1-char change: `let
> clampedInput: unknown = call.input`).

---

## 1. The four verifiers — nightly automation

Four scripts under `scripts/dr/`. Each writes a verdict JSON to
`/var/lib/program-landscape/<source>-verification.json` that
`BackupVerificationService` reads for `/admin/system-status`.

### 1.1 `verify-backup.sh` (171 LOC)

Picks the latest dump from `$BACKUPS_DIR`, spins up an isolated
`postgres:16-alpine` container (named `program-landscape-verify-pg` on
port `:55432`), restores via `pg_restore --clean --if-exists`, runs four
structural assertions, tears down on EXIT trap.

Assertions:

| # | Assertion | Threshold | Fails when |
|---|---|---|---|
| 1 | `information_schema.tables` count | ≥ 60 | Schema corruption |
| 2 | `programs WHERE code LIKE 'KKU-SEQ-%'` count | ≥ 200 | Seed didn't land in dump |
| 3 | `audit_logs` newest row age | ≤ 26 h | Backup landed but DB is stalled (writes stopped) |
| 4 | `departments` orphaned by missing parent faculty | == 0 | Mid-transaction dump |

**Pre-flight refusal:** if the backup file itself is > 26 h old, the
script refuses to even start the verification — that'd hide a stuck
`backup.sh` under a green status. Threshold is 26 h (not 24) to absorb
timer drift + the existing `RandomizedDelaySec=120`.

Exit codes: `0` OK, `1` operational failure, `2` verification failure.

### 1.2 `verify-minio.sh` (170 LOC)

Two-pass check on the latest `*-minio.tar.gz`:

| Pass | What | Threshold |
|---|---|---|
| 1 | Object-count delta (live vs tar) | live count must NOT be more than 50 below tar — extras above are legit (writes since snapshot) |
| 2 | Sampled hash (20 random objects from tar, both sides hashed) | ≥ 90 % must match |

The 90 % match-rate (rather than 100 %) absorbs legitimate object
deletes/replaces between snapshot and verify time. Mismatches +
live-side missing entries are recorded in `detail` for ops triage.

### 1.3 `check-mirror.sh` (96 LOC)

Reads the off-server (KKU IT) mirror stamp file from MinIO at
`db-backups/_mirror_status.json` (KKU IT's rclone wrapper writes it
post-mirror), parses `lastMirrorAt`, asserts age ≤ 26 h. Format:

```json
{
  "lastMirrorAt": "2026-05-09T03:30:42Z",
  "sourceCount":  1234,
  "destCount":    1234,
  "byteSize":     12345678
}
```

The KKU IT-side rclone wrapper update is the one external dependency
in the chain — documented as the prod-deploy gate.

### 1.4 `retention-check.sh` (89 LOC)

Inverts the same `find -mtime` predicates `backup.sh` uses to prune.
Anything that SHOULD have been deleted but is still present is a
violation. Rules:

- daily `*.sql.gz` > 30 d (excluding `monthly-*` + `pre-deploy-*`) → violation
- `*-minio.tar.gz` > 30 d (excluding `monthly-*`) → violation
- `monthly-*` > 365 d → violation
- `pre-deploy-*` > 90 d → violation

This catches the silent-failure mode where the prune step in `backup.sh`
crashes (e.g., `find` permission denied on a stuck file) and the
operator doesn't notice — backups silently accumulate until the disk
fills up.

---

## 2. Restore-drill rehearsal — `restore-drill.sh` (196 LOC)

Spins up a from-cold isolated docker-compose stack (different project
name + ports so prod stays untouched), restores the latest dump into
its postgres, hands off to the Playwright smoke from prompt 18 against
that stack.

### Phase timing harness

Each phase records its duration into a `PHASE_SEC` associative array.
Final log emits a per-phase breakdown + total — operator captures this
for the drill log.

| Phase | Description | Expected (~5 GB DB) |
|---|---|---|
| `pick_backup` | Find + stat the latest dump | ≤ 1 s |
| `provision_pg` | `docker run` + `pg_isready` poll | ≤ 30 s |
| `pg_restore` | Restore the dump (long pole) | 5–15 min |
| `assertions` | Pre-flight `psql` queries | ≤ 5 s |
| `compose_up` | Bring up isolated stack overlay | 60–90 s |
| **smoke** (out-of-band) | Playwright suite from prompt 18 | 3–5 min |
| **TOTAL** | end-to-end | **target < 30 min** |

### Operator runbook

Production runbook is the prose below — the script's compose-overlay
step is currently a STUB (logs a clearly-marked "wired in production
runbook" line) because the overlay file lives in
`/opt/program-landscape/secrets/` and varies per environment.

```bash
# 1. From-cold restore drill (run on the prod host or a clone)
sudo /opt/program-landscape/current/scripts/dr/restore-drill.sh

# 2. Once stack is up, run the smoke against the drill ports:
PLAYWRIGHT_BASE_URL=http://localhost:8543 \
  pnpm --filter web test:e2e

# 3. Capture timing into the drill log:
ls /opt/program-landscape/dr-drills/
cat /opt/program-landscape/dr-drills/index.tsv
```

### Drill log

| Date | Backup | Size | Total | Result | Notes |
|---|---|---|---|---|---|
| _(awaiting first staging-stack run)_ | | | | | |

> First measurement lands here after the operator runs the drill on
> staging. `restore-drill.sh` appends to `dr-drills/index.tsv` for
> easy traceability.

---

## 3. Admin tile — `BackupVerificationService` + `/admin/system-status`

`apps/api/src/admin/backup-verification.service.ts` (119 LOC) reads the
four JSON verdict files in parallel (fail-soft on ENOENT — verifier
hasn't run yet ⇒ status `UNKNOWN`).

Aggregate verdict logic:

| Trigger | Aggregate |
|---|---|
| Any verdict `FAILED` or `OP_FAILURE` | **RED** |
| Any verdict `lastRun` > 26 h ago | **RED** (timer is stuck) |
| Any verdict `UNKNOWN` (verifier never ran) | **AMBER** |
| All four `OK` and ≤ 26 h old | **GREEN** |

Wired into `system-status.controller.ts` as a 5th sibling in the
`Promise.all`, surfaced as the top-level `backup` field of the
response payload:

```jsonc
{
  // existing fields …
  "backup": {
    "pg":        { "source": "pg",        "status": "OK",     "lastRun": "...", "ageHours": 7.2, "metrics": { "tableCount": 78, "programCount": 297, "auditLogMaxAgeHours": 12 } },
    "minio":     { "source": "minio",     "status": "OK",     "lastRun": "...", "ageHours": 7.1, "metrics": { "liveObjectCount": 1234, "tarObjectCount": 1230, "samplesMatching": 20 } },
    "mirror":    { "source": "mirror",    "status": "OK",     "lastRun": "...", "ageHours": 5.8 },
    "retention": { "source": "retention", "status": "OK",     "lastRun": "...", "ageHours": 7.0, "metrics": { "totalBackups": 31, "stalDailies": 0 } },
    "overall":   "GREEN"
  }
}
```

(The admin UI render — colour-coded tile with click-through to
the per-source detail — is downstream of this surface and lands when
the operator wants to wire it. The JSON shape is the contract.)

---

## 4. Systemd unit — `program-landscape-verify-backup.{service,timer}`

```
[Timer]
OnCalendar=*-*-* 03:00:00 Asia/Bangkok
RandomizedDelaySec=300
Persistent=true
```

03:00 Asia/Bangkok = 1 h after `program-landscape-backup.timer` fires
at 02:00. Gives `backup.sh` time to finish dumping + mirroring before
verification starts.

The service runs all four verifiers in sequence, with `; true` between
them so a single failure doesn't abort the rest — each verifier writes
its own JSON, which is exactly what `/admin/system-status` needs.

`SuccessExitStatus=0 1 2` — the verifiers use exit 2 for "verification
failed", which is a legitimate outcome (the unit's job is to RUN the
verifier; the verdict goes to `/admin/system-status`).

Install on prod:

```bash
sudo cp /opt/program-landscape/current/infra/systemd/program-landscape-verify-backup.{service,timer} \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now program-landscape-verify-backup.timer
```

---

## 5. Files changed

```
 scripts/dr/verify-backup.sh                                      (NEW) | +171
 scripts/dr/verify-minio.sh                                       (NEW) | +170
 scripts/dr/check-mirror.sh                                       (NEW) | +96
 scripts/dr/retention-check.sh                                    (NEW) | +89
 scripts/dr/restore-drill.sh                                      (NEW) | +196
 apps/api/src/admin/backup-verification.service.ts                (NEW) | +119
 apps/api/src/admin/admin.module.ts                                     | +2 / 0
 apps/api/src/admin/system-status.controller.ts                         | +12 / -2
 apps/api/src/analyst/tool-executor.service.ts                          | +1 / -1   (pre-existing tsc fix)
 infra/systemd/program-landscape-verify-backup.service            (NEW) | +31
 infra/systemd/program-landscape-verify-backup.timer              (NEW) | +16
 docs/hardening/19-backup-dr.{plan,report}.md                     (NEW) | this report + plan
 ────────────────────────────────────────────────────────────────────────
 11 source files (9 new + 2 modified) + 2 docs
```

---

## 6. Acceptance criteria check

| Criterion | Status |
|---|---|
| From-cold restore drill (image load → restore → smoke pass) in <30 min, with documented timing | **operator gate** — `restore-drill.sh` provides the timing harness with per-phase breakdown. Documented expected timing (pick 1 s + provision 30 s + restore 5–15 min + assertions 5 s + compose 60–90 s + smoke 3–5 min ≈ 9–22 min). First measurement lands in §2 "Drill log" after staging run. |
| Backup verification runs nightly | ✅ §4 — systemd timer at 03:00 Asia/Bangkok, ~1 h after backup completion. |
| Verification verdict surfaces at `/admin/system-status` | ✅ §3 — `BackupVerificationService` reads 4 verdict JSONs; aggregate RED/AMBER/GREEN tile in the response. |
| MinIO backup integrity (object counts + sampled hashes) | ✅ §1.2 — `verify-minio.sh` does both, with 90 % match-rate threshold. |
| Off-server mirror freshness check | ✅ §1.3 — `check-mirror.sh` reads stamp file from MinIO; 26 h staleness threshold. KKU IT's rclone wrapper update is the documented prod-deploy dependency. |
| Restore-drill script | ✅ §2 — `restore-drill.sh` with phase-timing harness. |
| Retention enforcement check (deletes happen, not just policy) | ✅ §1.4 — `retention-check.sh` inverts `backup.sh`'s prune predicates. |
| First restore-drill output captured | **operator gate** — `dr-drills/<TS>.log` + `dr-drills/index.tsv` ship populated on first run. |

---

## 7. What this prompt does NOT do

- **Run the actual drill.** The 30-min acceptance gate requires (a) a real recent backup
  produced by `backup.sh` running on the prod-side compose, and (b) an `images.tar` from a
  real release bundle for the from-cold image-load step. Both exist on the prod server, not
  on this dev box. The script + harness ship; the first measurement is the operator's first
  run.
- **WAL replay.** Documented as a backup class in `docs/backup-dr.md` but not yet wired
  (Postgres archive_command + WAL shipping + replay during restore are a multi-day
  deliverable). When wired, `restore-drill.sh` gets a `--wal-since-snapshot` flag.
- **Real paging on red verdict.** Verdict surfaces at `/admin/system-status` as RED text + an
  amber/red tile. PagerDuty / SMS integration is the operator's tooling choice (CLAUDE.md
  notes "alerting deferred").
- **Auto-promote monthly archives to KKU's IT-managed cold storage.** Today the operator
  uploads manually; a `mc cp` script + cron would close this — listed as a follow-up in
  `docs/backup-dr.md`.
- **Encryption-at-rest on the backup tarballs.** MinIO bucket-level KMS is documented as a
  follow-up.
- **Admin UI render of the tile.** The JSON shape is the contract; rendering as a colour-coded
  card on `/admin/system-status` is downstream when the operator wants the visual pass.

The 1-char tsc fix in `analyst/tool-executor.service.ts:95` (`let clampedInput: unknown =
call.input`) is unrelated — it surfaced when I ran `pnpm --filter api exec tsc --noEmit` to
verify my admin-controller change. Clean fix in passing; tests stay 53/53 green.
