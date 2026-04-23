-- CreateTable saved_cockpit_views
CREATE TABLE "saved_cockpit_views" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "view_mode" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_id" TEXT,
    "filters_json" JSONB NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_cockpit_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_cockpit_views_user_id_last_used_at_idx" ON "saved_cockpit_views"("user_id", "last_used_at");

-- AddForeignKey
ALTER TABLE "saved_cockpit_views" ADD CONSTRAINT "saved_cockpit_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
