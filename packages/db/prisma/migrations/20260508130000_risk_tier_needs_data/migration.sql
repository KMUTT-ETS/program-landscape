-- Risk Management v1.1: NEEDS_DATA tier
-- Programs whose recruitment funnel + skill-automation classification are
-- both absent should not receive a LOW/MODERATE/HIGH/CRITICAL verdict —
-- they need data acquisition first. This adds a separate tier so the
-- data-thin programs surface in their own bucket.
-- Additive only.

ALTER TYPE "RiskTier" ADD VALUE IF NOT EXISTS 'NEEDS_DATA' BEFORE 'LOW';
