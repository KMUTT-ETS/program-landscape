CREATE TABLE "staff_lifecycle_dates" (
    "citizen_id_hash" TEXT NOT NULL,
    "birth_year_ad" INTEGER,
    "retire_year_ad" INTEGER,
    "sixty_year_ad" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'kku-hr-processed',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_lifecycle_dates_pkey" PRIMARY KEY ("citizen_id_hash")
);

CREATE INDEX "staff_lifecycle_dates_retire_year_ad_idx" ON "staff_lifecycle_dates"("retire_year_ad");
CREATE INDEX "staff_lifecycle_dates_birth_year_ad_idx" ON "staff_lifecycle_dates"("birth_year_ad");
