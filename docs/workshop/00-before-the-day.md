# Before the day

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [`00-before-the-day.th.md`](./00-before-the-day.th.md)

Do this at home, the week before the workshop. It downloads several gigabytes,
and the room network may be slow. It takes one to two hours, mostly waiting.
Bring the laptop with the app already set up and the ready check passing.

## Your laptop

- At least 16 GB of memory and 25 GB of free disk.
- Windows 10 or 11, macOS, or Linux. On Windows you work inside WSL2.
- Rights to install software on it. University-managed laptops sometimes block
  WSL2 or Docker: check with your IT desk early.

## Install the tools

- **Windows:** follow [Windows setup with WSL2](../guides/windows-wsl2.md). It
  installs WSL2, Docker, Git and Node.js.
- **macOS or Linux:** install Git, Docker with Compose v2, and Node.js 20, as
  listed in [Getting started, step 1](../tutorials/getting-started.md#1-check-what-you-need).

## Get the code and run setup once

Follow [Getting started](../tutorials/getting-started.md) steps 2, 3 and 4:
clone the repository, create `.env`, put the four TH Sarabun New font files in
place, and run the one-time setup. The setup downloads every package and
builds every Docker image, which is the part you do not want to do on the
workshop network.

You do not need to go further. Claiming the administrator happens in the room.

## Get an AI key and check it works

You need a key for the pipeline in session 3. How to get one is in
[Getting started, step 1](../tutorials/getting-started.md#1-check-what-you-need).
Get a **Google Gemini key** in any case, because the app always uses Google for
embeddings.

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

## Real-data track: prepare your files

Only if you want to load your own university's data after the sample track.

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

## Check you are ready

In the project folder:

```bash
pnpm adopter:fresh-check
docker compose images
```

You should see "Fresh-install check passed." and a list that includes the
`postgres`, `redis`, `minio` and `gotenberg` images. If either fails, look it
up in [Troubleshooting](./troubleshooting.md), or ask the facilitator before the
day.
