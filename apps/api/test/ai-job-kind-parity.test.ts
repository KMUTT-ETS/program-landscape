import { describe, expect, it } from 'vitest';

// AiJobKind is a plain TypeScript union, hand-declared TWICE — once in
// apps/ingestion/src/ai-jobs/queue.ts (the worker, which needs every kind to
// route a handler) and once in apps/api/src/ai-jobs/ai-jobs-queue.service.ts
// (the producer, which needs every kind to type `enqueue()`). They have
// drifted apart before: NOTIFY_MODEL_HEALTH existed on the ingestion side
// for some time with no matching entry here — see CLAUDE.md's "AiJobKind is
// declared in two hand-maintained places" note. A TS union has no runtime
// footprint to compare directly, so each file also exports a small
// `Record<AiJobKind, true>` const (AI_JOB_KINDS) that the type-checker keeps
// honest against ITS OWN union (a missing or extra key is a TS error where
// it's declared) — what this test catches is the two consts disagreeing
// WITH EACH OTHER, which the type-checker has no way to see since it checks
// each file against its own type, never against the other file's.
import { AI_JOB_KINDS as API_AI_JOB_KINDS } from '../src/ai-jobs/ai-jobs-queue.service';
import { AI_JOB_KINDS as INGESTION_AI_JOB_KINDS } from '../../ingestion/src/ai-jobs/queue';

describe('AiJobKind parity between apps/api and apps/ingestion', () => {
  it('declares exactly the same set of job kinds on both sides', () => {
    const apiKinds = Object.keys(API_AI_JOB_KINDS).sort();
    const ingestionKinds = Object.keys(INGESTION_AI_JOB_KINDS).sort();

    const onlyInApi = apiKinds.filter((k) => !ingestionKinds.includes(k));
    const onlyInIngestion = ingestionKinds.filter((k) => !apiKinds.includes(k));

    expect(onlyInApi, `kinds declared in apps/api but missing from apps/ingestion: ${onlyInApi.join(', ')}`).toEqual([]);
    expect(onlyInIngestion, `kinds declared in apps/ingestion but missing from apps/api: ${onlyInIngestion.join(', ')}`).toEqual([]);
    expect(apiKinds).toEqual(ingestionKinds);
  });

  // The specific kinds this task added — pinned by name so a future rename
  // on one side without the other fails here immediately.
  it('both sides carry the /admin/job-fields rebuild kinds', () => {
    expect(API_AI_JOB_KINDS.RUN_JOBTHAI_LINK_REBUILD).toBe(true);
    expect(API_AI_JOB_KINDS.RUN_JOBTHAI_FULL_REFRESH).toBe(true);
    expect(INGESTION_AI_JOB_KINDS.RUN_JOBTHAI_LINK_REBUILD).toBe(true);
    expect(INGESTION_AI_JOB_KINDS.RUN_JOBTHAI_FULL_REFRESH).toBe(true);
  });
});
