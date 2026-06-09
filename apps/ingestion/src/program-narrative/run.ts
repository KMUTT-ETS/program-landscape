// The strategic-narrative generator now lives in @kku/db so that BOTH the
// per-program pipeline (here) and the deep-dive "Regenerate" button (apps/api)
// run the IDENTICAL program-strategic-narrative prompt. Re-exported for
// backwards compatibility with existing pipeline imports.
export {
  generateProgramStrategicNarrative,
  type RunStrategicNarrativeParams,
  type StrategicNarrativeOutcome,
} from '@kku/db';
