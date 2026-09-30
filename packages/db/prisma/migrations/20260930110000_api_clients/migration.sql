-- HAND-WRITTEN. Additive only: external API clients, their keys, and a call log.

-- CreateEnum
CREATE TYPE "ApiClientStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ApiLookupType" AS ENUM ('CITIZEN_ID', 'EMAIL');

-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_contact" TEXT,
    "status" "ApiClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "allowed_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allow_citizen_id_lookup" BOOLEAN NOT NULL DEFAULT false,
    "allow_email_lookup" BOOLEAN NOT NULL DEFAULT false,
    "include_inactive" BOOLEAN NOT NULL DEFAULT false,
    "ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "created_by_id" TEXT,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_client_keys" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_client_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "key_id" TEXT,
    "lookup_type" "ApiLookupType",
    "faculty_member_id" TEXT,
    "status" INTEGER NOT NULL,
    "sections_returned" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latency_ms" INTEGER NOT NULL,
    "ip" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_name_key" ON "api_clients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_client_keys_prefix_key" ON "api_client_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_client_keys_client_id_idx" ON "api_client_keys"("client_id");

-- CreateIndex
CREATE INDEX "api_request_logs_client_id_created_at_idx" ON "api_request_logs"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "api_request_logs_created_at_idx" ON "api_request_logs"("created_at");

-- AddForeignKey
ALTER TABLE "api_client_keys" ADD CONSTRAINT "api_client_keys_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
