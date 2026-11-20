// Guards the rule that a published lifecycle verdict is reproducible: the
// numbers in packages/db/src/lifecycle/tuning.ts (and the health-score
// numbers lifecycle shares) may only change together with the methodology
// version stamped on every verdict.
//
// If this test fails after you changed a tuning value:
//   - Adopting institution: set (or bump) LIFECYCLE_INSTITUTION_REVISION in
//     lifecycle/tuning.ts, e.g. 'kmutt.1' -> 'kmutt.2', then add a line to
//     PINNED below for the new version with the fingerprint the failure
//     printed. Keep the old lines: they record what each published version
//     used.
//   - Upstream: bump UPSTREAM_LIFECYCLE_VERSION in lifecycle/version.ts and
//     pin it.
//
// The fingerprint also covers the revenue targets, the flagship floor and
// the partial-year share, which live in health-score/tuning.ts. Changing
// one of those needs a new lifecycle version as well as a new health-score
// version.
//
// This catches changed NUMBERS only. A change to the formula's logic needs a
// new version too; nothing here can detect it, so it is on the reviewer.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FLAGSHIP_REVENUE_FLOOR_THB,
  HEALTH_SCORE_TUNING,
  REVENUE_TARGET_THB_BY_LEVEL,
} from '../src/health-score/tuning';
import { LIFECYCLE_INSTITUTION_REVISION, LIFECYCLE_TUNING } from '../src/lifecycle/tuning';
import { LIFECYCLE_VERSION, UPSTREAM_LIFECYCLE_VERSION } from '../src/lifecycle/version';

/** methodology version -> fingerprint of the tuning it was published with. */
const PINNED: Record<string, string> = {
  'lifecycle.v1.4': '91368104e5d38ed3',
};

function tuningFingerprint(): string {
  const payload = JSON.stringify({
    tuning: LIFECYCLE_TUNING,
    revenueTargets: REVENUE_TARGET_THB_BY_LEVEL,
    flagshipFloor: FLAGSHIP_REVENUE_FLOOR_THB,
    partialYearBelowShareOfPrior: HEALTH_SCORE_TUNING.shared.partialYearBelowShareOfPrior,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

describe('lifecycle tuning pin', () => {
  it('the tuning values match the fingerprint pinned for the stamped version', () => {
    const actual = tuningFingerprint();
    const pinned = PINNED[LIFECYCLE_VERSION];
    const hint =
      pinned === undefined
        ? `No fingerprint is pinned for ${LIFECYCLE_VERSION}. If this version is intended, ` +
          `add  '${LIFECYCLE_VERSION}': '${actual}',  to PINNED in this file.`
        : `A lifecycle tuning value changed but the version did not. Set or bump ` +
          `LIFECYCLE_INSTITUTION_REVISION in lifecycle/tuning.ts (adopter) or ` +
          `UPSTREAM_LIFECYCLE_VERSION in lifecycle/version.ts (upstream), ` +
          `then pin the new version with '${actual}'.`;
    expect(pinned === actual, hint).toBe(true);
  });

  it('the stamped version is the upstream version plus the institution revision', () => {
    expect(LIFECYCLE_VERSION).toBe(
      LIFECYCLE_INSTITUTION_REVISION === null
        ? UPSTREAM_LIFECYCLE_VERSION
        : `${UPSTREAM_LIFECYCLE_VERSION}+${LIFECYCLE_INSTITUTION_REVISION}`,
    );
  });

  it('an institution revision is a short lowercase tag', () => {
    if (LIFECYCLE_INSTITUTION_REVISION === null) return;
    expect(LIFECYCLE_INSTITUTION_REVISION).toMatch(/^[a-z0-9][a-z0-9.-]{0,31}$/);
  });
});
