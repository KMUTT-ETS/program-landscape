# Workshop mock-data generator

Writes 20 mock import spreadsheets (and a `README.txt` of next steps) for your
university, so you can try the Program Landscape import without real data.
The figures are invented, but they agree with the public TCAS round-3 numbers
of your own programmes. Requires Python 3.11 or newer.

## Install

Run these from the repository root. Use a virtual environment.

macOS / Linux / WSL:

    python3 -m venv .venv
    .venv/bin/pip install -r scripts/workshop-mock/requirements.txt

Windows:

    py -m venv .venv
    .venv\Scripts\pip install -r scripts\workshop-mock\requirements.txt

## Input file

Copy `example-input.toml`, then set `university` (the Thai name exactly as TCAS
spells it), `region`, and one `[[programme]]` block per curriculum PDF. See the
comments in that file for every field.

## Run

macOS / Linux / WSL:

    .venv/bin/python scripts/workshop-mock/generate.py my-input.toml

Windows:

    .venv\Scripts\python scripts\workshop-mock\generate.py my-input.toml

Flags:

- `--size small|medium` (default `small`): how many faculties and programmes.
- `--seed N` (default 2026): the same seed gives the same files.
- `--out DIR` (default `./workshop-mock-out`): where the files go. The folder gets a
  `.gitignore` containing `*`, so it is never committed.
- `--cache DIR` (default `<out>/.cache`): where TCAS files are kept.
- `--offline`: never download; use the cache only.
- `--tcas-file PATH:YEAR:ROUND` (repeatable): use a TCAS file you downloaded,
  for example `--tcas-file tcas67.xlsx:2567:3` (year is Buddhist era; rounds are
  `3`, or `3.1` / `3.2` for 2568). The file is copied into the cache, so later
  runs can use `--offline`.

On start the program prints which TCAS row each of your programmes was matched
to, and every note (English names it had to invent, how courses were read).
Read them. A wrong match is easy to fix.

Exit code 0 is success, 2 is an input problem. Then open `README.txt` in the
output folder.

## If something fails

- `University '...' is not in the TCAS files`: copy the Thai name from one of the
  closest names it lists.
- `Cannot match programme`: add `tcas_code = "<course code>"` to that block, using a
  code from the candidate list.
- `tcas_code ... is not in the latest TCAS year`: course codes change every year; use the
  code it suggests.
- `No TCAS data` with `--offline`: run once without `--offline`, or pass `--tcas-file`.
- `Cannot download`: download the files from mytcas.com yourself and pass `--tcas-file`.
- `no course codes found in ...pdf`: the PDF is a scan or has no course table. An invented
  course list is used. Give a `courses = "list.csv"` file (columns `code,name_th,name_en,credits,category`) to
  use your own.

## Tests

    .venv/bin/python -m unittest discover -s scripts/workshop-mock/tests -v

(run from `scripts/workshop-mock`, or `cd` there first)
