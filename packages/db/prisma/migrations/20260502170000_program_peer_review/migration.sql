-- AI-generated comparative peer review (one row per program). Drives
-- the Deep-Dive Peer Comparison section's strengths / weaknesses /
-- per-tier verdict / recommendations UI.

CREATE TABLE "program_peer_reviews" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "method_version" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "peer_count_total" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_ai_inference_id" TEXT,

    CONSTRAINT "program_peer_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_peer_reviews_program_id_key" ON "program_peer_reviews"("program_id");

ALTER TABLE "program_peer_reviews"
  ADD CONSTRAINT "program_peer_reviews_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
