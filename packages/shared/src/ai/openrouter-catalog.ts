import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// OpenRouter model-catalog fetcher — DISCOVERY ONLY.
//
// Fetches the public OpenRouter model list to discover the latest Google
// Gemini models plus their description + pricing. OpenRouter is NOT an AI
// route: every AI call still goes through the Google provider directly.
// The model id we use for calls is the OpenRouter id minus the 'google/'
// prefix — which is exactly the Google GenAI API model id.
//
// No API key required — https://openrouter.ai/api/v1/models is public.
// ─────────────────────────────────────────────────────────────────────────

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=all';

const FETCH_TIMEOUT_MS = 12_000;
const DESCRIPTION_MAX = 600;

// Special-purpose Gemini variants that are not general text-completion
// models — excluded from the flash/pro pick.
const EXCLUDE_TOKENS = ['lite', 'image', 'tts', 'audio', 'embedding', 'customtools'];

const OpenRouterModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    created: z.number().optional(),
    context_length: z.number().nullable().optional(),
    pricing: z
      .object({
        prompt: z.string().optional(),
        completion: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const OpenRouterModelsResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
});

export interface DiscoveredAiModel {
  /** Google GenAI API model id — OpenRouter id minus the 'google/' prefix. */
  id: string;
  /** Full OpenRouter id, e.g. 'google/gemini-3.5-flash'. */
  openrouterId: string;
  label: string;
  tier: 'flash' | 'pro';
  description: string;
  /** USD per 1M input tokens. */
  costInputPer1m: number;
  /** USD per 1M output tokens. */
  costOutputPer1m: number;
  /** OpenRouter `created` timestamp — drives the "2 latest" ordering. */
  sourceCreatedAt: Date;
  contextLength: number | null;
}

export interface FetchOpenRouterOptions {
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Models to keep per tier (latest-first). Default 2. */
  perTier?: number;
}

function classifyTier(bareId: string): 'flash' | 'pro' | null {
  if (bareId.includes('pro')) return 'pro';
  if (bareId.includes('flash')) return 'flash';
  return null;
}

function priceToPer1m(perToken: string | undefined): number {
  const n = Number(perToken ?? '0');
  return Number.isFinite(n) ? n * 1_000_000 : 0;
}

function cleanLabel(name: string | undefined, fallbackId: string): string {
  if (!name) return fallbackId;
  // OpenRouter names look like "Google: Gemini 3.5 Flash".
  return name.replace(/^Google:\s*/i, '').trim() || fallbackId;
}

/**
 * Fetch the OpenRouter model list and return the N latest general-purpose
 * Google Gemini flash + pro models (default 2 each, latest-first). Throws
 * on network / parse failure so the caller can keep the last-known-good
 * catalog rather than wiping it.
 */
export async function fetchOpenRouterGeminiModels(
  opts: FetchOpenRouterOptions = {},
): Promise<DiscoveredAiModel[]> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const perTier = opts.perTier ?? 2;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let json: unknown;
  try {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`OpenRouter models API returned HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const parsed = OpenRouterModelsResponseSchema.parse(json);

  const candidates: DiscoveredAiModel[] = [];
  for (const m of parsed.data) {
    if (!m.id.startsWith('google/gemini')) continue;
    const bareId = m.id.slice('google/'.length);
    if (EXCLUDE_TOKENS.some((t) => bareId.includes(t))) continue;
    const tier = classifyTier(bareId);
    if (!tier) continue;
    if (typeof m.created !== 'number') continue;
    candidates.push({
      id: bareId,
      openrouterId: m.id,
      label: cleanLabel(m.name, bareId),
      tier,
      description: (m.description ?? '').slice(0, DESCRIPTION_MAX).trim(),
      costInputPer1m: priceToPer1m(m.pricing.prompt),
      costOutputPer1m: priceToPer1m(m.pricing.completion),
      sourceCreatedAt: new Date(m.created * 1000),
      contextLength: m.context_length ?? null,
    });
  }

  const pick = (tier: 'flash' | 'pro'): DiscoveredAiModel[] =>
    candidates
      .filter((c) => c.tier === tier)
      .sort((a, b) => b.sourceCreatedAt.getTime() - a.sourceCreatedAt.getTime())
      .slice(0, perTier);

  return [...pick('flash'), ...pick('pro')];
}
