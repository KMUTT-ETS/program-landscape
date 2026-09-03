# Curriculum Submission Entry Point — Implementation Plan (Project 1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse three programme-creation buttons into one submission page that handles both new programmes and revisions of existing ones, and fix four defects found while mapping it.

**Architecture:** Rework the existing `/admin/programs/from-pdf` wizard rather than build a new page — it already owns the upload, the 60-second extraction poll, the version-gated pre-fill and the live collision panel, all of which are good and should be preserved. Add a mode step in front of it, a revision branch behind it, and a pipeline call at the end. Delete `/admin/programs/new` and the two duplicate buttons.

**Tech Stack:** Next.js 14 App Router (client components), NestJS, Prisma, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-curriculum-submission-entry-point-design.md`

---

## Why this exists (read before starting)

`/admin/programs` shows **three buttons that all add a programme**, pointing at **two** destinations — "New blank" and "Add new program" are the same page. Nothing says so.

Meanwhile there is **no entry point for revising an existing programme**. That operation exists (find programme → open → Files tab → attach → run pipeline) but nothing in the UI names it.

Every programme needs a มคอ.2 — the whole pipeline reads it. "New blank" creates a canonical, pipeline-eligible programme with no document, which the pipeline then skips. **21 programmes currently have no curriculum document.**

## The one decision that shapes the work

**The new-vs-revision branch is declared by the operator, never inferred from collisions.** This was tested and rejected: a revised มคอ.2 carries a *different* code (the curriculum year changes), so `same_code` never fires; the name-match rules require `facultyId && level`, and `facultyId` is auto-filled only by `faculties.find(f => f.nameTh.includes(payload.facultyNameTh))` — a substring match on an AI-extracted name. When it misses, **a genuine revision renders a green "safe to create" panel**, failing silently toward creating a duplicate.

Do not "improve" this by making the collision panel drive the branch.

## Ordering

Tasks 1–3 are independent fixes to the existing page; they ship value before anything is restructured. Tasks 4–6 add revision mode. Task 7 removes the old page **after** its replacement works. Task 8 is the console tile. Task 9 verifies.

## File structure

| File | Responsibility |
|---|---|
| `apps/web/app/admin/programs/from-pdf/client.tsx` | **Modify** — mode step, revision branch, pipeline call, level option, year input |
| `apps/web/app/admin/programs/from-pdf/page.tsx` | **Modify** — title/eyebrow now cover both modes |
| `packages/db/src/program-revision.ts` | **Modify** — `isFirstAnalysis` on the staleness result |
| `apps/web/app/admin/programs/[id]/client.tsx` | **Modify** — banner copy branch |
| `apps/web/app/programs/[id]/client.tsx` | **Modify** — banner copy branch |
| `apps/web/app/programs/[id]/types.ts` | **Modify** — staleness type gains the field |
| `apps/web/app/admin/programs/page.tsx` | **Modify** — one button, count fix |
| `apps/web/app/admin/programs/list-client.tsx` | **Modify** — remove two links, keep the count |
| `apps/web/app/admin/programs/new/` | **Delete** — page + client |
| `apps/web/test/pdf-upload-response-shape.test.ts` | **Modify** — drop the deleted path |
| `apps/web/app/admin/page.tsx` | **Modify** — second Group 1 tile, count fix |

---

### Task 1: Add the missing level option

**Files:**
- Modify: `apps/web/app/admin/programs/from-pdf/client.tsx` (~line 553-561)

`HIGHER_GRAD_DIPLOMA` appears three times in this file — the form-state type, the payload type, and the lazy initialiser cast — but **not** in the `<select>`, which offers only Bachelor / Master / Doctoral. So an extraction can seed a value the operator can neither see nor choose, and the select renders blank. `new/client.tsx` offers it; deleting that page in Task 7 without this is silent data loss.

- [ ] **Step 1: Add the option**

In the `Level *` field's `<select>`, after the Doctoral option:

```tsx
                <option value="HIGHER_GRAD_DIPLOMA">Higher graduate diploma</option>
```

Match the label wording used in `apps/web/app/admin/programs/new/client.tsx`'s level select — read it and copy the exact string so the two pages don't disagree while both exist.

- [ ] **Step 2: Verify the seed path works**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean.

Then confirm the round-trip by reasoning through the lazy initialiser (~line 354): `level: (payload.level ?? 'BACHELOR') as ...`. With the option present, an extraction carrying `HIGHER_GRAD_DIPLOMA` now renders as a selected option instead of a blank select. Say whether you traced this or only added the line.

- [ ] **Step 3: Commit**

```bash
git add 'apps/web/app/admin/programs/from-pdf/client.tsx'
git commit -m "fix(web): higher graduate diploma was typed but unselectable"
```

---

### Task 2: Fire the pipeline after creating a programme

**Files:**
- Modify: `apps/web/app/admin/programs/from-pdf/client.tsx`

**The gap:** this page fires the pipeline **nowhere** — verified, its only network calls are upload, detail-poll, collision-check, re-extract and create. A programme created here gets header fields and no analysis until somebody manually runs it. `/admin/programs/new` does fire it, and Task 7 deletes that page, so without this the regression becomes universal.

- [ ] **Step 1: Port the pipeline call**

`apps/web/app/admin/programs/new/client.tsx` (~line 122-141) has the implementation to port. Copy its shape, including its error posture — a failed enqueue must **not** lose the programme:

```tsx
  // The programme exists at this point. A failed enqueue is recoverable
  // from the detail page, so warn and continue rather than surfacing it as
  // a create failure — that would tell the operator the programme wasn't
  // created when it was.
  const firePipeline = async (programId: string) => {
    try {
      const res = await fetch(`/api/admin-programs/${programId}/run-pipeline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      return true;
    } catch (err) {
      toast.warning(
        `Program created but pipeline enqueue failed: ${(err as Error).message}. Run pipeline from the program page when ready.`,
      );
      return false;
    }
  };
```

- [ ] **Step 2: Call it after a successful create**

In `submit` (~line 427-464), after `const created = json.data as { id: string };` and before navigating:

```tsx
      await firePipeline(created.id);
      toast.success('Program created; PDF attached and analysis started.');
      onCreated(created.id);
```

Replace the existing success toast — the old wording ("PDF attached as current curriculum") no longer describes what happens.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit && npx eslint 'app/admin/programs/from-pdf/client.tsx'`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add 'apps/web/app/admin/programs/from-pdf/client.tsx'
git commit -m "fix(web): from-pdf never started analysis on the programme it created"
```

---

### Task 3: A new programme should not accuse itself of being stale

**Files:**
- Modify: `packages/db/src/program-revision.ts`
- Modify: `packages/db/test/program-revision.test.ts`
- Modify: `apps/web/app/programs/[id]/types.ts`
- Modify: `apps/web/app/admin/programs/[id]/client.tsx`
- Modify: `apps/web/app/programs/[id]/client.tsx`

`create()` opens a DRAFT revision, so a freshly created programme immediately renders *"A revised curriculum file was attached … and has not been analysed. Every AI section still reflects the previous file."* There is no previous file. The copy is wrong for the first-analysis case.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/test/program-revision.test.ts`, following the existing style in that file (`vi.hoisted` mocks, **no** `vi.importActual` spread — that spread silently bypasses the mock and reaches the live database):

```typescript
describe('programRevisionStaleness — first analysis', () => {
  it('flags a pending revision as the first analysis when no revision has ever completed', async () => {
    // A brand-new programme opens a DRAFT revision at create time. Telling
    // its operator that "a revised file was attached" is nonsense — there is
    // no previous file. The banner needs to say "not yet analysed" instead.
    mocks.revisionFindFirst.mockResolvedValue({
      id: 'rev1', curriculumYearBE: 2567, createdAt: new Date('2026-09-01'),
    });
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: null });
    mocks.documentFindFirst.mockResolvedValue({ pdfDocumentId: 'pdf1', attachedAt: new Date('2026-09-01') });
    mocks.revisionCount.mockResolvedValue(0);
    const r = await programRevisionStaleness('p1');
    expect(r.stale).toBe(true);
    expect(r.reason).toBe('unanalysed-revision');
    expect(r.isFirstAnalysis).toBe(true);
  });

  it('is NOT the first analysis when an earlier revision already completed', async () => {
    mocks.revisionFindFirst.mockResolvedValue({
      id: 'rev2', curriculumYearBE: 2570, createdAt: new Date('2026-09-01'),
    });
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.documentFindFirst.mockResolvedValue({ pdfDocumentId: 'pdf2', attachedAt: new Date('2026-09-01') });
    mocks.revisionCount.mockResolvedValue(1);
    const r = await programRevisionStaleness('p1');
    expect(r.stale).toBe(true);
    expect(r.isFirstAnalysis).toBe(false);
  });
});
```

You will need to add `revisionCount: vi.fn()` to the `vi.hoisted` mocks block and `count: mocks.revisionCount` to the mocked `programRevision` client. Check whether the existing tests need `revisionCount` given a default — if `count` returns `undefined` the other tests may break; give it a sensible `mockResolvedValue(0)` in `beforeEach` if so.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/db && npx vitest run test/program-revision.test.ts`
Expected: FAIL — `isFirstAnalysis` is undefined.

- [ ] **Step 3: Add the field**

In `packages/db/src/program-revision.ts`, extend the result interface:

```typescript
  /** True when no revision for this programme has ever completed analysis —
   *  i.e. this is the programme's first. A brand-new programme opens a DRAFT
   *  revision at create time, and telling its operator "a revised file was
   *  attached" is nonsense when there is no previous file. */
  isFirstAnalysis: boolean;
```

Compute it in the `unanalysed-revision` branch by counting revisions that have left the pending set:

```typescript
    const completedCount = await prisma.programRevision.count({
      where: { programId, status: { in: ['APPROVED', 'SUPERSEDED'] } },
    });
```

Return `isFirstAnalysis: completedCount === 0` on that branch, and `false` on the `superseded-document` and `none` branches — a superseded document by definition means something was analysed before.

- [ ] **Step 4: Run tests**

Run: `cd packages/db && npx vitest run test/program-revision.test.ts && npx tsc --noEmit`
Expected: all pass (13 now — 11 existing plus 2).

- [ ] **Step 5: Branch the copy in both UIs**

`apps/web/app/programs/[id]/types.ts` — add `isFirstAnalysis: boolean;` to the staleness type.

`apps/web/app/admin/programs/[id]/client.tsx` — in `StalenessBanner`, when `reason === 'unanalysed-revision' && isFirstAnalysis`:

> *"This programme's curriculum file has not been analysed yet. Run the pipeline to generate its analysis."*

Otherwise keep the existing revised-file wording.

`apps/web/app/programs/[id]/client.tsx` — same branch, Council register:

> *"This programme's analysis has not been generated yet."*

Keep the existing wording for the non-first cases. Design tokens only — ESLint bans literal colours.

- [ ] **Step 6: Typecheck and lint**

Run: `cd packages/db && npx tsc --noEmit && cd ../../apps/api && npx tsc --noEmit && cd ../web && npx tsc --noEmit && npx eslint 'app/programs/[id]/client.tsx' 'app/admin/programs/[id]/client.tsx'`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/program-revision.ts packages/db/test/program-revision.test.ts 'apps/web/app/programs/[id]/types.ts' 'apps/web/app/programs/[id]/client.tsx' 'apps/web/app/admin/programs/[id]/client.tsx'
git commit -m "fix(web): a new programme no longer reports itself as having a revised file"
```

---

### Task 4: The mode step

**Files:**
- Modify: `apps/web/app/admin/programs/from-pdf/client.tsx`
- Modify: `apps/web/app/admin/programs/from-pdf/page.tsx`

- [ ] **Step 1: Widen the step machine**

The component currently holds `const [step, setStep] = React.useState<'upload' | 'fill'>('upload');` (~line 105). Add a mode step in front:

```tsx
  const [step, setStep] = React.useState<'mode' | 'upload' | 'fill'>('mode');
  // null = new programme; a programme = revise that one. Chosen before
  // upload, never inferred: checkCollision cannot detect a revision (a
  // revised มคอ.2 carries a different code, and the name rules need a
  // facultyId that comes from a fragile substring match), so inferring it
  // would fail silently toward creating a duplicate.
  const [target, setTarget] = React.useState<TargetProgram | null>(null);
```

with

```tsx
interface TargetProgram {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
}
```

- [ ] **Step 2: Write the mode step component**

Add a `ModeStep` rendered when `step === 'mode'`. Two choices; picking "revision" reveals a programme search.

The search reuses the pattern already working in `apps/web/app/admin/pdf-review/[id]/client.tsx` (~line 300-325) — read it and match it:

```tsx
function ModeStep({
  onNew,
  onRevise,
}: {
  onNew: () => void;
  onRevise: (p: TargetProgram) => void;
}) {
  const [mode, setMode] = React.useState<'new' | 'revision' | null>(null);
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<TargetProgram[]>([]);

  React.useEffect(() => {
    if (mode !== 'revision' || query.trim().length < 2) {
      setOptions([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await fetch(
        `/api/admin-programs?q=${encodeURIComponent(query)}&pageSize=10`,
      );
      if (!res.ok) return;
      const json = await res.json();
      setOptions((json?.data ?? []) as TargetProgram[]);
    }, 250);
    return () => clearTimeout(handle);
  }, [mode, query]);

  return (
    <Card padding="md">
      <h2 className="text-sm font-semibold text-text-primary">
        Step 1 of 3 · What are you submitting?
      </h2>
      <div className="mt-3 flex flex-col gap-2">
        <Button
          variant={mode === 'new' ? 'primary' : 'outline'}
          onClick={() => setMode('new')}
        >
          A new programme
        </Button>
        <Button
          variant={mode === 'revision' ? 'primary' : 'outline'}
          onClick={() => setMode('revision')}
        >
          A revised curriculum for an existing programme
        </Button>
      </div>

      {mode === 'new' && (
        <div className="mt-4">
          <Button onClick={onNew}>Continue</Button>
        </div>
      )}

      {mode === 'revision' && (
        <div className="mt-4 flex flex-col gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code or name…"
          />
          {options.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onRevise(p)}
              className="rounded-md border border-border-subtle px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <span className="font-mono text-xs text-text-tertiary">{p.code}</span>{' '}
              <span className="text-text-primary">{p.nameTh}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
```

Verify `Card`, `Button` and `Input` prop names against their definitions in `packages/ui` rather than trusting this snippet — a previous project in this repo found `Card` has no `tone="warning"` and `FreshnessBadge`/`ProvenanceButton` had entirely different APIs than a plan claimed.

- [ ] **Step 3: Wire it**

```tsx
  if (step === 'mode') {
    return (
      <ModeStep
        onNew={() => { setTarget(null); setStep('upload'); }}
        onRevise={(p) => { setTarget(p); setStep('upload'); }}
      />
    );
  }
```

Update `page.tsx`'s `PageHeader` title from "New program from PDF" to something covering both — e.g. "Submit curriculum file" — and the `AdminBackNav` `current` label to match.

Update the existing step headings: `UploadStep`'s is "Step 1", `FillStep`'s is "Step 2 of 2". They become steps 2 and 3.

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/web && npx tsc --noEmit && npx eslint 'app/admin/programs/from-pdf/client.tsx'`
Expected: clean, no `no-restricted-syntax` colour violations.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/app/admin/programs/from-pdf/client.tsx' 'apps/web/app/admin/programs/from-pdf/page.tsx'
git commit -m "feat(web): submission page asks new-programme or revision first"
```

---

### Task 5: Revision mode — attach and analyse

**Files:**
- Modify: `apps/web/app/admin/programs/from-pdf/client.tsx`

When `target` is set, the identity form is wrong — the programme already exists and its identity is fixed. Show a confirmation instead, then attach.

- [ ] **Step 1: Add the revision confirm-and-attach step**

Rendered when `step === 'fill' && target !== null`, in place of `FillStep`:

```tsx
function ReviseStep({
  target,
  pdf,
  extraction,
  onDone,
}: {
  target: TargetProgram;
  pdf: PdfAfterUpload;
  extraction: PdfExtractionLite | null;
  onDone: (programId: string) => void;
}) {
  const [yearBE, setYearBE] = React.useState<string>(
    extraction?.payloadJson?.curriculumYear
      ? String(extraction.payloadJson.curriculumYear)
      : '',
  );
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      // Attach only — deliberately NOT apply-extraction, which would also
      // overwrite the programme's header columns from the payload with no
      // record and no diff. The metadata update happens when the pipeline
      // re-digests, where it IS recorded (metadataProposalJson + an
      // audit row). See the spec's "Revision mode" section.
      const res = await fetch(`/api/admin-programs/${target.id}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pdfDocumentId: pdf.pdfDocumentId,
          role: 'CURRENT_CURRICULUM',
          promoteToCurrent: true,
          curriculumYearBE: yearBE ? Number(yearBE) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      await firePipeline(target.id);
      toast.success('Revised curriculum attached; analysis started.');
      onDone(target.id);
    } catch (err) {
      toast.error(`Attach failed: ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <Card padding="md">
      <h2 className="text-sm font-semibold text-text-primary">
        Step 3 of 3 · Confirm the revision
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        <span className="font-mono text-xs text-text-tertiary">{target.code}</span>{' '}
        {target.nameTh}
      </p>
      <p className="mt-2 text-xs text-text-tertiary">
        The current curriculum file will be kept as a previous version. The
        programme&rsquo;s existing details are not changed here — they update
        when the analysis re-reads the new file.
      </p>
      <div className="mt-4 max-w-xs">
        <Field label="Curriculum year (พ.ศ.)">
          <Input
            type="number"
            value={yearBE}
            onChange={(e) => setYearBE(e.target.value)}
            placeholder="2570"
          />
        </Field>
      </div>
      <div className="mt-4">
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Attaching…' : 'Attach and analyse'}
        </Button>
      </div>
    </Card>
  );
}
```

`firePipeline` must be reachable from here — Task 2 defined it inside `FillStep`. Lift it to module scope (it takes `programId` and closes over nothing) so both callers share one implementation. Say that you did.

`PdfExtractionLite` is the existing extraction type in this file — check its real name and the shape of `payloadJson` before reading `curriculumYear` off it. If `payloadJson` is typed loosely, narrow it locally rather than casting to `any`.

- [ ] **Step 2: Cross-check the declared mode against the extraction**

The payload carries `isRevision` and `previousCurriculumYearBE`, both currently invisible in the UI. Use them as a warning only — never to switch mode:

In `FillStep` (new-programme mode), when `extraction?.payloadJson?.isRevision === true`, render above the form:

```tsx
        <Card padding="sm" tone="quiet">
          <p className="text-xs text-text-secondary">
            This document appears to be a revision of an existing curriculum
            {payload.previousCurriculumYearBE
              ? ` (previous year พ.ศ. ${payload.previousCurriculumYearBE})`
              : ''}
            . If this programme already exists, go back and choose
            &ldquo;a revised curriculum&rdquo; instead of creating a duplicate.
          </p>
        </Card>
```

- [ ] **Step 3: Wire the branch**

```tsx
  if (target) {
    return <ReviseStep target={target} pdf={pdf} extraction={usableExtraction(pdf)} onDone={(id) => router.push(`/admin/programs/${id}`)} />;
  }
```

placed where `FillStep` is currently returned, before it.

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/web && npx tsc --noEmit && npx eslint 'app/admin/programs/from-pdf/client.tsx'`
Expected: clean.

- [ ] **Step 5: Verify against the running app**

With `pnpm dev` up (web :3000, api :4000), sign in as `admin@kku.ac.th` / `kku-dev`, go to the submission page, choose **revision**, pick a programme, upload any PDF, set a year, submit.

Confirm in the database:

```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const p = await prisma.program.findFirst({ where:{ code:'<the code you picked>' }, select:{id:true} });
  console.log('documents:', await prisma.programDocument.findMany({ where:{programId:p!.id}, select:{role:true,isCurrent:true,curriculumYearBE:true} }));
  console.log('revisions:', await prisma.programRevision.findMany({ where:{programId:p!.id}, select:{status:true,curriculumYearBE:true} }));
  await prisma.\$disconnect();
})();
"
```

Expected: the new document is `CURRENT_CURRICULUM / isCurrent: true` carrying your year, the prior one is `PREVIOUS_CURRICULUM / isCurrent: false`, and exactly one new revision exists.

**Then clean up completely** — remove the document you attached, restore the prior one to current, delete the revision. Previous work on this branch set a high bar here: one task restored a shared PDF's filename from a value recovered out of a `notes` field. Snapshot before you start and diff after.

- [ ] **Step 6: Commit**

```bash
git add 'apps/web/app/admin/programs/from-pdf/client.tsx'
git commit -m "feat(web): submission page can attach a revised curriculum"
```

---

### Task 6: Remove blank-create and the duplicate buttons

**Files:**
- Delete: `apps/web/app/admin/programs/new/page.tsx`, `apps/web/app/admin/programs/new/client.tsx`
- Modify: `apps/web/app/admin/programs/page.tsx` (~line 110-128)
- Modify: `apps/web/app/admin/programs/list-client.tsx` (~line 413-443)
- Modify: `apps/web/test/pdf-upload-response-shape.test.ts`

Do this **after** Tasks 4-5 work — the replacement must exist before the original is removed.

- [ ] **Step 1: Collapse the header buttons to one**

In `apps/web/app/admin/programs/page.tsx`, the `PageHeader` `actions` prop currently renders two buttons. Replace with one pointing at the submission page:

```tsx
        actions={
          <EdgeGlow inline>
            <Button variant="primary" asChild>
              <Link href="/admin/programs/from-pdf">
                <FileUp className="size-icon-md" aria-hidden />
                Submit curriculum file
              </Link>
            </Button>
          </EdgeGlow>
        }
```

Remove the now-unused `Plus` import.

- [ ] **Step 2: Remove the toolbar button, keep the count**

In `list-client.tsx`, the non-selected toolbar branch (~line 413-428) contains the `showing N of M programs` count **and** the "Add new program" button. **The count must survive.** Reduce the fragment to just the count span.

Point the empty-state action (~line 431-443) at `/admin/programs/from-pdf` rather than deleting it — an empty filtered list is a reasonable place to offer submission. Update its label to "Submit curriculum file".

Remove the `FilePlus2` import if it becomes unused; keep it if the empty state still uses it.

- [ ] **Step 3: Delete the page**

```bash
git rm apps/web/app/admin/programs/new/page.tsx apps/web/app/admin/programs/new/client.tsx
```

- [ ] **Step 4: Fix the test that reads the deleted file**

`apps/web/test/pdf-upload-response-shape.test.ts` `readFileSync`s `apps/web/app/admin/programs/new/client.tsx` in its `files` array. Deleting the page makes it throw ENOENT. Remove that one entry; keep the other two.

- [ ] **Step 5: Confirm nothing else links to it**

Run: `grep -rn "admin/programs/new" apps/ docs/ --include=*.tsx --include=*.ts --include=*.md | grep -v node_modules`
Expected: only documentation/plan references, no live links. Report anything else you find. `apps/api/src/departments/departments.controller.ts` has a comment naming both routes — update it.

- [ ] **Step 6: Verify**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run test/pdf-upload-response-shape.test.ts && npx eslint 'app/admin/programs/page.tsx' 'app/admin/programs/list-client.tsx'`
Expected: clean, tests pass.

Then load `/admin/programs` and confirm exactly **one** create button and that the `showing N of M programs` count still renders. Load `/admin/programs/new` and confirm 404.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/admin/programs/page.tsx apps/web/app/admin/programs/list-client.tsx apps/web/test/pdf-upload-response-shape.test.ts apps/api/src/departments/departments.controller.ts
git commit -m "refactor(web): one submission entry point, not three create buttons"
```

---

### Task 7: The Group 1 console tile

**Files:**
- Modify: `apps/web/app/admin/page.tsx`

Group 1's caption states *"one tile, one destination"*, and a code comment above the tile array says the list page "owns the 'Add new program' affordance … instead of a separate tile" — a decision this task reverses. **Update that comment** or the next reader will re-collapse it.

- [ ] **Step 1: Add the tile**

In the `programs: ConsoleTile[]` array, after the existing "Program list" tile. The shape is `{ href, label, description, icon }` required, `{ meta, badge, tone, roles }` optional:

```tsx
    {
      href: '/admin/programs/from-pdf',
      label: 'Submit curriculum file',
      description:
        'Upload a มคอ.2 — either to register a new programme, or to attach a revised curriculum to an existing one. Runs the full analysis pipeline on submit.',
      icon: <FileUp className="size-icon-xl" />,
      badge: dataStats
        ? { label: `${dataStats.programs.missingCurriculumPdf} missing`, tone: 'warning' as const }
        : undefined,
    },
```

`dataStats.programs.missingCurriculumPdf` is **already fetched on this page** — no new round-trip. Keep the badge label short; the tile's own comment records that badge and hover-arrow used to collide.

Import `FileUp` from `lucide-react` if not already imported, and check which icon the existing tiles use so the visual weight matches.

- [ ] **Step 2: Fix the stale programme count**

The copy says **297 programmes** in the "Program list" tile description; the real count is **301**. Fix it here and in `apps/web/app/admin/programs/page.tsx`'s subtitle. Prefer wording that will not go stale again — the tile already carries a live `badge` with the real total, so the description does not need a number at all.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx tsc --noEmit && npx eslint 'app/admin/page.tsx'`
Expected: clean.

Load `/admin` and confirm Group 1 shows two tiles, the badge reads the missing-curriculum count, and the new tile navigates to the submission page.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/admin/page.tsx apps/web/app/admin/programs/page.tsx
git commit -m "feat(web): add the submission tile to the admin console"
```

---

### Task 8: End-to-end verification

**Files:** none — operational.

- [ ] **Step 1: Everything builds and passes**

```bash
cd /home/denpong/projects/program-landscape
for p in packages/shared packages/db apps/api apps/web apps/ingestion; do
  (cd $p && npx tsc --noEmit >/dev/null 2>&1 && echo "  OK  $p" || echo "  FAIL $p")
done
(cd packages/db && npx vitest run 2>&1 | tail -3)
(cd apps/web && npx vitest run --passWithNoTests --exclude 'e2e/**' 2>&1 | tail -3)
```

Note the `--exclude 'e2e/**'` — a bare `vitest run` in `apps/web` sweeps up Playwright specs that fail with "Playwright Test did not expect test.describe() to be called here". That is the package's own script, not a defect.

- [ ] **Step 2: New-programme mode, end to end**

Create a programme through the submission page with a real PDF. Confirm: the programme exists, the PDF is `CURRENT_CURRICULUM`, a revision was opened, **the pipeline fired**, and its detail page shows the *first-analysis* banner wording — not the "revised file was attached" wording.

- [ ] **Step 3: Revision mode, end to end**

Attach a revised file to an existing programme. Confirm: prior document demoted to `PREVIOUS_CURRICULUM`, exactly one new DRAFT revision, the year you entered on both the document and the revision, the pipeline fired, and the banner clears once it completes.

- [ ] **Step 4: The removals hold**

`/admin/programs` shows one create button; the count renders; `/admin/programs/new` 404s; `/admin` Group 1 shows two tiles.

- [ ] **Step 5: Clean up**

Delete every programme, document, revision and PDF you created. Snapshot counts before you begin and prove restoration:

```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  console.log({ programs: await prisma.program.count(), revisions: await prisma.programRevision.count(), pdfs: await prisma.pdfDocument.count() });
  await prisma.\$disconnect();
})();
"
```

Be aware: uploading a PDF that content-hash-matches an existing one does **not** create a new row — it deduplicates onto the existing `PdfDocument` and rewrites that row's `originalFilename` to your upload's name. A previous task on this branch hit exactly this and had to restore a shared PDF's filename. Use a distinctive file, and check whether you deduped before assuming you created anything.

No commit — verification of work already committed.

---

## Self-Review

**Spec coverage:** mode step → Task 4; revision attach + pipeline → Task 5; the four defects → Tasks 1 (level), 2 (pipeline), 3 (first-analysis banner), 6 Step 4 (the test); removals → Task 6; Group 1 tile → Task 7; the 297→301 fix → Task 7 Step 2; verification → Task 8. Every spec non-goal is respected: no metadata diff, no draft deep-dive, no `programId @unique` migrations, no change to `checkCollision`, no resume-after-refresh.

**Placeholder scan:** no TBD/TODO. Every code step carries complete code or an exact before/after. Where a symbol could differ from my reading (`PdfExtractionLite`'s real name, `Card`/`Button`/`Input` props, the level label wording, which icon the tiles use), the step says to confirm against source rather than assume — three separate prop mismatches have already been found this way on this branch.

**Type consistency:** `TargetProgram` is defined in Task 4 and consumed by `ModeStep` and `ReviseStep` (Task 5) with the same four fields. `firePipeline(programId)` is introduced in Task 2 inside `FillStep` and explicitly lifted to module scope in Task 5 so both callers share it — flagged rather than left to drift. `isFirstAnalysis` is added to `ProgramStaleness` in Task 3 Step 3, mirrored into the web type in Step 5, and read by both banners.

**Ordering:** Tasks 1–3 are independent and shippable alone. Task 6 deletes the old page only after 4–5 replace it. Task 3 must precede Task 8 Step 2, which asserts the new banner wording.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-03-curriculum-submission-entry-point.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
