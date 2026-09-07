// ─────────────────────────────────────────────────────────────────────────
// Pure planner for the AI-settings "bulk model swap" action. No I/O — takes
// the method rows already loaded by AiSettingsService.list() plus a
// (fromModelId, toModelId) pair and sorts every method into one of three
// buckets. Kept side-effect-free and dependency-free so it's trivially
// unit-testable and so the preview (apply: false) and the real apply
// (apply: true) share the exact same targeting logic — no drift between
// what the operator is shown and what actually gets written.
//
// Scope note (explicit, not a footnote): "replace every method using X"
// includes methods that reach X through the catalog default, not only
// methods with an explicit pin. Swapping away from a default therefore
// CREATES a pin where none existed — that method stops tracking the
// catalog default from then on. `create` is reported as its own group
// precisely so that consequence is visible before Apply is pressed.
// ─────────────────────────────────────────────────────────────────────────

export interface SwapCandidate {
  methodPrefix: string;
  effectiveModel: string;
  isPinned: boolean;
  lockedModel: string | null;
}

export interface SwapPlan {
  /** Existing override rows repointed at the target. */
  rewrite: SwapCandidate[];
  /** Methods inheriting the source model via the catalog default. A pin is
   *  CREATED for these, so they stop following the default from now on —
   *  surfaced as its own group because that consequence outlives the swap. */
  create: SwapCandidate[];
  /** lockedModel already trumps any override, so pinning these would write a
   *  row that changes nothing. Skipped, with the reason shown. */
  skipped: SwapCandidate[];
}

export function planModelSwap(
  rows: SwapCandidate[],
  fromModelId: string,
  toModelId: string,
): SwapPlan {
  const plan: SwapPlan = { rewrite: [], create: [], skipped: [] };
  if (fromModelId === toModelId) return plan;
  for (const row of rows) {
    if (row.effectiveModel !== fromModelId) continue;
    if (row.lockedModel) plan.skipped.push(row);
    else if (row.isPinned) plan.rewrite.push(row);
    else plan.create.push(row);
  }
  return plan;
}
