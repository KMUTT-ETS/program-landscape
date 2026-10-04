// ─────────────────────────────────────────────────────────────────────────────
// program-overlap.v1 — data preparation (spec §4.2–4.4).
//
//   1. loadPlos              PROGRAM_SKILLS_DETAILED.programLearningOutcomes → program_learning_outcomes
//   2. loadCourseDescriptions approved/auto-approved PROGRAM_DIGEST.courses[] → ProgramCourse.descriptionTh / learningOutcomesTh
//   3. loadMarketProfiles    degree names + recruitment summary + careers → program_market_profiles
//   4. embedPending          PLOs, every major course (names + description when present),
//                            market profiles — only where the text hash changed
//
// Every step takes { apply }. A dry run only counts — in particular step 4
// makes NO model call in a dry run; it reports how many texts are pending.
// Idempotent: unchanged inputs write nothing, and a vector is only replaced
// when the sha256 of the text that produced it changes.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';
import {
  prisma,
  activeRevisionIdFor,
  normalisePloText,
  normaliseCourseCode,
  sha256,
  buildMarketProfileText,
  courseEmbeddingText,
  writeVector,
  EMBED_DIMENSIONS,
  IS_CANONICAL_PROGRAM,
} from '@kku/db';
import type { VectorTable, CourseCategory, Prisma, ReviewStatus } from '@kku/db';
import { embedWithRetry, type AiService } from '@kku/shared';

// ── Pure planning ───────────────────────────────────────────────────────────

export interface PloRowPlan {
  ordinal: number;
  textTh: string;
  textNormalised: string;
}

export function planPloRows(plos: string[]): PloRowPlan[] {
  const out: PloRowPlan[] = [];
  for (const raw of plos) {
    const textNormalised = normalisePloText(raw);
    if (!textNormalised) continue;
    out.push({ ordinal: out.length + 1, textTh: raw.trim(), textNormalised });
  }
  return out;
}

export interface CourseDescriptionUpdate {
  id: string;
  descriptionTh: string;
  learningOutcomesTh: string[];
}

export function planCourseDescriptionUpdates(
  programCourses: Array<{ id: string; courseCode: string }>,
  digestCourses: Array<{ code: string; descriptionTh?: string | null; learningOutcomesTh?: string[] | null }>,
): CourseDescriptionUpdate[] {
  const byCode = new Map<string, { descriptionTh: string; learningOutcomesTh: string[] }>();
  for (const c of digestCourses) {
    const code = normaliseCourseCode(c.code);
    if (!code || !c.descriptionTh) continue;
    byCode.set(code, { descriptionTh: c.descriptionTh, learningOutcomesTh: c.learningOutcomesTh ?? [] });
  }
  const out: CourseDescriptionUpdate[] = [];
  for (const pc of programCourses) {
    const hit = byCode.get(pc.courseCode);
    if (hit) out.push({ id: pc.id, ...hit });
  }
  return out;
}

/** `careersThJson` is a string[] on every dev row; an array of `{ titleTh }`
 *  objects is tolerated, anything else yields no careers. */
const CareerItem = z.union([z.string(), z.object({ titleTh: z.string() }).passthrough(), z.unknown()]);
export function parseCareers(json: unknown): string[] {
  const parsed = z.array(CareerItem).safeParse(json);
  if (!parsed.success) return [];
  const out: string[] = [];
  for (const item of parsed.data) {
    const s = typeof item === 'string' ? item : isTitled(item) ? item.titleTh : '';
    if (s.trim()) out.push(s.trim());
  }
  return out;
}
function isTitled(v: unknown): v is { titleTh: string } {
  return typeof v === 'object' && v !== null && typeof (v as { titleTh?: unknown }).titleTh === 'string';
}

/** Categories whose courses are embedded (spec §4.5). The >25 % service-course
 *  rule is applied at scoring time, not here. */
export const MAJOR_CATEGORIES: CourseCategory[] = ['CORE', 'MAJOR_REQUIRED', 'MAJOR_ELECTIVE', 'UNKNOWN'];

/** Approved digests feed course descriptions — human-approved or auto-approved
 *  (D7: descriptions are a bonus, so take every one that exists). */
export const DIGEST_REVIEW_STATUSES: ReviewStatus[] = ['APPROVED', 'AUTO_APPROVED'];

/**
 * Should this course be embedded? Every MAJOR course (spec §4.4, decision D7)
 * — described or not, since courseEmbeddingText degrades to names only. A
 * course with neither name has nothing to embed.
 */
export function isEmbeddableMajorCourse(c: {
  category: CourseCategory | null;
  courseNameTh: string | null;
  courseNameEn: string | null;
}): boolean {
  const major = c.category === null || MAJOR_CATEGORIES.includes(c.category);
  const named = Boolean(c.courseNameTh?.trim() || c.courseNameEn?.trim());
  return major && named;
}
const MAJOR_COURSE_WHERE: Prisma.ProgramCourseWhereInput = {
  program: IS_CANONICAL_PROGRAM,
  OR: [{ category: { in: MAJOR_CATEGORIES } }, { category: null }],
};

export interface ApplyOpt {
  apply: boolean;
}

// ── 1. PLO table ────────────────────────────────────────────────────────────

const SkillsDetailedPayload = z
  .object({ programLearningOutcomes: z.array(z.string()).nullish().transform((v) => v ?? []) })
  .passthrough();

export interface PloLoadResult {
  programmesWithSource: number;
  programmesRewritten: number;
  programmesUnchanged: number;
  /** Programmes whose stored PLOs were deleted because their latest source
   *  has no usable PLOs (none listed, unparseable, or no extraction at all). */
  programmesCleared: number;
  rowsWritten: number;
}

export async function loadPlos({ apply }: ApplyOpt): Promise<PloLoadResult> {
  const programs = await prisma.program.findMany({ where: IS_CANONICAL_PROGRAM, select: { id: true } });
  const ids = programs.map((p) => p.id);
  const extractions = await prisma.aiExtraction.findMany({
    where: { sourceEntityType: 'program', sourceEntityId: { in: ids }, extractionKind: 'PROGRAM_SKILLS_DETAILED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, sourceEntityId: true, payloadJson: true },
  });
  const latest = new Map<string, { id: string; payloadJson: Prisma.JsonValue }>();
  for (const e of extractions) if (!latest.has(e.sourceEntityId)) latest.set(e.sourceEntityId, e);

  const existing = await prisma.programLearningOutcome.findMany({
    where: { programId: { in: ids } },
    select: { programId: true, sourceExtractionId: true, programRevisionId: true },
  });
  const existingBy = new Map<string, { sourceExtractionId: string; programRevisionId: string | null; count: number }>();
  for (const r of existing) {
    const cur = existingBy.get(r.programId);
    if (cur) cur.count++;
    else existingBy.set(r.programId, { sourceExtractionId: r.sourceExtractionId, programRevisionId: r.programRevisionId, count: 1 });
  }

  const result: PloLoadResult = {
    programmesWithSource: 0,
    programmesRewritten: 0,
    programmesUnchanged: 0,
    programmesCleared: 0,
    rowsWritten: 0,
  };
  for (const programId of ids) {
    const extraction = latest.get(programId);
    const payload = extraction ? SkillsDetailedPayload.safeParse(extraction.payloadJson) : undefined;
    const planned = payload?.success ? planPloRows(payload.data.programLearningOutcomes) : [];
    if (!extraction || planned.length === 0) {
      // No usable source any more: rows left behind would keep scoring a
      // programme on PLOs its current extraction no longer states.
      if (existingBy.has(programId)) {
        result.programmesCleared++;
        if (apply) await prisma.programLearningOutcome.deleteMany({ where: { programId } });
      }
      continue;
    }
    result.programmesWithSource++;

    // The ACTIVE revision, per the revision-stamping contract
    // (packages/db/test/program-revision-stamping.test.ts) — not the
    // extraction's own revision. One lookup per programme, deliberately: the
    // guard requires the shared helper rather than an inlined query.
    const programRevisionId = await activeRevisionIdFor(programId);
    const prior = existingBy.get(programId);
    if (
      prior &&
      prior.sourceExtractionId === extraction.id &&
      prior.count === planned.length &&
      prior.programRevisionId === programRevisionId
    ) {
      // Unchanged: keep the rows and therefore their embeddings.
      result.programmesUnchanged++;
      continue;
    }
    result.programmesRewritten++;
    result.rowsWritten += planned.length;
    if (!apply) continue;

    const ploRows = planned.map((r) => ({
      programId,
      ordinal: r.ordinal,
      textTh: r.textTh,
      textNormalised: r.textNormalised,
      sourceExtractionId: extraction.id,
      programRevisionId,
    }));
    await prisma.$transaction([
      prisma.programLearningOutcome.deleteMany({ where: { programId } }),
      prisma.programLearningOutcome.createMany({ data: ploRows }),
    ]);
  }
  return result;
}

// ── 2. Course descriptions + CLOs ───────────────────────────────────────────

const DigestPayload = z
  .object({
    courses: z
      .array(
        z
          .object({
            code: z.string(),
            descriptionTh: z.string().nullish(),
            learningOutcomesTh: z.array(z.string()).nullish(),
          })
          .passthrough(),
      )
      .nullish()
      .transform((v) => v ?? []),
  })
  .passthrough();

export interface CourseDescriptionResult {
  programmesWithDigest: number;
  coursesMatched: number;
  coursesUpdated: number;
}

export async function loadCourseDescriptions({ apply }: ApplyOpt): Promise<CourseDescriptionResult> {
  const programs = await prisma.program.findMany({ where: IS_CANONICAL_PROGRAM, select: { id: true } });
  const ids = programs.map((p) => p.id);
  const digests = await prisma.aiExtraction.findMany({
    where: { sourceEntityType: 'program', sourceEntityId: { in: ids }, extractionKind: 'PROGRAM_DIGEST', reviewStatus: { in: DIGEST_REVIEW_STATUSES } },
    orderBy: { createdAt: 'desc' },
    select: { sourceEntityId: true, payloadJson: true },
  });
  const latest = new Map<string, Prisma.JsonValue>();
  for (const d of digests) if (!latest.has(d.sourceEntityId)) latest.set(d.sourceEntityId, d.payloadJson);

  const allCourses = await prisma.programCourse.findMany({
    where: { programId: { in: [...latest.keys()] } },
    select: { id: true, programId: true, courseCode: true, descriptionTh: true, learningOutcomesTh: true },
  });
  const coursesBy = new Map<string, typeof allCourses>();
  for (const c of allCourses) {
    const list = coursesBy.get(c.programId);
    if (list) list.push(c);
    else coursesBy.set(c.programId, [c]);
  }

  const result: CourseDescriptionResult = { programmesWithDigest: 0, coursesMatched: 0, coursesUpdated: 0 };
  for (const [programId, json] of latest) {
    const payload = DigestPayload.safeParse(json);
    if (!payload.success) continue;
    result.programmesWithDigest++;
    const courses = coursesBy.get(programId) ?? [];
    const current = new Map(courses.map((c) => [c.id, c]));
    const updates = planCourseDescriptionUpdates(courses, payload.data.courses);
    result.coursesMatched += updates.length;
    for (const u of updates) {
      const cur = current.get(u.id);
      const unchanged =
        cur?.descriptionTh === u.descriptionTh &&
        cur.learningOutcomesTh.length === u.learningOutcomesTh.length &&
        cur.learningOutcomesTh.every((x, i) => x === u.learningOutcomesTh[i]);
      if (unchanged) continue;
      result.coursesUpdated++;
      if (!apply) continue;
      // Clearing the hash forces a re-embed even if embedPending's text-hash
      // comparison were ever bypassed.
      await prisma.programCourse.update({
        where: { id: u.id },
        data: { descriptionTh: u.descriptionTh, learningOutcomesTh: u.learningOutcomesTh, embeddingTextHash: null },
      });
    }
  }
  return result;
}

// ── 3. Market profiles ──────────────────────────────────────────────────────

export interface MarketProfileResult {
  programmes: number;
  created: number;
  changed: number;
  unchanged: number;
}

export async function loadMarketProfiles({ apply }: ApplyOpt): Promise<MarketProfileResult> {
  const programs = await prisma.program.findMany({
    where: IS_CANONICAL_PROGRAM,
    select: {
      id: true,
      nameTh: true,
      nameEn: true,
      degreeNameTh: true,
      degreeNameEn: true,
      recruitmentSummaryTh: true,
      careersThJson: true,
    },
  });
  const existing = new Map(
    (await prisma.programMarketProfile.findMany({ select: { programId: true, textHash: true } })).map((r) => [r.programId, r.textHash]),
  );

  const result: MarketProfileResult = { programmes: programs.length, created: 0, changed: 0, unchanged: 0 };
  for (const p of programs) {
    const text = buildMarketProfileText({
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      degreeNameTh: p.degreeNameTh,
      degreeNameEn: p.degreeNameEn,
      recruitmentSummaryTh: p.recruitmentSummaryTh,
      careers: parseCareers(p.careersThJson),
    });
    const textHash = sha256(text);
    const prior = existing.get(p.id);
    if (prior === textHash) {
      result.unchanged++;
      continue;
    }
    if (prior === undefined) result.created++;
    else result.changed++;
    if (!apply) continue;
    // One statement, so the new text can never sit beside the old text's
    // vector: the embedding is cleared in the same write whenever the hash moves.
    await prisma.$executeRaw`
      INSERT INTO program_market_profiles (program_id, text, text_hash, updated_at)
      VALUES (${p.id}, ${text}, ${textHash}, now())
      ON CONFLICT (program_id) DO UPDATE SET
        text = EXCLUDED.text,
        text_hash = EXCLUDED.text_hash,
        updated_at = now(),
        embedding = CASE
          WHEN program_market_profiles.text_hash IS DISTINCT FROM EXCLUDED.text_hash THEN NULL
          ELSE program_market_profiles.embedding
        END`;
  }
  return result;
}

// ── 4. Embeddings ───────────────────────────────────────────────────────────

const EMBED_BATCH = 96;

export interface EmbedResult {
  plos: { pending: number; written: number };
  courses: { pending: number; written: number };
  profiles: { pending: number; written: number };
  costUsd: number;
}

interface PendingText {
  id: string;
  text: string;
}

function logEmbedRetry(kind: string, offset: number, total: number) {
  return ({ attempt, delayMs, error }: { attempt: number; delayMs: number; error: string }) =>
    console.warn(
      `  embed ${kind} ${offset}/${total}: attempt ${attempt} failed (${error}) — retrying in ${Math.round(delayMs / 1000)}s`,
    );
}

async function embedBatches(
  ai: AiService,
  kind: string,
  table: VectorTable,
  items: PendingText[],
): Promise<{ written: number; costUsd: number }> {
  let written = 0;
  let costUsd = 0;
  for (let i = 0; i < items.length; i += EMBED_BATCH) {
    const batch = items.slice(i, i + EMBED_BATCH);
    // Waits out rate limits (prod's key throttles a back-to-back backfill);
    // batches already written survive a final failure, so a re-run resumes.
    const res = await embedWithRetry(
      ai,
      {
        ctx: { module: 'program-overlap', kind: `embedding.${kind}` },
        texts: batch.map((b) => b.text),
        dimensions: EMBED_DIMENSIONS,
      },
      { onRetry: logEmbedRetry(kind, i, items.length) },
    );
    costUsd += res.cost.usd;
    // Fail loud rather than skip: a missing or wrong-size vector would leave a
    // hole the scorer cannot tell from "no data". Batches already written stay.
    if (res.vectors.length !== batch.length) {
      throw new Error(`program-overlap embed (${kind}): provider returned ${res.vectors.length} vectors for ${batch.length} texts`);
    }
    for (let j = 0; j < batch.length; j++) {
      const vec = res.vectors[j]!;
      const item = batch[j]!;
      if (vec.length !== EMBED_DIMENSIONS) {
        throw new Error(`program-overlap embed (${kind}): vector of ${vec.length} dimensions, expected ${EMBED_DIMENSIONS}`);
      }
      await writeVector(table, item.id, vec, sha256(item.text));
      written++;
    }
  }
  return { written, costUsd };
}

const PendingProfileRow = z.object({ program_id: z.string(), text: z.string() });

export async function pendingEmbeddings(): Promise<{ plos: PendingText[]; courses: PendingText[]; profiles: PendingText[] }> {
  const ploRowsDb = await prisma.programLearningOutcome.findMany({
    where: { program: IS_CANONICAL_PROGRAM },
    select: { id: true, textNormalised: true, embeddingTextHash: true },
  });
  // writeVector sets the hash and the vector together, so a matching hash
  // implies a present, current vector.
  const plos = ploRowsDb
    .filter((r) => r.embeddingTextHash !== sha256(r.textNormalised))
    .map((r) => ({ id: r.id, text: r.textNormalised }));

  const courseRows = await prisma.programCourse.findMany({
    where: MAJOR_COURSE_WHERE,
    select: {
      id: true,
      category: true,
      courseNameTh: true,
      courseNameEn: true,
      descriptionTh: true,
      learningOutcomesTh: true,
      embeddingTextHash: true,
    },
  });
  const courses: PendingText[] = [];
  for (const c of courseRows) {
    if (!isEmbeddableMajorCourse(c)) continue;
    const text = courseEmbeddingText({
      nameTh: c.courseNameTh,
      nameEn: c.courseNameEn,
      descriptionTh: c.descriptionTh,
      learningOutcomesTh: c.learningOutcomesTh,
    });
    if (c.embeddingTextHash !== sha256(text)) courses.push({ id: c.id, text });
  }

  const profiles = z
    .array(PendingProfileRow)
    .parse(await prisma.$queryRaw`SELECT program_id, text FROM program_market_profiles WHERE embedding IS NULL`)
    .map((r) => ({ id: r.program_id, text: r.text }));

  return { plos, courses, profiles };
}

export async function embedPending(ai: AiService, { apply }: ApplyOpt): Promise<EmbedResult> {
  const pending = await pendingEmbeddings();
  const result: EmbedResult = {
    plos: { pending: pending.plos.length, written: 0 },
    courses: { pending: pending.courses.length, written: 0 },
    profiles: { pending: pending.profiles.length, written: 0 },
    costUsd: 0,
  };
  // Dry run: count only. No model call, no cost.
  if (!apply) return result;

  const p = await embedBatches(ai, 'plo', 'program_learning_outcomes', pending.plos);
  const c = await embedBatches(ai, 'course', 'program_courses', pending.courses);
  const m = await embedBatches(ai, 'market-profile', 'program_market_profiles', pending.profiles);
  result.plos.written = p.written;
  result.courses.written = c.written;
  result.profiles.written = m.written;
  result.costUsd = p.costUsd + c.costUsd + m.costUsd;
  return result;
}

// ── Orchestration + coverage ────────────────────────────────────────────────

export interface OverlapPrepResult {
  plos: PloLoadResult;
  courseDescriptions: CourseDescriptionResult;
  marketProfiles: MarketProfileResult;
  embeddings: EmbedResult;
}

export async function runOverlapPrep(ai: AiService, opt: ApplyOpt): Promise<OverlapPrepResult> {
  const plos = await loadPlos(opt);
  const courseDescriptions = await loadCourseDescriptions(opt);
  const marketProfiles = await loadMarketProfiles(opt);
  const embeddings = await embedPending(ai, opt);
  return { plos, courseDescriptions, marketProfiles, embeddings };
}

export interface OverlapPrepCoverage {
  canonicalProgrammes: number;
  withPlos: number;
  withDescribedMajorCourses: number;
  majorCourses: number;
  describedMajorCourses: number;
  majorCredits: number;
  describedMajorCredits: number;
  embeddedMajorCourses: number;
  embeddedMajorCredits: number;
  withMarketProfile: number;
}

/** Current state of the stored data (not what a dry run would produce). */
export async function overlapPrepCoverage(): Promise<OverlapPrepCoverage> {
  const canonicalProgrammes = await prisma.program.count({ where: IS_CANONICAL_PROGRAM });
  const ploProgs = await prisma.programLearningOutcome.findMany({
    where: { program: IS_CANONICAL_PROGRAM },
    distinct: ['programId'],
    select: { programId: true },
  });
  const majors = await prisma.programCourse.findMany({
    where: MAJOR_COURSE_WHERE,
    select: { programId: true, credits: true, descriptionTh: true, embeddingTextHash: true },
  });
  const described = new Set<string>();
  let majorCredits = 0;
  let describedMajorCredits = 0;
  let describedMajorCourses = 0;
  let embeddedMajorCourses = 0;
  let embeddedMajorCredits = 0;
  for (const c of majors) {
    majorCredits += c.credits ?? 0;
    // writeVector sets the hash and the vector together.
    if (c.embeddingTextHash) {
      embeddedMajorCourses++;
      embeddedMajorCredits += c.credits ?? 0;
    }
    if (c.descriptionTh) {
      described.add(c.programId);
      describedMajorCourses++;
      describedMajorCredits += c.credits ?? 0;
    }
  }
  const withMarketProfile = await prisma.programMarketProfile.count({ where: { program: IS_CANONICAL_PROGRAM } });
  return {
    canonicalProgrammes,
    withPlos: ploProgs.length,
    withDescribedMajorCourses: described.size,
    majorCourses: majors.length,
    describedMajorCourses,
    majorCredits,
    describedMajorCredits,
    embeddedMajorCourses,
    embeddedMajorCredits,
    withMarketProfile,
  };
}
