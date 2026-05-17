export type AnalystConversationKind = 'STRATEGIC' | 'DASHBOARD';

export interface AnalystConversationDto {
  id: string;
  /** Optional — older serialised payloads from before the v1.2.3
   *  dashboard chatbot migration may not carry it. Treat missing as
   *  STRATEGIC. */
  kind?: AnalystConversationKind;
  title: string;
  language: 'th' | 'en';
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalystMessageDto {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  evidenceJson: unknown;
  toolCallsJson: unknown;
  aiInferenceIds: string[];
  stopReason: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  costEstimateUsd: number | null;
  latencyMs: number | null;
  refused: boolean;
  createdAt: string;
}

export interface AnalystConversationDetail extends AnalystConversationDto {
  messages: AnalystMessageDto[];
}

export interface AnalystBriefTemplate {
  slug: string;
  name: string;
  descriptionEn: string;
  descriptionTh: string;
  requiresScopeArg: boolean;
  pdfTemplate: string;
}

export interface ChatTurnResult {
  conversationId: string;
  messageId: string;
  text: string;
  refused: boolean;
  refusalCategories: string[];
  evidence: {
    toolCalls: Array<{ name: string; input: Record<string, unknown>; result?: string }>;
    aiInferenceIds: string[];
    iterations: number;
    stopReason: string;
  };
  model: string;
  tokens: { input: number; output: number };
  costUsd: number;
  latencyMs: number;
  methodologyVersion: string;
}
