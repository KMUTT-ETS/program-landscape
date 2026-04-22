# AI governance

Policy for how AI is used across Curriculum Landscape. Full policy filled in
prompt 04; scaffolded here so later prompts have a landing page.

## Principles

1. AI is a force multiplier for analysts, **not a decision-maker**.
2. Every AI output shows confidence, sources, and a "show reasoning" view.
3. Every AI call is logged to `AiInference` via the `@AiCall()` decorator.
4. Prompts are versioned in `packages/shared/src/ai/prompts/` and referenced
   by version in every call.
5. Bias and quality are reviewed on a scheduled cadence (prompt 13).
6. Human-in-the-loop for every consequential recommendation (program
   closures, mergers, launches).

## Models (placeholder — decisions land in prompt 04)

- Primary reasoning: TBD (Anthropic vs OpenAI)
- Embeddings: TBD (OpenAI `text-embedding-3-*` or Voyage)
- Thai OCR fallback: vision-capable LLM when Tesseract confidence < 0.8
