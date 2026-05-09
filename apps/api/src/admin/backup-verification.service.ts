import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// Reads the verdict files written by scripts/dr/{verify-backup,verify-minio,
// check-mirror,retention-check}.sh. The scripts run on the host (systemd
// timer); this service reads their output from the host-mounted state
// directory.
//
// Failure semantics: missing file === "never run" — surfaces as
// `null` lastRun + status='UNKNOWN'. Surfacing red on `/admin/system-status`
// is the operator paging signal until real alerting lands.

export interface BackupVerificationVerdict {
  source: 'pg' | 'minio' | 'mirror' | 'retention';
  status: 'OK' | 'FAILED' | 'OP_FAILURE' | 'UNKNOWN';
  lastRun: string | null;
  ageHours: number | null;
  detail?: string | null;
  metrics?: Record<string, unknown>;
}

export interface BackupTile {
  pg: BackupVerificationVerdict;
  minio: BackupVerificationVerdict;
  mirror: BackupVerificationVerdict;
  retention: BackupVerificationVerdict;
  // Aggregate red-flag — if ANY of the four is FAILED or > 26 h stale.
  overall: 'GREEN' | 'AMBER' | 'RED';
}

@Injectable()
export class BackupVerificationService {
  private readonly logger = new Logger(BackupVerificationService.name);

  // Override via env BACKUP_VERIFY_STATE_DIR to point at a different
  // path in dev / staging.
  private readonly stateDir =
    process.env.BACKUP_VERIFY_STATE_DIR || '/var/lib/program-landscape';

  async getTile(): Promise<BackupTile> {
    const [pg, minio, mirror, retention] = await Promise.all([
      this.readVerdict('pg', 'backup-verification.json', 'verifiedAt'),
      this.readVerdict('minio', 'minio-verification.json', 'verifiedAt'),
      this.readVerdict('mirror', 'mirror-verification.json', 'checkedAt'),
      this.readVerdict('retention', 'retention-verification.json', 'checkedAt'),
    ]);

    return {
      pg,
      minio,
      mirror,
      retention,
      overall: this.aggregate([pg, minio, mirror, retention]),
    };
  }

  private async readVerdict(
    source: BackupVerificationVerdict['source'],
    file: string,
    timestampField: 'verifiedAt' | 'checkedAt',
  ): Promise<BackupVerificationVerdict> {
    const full = path.join(this.stateDir, file);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const ts = (parsed[timestampField] as string | undefined) ?? null;
      const status = (parsed.status as BackupVerificationVerdict['status']) ?? 'UNKNOWN';
      const ageHours =
        ts ? (Date.now() - new Date(ts).getTime()) / (60 * 60 * 1000) : null;
      // Strip the timestamp + status from the metrics — they're already
      // surfaced as top-level fields. Keep everything else for the UI to
      // render (tableCount, sampleSize, etc.).
      const { status: _s, detail, ...metrics } = parsed;
      delete metrics[timestampField];
      return {
        source,
        status,
        lastRun: ts,
        ageHours,
        detail: (detail as string | undefined) ?? null,
        metrics,
      };
    } catch (err) {
      // ENOENT is the expected steady-state when the verifier hasn't
      // run yet (post-deploy day 1 before the timer fires). UI shows
      // "—" and the operator interprets.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Failed to read ${full}: ${(err as Error).message}`);
      }
      return {
        source,
        status: 'UNKNOWN',
        lastRun: null,
        ageHours: null,
        detail: 'verifier has not run',
      };
    }
  }

  private aggregate(verdicts: BackupVerificationVerdict[]): BackupTile['overall'] {
    // RED: any FAILED, or any verdict older than 26 h (means the timer
    // is stuck — no fresh result is itself a failure mode).
    const hasFailed = verdicts.some((v) => v.status === 'FAILED' || v.status === 'OP_FAILURE');
    if (hasFailed) return 'RED';

    const stuck = verdicts.some(
      (v) => v.lastRun !== null && v.ageHours !== null && v.ageHours > 26,
    );
    if (stuck) return 'RED';

    // AMBER: any UNKNOWN (verifier never ran). Acceptable on day 1
    // post-deploy, not acceptable in steady state — the UI explains.
    const hasUnknown = verdicts.some((v) => v.status === 'UNKNOWN');
    if (hasUnknown) return 'AMBER';

    return 'GREEN';
  }
}
