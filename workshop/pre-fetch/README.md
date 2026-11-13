# Workshop pre-fetch kit (for organisers)

Lets participants download the heavy part of setup (~1.7 GB of the ~1.9 GB per
laptop) **before** they receive the source code. On the workshop day they
clone the repository into any folder and `pnpm setup` reuses what the kit
downloaded.

## Build the kit

```bash
pnpm workshop:prefetch-kit
```

Output, in `workshop/pre-fetch/dist/` (gitignored):

- `program-landscape-prefetch.tar.gz`: send this to participants (~0.6 MB)
- `program-landscape-prefetch/`: the same files unpacked

Build it from the **same branch and commit participants will clone** — the
kit's lockfile and images must match that code. `KIT-VERSION.txt` records the
branch, commit and two hashes.

## What goes into it

| File | Why | What it reveals |
|---|---|---|
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/` | `pnpm fetch` downloads every package from these | dependency names and versions, workspace folder names, a small patch to Next.js |
| `docker-compose.yml`, `infra/{postgres,gotenberg,markitdown}` | `docker compose build` / `pull` | Dockerfiles, TH Sarabun New fonts, Postgres init SQL, the markitdown sidecar's `server.py` |
| `package.json` (generated stub) | pins the pnpm version and build-script allowlist | — |
| `prefetch.mjs`, `README.md`, `README.th.md` | participant script and instructions (from `kit/`) | — |

No application code is included.

## How it works

- `pnpm fetch` fills the user's **global** pnpm store, which any folder on the
  same disk reuses. `pnpm install --offline` in a separate checkout succeeded
  from a kit-filled store with no network (tested 2026-11-13: 3.4 s).
- `docker-compose.yml` names every image explicitly
  (`program-landscape-postgres:dev`, …) and fixes the project name, so images
  built from the kit folder are the ones `pnpm setup` looks for. A
  `docker compose --dry-run up` in the clone planned no build and no pull.

## Keep it in sync

The kit goes stale if `pnpm-lock.yaml`, `patches/`, `docker-compose.yml` or
`infra/` change after you send it.

- **Lockfile changed:** the day-of `pnpm install` downloads only the new
  packages. This is usually harmless.
- **`infra/` changed:** Compose does **not** notice. Participants keep running
  the old images until they run `docker compose build`. Freeze `infra/` until
  the workshop, or tell participants to rebuild.

To check a kit you sent, rebuild it and compare the two hashes in
`KIT-VERSION.txt`.

## Still downloaded on the day (~150 MB per person)

`git clone` (~40 MB), Prisma engines (~35 MB, fetched by `prisma generate`)
and the `un-wpp` data source run (~68 MB).
