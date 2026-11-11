// Guards the rule that a published health score is reproducible: the numbers
// in packages/db/src/health-score/tuning.ts may only change together with
// the methodology version stamped on every score.
//
// If this test fails after you changed tuning.ts:
//   - Adopting institution: set (or bump) INSTITUTION_REVISION in tuning.ts,
//     e.g. 'kmutt.1' -> 'kmutt.2', then add a line to PINNED below for the
//     new version with the fingerprint the failure printed. Keep the old
//     lines: they record what each published version used.
//   - Upstream: bump UPSTREAM_HEALTH_SCORE_VERSION in version.ts and pin it.
//
// It also fails after you merge an upstream release that bumped the
// upstream version, because '<new upstream>+<your revision>' is not pinned
// yet. Review what changed upstream, then pin it.
//
// This catches changed NUMBERS only. A change to a scorer's logic needs a
// new version too; nothing here can detect it, so it is on the reviewer.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FLAGSHIP_REVENUE_FLOOR_THB,
  HEALTH_SCORE_TUNING,
  INSTITUTION_REVISION,
  REVENUE_TARGET_THB_BY_LEVEL,
} from '../src/health-score/tuning';
import { HEALTH_SCORE_VERSION, UPSTREAM_HEALTH_SCORE_VERSION } from '../src/health-score/version';

/** methodology version -> fingerprint of the tuning it was published with. */
const PINNED: Record<string, string> = {
  'health-score.v5.6': '58169869d6276c5f',
};

function tuningFingerprint(): string {
  const payload = JSON.stringify({
    tuning: HEALTH_SCORE_TUNING,
    revenueTargets: REVENUE_TARGET_THB_BY_LEVEL,
    flagshipFloor: FLAGSHIP_REVENUE_FLOOR_THB,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

describe('health-score tuning pin', () => {
  it('the tuning values match the fingerprint pinned for the stamped version', () => {
    const actual = tuningFingerprint();
    const pinned = PINNED[HEALTH_SCORE_VERSION];
    const hint =
      pinned === undefined
        ? `No fingerprint is pinned for ${HEALTH_SCORE_VERSION}. If this version is intended, ` +
          `add  '${HEALTH_SCORE_VERSION}': '${actual}',  to PINNED in this file.`
        : `tuning.ts changed but the version did not. Set or bump INSTITUTION_REVISION in ` +
          `tuning.ts (adopter) or UPSTREAM_HEALTH_SCORE_VERSION in version.ts (upstream), ` +
          `then pin the new version with '${actual}'.`;
    expect(pinned === actual, hint).toBe(true);
  });

  it('the stamped version is the upstream version plus the institution revision', () => {
    expect(HEALTH_SCORE_VERSION).toBe(
      INSTITUTION_REVISION === null
        ? UPSTREAM_HEALTH_SCORE_VERSION
        : `${UPSTREAM_HEALTH_SCORE_VERSION}+${INSTITUTION_REVISION}`,
    );
  });

  it('an institution revision is a short lowercase tag', () => {
    if (INSTITUTION_REVISION === null) return;
    expect(INSTITUTION_REVISION).toMatch(/^[a-z0-9][a-z0-9.-]{0,31}$/);
  });
});
