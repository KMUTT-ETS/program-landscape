-- Adds the AnalystConversationKind enum + a kind column on
-- analyst_conversations. STRATEGIC is the back-compat default so existing
-- rows (which all belong to the original /analyst Council assistant)
-- stay in their bucket.
--
-- DASHBOARD is the new bucket for the operational Education + Staff
-- dashboard chatbot — separate system prompt, narrower tool catalog,
-- separate conversation history.

-- CreateEnum
CREATE TYPE "AnalystConversationKind" AS ENUM ('STRATEGIC', 'DASHBOARD');

-- AlterTable
ALTER TABLE "analyst_conversations"
  ADD COLUMN "kind" "AnalystConversationKind" NOT NULL DEFAULT 'STRATEGIC';

-- CreateIndex
-- Conversation list query path: WHERE user_id = ? AND kind = ?
-- ORDER BY updated_at DESC.
CREATE INDEX "analyst_conversations_user_id_kind_updated_at_idx"
  ON "analyst_conversations"("user_id", "kind", "updated_at");
