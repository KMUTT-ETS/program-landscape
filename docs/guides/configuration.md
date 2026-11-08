# Configuration and environment

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/configuration.md)

**Outcome.** You can set the environment keys that matter on day one and keep secrets out of the repository in production.

`.env.example` carries **104 uncommented keys** (plus ~20 commented optional ones); `.env.prod.example` carries more, with production-specific guidance in comments. Read both. Neither is a checklist you must complete — most keys are per-connector credentials you will not need until you wire that connector.

## The env keys that actually matter on day one

| Key | Note |
|---|---|
| `DATABASE_URL` | Must agree with `POSTGRES_*`; the release does not auto-splice them |
| `NEXTAUTH_SECRET` | Required. Missing → silent auth failure, see Trap 4 |
| `NEXTAUTH_URL`, `AUTH_TRUST_HOST` | Set to your public URL in production |
| `ENABLE_LOCAL_AUTH`, `DEV_AUTH_PASSWORD` | Dev sign-in. Hard-fails in production |
| `AI_PROVIDER` | `google` (default) / `anthropic` / `openrouter` / `stub`. Tool-use (AI Analyst) requires `anthropic` |
| `GOOGLE_AI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` | The key for your provider; `stub` works without any. Embeddings (programme overlap, skill matching) go to Google whenever `GOOGLE_AI_API_KEY` is set. With `anthropic` a Google key is required for them; with `openrouter` and no Google key, set `AI_OPENROUTER_EMBEDDING_MODEL` instead |
| `CONNECTOR_MODE` | Global default connector mode. Leave at `mocked` initially |
| *(none — moved)* | Institution identity is set in the app at **/admin/organization** (names, short names, region, contact email, public URL). The Thai name must match the TCAS สถาบัน column exactly; the form checks it for you. |
| `MINIO_*`, `REDIS_*`, `GOTENBERG_URL` | Local defaults in `.env.example` work with `pnpm db:up` |

Brand colours and logos are set on the **Brand** tab of the same page (`/admin/organization?tab=brand`). The app derives light and dark shades from your two colours and checks they stay readable.

**Known gaps in `.env.example` you will hit.** `UNICON_DS2001_DB_*` and `UNICON_DS1001_DB_*` are documented in `.env.prod.example` but **absent from `.env.example`**. When a connector reports missing config, check `.env.prod.example` and `configFromEnv('<PREFIX>')` in the connector before assuming the key does not exist.

> `AI_PROVIDER` and `GOOGLE_AI_API_KEY` used to be missing here too; that gap is fixed. `.env.example` now ships `AI_PROVIDER=stub`, which is what lets `api` and `ingestion` boot without an LLM key (the code default, `google`, crashes both at boot when `GOOGLE_AI_API_KEY` is empty).

## Each app needs its own `.env` — this is not optional

Next.js's `@next/env` loads `.env` from the **Next project directory** (`apps/web/`), never from the monorepo root. The same trap hits `apps/api` and `apps/ingestion`.

`scripts/link-env.mjs` (`pnpm link-env`, also part of `pnpm setup`) symlinks the root `.env` into all three app directories and into `packages/db` (the Prisma CLI reads `DATABASE_URL` from `packages/db/.env`). On Windows without Developer Mode it falls back to copying — and a copy **drifts** when you edit the root `.env`, so re-run `pnpm link-env` after every env change on Windows.

The failure mode when this is missing is silent and misleading. See [Trap 4](../adopters/traps.md#trap-4-per-app-env-files-and-the-silent-edge-middleware-failure).

## Secrets in production

Production uses Docker Compose file-based secrets under `/opt/program-landscape/secrets/` (one value per file, mode 0600) for Postgres and MinIO credentials, alongside a root-owned mode-0600 `.env.prod`. `DEPLOYMENT.md` § *One-time server setup* is the authority. Note the documented wrinkle: `DATABASE_URL` in `.env.prod` still embeds the password, so it must be kept in sync with the secret files by hand.

## Next step

Continue with [Write a connector](./write-a-connector.md).
