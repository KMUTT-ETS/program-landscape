# Spreadsheet import — browser end-to-end check

Drives the import through a real browser against running dev servers. What it
proves is the part the unit and integration suites structurally cannot: that
the multipart POST reaches NestJS with the session cookie, that a validation
failure survives the exception filter into the panel as a readable table, and
that a refusal never puts a personal identifier on screen.

It found three defects the Vitest suites and a code review had all missed —
see the commit that introduced it.

## Running it

Needs Postgres up, and the API and web dev servers running. The ports below
avoid colliding with a dev stack already using 3000/4000:

```bash
PORT=4100 pnpm --filter api start:dev
API_URL=http://localhost:4100 NEXTAUTH_URL=http://localhost:3100 \
  pnpm --filter web exec next dev -p 3100
```

Then, from the repo root:

```bash
node scripts/e2e-import/make-fixtures.mjs   # writes fixtures/
node scripts/e2e-import/reset.mjs           # clears what a previous run left
node scripts/e2e-import/drive.mjs           # the browser run
```

`make-fixtures.mjs` needs `xlsx` and `drive.mjs` needs `playwright`; neither is
a root dependency, so run them from a workspace that has them (`apps/api` and
`apps/ingestion` respectively) or copy them there. A sign-in account is created
by `reset.mjs`'s sibling steps — the drive signs in as
`e2e-import@example.ac.th` using `DEV_AUTH_PASSWORD`, which it reads from the
local env file and never prints.

`reset.mjs` is not optional. The drive asserts on insert counts, so a second
run against data from the first would see legitimate de-duplication and read
as a failure.

## Two dev-server workarounds, and why they are not defects in the feature

- **`bypassCSP: true`.** The app sends a strict nonce-based CSP; under
  `next dev` the inline hydration bootstrap trips it and the page never becomes
  interactive.
- **A pause after every navigation.** The layout hydrates with a mismatch in
  dev, so React drops to client rendering and re-mounts the form — wiping
  anything typed before that settles, and leaving file inputs with no change
  handler attached.

Both are properties of the dev server, not of the import. Neither is needed
against a production build.

## Fixtures

`01`–`04` are valid and load in dependency order. The `bad-*` files each
violate exactly one rule — an unknown column, a national identifier, a blank
required cell, a reference to a faculty that does not exist, and two headers
differing only by a trailing space. `04-awkward-but-valid.xlsx` is the
Excel-ism case: blank rows between data, a zero-padded code and a numeric one.

Every identifier in them is synthetic.
