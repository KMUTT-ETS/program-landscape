# KICKOFF — Your Very First Claude Code Session

> **When to use:** The very first time you launch Claude Code in your empty repo. Before prompt 00.
>
> This pre-loads context, sets expectations, and verifies the environment is ready.

---

## Step 0: If you're on Windows — set up WSL2 first

**If your dev machine is Windows, read `WINDOWS-DEV.md` first and follow its setup.** In short:
- Install WSL2 with Ubuntu 24.04
- Install Docker Desktop with WSL2 integration
- Install Node.js 20, pnpm, git inside WSL2 (not on native Windows)
- Install Claude Code inside WSL2
- All the commands below run inside the WSL2 Ubuntu terminal

If you're on macOS or Linux, proceed directly.

## Step 1: Set up the empty repo

Two options:

**Option A — Create fresh, push to GitHub later:**

In your terminal (WSL2 terminal on Windows; regular terminal on macOS/Linux), before launching Claude Code:

```bash
# On WSL2: DO NOT use /mnt/c/ — use the native Linux filesystem for performance
# Good:  ~/projects/program-landscape
# Bad:   /mnt/c/Users/Denpong/projects/program-landscape

mkdir -p ~/projects/program-landscape
cd ~/projects/program-landscape
git init
git branch -M main
mkdir prompts
```

Later, once prompt 00 is complete:
```bash
git remote add origin git@github.com:khon-kaen-university/program-landscape.git
git push -u origin main
```

**Option B — Clone an empty GitHub repo first:**

If the GitHub repo has already been created at `https://github.com/khon-kaen-university/program-landscape`:

```bash
cd ~/projects
git clone git@github.com:khon-kaen-university/program-landscape.git
cd program-landscape
mkdir prompts
```

On macOS/Linux, any location works.

Copy all files from this delivery into `prompts/`:
- `README.md`
- `GLOBAL-UPDATES.md`
- `SKILLS.md`
- `CLAUDE.md.template`
- `00-bootstrap.md` through `13-hardening.md` (16 prompts)

Initial commit:
```bash
git add .
git commit -m "chore: bootstrap project with prompt set"
```

## Step 2: Launch Claude Code

```bash
claude
```

## Step 3: Paste this kickoff prompt as your very first message

---

```
Hello. I'm starting a long-running project called KKU Curriculum Landscape — a strategic decision-support web app for Khon Kaen University Council.

Before we do anything else, please:

1. Read these files in this order and confirm you understand each:
   - prompts/README.md (overview of the build plan)
   - prompts/GLOBAL-UPDATES.md (cross-cutting requirements that apply to every session)
   - prompts/SKILLS.md (which Claude skills to invoke per session)
   - prompts/CLAUDE.md.template (the template for the project's CLAUDE.md)

2. Then verify the environment:
   - Run `uname -a` and report the result (confirms you're on WSL2/Linux/macOS)
   - Confirm pnpm is installed (`pnpm --version`) — should be 9.x+
   - Confirm Docker and docker compose are installed (`docker --version` and `docker compose version` — note: space, not hyphen)
   - Confirm Node.js 20+ is installed (`node --version`)
   - Confirm git is initialized
   - If the repo path starts with `/mnt/c/`, warn me — we're on WSL2 but the repo should be in the Linux filesystem (`/home/...`) for performance
   - List anything missing

3. Then summarize back to me:
   - The project's purpose (one sentence)
   - The eight strategic questions (just titles)
   - The four scope levels and what they mean
   - The language strategy (UI vs analysis content)
   - The Council-readiness rules (the non-negotiables)
   - The skills you'll invoke when (per the table in SKILLS.md)

4. Do NOT start prompt 00 yet. Wait for me to confirm the summary, then I will paste prompt 00.

Important behavior for this entire project:
- At the start of every future session, read CLAUDE.md and GLOBAL-UPDATES.md first.
- Always invoke the Claude skill(s) listed at the top of each prompt.
- Make conservative choices — when in doubt, ask before acting.
- Never run `rm -rf` without confirmation.
- Commit at logical checkpoints with conventional commits.
- Update the "Current status" checklist in CLAUDE.md after each prompt is completed.
- If a prompt's deliverables aren't done at end of session, leave a note in CLAUDE.md "Recent decisions" explaining what's pending.

Acknowledge when ready.
```

---

## Step 4: After Claude responds

If Claude's summary is correct, paste prompt 00 (`prompts/00-bootstrap.md`) as your next message.

If anything is wrong (misread requirements, missing tools, wrong understanding), correct it before moving on. The cost of fixing misunderstandings now is tiny; the cost of fixing them after prompt 03 is enormous.

## Step 5: For every subsequent session

Open Claude Code in the project directory and start with:

```
New session. Please read CLAUDE.md and GLOBAL-UPDATES.md first.

Then check the "Current status" section to see where we are. Confirm what was done last and what's next.

I'm planning to run prompt [NN]. Skills to invoke: [from SKILLS.md].

Ready when you are.
```

This habit takes 30 seconds and prevents the most common failure mode in long Claude Code projects — Claude losing track of project conventions across sessions.
