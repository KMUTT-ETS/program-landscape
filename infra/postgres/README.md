# Postgres image

Custom PostgreSQL 16 image used for dev and production. Built from
`postgis/postgis:16-3.4` with `pgvector` added via apt, so a single instance
supports:

- `postgis` — regional analysis
- `vector` — pgvector embeddings
- `pg_trgm` — fuzzy search (Thai/English)
- `btree_gin`, `uuid-ossp` — index and UUID helpers

Init scripts in `init/` run the first time a volume is created (Postgres
convention). `01-extensions.sql` enables the extensions idempotently on the
default database (`POSTGRES_DB`).

Rebuild after changes:

```bash
docker compose build postgres
docker compose up -d postgres
```
