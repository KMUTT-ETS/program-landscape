# WINDOWS-DEV — Developing This Project on Windows

This project was specified for a Unix-like environment by default. Windows works, but needs specific setup. **Strongly recommended: develop inside WSL2**, not native Windows.

---

## TL;DR — Recommended setup

1. **Install WSL2** with Ubuntu 22.04 or 24.04
2. **Install Docker Desktop for Windows** with WSL2 backend enabled
3. **Install Node.js + pnpm + Git inside WSL2** (not on native Windows)
4. **Clone the repo inside the WSL2 filesystem** (e.g., `~/projects/program-landscape`, NOT `/mnt/c/...`)
5. **Open the project in VS Code with the "WSL" extension** — runs VS Code UI on Windows but all commands/terminals inside Linux
6. **Run Claude Code inside WSL2**

This gives you the Unix environment the prompts assume, with full Windows desktop integration. Nearly all "it works on Mac/Linux but not Windows" problems disappear.

## Why WSL2 instead of native Windows

- **Docker performance**: Docker Desktop on Windows uses WSL2 under the hood anyway. Files mounted from WSL2 are vastly faster than from `C:\`.
- **testcontainers**: our tests spin up real PostgreSQL in containers — WSL2 is the supported path
- **Case-sensitive filesystem**: Linux is case-sensitive; Windows by default is not. This causes subtle import bugs (`./Button` vs `./button`) that work in dev but break in CI
- **Line endings**: Git on Windows can convert LF→CRLF which breaks Docker builds, shell scripts, and Prisma migration checksums
- **Path length limits**: Windows has a 260-character path limit that trips up `node_modules` in monorepos
- **Symlinks**: pnpm uses symlinks extensively; these are first-class on Linux, permission-dependent on Windows
- **Prisma**: its query engine binary is platform-specific and auto-detects — WSL2 picks the Linux binary that matches the Docker containers, avoiding mismatches

## If you must use native Windows (not WSL2)

It's possible but you will hit rough edges. You'll need:

- Git Bash or PowerShell 7+ (avoid legacy cmd.exe)
- Docker Desktop with Hyper-V (if WSL2 is truly unavailable)
- A deep-enough folder (e.g., `C:\dev\kku\` not `C:\Users\YourName\Documents\Projects\KKU\...`) to avoid path-length issues
- Disable Git's autocrlf: `git config --global core.autocrlf input`
- Accept that some shell-based workflows (Bash scripts, fc-cache in Docker builds) will need explicit translation
- Claude Code may occasionally generate Unix paths — you'll need to correct them

You'll save many hours by just installing WSL2.

## One-time setup on WSL2

Open PowerShell as Administrator, then:

```powershell
# Install WSL2 with Ubuntu
wsl --install -d Ubuntu-24.04

# After reboot and Ubuntu's first-launch setup, open Ubuntu terminal
```

Inside the Ubuntu/WSL2 terminal:

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 24 via nvm (24.22.1+ — Node2Shell fix)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24
nvm alias default 24

# Install pnpm
npm install -g pnpm

# Install useful tools
sudo apt install -y build-essential git curl unzip

# Verify
node --version    # should show v24.22.1 or later
pnpm --version    # should show 9.x+
git --version
```

Install Docker Desktop for Windows separately. In Docker Desktop settings:
- Enable "Use the WSL 2 based engine"
- Under "Resources → WSL Integration", enable integration with your Ubuntu distro
- Verify inside WSL2: `docker --version` and `docker compose version`

Install VS Code on Windows (not WSL2) with the **Remote - WSL** extension. Then from WSL2 terminal: `code .` opens VS Code connected to Linux.

Install Claude Code inside WSL2 per Anthropic's instructions.

## Clone and work

```bash
# Inside WSL2, NOT in /mnt/c/
mkdir -p ~/projects
cd ~/projects

# Then follow KICKOFF.md from here
mkdir program-landscape
cd program-landscape
git init
mkdir prompts
# ... continue with KICKOFF.md
```

## Line-ending configuration (critical)

Before the first commit, create `.gitattributes` in the repo root:

```gitattributes
# Enforce LF on all text files regardless of OS
* text=auto eol=lf

# Specific files that MUST be LF for Docker/shell/Prisma to work
*.sh              text eol=lf
Dockerfile        text eol=lf
*.dockerfile      text eol=lf
*.prisma          text eol=lf
docker-compose*.yml text eol=lf
.env*             text eol=lf
Makefile          text eol=lf

# Binary files (don't touch)
*.ttf             binary
*.otf             binary
*.png             binary
*.jpg             binary
*.jpeg            binary
*.gif             binary
*.webp            binary
*.ico             binary
*.pdf             binary
*.zip             binary
*.gz              binary
```

This ensures Linux-style line endings across all OSes, which matters for Docker builds and Prisma migration checksums.

## Editor configuration

`.editorconfig` in repo root:

```editorconfig
root = true

[*]
end_of_line = lf
charset = utf-8
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
```

## Environment-specific notes

### WSL2

- Works as if on Linux — all commands in the prompts work as written
- Access Windows files under `/mnt/c/` (but don't put the project there — performance)
- Access WSL2 files from Windows via `\\wsl$\Ubuntu-24.04\home\yourname\projects\`

### Native Windows (PowerShell)

Replace these patterns in any KICKOFF/instruction:

| Linux/macOS | Windows PowerShell |
|---|---|
| `mkdir -p foo/bar` | `New-Item -ItemType Directory -Force -Path foo\bar` (or just `mkdir foo\bar`) |
| `cp a.txt b.txt` | `Copy-Item a.txt b.txt` |
| `rm -rf foo` | `Remove-Item -Recurse -Force foo` |
| `cat file.md` | `Get-Content file.md` |
| `export FOO=bar` | `$env:FOO = "bar"` |
| `$(pwd)` | `$PWD` |

Most `pnpm` and `docker` commands are identical.

### Native Windows (Git Bash)

Closer to Linux syntax. Most POSIX commands work. Key differences:
- Paths still use Windows drives (`/c/dev/...` mapped from `C:\dev\...`)
- Some tools (notably testcontainers) may have issues
- Docker volume mounts need `//c/dev/...` (double slash) in some contexts

## Docker on Windows

Always use Docker Desktop. Verify from WSL2:

```bash
docker run --rm hello-world
docker compose version   # note: space, not hyphen — modern compose is a docker plugin
```

Common Windows gotcha: Docker Desktop consumes a lot of RAM. In Docker Desktop Settings → Resources → Advanced, allocate at least 6 GB. `.wslconfig` in your Windows user folder can tune this:

```ini
[wsl2]
memory=10GB
processors=6
swap=2GB
```

## Prisma on Windows

In WSL2: works like Linux. Nothing special.

Native Windows: install Visual C++ Build Tools so Prisma's binary dependencies compile correctly. If you hit Prisma binary target errors, set in `schema.prisma`:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "windows", "linux-musl-openssl-3.0.x"]
}
```

The `linux-musl-*` target is what Docker containers need.

## Gotenberg on Windows

Gotenberg runs inside Docker Desktop — Windows-native vs WSL2 doesn't matter for Gotenberg itself. But the font files embedded into the Gotenberg image (TH Sarabun New `.ttf`) MUST be saved with LF line endings in any accompanying Dockerfile / shell script. The `.gitattributes` above handles this.

When committing the .ttf binary files, ensure they're marked as binary in `.gitattributes` (already done above). Otherwise Git may corrupt them on Windows checkout.

## Running the app

Identical inside WSL2 to Linux instructions. The prompts' `pnpm dev`, `pnpm test`, etc. all work unchanged.

## Common Windows failure modes and fixes

| Symptom | Fix |
|---|---|
| `bash: make: command not found` | We use `pnpm` scripts instead of Make (see `package.json`). Do not install Make on Windows. |
| Docker build fails on `fc-cache` or `COPY fonts/` | Likely CRLF in Dockerfile. Check `.gitattributes`, re-clone, or run `dos2unix` on the file |
| `Error: EACCES: permission denied, symlink` | You're outside WSL2. Move the project into `~/projects` inside WSL2 |
| `ENAMETOOLONG` during `pnpm install` | Path too deep. Move repo closer to drive root (`C:\dev\kku\`) |
| Prisma "binary target missing" | See Prisma section above — add `binaryTargets` |
| Tests timing out with testcontainers | Docker Desktop not running or WSL integration not enabled |
| Hot reload painfully slow | Project is on `/mnt/c/` instead of WSL2 native filesystem. Move it. |
| Git showing every file as modified after clone | Line endings got converted. Set `git config --global core.autocrlf input` and re-clone |
| Chrome not launching in Playwright | Run `pnpm exec playwright install --with-deps chromium` inside WSL2 |
| Thai characters broken in terminal output | Terminal encoding issue. Windows Terminal handles UTF-8 correctly; legacy cmd.exe does not. Use Windows Terminal. |

## Claude Code specific notes

When Claude Code runs inside WSL2, it sees a Linux environment and generates Linux-appropriate commands. This is what you want.

If Claude Code ever generates Windows-style paths (backslashes) or PowerShell commands when you're on WSL2, push back: "I'm on WSL2 — use Linux commands and forward-slash paths."

When asking Claude Code to create shell scripts, remind it: "Use LF line endings and bash syntax. This runs inside Docker containers that are Linux."

## Installing Claude Code on Windows

Anthropic's official install is the source of truth, but as of this writing:
- Claude Code on native Windows: limited support
- Claude Code inside WSL2: fully supported, recommended
- Install inside WSL2 following Anthropic's Linux instructions

## Summary checklist

- [ ] WSL2 installed with Ubuntu 24.04
- [ ] Docker Desktop installed with WSL2 integration enabled
- [ ] Node.js 24 (24.22.1+), pnpm, Git installed inside WSL2
- [ ] VS Code with Remote-WSL extension
- [ ] Project cloned inside WSL2 filesystem (`~/projects/`, not `/mnt/c/`)
- [ ] `.gitattributes` and `.editorconfig` in repo root
- [ ] `git config --global core.autocrlf input` set on Windows side
- [ ] Claude Code running inside WSL2

Do these and the project works as specified.
