# Session 1: local environment and AI tools

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [`01-environment-and-ai-tools.th.md`](./01-environment-and-ai-tools.th.md)

**Time.** About 45 minutes.

## Goal

Confirm that every tool on your laptop answers, that your AI key works, and
that your AI coding assistant can read the repository. Nothing is built yet.
If you did the pre-work in [Before the day](./00-before-the-day.md), this
session is mostly checks.

## Check each tool

Open a terminal in the project folder (on Windows, the Ubuntu terminal) and
run:

```bash
git --version
docker compose version
node --version
pnpm --version
docker compose ps
```

You should see:

| Command | Expected |
|---|---|
| `git --version` | Any recent version |
| `docker compose version` | Version 2 or higher |
| `node --version` | `v24.22.1` or later |
| `pnpm --version` | Starts with `10` |
| `docker compose ps` | `postgres`, `redis`, `minio` and `gotenberg` running and healthy |

If the containers are not running, start them with `pnpm db:up` and wait until
`docker compose ps` shows them healthy.

## Check the AI key

Open `.env` and confirm `AI_PROVIDER` names your provider (`google` or
`openrouter`) and the matching key is set. `stub` runs the app with no real AI,
which is fine for today's sessions 1 and 2 but not for the pipeline in session
3. If you have not tested the key yet, run the check in
[Before the day](./00-before-the-day.md#get-an-ai-key-and-check-it-works).

## Check the AI assistant can read the repo

Start your AI coding assistant in the project folder and give it this prompt:

```text
You are in the Program Landscape repository. Without changing any file:
1. List the apps under apps/ and the packages under packages/, with one line on what each does.
2. Name the file that defines the API endpoints of the Program Deep-Dive page.
```

A good answer lists `web`, `api` and `ingestion` (plus the docs site), the
packages `db`, `shared`, `ui`, `design` and `pdf-templates`, and names
`apps/api/src/programs/deep-dive.controller.ts`. If the assistant cannot read
files, it is not running in the project folder, or it needs permission to read:
fix that before session 2.

## You are done when

- Every command in the table gives the expected answer.
- Your AI key passed its check.
- Your assistant named `deep-dive.controller.ts`.

## If something fails

| What you see | What to do |
|---|---|
| `command not found: pnpm` | Run `corepack enable`, then open a new terminal. |
| `node --version` shows another version | Run `nvm use` in the project folder. |
| A container is `unhealthy` or keeps restarting | Run `docker compose logs <name>` and show the facilitator. |
| The assistant answers from general knowledge, not the repository | Start it from the project folder, and allow it to read files. |
