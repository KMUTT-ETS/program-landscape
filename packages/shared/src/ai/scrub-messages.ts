// Pre-flight PII scrubber for outbound LLM messages.
//
// Runs at the entry of every provider's complete() / completeWithTools()
// so that no Thai citizen ID, phone, non-KKU email, or HR salary line
// crosses the network to Google / Anthropic. Closes the PDPA §28
// cross-border-transfer concern that prompt-04 §asset-table flagged
// against the AI-call boundary.
//
// Surface:
//   scrubMessages(messages) → { messages, didScrub, redactions[] }
//
// Pattern set is the same as `sanitizeAiOutput` — the input-vs-output
// distinction is operational only (where the call site sits in the
// pipeline). Passing both sides through the same gate avoids divergent
// trust boundaries.
//
// ONLY messages with role='user' or role='assistant' are scrubbed.
// `system` messages are server-controlled and may legitimately contain
// names of fields the model needs to handle (e.g. "if a user mentions
// 'citizen ID', redirect to HR").

import { scrubAiInput, type SafetyCategory } from '../analyst/safety';
import type { AiMessage } from './types';

export interface ScrubMessagesResult {
  messages: AiMessage[];
  didScrub: boolean;
  redactions: Array<{ category: SafetyCategory; marker: string; count: number }>;
}

export function scrubMessages(messages: AiMessage[]): ScrubMessagesResult {
  let didScrub = false;
  const allRedactions = new Map<
    SafetyCategory,
    { marker: string; count: number }
  >();
  const out: AiMessage[] = messages.map((msg) => {
    if (msg.role === 'system') return msg;
    const r = scrubAiInput(msg.content);
    if (r.changed) {
      didScrub = true;
      for (const red of r.redactions) {
        const prev = allRedactions.get(red.category);
        allRedactions.set(red.category, {
          marker: red.marker,
          count: (prev?.count ?? 0) + red.count,
        });
      }
      return { ...msg, content: r.text };
    }
    return msg;
  });
  return {
    messages: out,
    didScrub,
    redactions: [...allRedactions.entries()].map(([category, v]) => ({
      category,
      marker: v.marker,
      count: v.count,
    })),
  };
}
