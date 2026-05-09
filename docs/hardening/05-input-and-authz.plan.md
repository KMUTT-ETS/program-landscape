# Plan — Prompt 05: Input validation, DTOs & authz fix-up

**Mode:** code changes. Targeted scope per prompt-04 violation list. Tests added per behavioural change.

## Order of work

1. **V1 (CRITICAL)** — `packages/shared/src/auth/can.ts`. Refuse unresolved dept/program scope on `:own_faculty`. Add `scopeContextMatchesProgram` for narrower roles. Tests under `packages/shared/test/can.test.ts` (extend or create).
2. **V9 (LOW)** — `apps/api/src/common/decorators.ts`: extend `Authorized()` to auto-attach `@RequireScope()` for `:own_program`.
3. **V8 (MEDIUM)** — Add `institution:read:university` permission. Grant to SUPER_ADMIN / SYSTEM_ADMIN / UNIVERSITY_USER. Re-gate the 19 education + staff-dashboard routes.
4. **V10 (LOW)** — Re-gate `/admin/system-status` to `institution:read:university`.
5. **V6 (MEDIUM)** — Re-gate decision/scenario transition routes:
   - `POST /scenarios/:id/council-review` → `scenarios:edit:any`
   - `POST /scenarios/:id/decide` → `decisions:approve`
   - `POST /decisions/:id/status` → `decisions:edit`
   - `POST /decisions/:id/amend` → `decisions:edit`
   - `POST /decisions/:id/milestones` (+ patch) → `decisions:edit`
   - `POST /decisions/:id/approvers` → `decisions:approve`
   - `POST /decisions/:id/outcome-review` → `decisions:edit`
6. **V3 (MEDIUM)** — `apps/api/src/app.controller.ts`: strip `detail` field when `NODE_ENV=production`.
7. **V7 (LOW)** — `apps/web/app/api/profile/avatar/[userId]/route.ts`: require `auth()` session.
8. **V2 (MEDIUM)** — Add `isAdminGrade` short-circuit to every `apps/web/app/api/admin-*/route.ts` (~13 files).
9. **V4 + V5 (HIGH)** — Add `canSeeAllPrograms()` + `assertProgramInScope()` helpers in `@kku/shared/auth`. Apply at the entry of every program-keyed module read (deep-dive, cockpit/heatmap by-program detail, gap by-program, risks by-program, benchmarking by-program). For V5, add scenarios + decisions visibility check.
10. **V11** — accept as-is (very low; Prisma will throw + global filter handles).
11. **Input validation pass** — confirm `ValidationPipe` config in `app.module.ts:158`. Grep `$queryRawUnsafe`. Verify Next handlers parse JSON via Zod. Audit avatar + PDF upload paths.
12. **Tests** — `pnpm test` across workspaces.
13. **Report** — `docs/hardening/05-input-and-authz.report.md`.

## Conservative principles

- Keep public APIs of `@kku/shared/auth` backward-compatible — add new exports, don't rename.
- Where a service-layer clamp is needed but the existing service file already returns university-wide data by design, add the clamp **only when it changes behaviour** for FACULTY_USER / PROGRAM_USER. Document any "explicitly accepted" route.
- Tests are unit-level (no DB) where possible; integration tests already exist for status transitions in `apps/api/test`.

## What I will NOT do

- Refactor the `programs:read:all` permission name (the V4 deeper fix). Service-layer clamps are sufficient + faster to ship safely. Rename is post-launch backlog.
- Introduce new modules.
- Change DB schema.
- Change the rendering of `/staff/research` (the H1 IP-disclosure from prompt 03 is a separate one-line UI tweak — out of scope here per prompt-03 routing).
