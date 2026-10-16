-- CreateTable
CREATE TABLE "organization_profile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "short_name_th" TEXT NOT NULL,
    "short_name_en" TEXT NOT NULL,
    "region_th" TEXT,
    "region_en" TEXT,
    "contact_email" TEXT,
    "app_url" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "organization_profile_pkey" PRIMARY KEY ("id"),
    -- Singleton: no second row can ever exist.
    CONSTRAINT "organization_profile_singleton" CHECK ("id" = 'default')
);
