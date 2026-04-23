-- CreateTable notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'trend_signal',
    "title" TEXT NOT NULL,
    "body_en" TEXT,
    "body_th" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
CREATE INDEX "notifications_kind_idx" ON "notifications"("kind");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable signal_subscriptions
CREATE TABLE "signal_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filter_type" TEXT NOT NULL,
    "filter_value" TEXT NOT NULL,
    "min_impact_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signal_subscriptions_user_id_filter_type_filter_value_key" ON "signal_subscriptions"("user_id", "filter_type", "filter_value");
CREATE INDEX "signal_subscriptions_filter_type_filter_value_idx" ON "signal_subscriptions"("filter_type", "filter_value");
CREATE INDEX "signal_subscriptions_is_active_idx" ON "signal_subscriptions"("is_active");

ALTER TABLE "signal_subscriptions" ADD CONSTRAINT "signal_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
