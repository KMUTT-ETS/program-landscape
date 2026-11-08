# Before the day

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/workshop/00-before-the-day.md)

Do this at home. Start after the [early notice](./early-notice.md) and finish by
the **readiness form deadline, 19 November, 18:00**. The pre-workshop online on
16 November walks through this page. It downloads several gigabytes, and the
room network may be slow. It takes one to two hours, mostly waiting, plus about
30 minutes for the rehearsal. Bring the laptop with the app already set up and
the rehearsal done.

**Outcome.** You arrive with a laptop that runs the app, a working AI key and an AI coding assistant, so the day starts with the work, not with installs.

## Your laptop

- At least 16 GB of memory and 25 GB of free disk.
- Windows 10 or 11, macOS, or Linux. On Windows you work inside WSL2.
- Rights to install software on it. University-managed laptops sometimes block
  WSL2 or Docker: check with your IT desk early.

## Install the tools

- **Windows:** follow [Windows setup with WSL2](../guides/windows-wsl2.md). It
  installs WSL2, Docker, Git and Node.js.
- **macOS or Linux:** install Git, Docker with Compose v2, and Node.js 24 (24.22.1 or later), as
  listed in [Getting started, step 1](../tutorials/getting-started.md#1-check-what-you-need).

## Get the code and run setup once

Follow [Getting started](../tutorials/getting-started.md) steps 2, 3 and 4:
clone the repository, create `.env`, and run the one-time setup. The setup downloads every package and
builds every Docker image, which is the part you do not want to do on the
workshop network.

## Get an AI key and check it works

You need a key for the pipeline in session 3. How to get one is in
[Getting started, step 1](../tutorials/getting-started.md#1-check-what-you-need).
A Google Gemini key is the simplest choice: it also covers embeddings. With an
OpenRouter key only, set `AI_OPENROUTER_EMBEDDING_MODEL` as that page explains.

Check each key with one request. Put your key in place of the angle brackets.
Start the line with a space so most shells leave it out of your history.

```bash
 curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=<your-gemini-key>" | head -c 300
```

You should see the start of a list of models. An answer containing
`API_KEY_INVALID` means the key is wrong.

If you also use OpenRouter:

```bash
 curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer <your-openrouter-key>"
```

You should see your key's limit and usage. Make sure it has credit left.

## Install an AI coding assistant

Sessions 2, 4 and 5 use an AI coding assistant that can read the repository.
Bring the one you already use: Claude Code, GitHub Copilot, Cursor, or any
other. The prompts in these pages are plain text and work in any of them.

If you have none, install **opencode**, which is free. On Windows, install it
inside Ubuntu (WSL2).

```bash
curl -fsSL https://opencode.ai/install | bash
opencode auth login
```

Sign in when asked. Then start `opencode` in the project folder, type
`/models`, and pick a model whose name ends in `free`. The free models change
often, so choose from the list you see on the day rather than a name from this
page. You can also connect your Gemini or OpenRouter key to opencode instead.

## Rehearse once with the sample university

Run the **Sample track** of [Session 3](./03-university-data.md#sample-track) from
start to end on your own laptop: start the app, claim the administrator, upload
the 13 sample files, run `un-wpp`, attach the curriculum PDF, and run the
pipeline for `WDU-CPE-BE`. It takes about 30 minutes, mostly the pipeline, and
costs about USD 0.40 to 0.80 on your key.

You are done when `/programs/<id>` for `WDU-CPE-BE` shows content in its
Executive snapshot. This proves your key, Docker and the pipeline all work.

- **Keep this database.** On Day 1 you sign in with the administrator you
  created here; you do not claim it again. The sample university stays
  alongside your own data, which you load on Day 1.
- **If the pipeline fails twice, or the key runs out of credit,** stop. Do not
  keep retrying and spending: report it on the readiness form.
- `un-wpp` is now in your database, so you will not download it again in the
  room.

## Prepare your programme's data

Choose your data path (A real, B mixed, C mock) as described in the
[early notice](./early-notice.md#pick-your-data-path).

For the files you can get from your university (paths A and B):

1. Export the datasets listed in
   [Get Program Deep-Dive working, step 2](../tutorials/program-deep-dive.md#step-2-upload-the-organisation-and-the-programmes),
   at least faculties, departments, programmes, staff, programme teaching staff,
   enrolment, finance and graduate outcomes.
2. Fill them into the templates. The columns of each dataset are in
   [Importing from spreadsheets](../data-import.md). The sample files in
   `workshop/sample-data/` show a filled example of each.
3. **Remove personal data before the files leave your office.** No national ID
   numbers, no birth dates, no addresses or phone numbers. The importer refuses
   a file that contains something that looks like a national ID, but do not rely
   on it.
4. Bring the curriculum PDF of one programme.
5. Know your university's exact Thai name as it is written in the TCAS
   admission tables.

For the datasets you could not get (path B), or for all of them (path C),
generate them with `pnpm workshop:mock` as described in
[Session 3](./03-university-data.md#no-exports-generate-a-mock-set-for-your-university),
then run `pnpm workshop:check-mock` until it reports no errors.

Check the curriculum PDF of your programme:

```bash
pnpm curriculum:check "<file.pdf>"
```

Do not upload your own data yet. That is Day 1, in Session 3.

## Send the readiness form

In the project folder:

```bash
pnpm adopter:fresh-check
docker compose images
```

You should see "Fresh-install check passed." and a list that includes the
`postgres`, `redis`, `minio` and `gotenberg` images. If either fails, look it
up in [Troubleshooting](./troubleshooting.md), or ask the facilitator before the
day.

The instructor shares the readiness form link at the pre-workshop. It asks for:

- your operating system;
- whether `pnpm adopter:fresh-check` passed;
- whether the sample Deep-Dive of `WDU-CPE-BE` shows content;
- your AI provider (Gemini or OpenRouter) and your coding assistant;
- your data path: A, B or C;
- for each dataset, whether it is real or mock;
- the programme you chose, and whether its PDF passed `curriculum:check`;
- anything still blocking you.

Send it by **19 November, 18:00**. Never paste keys, the environment file or personal data into the form.

## Next step

Continue with [Session 1: environment and AI tools](./01-environment-and-ai-tools.md) on the day.
