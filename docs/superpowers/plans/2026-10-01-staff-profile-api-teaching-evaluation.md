# Staff Profile API — teaching evaluation section (spec + plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add an opt-in `teachingEvaluation` section to `POST /api/v1/external/staff-profile` carrying the same summary the `/profile` panel shows, plus per-course ratings.

**Decisions (user, 2026-10-01):** scope = panel summary **+ per-course**; **opt-in** — a client receives it only when an admin grants the section; existing clients don't. Additive → contract stays `staff-profile.v1`.

**Architecture:** The pure summary logic moves from `apps/web/src/lib/teaching-evaluation-summary.ts` into `packages/shared/src/staff-profile/teaching-evaluation.ts` (browser-safe; the client panel imports it by deep path), gains `courses`, and takes a structural input type (shared cannot import `@kku/db`). A server loader `getStaffTeachingEvaluation(facultyMemberId)` in `packages/db/src/staff-profile/teaching-evaluation.ts` runs `instructorPersonal` + freshness and summarises. The web `/profile` loader and the API both call it — one implementation. The API fetches it only when the client is granted the section.

## Ground rules
Same as `docs/superpowers/plans/2026-10-01-profile-enhancements.md` "Ground rules" (main branch, `git commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, explicit staging, never `.env`, Tailwind traps, client components never runtime-import `@kku/db` / the `@kku/shared` barrel). Known pre-existing failures: 4 in `packages/shared/test/usage-action-coverage.test.ts`. `instructorPersonal` must keep using plain parameters only (see `packages/db/test/evaluations-raw-sql.test.ts`).

## Response shape (added to `StaffProfileResponseDataSchema`, optional)

```ts
teachingEvaluation: z.object({
  scale: z.object({ min: z.literal(1), max: z.literal(5) }),
  overall: z.number(),
  totalAnswers: z.number(),          // answers, one per question answered — not students
  courseCount: z.number(),
  termCount: z.number(),             // terms with answers
  firstYearBE: z.number().nullable(),
  lastYearBE: z.number().nullable(),
  latestYearBE: z.number().nullable(),
  latestRating: z.number().nullable(),
  previousYearBE: z.number().nullable(),
  previousRating: z.number().nullable(),
  categories: z.array(z.object({
    tag: z.string(), labelEn: z.string(), labelTh: z.string(),
    questions: z.number(), latest: z.number().nullable(), allTime: z.number().nullable(),
  })),
  untaggedQuestions: z.number(),
  courses: z.array(z.object({
    code: z.string(), nameTh: z.string().nullable(), nameEn: z.string().nullable(),
    rating: z.number(), answers: z.number(), latestYearBE: z.number(), latestSemester: z.number(),
  })),
}).nullable().optional()
```
`null` = granted but no evaluations on record (distinct from withheld). Courses sorted latestYearBE desc, latestSemester desc, code asc.

---

### Task A: Move the summary to shared, add courses, add the server loader

**Files:** create `packages/shared/src/staff-profile/teaching-evaluation.ts`, `packages/db/src/staff-profile/teaching-evaluation.ts`; modify `packages/shared/src/staff-profile/index.ts`, `packages/shared/package.json` (exports entry `./src/staff-profile/teaching-evaluation`), `packages/db/src/staff-profile/index.ts`, `apps/web/src/lib/teaching-evaluation-summary.ts`, `apps/web/src/lib/profile-data.ts`; move/extend tests.

- [ ] **1. Shared module.** Move `EVALUATION_THEME_ORDER`, `EVALUATION_THEME_LABELS`, `EvaluationCategoryScore`, `TeachingEvaluationSummary`, `summariseTeachingEvaluation` from `apps/web/src/lib/teaching-evaluation-summary.ts` into `packages/shared/src/staff-profile/teaching-evaluation.ts` — **no runtime imports** (it is imported by a client component by deep path). Replace the `InstructorPersonalResult` type import with a structural interface declared in the file:
```ts
export interface EvaluationSource {
  methodologyVersion: string;
  summary: { ratingAvg: number; totalRespondents: number; courseCount: number };
  trend: Array<{ acadYearBE: number; ratingAvg: number | null; respondentCount: number }>;
  byQuestion: Array<{ themeTag: string | null; ratingAvg: number; respondentCount: number;
    byYear: Record<string, { ratingAvg: number; respondentCount: number }> }>;
  byCourse: Array<{ courseCode: string; courseNameTh: string | null; courseNameEn: string | null;
    ratingAvg: number; respondentCount: number; latestYearBE: number; latestSemester: number }>;
}
```
  (`InstructorPersonalResult` satisfies it structurally — `summariseTeachingEvaluation(r: EvaluationSource, …)`.) Treat `themeTag === ''` like null (untagged). Add to `TeachingEvaluationSummary`:
```ts
  courses: Array<{ code: string; nameTh: string | null; nameEn: string | null; rating: number; answers: number; latestYearBE: number; latestSemester: number }>;
```
  built from `byCourse`, sorted latestYearBE desc, latestSemester desc, code asc.
  Export from `packages/shared/src/staff-profile/index.ts`; add `"./src/staff-profile/teaching-evaluation": "./src/staff-profile/teaching-evaluation.ts"` to the shared `exports` map beside the other staff-profile entries.
- [ ] **2. Web lib becomes a thin re-export.** `apps/web/src/lib/teaching-evaluation-summary.ts`: `export * from '@kku/shared/src/staff-profile/teaching-evaluation';` and keep `evaluationRadarDomain` there (UI-only). Its existing test keeps passing (move summary tests to `packages/shared/test/teaching-evaluation.test.ts`, keep the radar-domain test in web; add tests for `courses` ordering and empty-string themeTag). Update the apps/web client-safety expectations if a test scans this file.
- [ ] **3. Server loader** `packages/db/src/staff-profile/teaching-evaluation.ts`:
```ts
import { summariseTeachingEvaluation, type TeachingEvaluationSummary } from '@kku/shared';
import { prisma } from '../index';
import { instructorPersonal } from '../evaluations';

/** Teaching-evaluation summary for one staff record. Callers enforce visibility:
 *  /profile passes the session user's own record; the external API only calls it
 *  for clients granted the `teachingEvaluation` section. */
export async function getStaffTeachingEvaluation(facultyMemberId: string): Promise<TeachingEvaluationSummary | null> {
  const [result, lastRun] = await Promise.all([
    instructorPersonal(facultyMemberId),
    prisma.ingestionRun.findFirst({
      where: { status: 'SUCCEEDED', dataSource: { slug: 'kku-evaluations' } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
  ]);
  return summariseTeachingEvaluation(result, lastRun?.completedAt?.toISOString() ?? null);
}
```
  Export from `packages/db/src/staff-profile/index.ts`. `apps/web/src/lib/profile-data.ts` `getMyTeachingEvaluation` becomes: resolve the member, then `return getStaffTeachingEvaluation(memberId)`.
- [ ] **4. Verify:** shared/db/web tests + typechecks; the client-safety test for the new shared file (no runtime imports — extend `apps/web/test/profile-types-client-safe.test.ts` or add a sibling); live: tsx call `getStaffTeachingEvaluation('cmonqt19901it2feejnr8ymwe')` → overall ≈ 4.348, 1,880 answers, 5 categories, `courses.length` = 1. Commit `refactor(evaluations): one teaching-evaluation summary for /profile and the API, with courses`.

### Task B: The API section, admin note, docs

**Files:** `packages/shared/src/staff-profile/api-schema.ts`, `apps/api/src/external/staff-profile.mapper.ts`, `apps/api/src/external/staff-profile.service.ts`, `apps/web/app/admin/external/api-clients/client.tsx`, `docs/integrations/staff-profile-api.md`, `docs/pdpa.md`, tests in `packages/shared/test/`, `apps/api/test/staff-profile-mapper.test.ts`, `apps/api/test/staff-profile-service.test.ts`, web admin tests.

- [ ] **1. Schema:** append `'teachingEvaluation'` to `STAFF_PROFILE_SECTIONS` (last), and the response field above to `StaffProfileResponseDataSchema`. Existing stored client grants are unaffected (they list the sections they had).
- [ ] **2. Mapper:** `toStaffProfileResponse(profile, grant, extras: { teachingEvaluation?: TeachingEvaluationSummary | null } = {})`; when granted, emit `data.teachingEvaluation` from `extras.teachingEvaluation` (mapping summary → wire shape: add `scale {1,5}`, category `labelEn/labelTh` from `EVALUATION_THEME_LABELS` (fallback to the tag), courses as above; `null` stays `null`); `included`/`withheld` already iterate `STAFF_PROFILE_SECTIONS`. Tests: granted → schema-valid; null → null; not granted → absent and listed withheld.
- [ ] **3. Service:** only when `client.allowedSections` includes `'teachingEvaluation'`, call `getStaffTeachingEvaluation(facultyMemberId)` in parallel with the build (inside the same concurrency bound if practical, or alongside it); pass to the mapper. Add `{ id: 'kku-evaluations', name: 'KKU student course evaluations' }` to `meta.sources` and two caveats ("Teaching ratings are on a 1–5 scale; category scores are respondent-weighted means of their questions." / "teachingEvaluation.totalAnswers counts answers, one per question answered, not students.") **only when the section is returned**. Tests: not granted → loader never called; granted → called once, data present; loader failure → the request fails like any other build failure (500 logged) — do not silently drop a granted section.
- [ ] **4. Admin console:** in `client.tsx`, next to the `teachingEvaluation` checkbox, a one-line note: "Performance data about the person — grant only to systems with a recorded basis for it." Readable label for the key ("Teaching evaluation"). Verify classes emit CSS.
- [ ] **5. Docs:** `docs/integrations/staff-profile-api.md` — section list, the field table, opt-in note, null-vs-withheld, the per-course caveat; `docs/pdpa.md` — the external-API subsection gains a sentence that teaching-evaluation ratings (overall, by category, by course) are disclosed only to clients granted `teachingEvaluation`, and that the grant needs a recorded basis.
- [ ] **6. Verify:** shared/db/api/web tests + typechecks; a live check through the running dev api (`localhost:4000`) with a temporary client granted the section (create via `createApiClient` in a tsx script, call with curl for denpong@kku.ac.th, then disable the client) — assert `data.teachingEvaluation.overall` ≈ 4.348 and `courses.length` = 1, and that a client without the grant gets it in `sectionsWithheld`. Commit `feat(api): staff profiles can carry teaching evaluations, for clients granted them`.
