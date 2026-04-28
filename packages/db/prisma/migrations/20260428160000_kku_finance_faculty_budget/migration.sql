-- ─────────────────────────────────────────────────────────────────────
-- Prompt 14 / kku-finance: per-source schema additions.
--
-- Adds:
--   1. faculty_budgets — raw budget allocation per (division × fund ×
--      fiscal year) from MSSQL ERPPowerBI.BudgetData. Stored at the
--      division level — does NOT cascade to programs (that's the
--      cost-allocation methodology layer downstream).
--
-- Additive — no existing rows touched, no data loss.
--
-- Note: kku-finance also writes to the existing `financial_metrics`
-- table (only `tuition_revenue` field — partial upsert), so no schema
-- change is needed there.
-- ─────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "faculty_budgets" (
    "id" TEXT NOT NULL,
    "faculty_id" TEXT,
    "division_name" TEXT NOT NULL,
    "fund_category" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "snapshot_name" TEXT,
    "total_budget" DECIMAL(16,2) NOT NULL,
    "total_commitment" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_obligation" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_expenditure" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "funds_available" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'kku-finance.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faculty_budgets_faculty_id_idx" ON "faculty_budgets"("faculty_id");

-- CreateIndex
CREATE INDEX "faculty_budgets_fiscal_year_idx" ON "faculty_budgets"("fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_budgets_division_name_fund_category_fiscal_year_key" ON "faculty_budgets"("division_name", "fund_category", "fiscal_year");

-- AddForeignKey
ALTER TABLE "faculty_budgets" ADD CONSTRAINT "faculty_budgets_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
