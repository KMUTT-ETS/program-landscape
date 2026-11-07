# Workshop mock-data generator

Writes 20 mock import spreadsheets (and a `README.txt` of next steps) for your
university, so you can try the Program Landscape import without real data.
The figures are invented, but they agree with the public TCAS round-3 numbers
of your own programmes. It needs only Node and pnpm.

## Run

From the repository root:

    pnpm workshop:mock my-input.json

Flags:

- `--size small|medium` (default `small`): how many faculties and programmes.
- `--seed N` (default 2026): the same input and seed give byte-identical files.
- `--out DIR` (default `./workshop-mock-out`): where the files go. The folder gets a
  `.gitignore` containing `*`, so it is never committed.
- `--cache DIR` (default `<out>/.cache`): where TCAS files are kept.
- `--offline`: never download; use the cache only.
- `--tcas-file PATH:YEAR:ROUND` (repeatable): use a TCAS file you downloaded, for
  example `--tcas-file tcas67.xlsx:2567:3` (year is Buddhist era; rounds are `3`, or
  `3.1` / `3.2` for 2568). The file is copied into the cache, so later runs can use
  `--offline`.

Relative paths you type (the input file, `--out`, `--cache`, `--tcas-file`) resolve
against the folder you ran pnpm from.

On start the program prints which TCAS row each of your programmes was matched to, and
every note (English names it had to invent, how courses were read). Read them.

Exit code 0 is success, 2 is an input problem (a message, no stack trace). Before any file
is written, every sheet is checked with the app's own importer validator; if one would be
refused, nothing is written. Then open `README.txt` in the output folder.

To prove the files with the app's importer and the `tcas` connector's matcher:

    pnpm workshop:check-mock <out> my-input.json

## Input file

`example-input.json` in this folder is a starting point. JSON has no comments, so every
field is explained here.

- `university` (required): the Thai name exactly as the TCAS files spell it.
- `region` (required): an English region as used by the platform's demographics, for
  example `Central`.
- `programmes` (required): one entry per curriculum PDF.
  - `name` (required): the programme name as written in the PDF (a small spelling
    difference is fine).
  - `pdf`: path to the curriculum PDF. Relative paths resolve against the JSON file's folder.
  - `level`: `BACHELOR` (default), `MASTER`, `DOCTORAL` or `HIGHER_GRAD_DIPLOMA`. Anything
    other than `BACHELOR` also needs `faculty`.
  - `faculty`: the faculty's Thai name. Optional for bachelor programmes.
  - `tcas_code`: a TCAS course code. Use it when the name cannot be matched
    automatically; it always wins over name matching.
  - `name_en`: the English name, used as-is in the mock files. Without it the generator
    translates common Thai words and otherwise writes a neutral placeholder.
  - `courses`: path to a CSV file (header `code,name_th,name_en,credits,category`) to use
    instead of the PDF's courses.

## If something fails

- `University '...' is not in the TCAS files`: copy the Thai name from one of the
  closest names it lists.
- `Cannot match programme`: add `"tcas_code": "<course code>"` to that entry, using a
  code from the candidate list.
- `tcas_code ... is not in the latest TCAS year`: course codes change every year; use the
  code it suggests.
- `No TCAS data` with `--offline`: run once without `--offline`, or pass `--tcas-file`.
- `Cannot download`: download the files from mytcas.com yourself and pass `--tcas-file`.
- `no course codes found in ...pdf`: the PDF is a scan or has no course table. An invented
  course list is used. Give a `courses` CSV to use your own.

## Tests

    pnpm --filter ingestion exec vitest run test/workshop-mock
    pnpm --filter api exec vitest run test/workshop-mock.test.ts
