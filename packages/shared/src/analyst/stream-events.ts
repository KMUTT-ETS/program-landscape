// SSE event shapes for the AI Analyst streaming chat endpoint.
// Persisted via `event: <type>\ndata: <json>\n\n` over text/event-stream.
//
// Lifecycle of one chat turn over SSE:
//   open   → connection established, optimistic conversationId echoed back
//   status → coarse-grained phase markers ("safety_check", "tool_call",
//            "synthesising", …). UI surfaces in a status pill under the
//            in-flight assistant bubble.
//   delta  → text chunks appended to the assistant message. v1 chunks
//            the model's finalText server-side after the tool loop
//            completes (simulated streaming). v2 plugs into provider-
//            native streaming once we lift `completeWithTools` to it.
//   done   → terminal event with the full ChatTurnResult shape so the
//            UI can finalize the bubble + evidence panel in one step.
//   error  → terminal failure event. UI shows the message text.

export type AnalystStatusPhase =
  | 'opening'
  | 'safety_check'
  | 'fetching_history'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'synthesising'
  | 'persisting';

export interface AnalystStreamOpenEvent {
  type: 'open';
  conversationId: string | null;
}

export interface AnalystStreamStatusEvent {
  type: 'status';
  phase: AnalystStatusPhase;
  /** Short label suitable for a pill. Bilingual where useful. */
  label: string;
  /** Optional richer description for tooltip / aria-live. */
  detail?: string;
  /** When `phase === 'tool_call'` / `'tool_result'`, the canonical tool
   *  name (`get_program`, `query_recruitment`, …) so the UI can map it
   *  to a friendlier label. */
  toolName?: string;
}

export interface AnalystStreamDeltaEvent {
  type: 'delta';
  /** Text to append to the in-flight assistant message. */
  text: string;
}

export interface AnalystStreamDoneEvent {
  type: 'done';
  conversationId: string;
  messageId: string;
  text: string;
  refused: boolean;
  refusalCategories: string[];
  evidence: {
    toolCalls: Array<{
      name: string;
      input: Record<string, unknown>;
      result?: string;
    }>;
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

export interface AnalystStreamErrorEvent {
  type: 'error';
  message: string;
}

export type AnalystStreamEvent =
  | AnalystStreamOpenEvent
  | AnalystStreamStatusEvent
  | AnalystStreamDeltaEvent
  | AnalystStreamDoneEvent
  | AnalystStreamErrorEvent;
