# Getting started: from a fresh clone to a running app

**Outcome.** You have Program Landscape running on your laptop, you have claimed
the first administrator account, and you are signed in.

**Time.** About 30 to 60 minutes the first time. Most of it is downloads.

## 1. Check what you need

You need all of these before you start.

1. Git.
2. Docker Engine with Compose v2. Check with `docker compose version`.
3. Node.js 20. Run `nvm use` in the project folder to pick it up.
4. pnpm 10. Run `corepack enable` and the project picks its pinned version.
5. An AI key. A Google Gemini key or an OpenRouter key both work. Without a key
   the app starts, but the AI steps later in the workshop cannot run.
6. These ports free: 3000, 4000, 5432, 6379, 9000, 9001, 3001.

## 2. Get the code

1. Clone the repository and open the folder.

```bash
git clone <repository-url> program-landscape
cd program-landscape
```

You should see the project files, including `package.json` and `.env.example`.

## 3. Create the environment file

1. Copy the example file.

```bash
cp .env.example .env
```

2. Open `.env` in an editor and set these keys. Leave the rest as they are.

| Key | What to set |
|---|---|
| `AI_PROVIDER` | `google` for a Gemini key, or `openrouter` for an OpenRouter key. The example value `stub` runs no real AI. |
| `GOOGLE_AI_API_KEY` | Your Gemini key, if you chose `google`. |
| `OPENROUTER_API_KEY` | Your OpenRouter key, if you chose `openrouter`. |
| `NEXTAUTH_SECRET` | A long random string. |
| `ENABLE_LOCAL_AUTH` | Keep `true` on a laptop. It lets you sign in with the password you create later. |

You should now have a `.env` file that is not tracked by git. Never commit it.

## 4. Run the one-time setup

1. Run the setup script.

```bash
pnpm setup
```

You should see it install packages, start the Docker containers, apply the
database migrations, register every data source (all switched off) and load the
generic reference data. It ends without errors.

2. Check that nothing of another university is in your database.

```bash
pnpm adopter:fresh-check
```

You should see "Fresh-install check passed."

## 5. Start the app

1. Start the web app, the API and the ingestion worker together.

```bash
pnpm dev
```

2. Leave it running. Open a second terminal for any other command.

## 6. Check that it is healthy

Open these addresses in your browser.

| Address | You should see |
|---|---|
| `http://localhost:3000` | The app. On a fresh install it sends you to the setup page. |
| `http://localhost:4000/api/v1/healthz` | A short "ok" answer from the API. |
| `http://localhost:4000/api/v1/ready` | One line per dependency: database, Redis, object storage, PDF service. |

If a line in the last page is not healthy, run `docker compose ps` and wait for
every container to say healthy.

## 7. Claim the first administrator

**Do this straight away.** The setup page is open to anyone who can reach the
address, and the first person to use it becomes the administrator. It closes
for good once it has been used.

1. Open `http://localhost:3000`. You land on `/setup`.
2. Fill in "Your name", "Email", "Password" and "Confirm password". The password
   needs at least 12 characters. Write it down, because there is no reset.
3. Click "Create administrator".

You should be signed in and see the app home page. If you land on "Sign in"
instead, sign in with the email and password you just created. With local
sign-in enabled, the button reads "Sign in with developer credentials".

## 8. What you should see

Every page is empty. That is correct. A fresh install holds no faculties,
programmes, students or staff. You load them next.

## Next step

Continue with [Get Program Deep-Dive working](./program-deep-dive.md). The
facilitator page for a workshop is [Workshop guide](./workshop.md).

## If something goes wrong

| What you see | What to do |
|---|---|
| "Environment variable not found: DATABASE_URL" | Run `pnpm link-env`, then run the failed command again. |
| "Cannot connect to the Docker daemon" | Start Docker, then run `pnpm setup` again. |
| "port is already allocated" | Stop the program that uses the port, then start again. |
| Sign-in goes round in a circle | Run `pnpm link-env` and restart `pnpm dev`. |
| The api or ingestion stops at start with a missing key message | Set `AI_PROVIDER=stub` or add the key for your provider, then restart `pnpm dev`. |
| Node or install errors | Run `nvm use`, then `pnpm setup` again. |
