# Workshop guide for facilitators

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [`workshop.th.md`](./workshop.th.md)

A half-day workshop in which each attendee brings their own university's files
and finishes with one programme's Deep-Dive showing real content.

## What attendees bring

1. A laptop with Docker, Node.js 20, pnpm 10 and Git installed.
2. An AI key: a Google Gemini key or an OpenRouter key.
3. Their exports, as spreadsheets: faculties, departments, programmes, staff,
   enrolment, finance and graduate outcomes. Course lists, evaluations and
   grants are a bonus.
4. The curriculum PDF of one programme.
5. Optional: a free OpenAlex key, and KMITL credentials.

## Send in advance

Ask every attendee to finish this list before the day.

1. Install Docker, Node.js 20 and pnpm 10, and check `docker compose version`.
2. Clone the repository and run `pnpm setup` once, so the large downloads are done.
3. Free the ports 3000, 4000, 5432, 6379, 9000, 9001 and 3001.
4. Get the AI key.
5. Collect the exports. Remove personal data first: no national ID numbers, no
   birth dates.
6. Know their university's exact Thai name as written in the TCAS sheets.

## Agenda (half day)

| Time | Part | Page |
|---|---|---|
| 0:00 | Welcome and the eight questions the app answers | |
| 0:15 | Fresh clone to running app, claim the administrator | [Getting started](./getting-started.md) |
| 0:45 | Organisation profile, then faculties, departments, programmes | [Get Program Deep-Dive working](./program-deep-dive.md) steps 1 and 2 |
| 1:30 | Break | |
| 1:45 | Staff, enrolment, finance, outcomes, course lists | step 2 |
| 2:30 | Public connectors and the curriculum PDF | steps 3 and 4 |
| 3:00 | Run the pipeline on one programme | step 5 |
| 3:20 | Setup checklist to green, then the Deep-Dive | steps 6 and 7 |
| 3:45 | Questions and next steps | |

Start the pipeline early in the last block. It takes the longest, and it is a
good time to talk.

## Facilitator tips

1. Tell everyone to claim the first administrator at once, before sharing the
   address with anyone.
2. Upload order matters. If a file is refused, read the message together. It
   names the rows.
3. The pipeline costs about USD 0.80 per programme. It was measured on one bachelor programme with a 126-course curriculum; longer curricula cost more. Tell attendees to run one.
4. Run `pnpm skills:normalise --source=linkedin --auto-promote` once, after the `kmitl-skill-mapping` run and before the pipeline. Start it early: it takes about an hour.
5. Embeddings need a Google key. A free key may stop after about 1,000 courses. Tell attendees with more courses to use a paid key or to re-run on later days.

## Common failures and fixes

| What attendees see | Cause | Fix |
|---|---|---|
| "... is not a known programmes code. Upload that dataset first, or correct the value." | A file names a programme, faculty, department or employee that an earlier upload does not have. Old exports often name retired programmes. | Add the missing rows to the earlier sheet, or delete those rows. |
| "This file has 8002 rows; the limit is 5000. Split it into smaller files." | One upload holds at most 5000 rows. | Split the file into parts and upload each one. Publications is the usual case. |
| "This file has N rows but M are already stored..." | Only class offerings and programme course lists ask for this, when a file is much smaller than what is stored. Other datasets never do, so split uploads of them go straight through. | If the small file is right, confirm the upload in the panel. |
| A required column is missing | Required columns may not be left out. | Add the column. Optional columns may be left out. |
| An unknown column is refused | Only the columns in the template are allowed. | Delete the column. |
| "OPENALEX_API_KEY is not set..." and the run is skipped | The free OpenAlex key is not in `.env`. | Add the key, restart `pnpm dev`, run `openalex-works` again. |
| The TCAS run matches no programmes | The "Thai name" on `/admin/organization` does not match the TCAS spelling, or the programmes are not uploaded yet. | Correct the name, upload the programmes, run `tcas` again. |
| Sign-in goes round in a circle | The per-app environment links are missing. | Run `pnpm link-env` and restart `pnpm dev`. |
| An upload succeeded but nothing shows | The data source rows are missing. | Run `pnpm data-sources:sync --apply` and upload again. |
| The pipeline fails at the first AI step | No AI key, or `AI_PROVIDER` is `stub`. | Set the key and `AI_PROVIDER` in `.env`, restart `pnpm dev`. |
| The demand match is skipped, and labour-market alignment stays empty | The market's skill names are not in your skill taxonomy yet. | After the `kmitl-skill-mapping` run, run `pnpm skills:normalise --source=linkedin --auto-promote` once (about an hour, roughly a dollar), then run the pipeline again. |
| The overlap section shows shared course codes only, or the log shows "429" while embedding | Embeddings always use Google. A free-tier key embeds about 1,000 course texts, then hits its daily limit. The step waits, retries, gives up, and resumes next run. | Use a paid Google key, or run the pipeline (or `pnpm programs:overlap-prep --apply`) again on later days. Then run `pnpm programs:overlap --apply`. |
| Phase 2 of the pipeline exits with code 1 | An older checkout. This is fixed. | Pull the latest code and run the pipeline again. |
| The pipeline was cut off part way | The worker restarted while it ran, for example after a code change in watch mode. | Run it again. Finished phases are cheap to repeat. |
| The JobThai driver shows "not applicable" | JobThai is a commercial feed. Installations without it show this. | Nothing. It is not a failure. |
| The pipeline cannot read the course list | The PDF layout is not recognised. | Check with `pnpm curriculum:check "<file.pdf>"`, or upload the course list instead. |
