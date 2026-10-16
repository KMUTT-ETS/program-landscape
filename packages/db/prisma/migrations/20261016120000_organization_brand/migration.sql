-- White label phase 2: brand fields on the organisation singleton.
ALTER TABLE "organization_profile"
  ADD COLUMN "logo_light_key" TEXT,
  ADD COLUMN "logo_dark_key" TEXT,
  ADD COLUMN "favicon_key" TEXT,
  ADD COLUMN "primary_color" TEXT,
  ADD COLUMN "secondary_color" TEXT,
  ADD COLUMN "brand_tokens_json" JSONB;
