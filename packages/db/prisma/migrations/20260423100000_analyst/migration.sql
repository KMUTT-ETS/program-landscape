-- CreateEnum AnalystMessageRole
CREATE TYPE "AnalystMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable analyst_conversations
CREATE TABLE "analyst_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary_th" TEXT,
    "summary_en" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analyst_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analyst_conversations_user_id_idx" ON "analyst_conversations"("user_id");
CREATE INDEX "analyst_conversations_updated_at_idx" ON "analyst_conversations"("updated_at");

ALTER TABLE "analyst_conversations" ADD CONSTRAINT "analyst_conversations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable analyst_messages
CREATE TABLE "analyst_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "AnalystMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls_json" JSONB,
    "evidence_json" JSONB,
    "ai_inference_ids" TEXT[] NOT NULL DEFAULT '{}',
    "stop_reason" TEXT,
    "tokens_input" INTEGER,
    "tokens_output" INTEGER,
    "cost_estimate_usd" DOUBLE PRECISION,
    "latency_ms" INTEGER,
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analyst_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analyst_messages_conversation_id_created_at_idx" ON "analyst_messages"("conversation_id", "created_at");
CREATE INDEX "analyst_messages_role_idx" ON "analyst_messages"("role");

ALTER TABLE "analyst_messages" ADD CONSTRAINT "analyst_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "analyst_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable analyst_feedback
CREATE TABLE "analyst_feedback" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "correction" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analyst_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analyst_feedback_message_id_idx" ON "analyst_feedback"("message_id");
CREATE INDEX "analyst_feedback_user_id_idx" ON "analyst_feedback"("user_id");

ALTER TABLE "analyst_feedback" ADD CONSTRAINT "analyst_feedback_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "analyst_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analyst_feedback" ADD CONSTRAINT "analyst_feedback_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
