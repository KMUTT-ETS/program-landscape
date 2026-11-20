// Lifecycle verdict — public surface of packages/db/src/lifecycle/.
//
// A single 4-band classifier (SUNSET / STABLE / RISING / FRONTIER) combining
// every signal the Deep-Dive exposes. Rules-based so it is auditable for
// Council; the AI peer review's content-modernity verdict acts as a
// directional modifier.
//
// Adapting it for your institution: ./README.md, then ./tuning.ts.

import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { computeLifecycle } from './compute';
import { loadLifecycleInputs } from './load';
import type { ProgramLifecycleResult } from './types';

export type {
  LifecycleGateEffect,
  LifecycleInputs,
  ProgramLifecycleDriver,
  ProgramLifecycleResult,
} from './types';
export {
  LIFECYCLE_TUNING,
  LIFECYCLE_INSTITUTION_REVISION,
  type BandTable,
  type Banded,
  type Linear,
} from './tuning';
export { UPSTREAM_LIFECYCLE_VERSION, LIFECYCLE_VERSION } from './version';
export { computeRevenueScaleContribution } from './drivers';
export { LIFECYCLE_GATES, type LifecycleGate } from './gates';
export { computeLifecycle } from './compute';

export async function programLifecycleVerdict(programId: string): Promise<ProgramLifecycleResult> {
  const result = computeLifecycle(await loadLifecycleInputs(programId));

  // Write-through cache for the home dashboard + cockpit aggregations.
  // Re-running lifecycle compute for ~300 programs takes tens of seconds;
  // reading the snapshot is one indexed query. Failure is intentionally
  // swallowed — the snapshot is observability, not the source of truth.
  prisma.programLifecycleSnapshot
    .upsert({
      where: { programId },
      create: {
        programId,
        verdict: result.verdict,
        trajectoryScore: result.trajectoryScore,
        methodologyVersion: result.methodologyVersion,
        driversJson: result as unknown as Prisma.InputJsonValue,
      },
      update: {
        verdict: result.verdict,
        trajectoryScore: result.trajectoryScore,
        methodologyVersion: result.methodologyVersion,
        driversJson: result as unknown as Prisma.InputJsonValue,
        computedAt: new Date(),
      },
    })
    .catch(() => undefined);

  return result;
}
