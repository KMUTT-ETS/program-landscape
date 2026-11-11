# Workshop mock institution API

Plays your university's registrar system in workshop session 4. It serves the mock data you
generated with `pnpm workshop:mock`, in a shape that is not the import template.

```bash
pnpm workshop:mock-api <mock output folder> [--port 4010] [--token <t>]
```

It prints the base URL (`http://127.0.0.1:4010/api/v1`) and the bearer token (random unless you
pass `--token`). It binds to 127.0.0.1 only and needs no database.

Every request needs `Authorization: Bearer <token>`; otherwise 401 `{ "error": "unauthorized" }`.

| Route                                                           | Returns                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/v1/terms`                                             | `{ data: [{ year_be, semester }] }`                                             |
| `GET /api/v1/terms/:yearBe/:semester/sections?cursor=&limit=`   | class sections (nested `subject`, `hours`, `seats`)                             |
| `GET /api/v1/terms/:yearBe/:semester/enrolments?cursor=&limit=` | one record per student per section: `student_ref`, `subject_code`, `section_no` |
| `GET /api/v1/programmes/:code/intake`                           | per-year `applied`, `admitted`, `enrolled`, ...                                 |

Paged routes return `next_cursor` (an opaque string, `null` on the last page). `limit` defaults to
50, maximum 200; anything else is 400 `{ "error": "bad_request" }`.

**Years are Buddhist era (2568), not Common Era.** Convert them. Student references (`S-1`, ...)
are synthetic; the seats `enrolled` count is the number of enrolment records for that section.
