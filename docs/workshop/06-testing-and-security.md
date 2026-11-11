# Session 6: testing, validation and security

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/workshop/06-testing-and-security.md)

**Time.** About 90 minutes.

**Outcome.** You run the tests that guard the calculations, see who is allowed to see what, and
watch the app keep personal data out. Every exercise uses the university you
loaded in session 3.

## Run the tests

The whole suite runs with `pnpm test`. It takes several minutes and some of
its tests read the local database, so start with the tests of the Program
Health Score, the score behind most of the Deep-Dive. They need nothing else:

```bash
pnpm --filter @kku/db exec vitest run test/health-score.test.ts
```

Open `packages/db/test/health-score.test.ts` and find a test about missing
data. The rule it checks: a missing figure is left out of an average, never
counted as 0 or 50, and the score reports how complete its data was. Ask your
assistant:

```text
In packages/db/test/health-score.test.ts, find the tests that check what happens
when a programme has no data for a driver. Explain the rule in two sentences and
point to the code in packages/db/src/health-score/ that applies it.
```

The method behind each score is written up in
[the health score methodology](../methodologies/health-score.md).

## Who can see what

Every signed-in user has one role:

| Role | Sees |
|---|---|
| Super admin | Everything, including administration and queues |
| System admin | Everything except queue management |
| University user | Every programme, read only |
| Faculty user | The programmes of one faculty |
| Program user | One programme |

Two checks run on every Deep-Dive request. `@Authorized` checks the role holds
the permission, and `assertProgramAccessible` checks the programme is inside
the user's scope. Staff names have one more rule: only administrators, faculty
users of the programme's own faculty and program users of that programme see
them. A University user can open every programme but never sees names. Everyone else sees the same section
with names, employee codes and specialisations removed. Details are in
[Roles and permissions](../auth/rbac.md).

### Try it

As the super administrator you can view the app as another role without
signing out.

1. Open your user menu at the top right and choose "Switch role".
You need two programmes: the one you ran the pipeline on in session 3 (call it
programme A) and any other programme you uploaded (programme B).

2. Pick "University user". Open the Deep-Dive of programme A and scroll to
   "Faculty capability". The staff are listed without names or codes.
3. Switch role again, pick "Program user", and scope it to programme B. Open
   the Deep-Dive of programme A again. It does not open: the page explains
   that this user has no access, because the programme is outside the scope.
4. Open the Deep-Dive of programme B. It opens, with names, because it is
   this user's own programme.
5. Click "Stop impersonating" in the banner at the top of the page.

## Personal data is kept out

The app works on aggregates. Personal data is stopped at several points:

- **Uploads accept only the template's columns.** An extra column is refused,
  so a column nobody described cannot slip in.
- **Uploads refuse anything that looks like a Thai national ID**, in any
  column, and the message never repeats the value.
- **Small groups are refused.** A headcount below 5, such as a graduate survey
  with 3 respondents, fails the file, because a group that small can identify
  people.
- **AI answers are scrubbed.** `sanitizeAiOutput` replaces citizen IDs, phone
  numbers and personal email addresses in model output with a visible
  `[REDACTED: ...]` marker.
- **Logs are redacted.** Request logs drop authorisation headers, cookies and
  export reasons.
- **Every change is recorded.** Each upload and setting change writes an audit
  row through `@AuditLog`.

How the app handles personal data under the PDPA is in [PDPA](../pdpa.md).

### Try it

1. Make a test number that has the shape of a Thai national ID. This generates
   a random one on your laptop; it belongs to nobody.

```bash
node -e "const d=Array.from({length:12},(_,i)=>i?Math.floor(Math.random()*10):1+Math.floor(Math.random()*8));const s=d.reduce((t,x,i)=>t+x*(13-i),0);console.log(d.join('')+(11-s%11)%10)"
```

2. Copy the Staff file you uploaded in session 3 (`07-faculty-members.xlsx`
   in a `workshop:mock` output folder), open the copy, and paste the number
   into the "Specialization" cell of any row.
3. Upload the copy on the Staff dataset page. It is refused: "This cell looks
   like a personal identifier (national ID)." The message names the row and
   column but not the number.
4. In a fresh copy, add a column headed "Citizen ID" with any text in it.
   Upload it. It is refused: "Unexpected column(s): Citizen ID."

Nothing is stored when a file is refused.

## You are done when

- The health score tests pass on your laptop.
- You have seen staff names hidden for a University user and the Deep-Dive
  refused for a Program user of another programme.
- Both refused uploads gave the messages above.

## Next step

Return to the [workshop overview](./README.md). To keep going after the workshop, pick your path in the [Adopter guide](../adopters/README.md#choose-your-path).
