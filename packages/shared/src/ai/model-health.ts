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

    const offCatalog = !knownModelIds.has(effectiveModel);
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

    return {
      methodPrefix,
      effectiveModel,
      isPinned,
      status,
      detail:
        status === 'ok'
          ? `Running on ${effectiveModel}${isPinned ? ' (pinned)' : ' (catalog default)'}.`
          : notes.join('. ') + '.',
    };
  });
}
