# Windows setup with WSL2

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/guides/windows-wsl2.md)

Run Program Landscape on Windows inside **WSL2** (Windows Subsystem for Linux),
not on Windows itself. Everything in the tutorials then works exactly as
written, because inside WSL2 you are on Linux. Native Windows is not supported
for this project: symlinks, line endings, file-path length and Docker file
sharing all cause failures there.

Do this page once, then continue with
[Getting started](../tutorials/getting-started.md).

## Install WSL2 and Ubuntu

1. Open **PowerShell as Administrator** and run:

```powershell
wsl --install -d Ubuntu-24.04
```

2. Restart Windows when asked. Ubuntu opens and asks for a Linux user name and
   password. Choose any; this account is only on your laptop.
3. Give WSL2 enough memory. In your Windows user folder
   (`C:\Users\<you>\`), create a file named `.wslconfig` with:

```ini
[wsl2]
memory=8GB
swap=4GB
```

4. In PowerShell, run `wsl --shutdown`, then open Ubuntu again.

You should now have an Ubuntu terminal. Every command from here on runs in it.

## Install Docker Engine inside WSL2

Install Docker directly inside Ubuntu. It needs no licence and nothing on the
Windows side.

```bash
sudo apt update && sudo apt install -y ca-certificates curl git build-essential
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

Close the Ubuntu window, open it again, and check:

```bash
docker run --rm hello-world
docker compose version
```

You should see "Hello from Docker!" and a Compose version of 2 or higher.

## Docker Desktop instead

If your laptop already runs Docker Desktop, you may keep it instead of the step
above. In Docker Desktop's settings, turn on "Use the WSL 2 based engine", and
under "Resources", "WSL integration", turn on your Ubuntu distribution. Check
your organisation's licence terms first: Docker Desktop is free only for some
kinds of use. Do not install both.

## Install Node.js 24 and pnpm 10

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 24
nvm alias default 24
corepack enable
node --version
```

You should see `v24.22.1` or later (earlier releases have the Node2Shell vulnerability). `corepack enable` makes the
project use the exact package-manager release it pins, so you do not install it
yourself.

## Keep the code inside Linux

Clone the repository into your Linux home folder, for example
`~/projects/program-landscape`. Never put it under `/mnt/c/`: files there are
on the Windows disk, which makes installs and the dev servers many times
slower and breaks file watching.

To open Linux files from Windows Explorer, type `\\wsl$` in the address bar.

## Line endings

The repository forces Linux line endings through `.gitattributes`. Make sure
Git inside WSL2 does not convert them:

```bash
git config --global core.autocrlf input
```

## Editor

Use VS Code on Windows with the **WSL** extension. In the Ubuntu terminal, go
to the project folder and run `code .`: the editor opens on Windows, while
every command and terminal runs in Linux. AI coding assistants that run in a
terminal, such as opencode, are installed and run inside Ubuntu too.

## Common failures

| What you see | Fix |
|---|---|
| `permission denied while trying to connect to the Docker daemon socket` | You have not reopened Ubuntu since `usermod`. Close every Ubuntu window, run `wsl --shutdown` in PowerShell, open Ubuntu again. |
| `System has not been booted with systemd` | Your WSL is old. In PowerShell run `wsl --update`, then `wsl --shutdown`. |
| Installs and `pnpm dev` are very slow | The project is under `/mnt/c/`. Clone it again under your Linux home folder. |
| Every file shows as modified after cloning | Line endings were converted. Run the `git config` command above and clone again. |
| The laptop freezes while the app runs | WSL2 has too little memory or Windows has too little left. Close other programs, or adjust `memory=` in `.wslconfig`. |
| Thai text shows as boxes in the terminal | Use Windows Terminal, not the old command prompt. |
