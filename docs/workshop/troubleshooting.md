# Troubleshooting

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/workshop/troubleshooting.md)

Every failure the workshop pages mention, in one place. Find what you see in
the left column. If it is not here, show the full message to the facilitator.

## Setup

| What you see | Cause | Fix |
|---|---|---|
| "Cannot connect to the Docker daemon" | Docker is not running. | Start Docker, then run the command again. On WSL2: `sudo systemctl start docker`. |
| "permission denied while trying to connect to the Docker daemon socket" | Your user was added to the `docker` group but the terminal is older. | Close every Ubuntu window, run `wsl --shutdown` in PowerShell, open Ubuntu again. |
| "port is already allocated" | Another program uses one of the ports 3000, 4000, 5432, 6379, 9000, 9001, 3001. | Stop that program, then start again. |
| "Environment variable not found: DATABASE_URL" | The per-app links to `.env` are missing. | Run `pnpm link-env`, then the failed command again. |
| Sign-in goes round in a circle | The same. | Run `pnpm link-env` and restart `pnpm dev`. |
| Node or install errors | The wrong Node.js version. | Run `nvm use`, then `pnpm setup` again. |
| Installs and `pnpm dev` are very slow on Windows | The project is under `/mnt/c/`. | Clone it again under your Linux home folder. See [Windows setup with WSL2](../guides/windows-wsl2.md). |
| Every file shows as modified after cloning | Line endings were converted. | Run `git config --global core.autocrlf input` and clone again. |
| The laptop freezes while the app runs | Too little memory for WSL2 or for Windows. | Close other programs, or adjust `memory=` in `.wslconfig`. |

## Data upload

| What you see | Cause | Fix |
|---|---|---|
| "... is not a known programmes code. Upload that dataset first, or correct the value." | A file names a programme, faculty, department or employee that an earlier upload does not have. | Upload the files in their numbered order, or add the missing rows to the earlier sheet. |
| "This file has 12000 rows; the limit is 10000. Split it into smaller files." | One upload holds at most 10000 rows. | Split the file and upload each part. |
| "This file has N rows but M are already stored..." | Only class offerings and programme course lists ask this, when a file is much smaller than what is stored. | If the small file is right, confirm the upload. |
| A required column is missing | Required columns may not be left out. | Add the column. |
| "Unexpected column(s): ..." | Only the template's columns are allowed. | Delete the column. |
| "This cell looks like a personal identifier (national ID)." | A cell has the shape of a Thai national ID. | Remove it. Personal data does not belong in these files. |
| An upload succeeded but nothing shows | The data source rows are missing. | Run `pnpm data-sources:sync --apply` and upload again. |
| A Deep-Dive section stays empty although rows exist | The rows cannot be traced to an upload or a real connector run, so the app hides them. | The same: run `pnpm data-sources:sync --apply` and upload again. |

## Connectors and pipeline

| What you see | Cause | Fix |
|---|---|---|
| "OPENALEX_API_KEY is not set..." and the run is skipped | The free OpenAlex key is not in `.env`. | Add it, restart `pnpm dev`, run `openalex-works` again. Not needed with a mock set: its staff are tokens. |
| The TCAS run matches no programmes | The Thai name on `/admin/organization` does not match the TCAS spelling, or the programmes are not uploaded yet. | Correct the name, upload the programmes, run `tcas` again. |
| The pipeline fails at its first AI step | No AI key, or `AI_PROVIDER` is `stub`. | Set the key and `AI_PROVIDER` in `.env`, restart `pnpm dev`. |
| The pipeline stops with "402" | OpenRouter credit ran out. | Add credit, or switch to a Google key, and run the pipeline again. Finished phases are cheap to repeat. |
| The pipeline was cut off part way | The worker restarted while it ran, for example after a code change. | Run it again. |
| The course-list phase says the list comes from the upload | The programme has an uploaded course list, which always wins over the PDF. | Nothing. This is expected when you uploaded a course list, as a mock set does. |
| The pipeline cannot read the course list from your own PDF | The PDF layout is not recognised. | Check it with `pnpm curriculum:check "<file.pdf>"`, or upload the course list instead. |
| The skills do not appear after the pipeline | The skill names were not matched, or the AI provider was unreachable during phase 2. | Run the two commands below, then the pipeline again. |
| The overlap section shows shared course codes only, or the log shows "429" while embedding | A free Google key reached its daily embedding limit. | Use a paid key, or run the pipeline again the next day. |
| The demand match is skipped and labour-market alignment stays empty | The market's skill names are not in your taxonomy. | After `kmitl-skill-mapping`, run `pnpm skills:normalise --source=linkedin --auto-promote` once, then the pipeline again. |
| The JobThai driver shows "not applicable" | JobThai is a commercial feed. | Nothing. It is not a failure. |

The two commands for missing skills, with the programme's id from its admin
page:

```bash
pnpm skills:normalise --source=program_digest --auto-promote
pnpm programs:approve-pending --rematerialise --program-id=<id>
```

## AI keys and assistants

| What you see | Cause | Fix |
|---|---|---|
| The api or ingestion stops at start with a missing key message | `AI_PROVIDER` names a provider whose key is not set. | Add the key, or set `AI_PROVIDER=stub` for now, then restart `pnpm dev`. |
| The key check answers `API_KEY_INVALID` | The Gemini key is wrong or was copied with a space. | Copy it again from Google AI Studio. |
| The assistant answers from general knowledge, not the repository | It is not running in the project folder, or may not read files. | Start it from the project folder and allow it to read files. |
| opencode has no free model in `/models` | You are not signed in, or the free models changed. | Run `opencode auth login`, or connect your Gemini or OpenRouter key. |
