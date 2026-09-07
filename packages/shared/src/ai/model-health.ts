// packages/shared/src/ai/model-health.ts
export type ModelHealthStatus = 'ok' | 'off-catalog' | 'deprecated' | 'failing';

export interface MethodModelHealth {
  methodPrefix: string;
  effectiveModel: string;
  /** false = running on the catalog default, no override row. */
  isPinned: boolean;
  status: ModelHealthStatus;
  /** One operator-facing sentence. Names secondary problems too: the
   *  2026-08-03 incident was off-catalog AND failing, and reporting only the
   *  more severe of the two would have hidden why it broke. */
  detail: string;
}

export interface ModelHealthInput {
  overrides: { methodPrefix: string; modelId: string }[];
  /** Ids from the `ai_model_catalog` TABLE — the same source findCatalogModel()
   *  gates pins against. Deliberately NOT the static AVAILABLE_AI_MODELS array:
   *  that holds 8 curated ids, so checking against it would mark every
   *  production pin off-catalog and bury the signal that matters. */
  knownModelIds: Set<string>;
  /** id -> note. Our own opinion, hand-maintained on the static catalog. The DB
   *  catalog is OpenRouter's list and has no view on what we should retire. */
  deprecatedModels: Map<string, string | undefined>;
  methods: Array<{ methodPrefix: string; defaultModel: string }>;
  /** Model-invalid failures inside the 7-day window, already grouped. */
  recentFailures: { methodPrefix: string; modelId: string; count: number; lastAt: Date }[];
}

/**
 * Pure verdict. No prisma, no network — the decision is the product, and it
 * must be testable without either.
 *
 * Precedence: failing > deprecated > off-catalog > ok.
 */
export function assessModelHealth(input: ModelHealthInput): MethodModelHealth[] {
  const { overrides, knownModelIds, deprecatedModels, methods, recentFailures } = input;
  const pinBy = new Map(overrides.map((o) => [o.methodPrefix, o.modelId]));

  return methods.map(({ methodPrefix, defaultModel }) => {
    const pin = pinBy.get(methodPrefix);
    const effectiveModel = pin ?? defaultModel;
    const isPinned = pin !== undefined;

    // off-catalog is gated on isPinned. The `ai_model_catalog` table is a
    // rolling, narrow OpenRouter window (fetchOpenRouterGeminiModels returns
    // only 2 flash + 2 pro, newest-first) that a daily delete-and-replace
    // refresh repopulates from scratch — so a model can drop out of the table
    // for reasons that have nothing to do with whether it still works. An
    // UNPINNED method's effective model is `defaultModel`, which is not an
    // operator choice and can't be corrected on /admin/app/ai-settings, so
    // reporting it "off-catalog" would be actionable by nobody and would just
    // flip the whole method list amber every time the window rolls. A default
    // that genuinely breaks is still caught by `failing`, which comes from
    // real refused calls, not catalog absence. A PINNED model is a deliberate
    // operator choice, so absence from the catalog is worth surfacing there.
    const offCatalog = isPinned && !knownModelIds.has(effectiveModel);
    const deprecated = deprecatedModels.has(effectiveModel);
    const deprecatedNote = deprecatedModels.get(effectiveModel);
    // Failures are keyed on the model as well as the method: once an operator
    // repins, yesterday's failures against the OLD model must stop counting,
    // or a fixed method stays red until the window rolls off.
    const failure = recentFailures.find(
      (f) => f.methodPrefix === methodPrefix && f.modelId === effectiveModel,
    );

    const notes: string[] = [];
    if (offCatalog) notes.push(`"${effectiveModel}" is not in the catalog`);
    if (deprecated) {
      notes.push(
        `"${effectiveModel}" is marked deprecated${deprecatedNote ? ` — ${deprecatedNote}` : ''}`,
      );
    }
    if (failure) {
      notes.push(
        `${failure.count} model-invalid failure${failure.count === 1 ? '' : 's'} in the last 7 days` +
          ` (most recent ${failure.lastAt.toISOString()})`,
      );
    }

    const status: ModelHealthStatus = failure
      ? 'failing'
      : deprecated
        ? 'deprecated'
        : offCatalog
          ? 'off-catalog'
          : 'ok';

    // Notes may already end with their own terminator (deprecatedNote is a
    // free-text sentence from the static catalog, e.g. "Retires 2026-12-01.").
    // Strip any trailing period before joining so there is exactly one
    // separator between notes and exactly one terminator on the whole string.
    const cleaned = notes.map((n) => n.replace(/\s*\.\s*$/, ''));

    return {
      methodPrefix,
      effectiveModel,
      isPinned,
      status,
      detail:
        status === 'ok'
          ? `Running on ${effectiveModel}${isPinned ? ' (pinned)' : ' (catalog default)'}.`
          : cleaned.join('. ') + '.',
    };
  });
}
