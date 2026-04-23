// The PRISMA-backed recorder implementation lives in @kku/db (see
// packages/db/src/ai-inference-recorder.ts) because @kku/shared cannot
// import @kku/db without a cycle. This file re-exports the interface
// only; consumers import the concrete PrismaAiInferenceRecorder from
// @kku/db directly.
export type { AiInferenceRecorder } from './types';
