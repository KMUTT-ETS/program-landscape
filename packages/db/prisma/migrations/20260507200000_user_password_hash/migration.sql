-- Add password_hash to users for per-user dev-credentials.
-- Format: 'scrypt:<salt-hex>:<hash-hex>'. NULL means the user falls back
-- to the shared DEV_AUTH_PASSWORD env (default 'kku-dev'). Field is
-- dev-only; never read in production code paths (KKU SSO is the only
-- auth in prod).

ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
