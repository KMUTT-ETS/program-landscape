# PostgreSQL 16 with postgis, pgvector, and pg_trgm (pg_trgm ships with base).
# Built for linux/amd64 — matches the production server architecture.
FROM postgis/postgis:16-3.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*
