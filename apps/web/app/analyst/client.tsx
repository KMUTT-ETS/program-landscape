'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card } from '@kku/ui';
import type {
  AnalystBriefTemplate,
  AnalystConversationDto,
  AnalystConversationDetail,
  AnalystMessageDto,
  ChatTurnResult,
} from './types';

export function AnalystClient({
  conversations,
  briefs,
  activeConversation,
}: {
  conversations: AnalystConversationDto[];
  briefs: AnalystBriefTemplate[];
  activeConversation: AnalystConversationDetail | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = React.useState<AnalystMessageDto[]>(
    activeConversation?.messages ?? [],
  );
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = React.useState<string | null>(null);
  const [conversationId, setConversationId] = React.useState<string | null>(
    activeConversation?.id ?? null,
  );
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const activeEvidence = React.useMemo(
    () => messages.find((m) => m.id === activeEvidenceId) ?? messages.filter((m) => m.role === 'ASSISTANT').at(-1) ?? null,
    [messages, activeEvidenceId],
  );

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    // Optimistic user turn.
    const tempUser: AnalystMessageDto = {
      id: `tmp-${Date.now()}`,
      conversationId: conversationId ?? '',
      role: 'USER',
      content: trimmed,
      evidenceJson: null,
      toolCallsJson: null,
      aiInferenceIds: [],
      stopReason: null,
      tokensInput: null,
      tokensOutput: null,
      costEstimateUsd: null,
      latencyMs: null,
      refused: false,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUser]);
    setInput('');
    try {
      const res = await fetch('/api/proxy/analyst/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversationId ?? undefined, message: trimmed }),
      });
      if (!res.ok) throw new Error('chat failed');
      const envelope = (await res.json()) as { data: ChatTurnResult };
      const result = envelope.data;
      const assistantTurn: AnalystMessageDto = {
        id: result.messageId,
        conversationId: result.conversationId,
        role: 'ASSISTANT',
        content: result.text,
        evidenceJson: result.evidence,
        toolCallsJson: null,
        aiInferenceIds: result.evidence.aiInferenceIds,
        stopReason: result.evidence.stopReason,
        tokensInput: result.tokens.input,
        tokensOutput: result.tokens.output,
        costEstimateUsd: result.costUsd,
        latencyMs: result.latencyMs,
        refused: result.refused,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantTurn]);
      setActiveEvidenceId(assistantTurn.id);
      if (!conversationId) {
        setConversationId(result.conversationId);
        // Update URL so reloads land on the same conversation.
        const qs = new URLSearchParams(window.location.search);
        qs.set('c', result.conversationId);
        window.history.replaceState(null, '', `?${qs}`);
        router.refresh(); // repopulate sidebar conversation list
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          ...tempUser,
          id: `err-${Date.now()}`,
          role: 'ASSISTANT',
          content: 'Something went wrong. Check the server log.',
          refused: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const startNew = () => {
    setMessages([]);
    setConversationId(null);
    setActiveEvidenceId(null);
    const qs = new URLSearchParams(window.location.search);
    qs.delete('c');
    router.push(`/analyst${qs.toString() ? '?' + qs : ''}`);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr_320px]">
      {/* Left: conversation history + briefs */}
      <aside className="flex flex-col gap-4">
        <Card padding="sm">
          <button
            type="button"
            onClick={startNew}
            className="w-full rounded-md bg-accent-default px-3 py-2 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          >
            + New conversation
          </button>
          <div className="mt-3 flex flex-col gap-1">
            {conversations.length === 0 ? (
              <p className="text-xs text-text-tertiary">No conversations yet.</p>
            ) : (
              conversations.slice(0, 20).map((c) => (
                <Link
                  key={c.id}
                  href={`/analyst?c=${c.id}`}
                  className={
                    'truncate rounded-sm px-2 py-1 text-xs ' +
                    (c.id === conversationId
                      ? 'bg-surface-2 text-text-primary'
                      : 'text-text-secondary hover:bg-surface-2')
                  }
                  title={c.title}
                >
                  {c.title}
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card padding="sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Pre-built briefs
          </h3>
          <div className="flex flex-col gap-1">
            {briefs.map((b) => (
              <button
                key={b.slug}
                type="button"
                disabled={b.requiresScopeArg}
                onClick={() => send(`Generate the "${b.name}" brief.`)}
                className="rounded-sm px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                title={b.descriptionEn}
              >
                {b.name}
                {b.requiresScopeArg ? (
                  <span className="ml-1 text-[9px] text-text-tertiary">(needs scope)</span>
                ) : null}
              </button>
            ))}
          </div>
        </Card>
      </aside>

      {/* Centre: chat */}
      <main className="flex min-h-[60vh] flex-col gap-4">
        <Card padding="md" className="flex flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onInspect={() => m.role === 'ASSISTANT' && setActiveEvidenceId(m.id)}
                  isActive={activeEvidenceId === m.id}
                />
              ))
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mt-3 flex items-center gap-2 border-t border-subtle pt-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ถามเป็นภาษาไทยหรือ English. For example: โปรแกรมไหนที่มีความเสี่ยงทางการเงินสูงสุด 5 อันดับแรก"
              disabled={sending}
              className="flex-1 rounded-md border border-default bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-md bg-accent-default px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
            >
              {sending ? 'Thinking…' : 'Send'}
            </button>
          </form>
        </Card>
      </main>

      {/* Right: evidence panel */}
      <aside className="flex flex-col gap-3">
        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Evidence</h3>
          {activeEvidence ? <EvidencePanel message={activeEvidence} /> : (
            <p className="text-xs text-text-tertiary">
              Ask a question. The evidence panel will show tool calls, data retrieved, and AI inference ids.
            </p>
          )}
        </Card>
      </aside>
    </div>
  );
}

function MessageBubble({
  message,
  onInspect,
  isActive,
}: {
  message: AnalystMessageDto;
  onInspect: () => void;
  isActive: boolean;
}) {
  const isUser = message.role === 'USER';
  return (
    <div
      className={
        'rounded-lg border px-4 py-3 text-sm leading-relaxed transition-colors ' +
        (isUser
          ? 'ml-12 border-accent-default bg-accent-subtle text-text-primary'
          : 'mr-12 border-subtle bg-surface-1 text-text-primary') +
        (isActive && !isUser ? ' ring-2 ring-accent-default/40' : '') +
        (!isUser ? ' cursor-pointer hover:bg-surface-2' : '')
      }
      onClick={onInspect}
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-text-tertiary">
        {isUser ? <Badge tone="accent">You</Badge> : <Badge tone="outline">Analyst</Badge>}
        {message.refused ? <Badge tone="danger">Refused</Badge> : null}
        <span className="ml-auto font-mono">{new Date(message.createdAt).toLocaleTimeString('en-GB')}</span>
      </div>
      <p className="whitespace-pre-wrap">{message.content}</p>
    </div>
  );
}

function EvidencePanel({ message }: { message: AnalystMessageDto }) {
  const evidence = message.evidenceJson as
    | {
        toolCalls?: Array<{ name: string; input: Record<string, unknown>; result?: string }>;
        iterations?: number;
        stopReason?: string;
        refusalCategories?: string[];
      }
    | null;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Tokens in" value={message.tokensInput ?? '—'} />
        <Stat label="Tokens out" value={message.tokensOutput ?? '—'} />
        <Stat label="Latency" value={message.latencyMs ? `${message.latencyMs}ms` : '—'} />
        <Stat label="Cost" value={message.costEstimateUsd ? `$${message.costEstimateUsd.toFixed(4)}` : '—'} />
      </div>

      {evidence?.toolCalls && evidence.toolCalls.length > 0 ? (
        <div>
          <h4 className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
            Tool calls ({evidence.toolCalls.length} · {evidence.iterations} iterations · {evidence.stopReason})
          </h4>
          <ul className="space-y-1.5">
            {evidence.toolCalls.map((tc, i) => (
              <li key={i} className="rounded-md border border-subtle bg-surface-2 p-2">
                <code className="font-mono text-[11px] text-accent-default">{tc.name}</code>
                <pre className="mt-1 max-h-32 overflow-auto text-[10px] leading-tight text-text-tertiary">
                  {JSON.stringify(tc.input, null, 2)}
                </pre>
                {tc.result ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-text-secondary">
                      Result ({tc.result.length} bytes)
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto text-[10px] text-text-tertiary">
                      {tc.result}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message.aiInferenceIds.length > 0 ? (
        <div>
          <h4 className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">AI inferences</h4>
          <ul className="space-y-1">
            {message.aiInferenceIds.map((id) => (
              <li key={id}>
                <Link href={`/admin/ai-logs/${id}`} className="font-mono text-[10px] text-accent-default hover:underline">
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {evidence?.refusalCategories && evidence.refusalCategories.length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-2">
          <h4 className="text-[10px] uppercase tracking-wide text-danger">Refusal categories</h4>
          <p className="mt-1 text-[11px] text-text-secondary">{evidence.refusalCategories.join(', ')}</p>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-subtle bg-surface-2 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="font-mono text-xs text-text-primary">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <h3 className="text-sm font-semibold text-text-primary">Ask about the KKU portfolio</h3>
      <p className="max-w-md text-xs leading-relaxed text-text-secondary">
        Try a pre-built brief on the left, or ask a custom question. The analyst only uses real data — it will say so when it doesn't know.
      </p>
      <div className="flex flex-col gap-1 text-xs text-text-tertiary">
        <span>• โปรแกรมไหนที่มีความเสี่ยงทางการเงินสูงสุด 5 อันดับแรก</span>
        <span>• Which programs have the largest skill-demand gap?</span>
        <span>• ถ้ายุบโปรแกรม X จะกระทบรายได้เท่าไหร่</span>
      </div>
    </div>
  );
}
