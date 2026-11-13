# Program Landscape workshop — pre-fetch kit

> ภาษาไทย: ดู [README.th.md](README.th.md)

This kit downloads the large parts of the workshop setup **before** the day:
every npm package (~430 MB) and every Docker image (~1.2 GB). On the workshop
day you receive the source code, and its setup then finds everything already
on your laptop instead of downloading it over the room's network.

The kit contains no application code. It has only the dependency list
(`pnpm-lock.yaml`) and the recipes for three Docker images (`infra/`).

**You need:** about 2 GB of download, 7 GB of free disk, and 20–60 minutes.

## 1. Install the tools

- **Windows:** WSL2 with Ubuntu, and Docker Desktop with *WSL integration*
  turned on for Ubuntu. Do every step below **inside the Ubuntu terminal**.
- **macOS or Linux:** Docker with Compose v2.
- **Everyone:** Node.js 24.22.1 or later, then run `corepack enable` once.

## 2. Unpack the kit in your Linux home folder

Keep the kit, and later the project, inside your Linux home folder (`~`). On
Windows, **not** under `/mnt/c/...`: pnpm keeps one download store per disk,
so a kit on the Windows disk would not help the project on the Linux disk.

```bash
cd ~
tar -xzf /path/to/program-landscape-prefetch.tar.gz
cd program-landscape-prefetch
```

On Windows your Downloads folder is `/mnt/c/Users/<your Windows name>/Downloads/`.

## 3. Log in to Docker Hub (recommended)

```bash
docker login
```

A free Docker Hub account avoids the anonymous pull limit, which everyone on a
shared university network counts against together.

## 4. Run the pre-fetch

```bash
node prefetch.mjs
```

It checks your tools, downloads the packages, builds and pulls the Docker
images, and finishes with a list of ticks. If anything fails, fix what it says
and run it again — finished downloads are kept.

To check later that everything is still in place:

```bash
node prefetch.mjs --check
```

## Until the workshop

- **Keep** the downloads: do not run `pnpm store prune` or `docker system prune -a`.
- **Do not** run `docker compose up` in the kit folder.
- You may delete the kit folder; the downloads live outside it.
- On the day, clone the project into your Linux home folder as well (for
  example `~/program-landscape`) and use the same user account and, on
  Windows, the same Ubuntu.
