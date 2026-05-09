# PostgreSQL 16 with postgis, pgvector, and pg_trgm (pg_trgm ships with base).
# Built for linux/amd64 — matches the production server architecture.
FROM postgis/postgis:16-3.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*

# NOTE on USER: we deliberately do NOT set `USER postgres` here. The
# upstream postgres entrypoint must run as root to chown the data
# directory on first boot, then drops to the `postgres` UID via gosu.
# Forcing USER at image-build time breaks first-boot initialisation.
# The actual postgres process runs unprivileged regardless — verify
# in prod with `docker exec program-landscape-postgres ps -u postgres`.
