# AI Model Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when a per-method AI model pin is off-catalog, deprecated, or failing, fall back to the catalog default on model-invalid errors, and notify every `SUPER_ADMIN`.

**Architecture:** One pure resolver computes a per-method verdict from (overrides, catalog, methods, recent failures). A DB adapter feeds it and is the single function read by all three surfaces — two banners and a daily notifier job — so the surfaces cannot disagree. The Google provider records model-invalid failures into `ai_inferences.kind` (free-text, indexed, no migration) and retries once on the catalog default.

**Tech Stack:** TypeScript strict, Zod, Prisma, NestJS, BullMQ, vitest, Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-09-07-ai-model-health-notification-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/ingestion/src/lib/ai-service.ts` | **Create.** One factory that always wires the override resolver. |
| `packages/shared/src/ai/method-catalog.ts` | **Modify.** Add `deprecated?` / `deprecatedNote?` to `AiModelEntry`. |
| `packages/shared/src/ai/model-health.ts` | **Create.** Pure `assessModelHealth()`. No prisma, no network. |
| `packages/shared/src/ai/model-invalid.ts` | **Create.** Pure `isModelInvalidError()` classifier. |
| `packages/shared/src/ai/providers/factory.ts` | **Modify.** Add `wrapWithModelInvalidFallback`. |
| `packages/shared/src/ai/providers/google-ai.ts` | **Modify.** Record `ai_model_invalid` on a model-invalid throw. |
| `packages/db/src/ai-model-health.ts` | **Create.** Adapter: gather inputs → pure core. |
| `apps/ingestion/src/ai-jobs/model-health-notifier.ts` | **Create.** Daily job: raise + resolve notifications. |
| `apps/web/app/admin/app/ai-settings/page.tsx` | **Modify.** Banner. |
| `apps/web/app/admin/system-status/page.tsx` | **Modify.** Banner. |

---

## Task 1: One AI-service factory for ingestion scripts

**Why first:** 20 of 35 `createAiService` callers never pass `modelOverrideResolver`, so they silently use the catalog default while `/admin/app/ai-settings` claims otherwise. A health feature that reports the *effective* model is wrong for half the system until this lands. This is also how the August incident hid — the pipeline honours overrides and failed; `pnpm programs:extract-courses` ignores them and succeeded.

**Files:**
- Create: `apps/ingestion/src/lib/ai-service.ts`
- Modify: the 18 ingestion scripts listed in the spec
- Test: `apps/ingestion/test/ai-service-factory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ingestion/test/ai-service-factory.test.ts
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createAiService: vi.fn(() => ({} as never)) }));
vi.mock('@kku/shared', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createAiService: mocks.createAiService,
}));
vi.mock('@kku/db', () => ({
  getAiModelOverrideStore: () => ({ resolve: () => 'from-store' }),
  PrismaAiInferenceRecorder: class {},
}));

import { createIngestionAiService } from '../src/lib/ai-service';

describe('createIngestionAiService', () => {
  it('always passes a modelOverrideResolver', () => {
    createIngestionAiService();
    const cfg = mocks.createAiService.mock.calls[0][0] as { modelOverrideResolver?: unknown };
    expect(cfg.modelOverrideResolver).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter ingestion exec vitest run test/ai-service-factory.test.ts`
Expected: FAIL — cannot resolve `../src/lib/ai-service`.

- [ ] **Step 3: Implement the factory**

```ts
// apps/ingestion/src/lib/ai-service.ts
import { createAiService, type AiProviderId, type AiService } from '@kku/shared';
import { getAiModelOverrideStore, PrismaAiInferenceRecorder } from '@kku/db';

/**
 * The ONLY way an ingestion script should build an AiService.
 *
 * 20 of 35 createAiService callers used to omit modelOverrideResolver, so they
 * ran on the catalog default while /admin/app/ai-settings claimed a different
 * model was in effect. That divergence is how the 2026-08-03 gemini-3.6-flash
 * incident stayed hidden for five weeks: the pipeline honoured the override and
 * was failing, while `pnpm programs:extract-courses` ignored it and succeeded —
 * and that command is what the on-screen empty state tells operators to run.
 *
 * Making the omission impossible beats documenting that it is discouraged.
 */
export function createIngestionAiService(): AiService {
  return createAiService({
    recorder: new PrismaAiInferenceRecorder(),
    providerId: (process.env.AI_PROVIDER ?? 'google') as AiProviderId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
    modelOverrideResolver: getAiModelOverrideStore(),
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter ingestion exec vitest run test/ai-service-factory.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Switch the 18 scripts**

In each of `bulk-digest-programs.ts`, `digest-program.ts`, `extract-imd-pdf.ts`, `extract-program-courses.ts`, `extract-program-faculty.ts`, `extract-program-skills-detailed.ts`, `generate-curriculum-revision.ts`, `generate-program-ai-readiness.ts`, `generate-program-pedagogy.ts`, `ingest-employment-surveys.ts`, `map-admission-stat-programs.ts`, `map-program-careers.ts`, `match-program-demand.ts`, `normalise-skill-names.ts`, `risks-assess.ts`, `select-program-peers.ts`, `translate-evaluation-questions.ts` and `src/ingestion.service.ts`, replace the inline `createAiService({...})` block with:

```ts
import { createIngestionAiService } from '../lib/ai-service'; // '../../lib/ai-service' from src/ingestion.service.ts is NOT needed — it is `./lib/ai-service`
const ai = createIngestionAiService();
```

Delete the now-unused `createAiService` / `PrismaAiInferenceRecorder` / `AiProviderId` imports in each file. Leave `apps/web/src/lib/profile-narrative.ts` alone — whether the web app should honour overrides is a separate decision recorded in the spec.

- [ ] **Step 6: Verify nothing broke**

Run: `pnpm --filter ingestion exec tsc --noEmit && pnpm --filter ingestion exec vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/ingestion/src/lib/ai-service.ts apps/ingestion/test/ai-service-factory.test.ts apps/ingestion/src/scripts apps/ingestion/src/ingestion.service.ts
git commit -m "fix(ai): one ingestion AiService factory that always honours model overrides"
```

---

## Task 2: Catalog deprecation flag

**Files:**
- Modify: `packages/shared/src/ai/method-catalog.ts` (the `AiModelEntry` interface, ~line 330)

- [ ] **Step 1: Add the fields**

```ts
  /** True when this model should NOT be the default pick for new methods. */
  legacy?: boolean;
  /** True when the provider has announced retirement, or we have observed it
   *  stop working. Hand-maintained: no provider exposes a model-lifecycle API,
   *  and building machinery around data nobody updates is worse than a flag
   *  someone edits when they read a deprecation notice. Surfaces as a
   *  `deprecated` verdict in assessModelHealth(). */
  deprecated?: boolean;
  /** Operator-facing sentence shown beside the warning, e.g. "Retired by
   *  Google on 2026-11-01; use gemini-3.5-flash." */
  deprecatedNote?: string;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kku/shared exec tsc --noEmit`
Expected: clean — both fields are optional, so no existing entry changes.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/ai/method-catalog.ts
git commit -m "feat(ai): add deprecated flag to the model catalog"
```

---

## Task 3: Pure verdict resolver

**Files:**
- Create: `packages/shared/src/ai/model-health.ts`
- Test: `packages/shared/test/model-health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/model-health.test.ts
import { describe, it, expect } from 'vitest';
import { assessModelHealth } from '../src/ai/model-health';

// knownModelIds mirrors the ai_model_catalog TABLE (OpenRouter-refreshed) —
// the same source findCatalogModel() gates pins against. NOT the static
// AVAILABLE_AI_MODELS array, which would mark every production pin off-catalog.
const knownModelIds = new Set(['gemini-3.5-flash', 'gemini-2.5-pro']);
// Deprecation is our own opinion, from the static catalog. OpenRouter has no
// view on what we should stop using.
const deprecatedModels = new Map<string, string | undefined>([
  ['gemini-2.5-pro', 'Retires 2026-12-01.'],
]);

const methods = [
  { methodPrefix: 'program-courses-extract', defaultModel: 'gemini-3.5-flash' },
  { methodPrefix: 'program-digest', defaultModel: 'gemini-3.5-flash' },
];

const base = { knownModelIds, deprecatedModels, methods, recentFailures: [] };

describe('assessModelHealth', () => {
  it('reports ok for an unpinned method on its catalog default', () => {
    const [v] = assessModelHealth({ ...base, overrides: [], methods: [methods[0]] });
    expect(v).toMatchObject({ status: 'ok', effectiveModel: 'gemini-3.5-flash', isPinned: false });
  });

  it('reports off-catalog for a pin that is not in the catalog', () => {
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash' }],
    });
    expect(v.status).toBe('off-catalog');
    expect(v.effectiveModel).toBe('gemini-3.6-flash');
    expect(v.isPinned).toBe(true);
    expect(v.detail).toContain('gemini-3.6-flash');
  });

  it('reports deprecated for a pin flagged in the catalog, and quotes the note', () => {
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-2.5-pro' }],
    });
    expect(v.status).toBe('deprecated');
    expect(v.detail).toContain('Retires 2026-12-01.');
  });

  it('reports failing on a single model-invalid failure in the window', () => {
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash' }],
      recentFailures: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash',
                         count: 1, lastAt: new Date('2026-09-07T08:11:00Z') }],
    });
    expect(v.status).toBe('failing');
  });

  it('ranks failing above off-catalog but still names both — the August incident', () => {
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash' }],
      recentFailures: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash',
                         count: 4, lastAt: new Date('2026-09-07T08:11:00Z') }],
    });
    expect(v.status).toBe('failing');
    expect(v.detail).toContain('not in the catalog');
  });

  it('ignores failures recorded against a model that is no longer pinned', () => {
    // Operator already fixed the pin; yesterday's failures must not keep it red.
    const [v] = assessModelHealth({
      ...base,
      methods: [methods[0]],
      overrides: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.5-flash' }],
      recentFailures: [{ methodPrefix: 'program-courses-extract', modelId: 'gemini-3.6-flash',
                         count: 9, lastAt: new Date('2026-09-07T08:11:00Z') }],
    });
    expect(v.status).toBe('ok');
  });

  it('returns one verdict per method, in catalog order', () => {
    const out = assessModelHealth({ ...base, overrides: [] });
    expect(out.map((v) => v.methodPrefix)).toEqual(['program-courses-extract', 'program-digest']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @kku/shared exec vitest run test/model-health.test.ts`
Expected: FAIL — cannot resolve `../src/ai/model-health`.

- [ ] **Step 3: Implement**

```ts
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
        `"${effectiveModel}" is marked deprecated${
          deprecatedNote ? ` — ${deprecatedNote}` : ''
        }`,
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter @kku/shared exec vitest run test/model-health.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Export it from the package barrel**

Add to `packages/shared/src/index.ts` alongside the other `ai/` exports:

```ts
export * from './ai/model-health';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ai/model-health.ts packages/shared/test/model-health.test.ts packages/shared/src/index.ts
git commit -m "feat(ai): pure model-health verdict resolver"
```

---

## Task 4: Model-invalid error classifier

**Files:**
- Create: `packages/shared/src/ai/model-invalid.ts`
- Test: `packages/shared/test/model-invalid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/model-invalid.test.ts
import { describe, it, expect } from 'vitest';
import { isModelInvalidError } from '../src/ai/model-invalid';

describe('isModelInvalidError', () => {
  it('classifies the real production 400', () => {
    // Verbatim from prod, KKU-SEQ-0002, 2026-09-07.
    const err = new Error(
      '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
    );
    expect(isModelInvalidError(err)).toBe(true);
  });

  it('classifies a 404 model-not-found', () => {
    const err = new Error(
      '{"error":{"code":404,"message":"models/gemini-9.9-flash is not found for API version v1beta","status":"NOT_FOUND"}}',
    );
    expect(isModelInvalidError(err)).toBe(true);
  });

  it('does NOT classify a 429 — that is the transient wrapper\'s job', () => {
    const err = new Error('{"error":{"code":429,"message":"Resource exhausted","status":"RESOURCE_EXHAUSTED"}}');
    expect(isModelInvalidError(err)).toBe(false);
  });

  it('does NOT classify a 500', () => {
    const err = new Error('{"error":{"code":500,"message":"Internal error","status":"INTERNAL"}}');
    expect(isModelInvalidError(err)).toBe(false);
  });

  it('does NOT classify a schema-validation failure — the response arrived', () => {
    const err = new Error('AiService extractStructured: response failed schema validation (issues=[])');
    expect(isModelInvalidError(err)).toBe(false);
  });

  it('is safe on non-Error input', () => {
    expect(isModelInvalidError(undefined)).toBe(false);
    expect(isModelInvalidError('boom')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @kku/shared exec vitest run test/model-invalid.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/ai/model-invalid.ts
/**
 * "The model itself is wrong" — as distinct from "the call failed".
 *
 * Kept deliberately narrow. wrapWithTransientFallback already owns 429/5xx and
 * timeouts; if this predicate widened to those, a capacity problem would be
 * absorbed as a model substitution and the /ready breaker would never see it.
 *
 * Matched on message text because the Google SDK surfaces the provider's JSON
 * error body in the thrown Error's message rather than as structured fields.
 */
const MODEL_INVALID_MARKERS = [
  /"code"\s*:\s*400[\s\S]*"status"\s*:\s*"INVALID_ARGUMENT"/,
  /"code"\s*:\s*404[\s\S]*"status"\s*:\s*"NOT_FOUND"/,
  /is not found for API version/i,
];

export function isModelInvalidError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  if (!message) return false;
  return MODEL_INVALID_MARKERS.some((re) => re.test(message));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter @kku/shared exec vitest run test/model-invalid.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Export and commit**

Add `export * from './ai/model-invalid';` to `packages/shared/src/index.ts`.

```bash
git add packages/shared/src/ai/model-invalid.ts packages/shared/test/model-invalid.test.ts packages/shared/src/index.ts
git commit -m "feat(ai): classifier for model-invalid provider errors"
```

---

## Task 5: Record model-invalid failures, and fall back

**Files:**
- Modify: `packages/shared/src/ai/providers/google-ai.ts` (the `extractStructured` / completion call sites, around lines 151, 261, 407, 528)
- Modify: `packages/shared/src/ai/providers/factory.ts:78,108`
- Test: `packages/shared/test/model-invalid-fallback.test.ts`

**Read first:** `pickModelForMethod` at `google-ai.ts:97`. Its precedence is `lockedModel` > admin override > static table > provider default. The fallback target for a failing method is the **catalog default**, i.e. what `pickModelForMethod` would return with the override resolver removed — not `DEFAULT_COMPLETION_MODEL` directly, because a `lockedModel` entry must still win.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/model-invalid-fallback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { wrapWithModelInvalidFallback } from '../src/ai/providers/factory';
import type { AiService } from '../src/ai/types';

function svc(overrides: Partial<AiService>): AiService {
  return { complete: vi.fn(), extractStructured: vi.fn(), embed: vi.fn(), ...overrides } as unknown as AiService;
}

const MODEL_INVALID = new Error(
  '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
);

describe('wrapWithModelInvalidFallback', () => {
  it('retries once on the catalog default and returns the retry result', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(MODEL_INVALID)
      .mockResolvedValueOnce({ parsed: { ok: true }, confidence: 0.9 });
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    const out = await wrapped.extractStructured({ methodVersion: 'program-courses-extract.v4' } as never);
    expect(out).toMatchObject({ parsed: { ok: true } });
    expect(extract).toHaveBeenCalledTimes(2);
    // The retry must explicitly pin the fallback model, not repeat the request.
    expect((extract.mock.calls[1][0] as { model?: string }).model).toBeDefined();
  });

  it('does not retry a transient error — that path is already owned', async () => {
    const transient = new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
    const extract = vi.fn().mockRejectedValue(transient);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(
      wrapped.extractStructured({ methodVersion: 'program-digest.v1' } as never),
    ).rejects.toThrow('429');
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('rethrows when the retry also fails, rather than looping', async () => {
    const extract = vi.fn().mockRejectedValue(MODEL_INVALID);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(
      wrapped.extractStructured({ methodVersion: 'program-digest.v1' } as never),
    ).rejects.toThrow('INVALID_ARGUMENT');
    expect(extract).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @kku/shared exec vitest run test/model-invalid-fallback.test.ts`
Expected: FAIL — `wrapWithModelInvalidFallback` is not exported.

- [ ] **Step 3: Implement the wrapper in `factory.ts`**

```ts
import { isModelInvalidError } from '../model-invalid';
import { findAiMethodEntry } from '../method-catalog';

/**
 * Retry once on the method's catalog default when the provider rejects the
 * MODEL rather than the request.
 *
 * Separate from wrapWithTransientFallback on purpose: that one swaps PROVIDER
 * on 429/5xx. This one swaps MODEL on a deterministic "this model is wrong".
 * Merging them would let a capacity problem masquerade as a model problem.
 */
export function wrapWithModelInvalidFallback(primary: AiService): AiService {
  const retryOnce = async <T>(
    methodVersion: string | undefined,
    call: (modelOverride?: string) => Promise<T>,
  ): Promise<T> => {
    try {
      return await call();
    } catch (err) {
      if (!isModelInvalidError(err)) throw err;
      const prefix = (methodVersion ?? '').replace(/\.v\d+(?:\.\d+)*$/, '');
      const fallback = findAiMethodEntry(prefix)?.defaultModel;
      if (!fallback) throw err;
      // Second failure rethrows — no loop, no third model.
      return await call(fallback);
    }
  };

  return {
    ...primary,
    extractStructured: (req) =>
      retryOnce(req.methodVersion, (model) =>
        primary.extractStructured(model ? { ...req, model } : req),
      ),
    complete: (req) =>
      retryOnce(req.methodVersion, (model) =>
        primary.complete(model ? { ...req, model } : req),
      ),
  } as AiService;
}
```

Then wrap at both existing sites:

```ts
// factory.ts:78
return wrapWithModelInvalidFallback(wrapWithTransientFallback(google, secondary));
// factory.ts:108
return wrapWithModelInvalidFallback(wrapWithTransientFallback(withEmbeddings, googleSecondary));
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter @kku/shared exec vitest run test/model-invalid-fallback.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Record the failure in `google-ai.ts`**

At each `generateContent` call site (151, 261, 407, 528), wrap the call so a model-invalid throw records before rethrowing. `ai_inferences.kind` is free-text and indexed, so no migration is needed:

```ts
try {
  const result = await this.client.models.generateContent({ /* unchanged */ });
  // …unchanged…
} catch (err) {
  if (isModelInvalidError(err)) {
    // Without this row recentFailures has no input at all: a 400 fails the
    // HTTP call outright and produces no AiInference today.
    await this.recorder.record({
      module: 'ai-health',
      kind: 'ai_model_invalid',
      model,                      // the model that was REFUSED
      promptVersion: methodVersion,   // InferenceRecord.promptVersion is string | undefined — never null
      prompt: '(model-invalid — prompt omitted)',
      response: err instanceof Error ? err.message.slice(0, 2000) : String(err),
      confidence: 0,
    }).catch(() => undefined);    // recording must never mask the real error
  }
  throw err;
}
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @kku/shared exec tsc --noEmit && pnpm --filter @kku/shared exec vitest run`
Expected: clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ai/providers/factory.ts packages/shared/src/ai/providers/google-ai.ts packages/shared/test/model-invalid-fallback.test.ts
git commit -m "feat(ai): record model-invalid failures and retry once on the catalog default"
```

---

## Task 6: DB adapter

**Files:**
- Create: `packages/db/src/ai-model-health.ts`
- Modify: `packages/db/src/index.ts` (export it)

- [ ] **Step 1: Implement**

```ts
// packages/db/src/ai-model-health.ts
import { assessModelHealth, AVAILABLE_AI_MODELS, AI_METHOD_CATALOG,
         type MethodModelHealth } from '@kku/shared';
import { prisma } from './index';

const WINDOW_DAYS = 7;

/**
 * The ONE function every model-health surface reads — both banners and the
 * notifier. Three surfaces computing this independently is how they drift.
 *
 * Fail-open: if the failure-stats query fails we still return catalog-derived
 * verdicts. A monitoring feature must never be the reason a page is down.
 */
export async function aiModelHealth(): Promise<MethodModelHealth[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [overrides, catalogRows, failureRows] = await Promise.all([
    prisma.aiModelOverride.findMany({ select: { methodPrefix: true, modelId: true } }),
    // The ai_model_catalog TABLE, not AVAILABLE_AI_MODELS — this is what
    // findCatalogModel() gates pins against, so it is what "known" must mean.
    prisma.aiModelCatalog.findMany({ select: { id: true } }),
    prisma.aiInference
      .groupBy({
        by: ['model', 'promptVersion'],
        where: { kind: 'ai_model_invalid', createdAt: { gte: since } },
        _count: { _all: true },
        _max: { createdAt: true },
      })
      .catch(() => []),
  ]);

  const recentFailures = failureRows.flatMap((r) =>
    r.promptVersion
      ? [{
          methodPrefix: r.promptVersion.replace(/\.v\d+(?:\.\d+)*$/, ''),
          modelId: r.model,
          count: r._count._all,
          lastAt: r._max.createdAt ?? since,
        }]
      : [],
  );

  return assessModelHealth({
    overrides,
    knownModelIds: new Set(catalogRows.map((r) => r.id)),
    deprecatedModels: new Map(
      AVAILABLE_AI_MODELS.filter((m) => m.deprecated).map((m) => [m.id, m.deprecatedNote]),
    ),
    methods: AI_METHOD_CATALOG.map((m) => ({
      methodPrefix: m.methodPrefix,
      defaultModel: m.defaultModel,
    })),
    recentFailures,
  });
}
```

- [ ] **Step 2: Export it**

Add `export * from './ai-model-health';` to `packages/db/src/index.ts`.

- [ ] **Step 3: Verify against the live dev database**

Run: `pnpm tsx -e "import('@kku/db').then(async m => console.table(await m.aiModelHealth()))"`
Expected: one row per method, all `status: 'ok'` on dev (dev has zero overrides). If prod data were loaded, `program-courses-extract` would read `off-catalog`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/ai-model-health.ts packages/db/src/index.ts
git commit -m "feat(ai): model-health DB adapter"
```

---

## Task 7: Daily notifier

**Files:**
- Create: `apps/ingestion/src/ai-jobs/model-health-notifier.ts`
- Test: `apps/ingestion/test/model-health-notifier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ingestion/test/model-health-notifier.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  aiModelHealth: vi.fn(),
  userFindMany: vi.fn(),
  notifFindFirst: vi.fn(),
  notifCreate: vi.fn(),
  notifUpdateMany: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  aiModelHealth: mocks.aiModelHealth,
  prisma: {
    user: { findMany: mocks.userFindMany },
    notification: {
      findFirst: mocks.notifFindFirst,
      create: mocks.notifCreate,
      updateMany: mocks.notifUpdateMany,
    },
  },
}));

import { runModelHealthNotifier } from '../src/ai-jobs/model-health-notifier';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
  mocks.notifFindFirst.mockResolvedValue(null);
});

describe('runModelHealthNotifier', () => {
  it('raises one notification per SUPER_ADMIN for a failing method', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-courses-extract', effectiveModel: 'gemini-3.6-flash',
        isPinned: true, status: 'failing', detail: 'x' },
    ]);
    await runModelHealthNotifier();
    expect(mocks.notifCreate).toHaveBeenCalledTimes(2);
    const data = mocks.notifCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      kind: 'ai_model_health',
      severity: 'high',
      entityType: 'ai_model_override',
      entityId: 'program-courses-extract:gemini-3.6-flash',
    });
  });

  it('does not duplicate while an unread notification for the same pin exists', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'bad-model',
        isPinned: true, status: 'off-catalog', detail: 'x' },
    ]);
    mocks.notifFindFirst.mockResolvedValue({ id: 'n1' });
    await runModelHealthNotifier();
    expect(mocks.notifCreate).not.toHaveBeenCalled();
  });

  it('marks outstanding notifications read once a method returns to ok', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'gemini-3.5-flash',
        isPinned: false, status: 'ok', detail: 'x' },
    ]);
    await runModelHealthNotifier();
    expect(mocks.notifUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: 'ai_model_health', readAt: null }),
      }),
    );
    expect(mocks.notifCreate).not.toHaveBeenCalled();
  });

  it('uses medium severity for deprecated and off-catalog', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'old', isPinned: true,
        status: 'deprecated', detail: 'x' },
    ]);
    await runModelHealthNotifier();
    expect(mocks.notifCreate.mock.calls[0][0].data.severity).toBe('medium');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter ingestion exec vitest run test/model-health-notifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/ingestion/src/ai-jobs/model-health-notifier.ts
import { aiModelHealth, prisma } from '@kku/db';

/**
 * Daily at 04:00 Asia/Bangkok — after the 02:00 backup and 03:00 backup
 * verification timers, so the three operational jobs do not overlap.
 *
 * entityId carries the MODEL as well as the method, so re-running while a pin
 * is still broken suppresses a duplicate, while repinning to a different bad
 * model raises a fresh alert. Methods that return to ok have their outstanding
 * notifications marked read: an inbox full of alarms for things already fixed
 * teaches people to ignore the bell.
 */
export async function runModelHealthNotifier(): Promise<void> {
  const verdicts = await aiModelHealth();
  const admins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true },
  });

  for (const v of verdicts) {
    if (v.status === 'ok') {
      await prisma.notification.updateMany({
        where: {
          kind: 'ai_model_health',
          entityType: 'ai_model_override',
          entityId: { startsWith: `${v.methodPrefix}:` },
          readAt: null,
        },
        data: { readAt: new Date() },
      });
      continue;
    }

    const entityId = `${v.methodPrefix}:${v.effectiveModel}`;
    const existing = await prisma.notification.findFirst({
      where: { kind: 'ai_model_health', entityType: 'ai_model_override', entityId, readAt: null },
      select: { id: true },
    });
    if (existing) continue;

    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          kind: 'ai_model_health',
          severity: v.status === 'failing' ? 'high' : 'medium',
          title: `AI model problem: ${v.methodPrefix}`,
          bodyEn: v.detail,
          entityType: 'ai_model_override',
          entityId,
        },
      });
    }
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter ingestion exec vitest run test/model-health-notifier.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Schedule it on the existing `ai-jobs` queue**

In the ai-jobs worker registration, add the repeatable job and route it:

```ts
import { runModelHealthNotifier } from './model-health-notifier';

// 04:00 Asia/Bangkok — after the 02:00 backup and 03:00 backup-verification
// timers, so the three operational jobs never overlap.
await aiJobsQueue.add(
  'model-health-notify',
  {},
  {
    repeat: { pattern: '0 4 * * *', tz: 'Asia/Bangkok' },
    jobId: 'model-health-notify',   // stable id: re-registering replaces, never duplicates
    removeOnComplete: 20,
    removeOnFail: 50,
  },
);
```

and in the worker's job handler switch:

```ts
if (job.name === 'model-health-notify') {
  await runModelHealthNotifier();
  return;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/ai-jobs/model-health-notifier.ts apps/ingestion/test/model-health-notifier.test.ts
git commit -m "feat(ai): daily model-health notifier for SUPER_ADMINs"
```

---

## Task 8: Banners

**Files:**
- Modify: `apps/web/app/admin/app/ai-settings/page.tsx`
- Modify: `apps/web/app/admin/system-status/page.tsx`

- [ ] **Step 1: Add the banner to ai-settings**

Server-side, before rendering the picker list:

```tsx
import { aiModelHealth } from '@kku/db';

const health = await aiModelHealth().catch(() => []);
const problems = health.filter((h) => h.status !== 'ok');
```

```tsx
{problems.length > 0 && (
  <Card className="border-danger-default bg-danger-subtle">
    <h3 className="text-sm font-semibold text-text-primary">
      {problems.length} method{problems.length === 1 ? '' : 's'} need attention
    </h3>
    <ul className="mt-2 space-y-1">
      {problems.map((p) => (
        <li key={p.methodPrefix} className="text-sm text-text-secondary">
          <span className="font-medium text-text-primary">{p.methodPrefix}</span>
          {' — '}{p.detail}
        </li>
      ))}
    </ul>
  </Card>
)}
```

Use design tokens only — no hardcoded colours (`packages/design`; ESLint fails the build on literal hex).

- [ ] **Step 2: Add the banner to system-status**

Rendered alongside the existing dependency probes, so a model problem reads as an operational fault rather than news. Extract the markup from Step 1 into `apps/web/components/admin/model-health-banner.tsx` so the two pages cannot drift — the whole point of this design is one verdict, and two hand-copied banners would reintroduce exactly the divergence the resolver exists to prevent:

```tsx
// apps/web/components/admin/model-health-banner.tsx
import type { MethodModelHealth } from '@kku/shared';
import { Card } from '@kku/ui';

export function ModelHealthBanner({ health }: { health: MethodModelHealth[] }) {
  const problems = health.filter((h) => h.status !== 'ok');
  if (problems.length === 0) return null;
  return (
    <Card className="border-danger-default bg-danger-subtle">
      <h3 className="text-sm font-semibold text-text-primary">
        {problems.length} method{problems.length === 1 ? '' : 's'} need attention
      </h3>
      <ul className="mt-2 space-y-1">
        {problems.map((p) => (
          <li key={p.methodPrefix} className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{p.methodPrefix}</span>
            {' — '}{p.detail}
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

Both pages then render `<ModelHealthBanner health={await aiModelHealth().catch(() => [])} />`. Replace the inline block from Step 1 with this component too.

- [ ] **Step 3: Verify in the browser**

Run: `pnpm dev`, open `http://localhost:3000/admin/app/ai-settings`.
Expected on dev: no banner (dev has zero overrides, so every method is `ok`). To see it, insert a bad override, reload, then delete it:

```bash
docker exec program-landscape-postgres psql -U kku -d program_landscape -c \
  "INSERT INTO ai_model_overrides (id, method_prefix, model_id, updated_at)
   VALUES ('tmp-banner', 'program-digest', 'gemini-9.9-flash', NOW());"
# reload the page — expect an off-catalog warning naming program-digest
docker exec program-landscape-postgres psql -U kku -d program_landscape -c \
  "DELETE FROM ai_model_overrides WHERE id='tmp-banner';"
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/admin/app/ai-settings/page.tsx apps/web/app/admin/system-status/page.tsx
git commit -m "feat(ai): model-health banners on ai-settings and system-status"
```

---

## Final verification

- [ ] `pnpm --filter @kku/shared exec vitest run` — all pass
- [ ] `pnpm --filter ingestion exec vitest run` — all pass
- [ ] `pnpm typecheck` — clean
- [ ] Manual: insert `gemini-3.6-flash` as an override for `program-courses-extract` on dev, run `pnpm programs:extract-courses KKU-SEQ-0002`, and confirm (a) it now honours the override, (b) the call falls back to `gemini-3.5-flash` and succeeds, (c) an `ai_model_invalid` row exists, (d) the banner appears. Then delete the override.

---

## Task 9: Bulk model swap on the AI-settings page

**Why:** Fixing the August incident meant repointing 23 pinned methods one at a time through a per-row picker. The swap turns that into one decision.

**Scope decision (approved 2026-09-07):** "every method *using* X" includes methods that reach X through the catalog default, not only explicit pins. Swapping away from a default therefore **creates** pins where none existed, and those methods stop tracking the catalog default from then on. The preview must show that group separately — it is the part with lasting consequence.

**Files:**
- Modify: `apps/api/src/admin/ai-settings.controller.ts`
- Modify: `apps/api/src/admin/ai-settings.service.ts`
- Modify: `apps/web/app/admin/app/ai-settings/client.tsx`
- Test: `apps/api/test/ai-settings-swap.test.ts`

- [ ] **Step 1: Write the failing test for the swap planner**

The planner is pure — which methods would change, and how — so it is testable without prisma.

```ts
// apps/api/test/ai-settings-swap.test.ts
import { describe, it, expect } from 'vitest';
import { planModelSwap } from '../src/admin/ai-settings-swap';

const rows = [
  { methodPrefix: 'a', effectiveModel: 'old', isPinned: true,  lockedModel: null },
  { methodPrefix: 'b', effectiveModel: 'old', isPinned: false, lockedModel: null },
  { methodPrefix: 'c', effectiveModel: 'other', isPinned: true, lockedModel: null },
  { methodPrefix: 'd', effectiveModel: 'old', isPinned: true,  lockedModel: 'old' },
];

describe('planModelSwap', () => {
  it('rewrites existing pins on the source model', () => {
    const plan = planModelSwap(rows, 'old', 'new');
    expect(plan.rewrite.map((r) => r.methodPrefix)).toEqual(['a']);
  });

  it('reports methods inheriting the source model separately — these gain a NEW pin', () => {
    const plan = planModelSwap(rows, 'old', 'new');
    expect(plan.create.map((r) => r.methodPrefix)).toEqual(['b']);
  });

  it('skips locked methods and says why', () => {
    const plan = planModelSwap(rows, 'old', 'new');
    expect(plan.skipped.map((r) => r.methodPrefix)).toEqual(['d']);
  });

  it('ignores methods on a different model', () => {
    const plan = planModelSwap(rows, 'old', 'new');
    const touched = [...plan.rewrite, ...plan.create].map((r) => r.methodPrefix);
    expect(touched).not.toContain('c');
  });

  it('is a no-op when source and target are the same', () => {
    const plan = planModelSwap(rows, 'old', 'old');
    expect(plan.rewrite).toHaveLength(0);
    expect(plan.create).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `pnpm --filter api exec vitest run test/ai-settings-swap.test.ts`
Expected: module `../src/admin/ai-settings-swap` not found.

- [ ] **Step 3: Implement the planner**

```ts
// apps/api/src/admin/ai-settings-swap.ts
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
  const empty: SwapPlan = { rewrite: [], create: [], skipped: [] };
  if (fromModelId === toModelId) return empty;

  return rows.reduce<SwapPlan>((plan, row) => {
    if (row.effectiveModel !== fromModelId) return plan;
    if (row.lockedModel) plan.skipped.push(row);
    else if (row.isPinned) plan.rewrite.push(row);
    else plan.create.push(row);
    return plan;
  }, empty);
}
```

- [ ] **Step 4: Run the tests, confirm they PASS** (5 tests)

- [ ] **Step 5: Add the service method**

In `apps/api/src/admin/ai-settings.service.ts`, alongside `setOverride`:

```ts
async swapModel(fromModelId: string, toModelId: string, userId: string, apply: boolean) {
  // Same validation the single-method PUT already applies. The target must be a
  // real catalog entry; note this is the ai_model_catalog TABLE, and a model
  // present there can still be unusable on the provider we call — which is how
  // gemini-3.6-flash passed this check in August. Runtime health covers that.
  const model = await findCatalogModel(toModelId);
  if (!model) throw new BadRequestException(`Unknown model id: ${toModelId}`);

  const { methods } = await this.list();
  const plan = planModelSwap(
    methods.map((m) => ({
      methodPrefix: m.methodPrefix,
      effectiveModel: m.effectiveModel,
      isPinned: m.isPinned,
      lockedModel: m.lockedModel ?? null,
    })),
    fromModelId,
    toModelId,
  );
  if (!apply) return { plan, applied: false };

  const targets = [...plan.rewrite, ...plan.create];
  // One transaction: a half-applied swap across 23 methods is a worse state
  // than not having swapped at all.
  await prisma.$transaction(
    targets.map((t) =>
      prisma.aiModelOverride.upsert({
        where: { methodPrefix: t.methodPrefix },
        create: { methodPrefix: t.methodPrefix, modelId: toModelId, setByUserId: userId },
        update: { modelId: toModelId, setByUserId: userId },
      }),
    ),
  );
  await getAiModelOverrideStore().invalidate();
  return { plan, applied: true, changed: targets.length };
}
```

Adjust the property names in the `methods.map` to whatever `list()` actually returns — read `MethodSettingRow` first and use its real field names.

- [ ] **Step 6: Add the endpoint**

```ts
const SwapSchema = z.object({
  fromModelId: z.string().min(1),
  toModelId: z.string().min(1),
  apply: z.boolean().default(false),
});

@Post('/swap')
@Authorized('ai_models:configure')
@AuditLog({ action: 'ai_model_override.swap', entityType: 'AiModelOverride' })
async swap(
  @AuthSession() user: SessionUser,
  @Body(new ZodValidationPipe(SwapSchema)) body: z.infer<typeof SwapSchema>,
) {
  return this.service.swapModel(body.fromModelId, body.toModelId, user.userId, body.apply);
}
```

One endpoint, one audit row naming both models and every affected method — a client-side loop of 23 PUTs would write 23 rows and could half-fail.

- [ ] **Step 7: Add the UI**

In `client.tsx`, above the module cards: two `<select>`s populated from the same model list the per-row picker uses, a **Preview** button calling `/swap` with `apply: false`, and an **Apply** button — disabled until a preview has been fetched — calling it with `apply: true`. Render the three groups with counts, and give `create` its own heading such as "will gain a new pin (currently following the catalog default)". Design tokens only; ESLint fails the build on literal hex.

- [ ] **Step 8: Verify end to end on dev**

```bash
docker exec program-landscape-postgres psql -U kku -d program_landscape -c \
  "INSERT INTO ai_model_overrides (id, method_prefix, model_id, updated_at)
   VALUES ('tmp-swap-a','program-digest','gemini-3.5-flash',NOW()),
          ('tmp-swap-b','program-faculty','gemini-3.5-flash',NOW());"
# Preview a swap in the UI; expect 2 rewrites plus every unpinned method
# defaulting to gemini-3.5-flash listed under "will gain a new pin".
docker exec program-landscape-postgres psql -U kku -d program_landscape -c \
  "DELETE FROM ai_model_overrides WHERE id IN ('tmp-swap-a','tmp-swap-b');"
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/admin/ai-settings-swap.ts apps/api/src/admin/ai-settings.service.ts apps/api/src/admin/ai-settings.controller.ts apps/api/test/ai-settings-swap.test.ts apps/web/app/admin/app/ai-settings/client.tsx
git commit -m "feat(ai-settings): bulk model swap with preview"
```
