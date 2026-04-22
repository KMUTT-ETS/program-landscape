# RBAC — role × permission matrix

Authoritative source: `packages/shared/src/auth/permissions.ts`. This doc
mirrors that file — if they disagree, the code wins. Unit tests in
`packages/shared/test/can.test.ts` verify the matrix against the catalog.

## Permission scope suffix semantics

| Suffix | Meaning |
|---|---|
| `:all` | Across every faculty / department / program |
| `:own_faculty` | User's own faculty (and its departments / programs) |
| `:own_department` | User's own department (and its programs) |
| `:aggregated_only` | Rolled-up numbers only; no per-individual drill-in |

The `can()` function treats the suffix as authoritative. `:all` ignores
the `scopeContext` argument; `:own_*` requires both a matching user-side
org id **and** a `scopeContext` argument pointing at an org inside that
org (or narrower; the AccessControlGuard in `apps/api` handles drill-through
resolution).

## Role × permission matrix

`✓` = granted; blank = not granted.

| Permission | VIEWER | COUNCIL | EXECUTIVE | DEAN | DEPT_HEAD | ANALYST | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `faculties:read:all`            | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `departments:read:all`          | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `programs:read:all`             | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `programs:read:own_faculty`     |   |   |   | ✓ |   |   | ✓ |
| `programs:read:own_department`  |   |   |   |   | ✓ |   | ✓ |
| `financials:read:all`           |   | ✓ | ✓ |   |   | ✓ | ✓ |
| `financials:read:own_faculty`   |   |   |   | ✓ |   |   | ✓ |
| `financials:read:own_department`|   |   |   |   | ✓ |   | ✓ |
| `financials:read:aggregated_only` | ✓ | ✓ | ✓ | ✓ | ✓ |   | ✓ |
| `faculty_members:read:all`      |   |   |   |   |   | ✓ | ✓ |
| `faculty_members:read:own_faculty` |   |   |   | ✓ |   |   | ✓ |
| `faculty_members:read:own_department` |   |   |   |   | ✓ |   | ✓ |
| `outcomes:read:all`             | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `outcomes:read:own_faculty`     |   |   |   | ✓ |   |   | ✓ |
| `outcomes:read:own_department`  |   |   |   |   | ✓ |   | ✓ |
| `scenarios:read:all`            |   | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scenarios:create:any`          |   |   | ✓ |   |   | ✓ | ✓ |
| `scenarios:create:own_faculty`  |   |   |   | ✓ |   |   | ✓ |
| `scenarios:edit:any`            |   |   | ✓ |   |   | ✓ | ✓ |
| `decisions:read:all`            |   | ✓ | ✓ | ✓ |   | ✓ | ✓ |
| `decisions:approve`             |   |   |   |   |   |   | ✓ |
| `decisions:edit`                |   |   | ✓ |   |   |   | ✓ |
| `pdf:upload`                    |   |   |   | ✓ | ✓ | ✓ | ✓ |
| `pdf:approve_extraction`        |   |   |   |   |   | ✓ | ✓ |
| `ingestion:configure`           |   |   |   |   |   | ✓ | ✓ |
| `ingestion:trigger`             |   |   |   |   |   | ✓ | ✓ |
| `users:manage`                  |   |   |   |   |   |   | ✓ |
| `kku_sso_mapping:manage`        |   |   |   |   |   |   | ✓ |
| `data_sources:read`             |   |   |   |   |   | ✓ | ✓ |
| `data_sources:configure`        |   |   |   |   |   |   | ✓ |

## Why some of these rules are the way they are

- **COUNCIL can see detailed financials but cannot see per-faculty-member
  salaries.** The Council needs program-level cost defensibility; it does
  not need individual HR detail. `faculty_members:read:all` is deliberately
  withheld.
- **DEAN gets full financials only for their own faculty** + aggregated-only
  for other faculties. This preserves inter-faculty confidentiality while
  letting deans run their own numbers.
- **DEPT_HEAD gets a narrower version of DEAN** — full data inside their
  department, aggregated for the rest of their faculty, and nothing for
  other faculties beyond the shared university-level rollups.
- **ANALYST has broad read but narrow write** — they can create scenarios
  and configure ingestion, but they cannot approve a Council decision.
- **EXECUTIVE = COUNCIL + editing.** They're the ones who turn Council
  direction into scenarios and decisions.
- **Decisions:approve is ADMIN only** in this matrix. In practice the
  Council's approval is recorded by an ADMIN on their behalf — we may
  expand this later with a `COUNCIL_APPROVE` permission once the workflow
  is real (prompt 12).

## Using `can()`

```ts
import { can, type SessionUser } from '@kku/shared';

if (can(user, 'programs:read:all')) {
  // ...
}

if (
  can(user, 'financials:read:own_faculty', {
    level: 'faculty',
    id: targetFacultyId,
  })
) {
  // ...
}
```

In NestJS handlers, prefer the decorators:

```ts
@Get()
@Authorized('financials:read:own_faculty')   // implies @RequireScope()
async list(@AuthSession() user: SessionUser, @Query() q: Q) { ... }
```

## Changing the matrix

1. Edit `packages/shared/src/auth/permissions.ts` — add the permission
   string to `PERMISSIONS` and to any role's list.
2. Update this document.
3. Extend `packages/shared/test/can.test.ts` if the rule has novel
   semantics.
4. If the permission is needed by an existing endpoint, switch the
   decorator.
