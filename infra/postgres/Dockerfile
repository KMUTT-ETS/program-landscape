# PostgreSQL 16 with postgis, pgvector, and pg_trgm (pg_trgm ships with base).
# Built for linux/amd64 — matches the production server architecture.
#
# The base is Debian 11 (bullseye). PGDG retired bullseye from
# apt.postgresql.org (bullseye-pgdg returns 404 since 2026-10), so the
# source is pointed at apt-archive.postgresql.org, which keeps it.
# Do NOT move to a bookworm base to "fix" this: a newer glibc changes text
# collation and can silently corrupt text indexes in the live database.
#
# Base digest and pgvector version are pinned to what production runs
# (image 646356838818, shipped v2.0.2–v2.1.2), so a from-scratch rebuild
# reproduces it instead of drifting.
FROM postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5

RUN sed -i 's|http://apt.postgresql.org/pub/repos/apt/|https://apt-archive.postgresql.org/pub/repos/apt/|' \
      /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector=0.8.6-1.pgdg11+1 \
 && rm -rf /var/lib/apt/lists/*

# NOTE on USER: we deliberately do NOT set `USER postgres` here. The
# upstream postgres entrypoint must run as root to chown the data
# directory on first boot, then drops to the `postgres` UID via gosu.
# Forcing USER at image-build time breaks first-boot initialisation.
# The actual postgres process runs unprivileged regardless — verify
# in prod with `docker exec program-landscape-postgres ps -u postgres`.
