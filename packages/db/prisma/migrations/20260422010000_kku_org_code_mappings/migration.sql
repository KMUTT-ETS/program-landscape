-- CreateEnum
CREATE TYPE "KkuOrgCodeKind" AS ENUM ('FACULTY', 'DEPARTMENT');

-- CreateTable
CREATE TABLE "kku_org_code_mappings" (
    "id" TEXT NOT NULL,
    "kku_code" TEXT NOT NULL,
    "kind" "KkuOrgCodeKind" NOT NULL,
    "faculty_id" TEXT,
    "department_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kku_org_code_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kku_org_code_mappings_kind_idx" ON "kku_org_code_mappings"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "kku_org_code_mappings_kku_code_kind_key" ON "kku_org_code_mappings"("kku_code", "kind");
