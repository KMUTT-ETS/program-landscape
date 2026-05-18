'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@kku/ui';
import { Loader2, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type {
  AnalystStreamDoneEvent,
  AnalystStreamEvent,
} from '@kku/shared';
import type {
  AnalystConversationDto,
  AnalystConversationDetail,
  AnalystConversationKind,
  AnalystMessageDto,
} from './types';

// Two-pane layout (Evidence on the left, Chat on the right). Briefs
// panel removed at the user's request — pre-built briefs reachable from
// the AI Analyst landing card on /admin / search / cmd-palette. The
// extra width goes to the chat surface.
//
// The same component powers both the strategic /analyst surface and
// the operational /analyst/dashboards surface. The `kind` prop picks
// which AnalystConversation bucket the chat lands in (the server
// system prompt + tool catalog switch on the same flag).

export interface AnalystClientProps {
  conversations: AnalystConversationDto[];
  activeConversation: AnalystConversationDetail | null;
  /** Which conversation bucket. Default STRATEGIC matches v1 behaviour. */
  kind?: AnalystConversationKind;
  /** Route prefix used by history links (`?c=…`). Default `/analyst`. */
  basePath?: string;
  /** Replace the default empty-state copy with surface-specific
   *  starter prompts. */
  emptyState?: React.ReactNode;
  /** Placeholder text for the chat input. */
  placeholder?: string;
}

export function AnalystClient({
  conversations: initialConversations,
  activeConversation,
  kind = 'STRATEGIC',
  basePath = '/analyst',
  emptyState,
  placeholder,
}: AnalystClientProps) {
  const router = useRouter();
  const [conversations, setConversations] =
    React.useState<AnalystConversationDto[]>(initialConversations);
  const [messages, setMessages] = React.useState<AnalystMessageDto[]>(
    activeConversation?.messages ?? [],
  );
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [streamingText, setStreamingText] = React.useState('');
  const [statusPhase, setStatusPhase] = React.useState<{
    label: string;
    detail?: string;
  } | null>(null);
  const [activeEvidenceId, setActiveEvidenceId] = React.useState<string | null>(null);
  const [conversationId, setConversationId] = React.useState<string | null>(
    activeConversation?.id ?? null,
  );
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamingText]);

  const activeEvidence = React.useMemo(
    () =>
      messages.find((m) => m.id === activeEvidenceId) ??
      messages.filter((m) => m.role === 'ASSISTANT').at(-1) ??
      null,
    [messages, activeEvidenceId],
  );

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setStreamingText('');
    setStatusPhase({ label: 'Starting…' });

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
      const res = await fetch('/api/proxy/analyst/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: trimmed,
          // First-turn signal — server ignores when continuing an
          // existing conversation (stored kind is authoritative).
          kind,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`stream failed (${res.status})`);
      }
      let acc = '';
      let doneEvent: AnalystStreamDoneEvent | null = null;
      await readSseEvents(res.body, (event) => {
        if (event.type === 'open') {
          if (event.conversationId && event.conversationId !== conversationId) {
            setConversationId(event.conversationId);
          }
        } else if (event.type === 'status') {
          setStatusPhase({ label: event.label, detail: event.detail });
        } else if (event.type === 'delta') {
          acc += event.text;
          setStreamingText(acc);
        } else if (event.type === 'done') {
          doneEvent = event;
        } else if (event.type === 'error') {
          toast.error(event.message);
        }
      });

      if (doneEvent) {
        const done = doneEvent as AnalystStreamDoneEvent;
        const assistantTurn: AnalystMessageDto = {
          id: done.messageId,
          conversationId: done.conversationId,
          role: 'ASSISTANT',
          content: done.text,
          evidenceJson: done.evidence,
          toolCallsJson: null,
          aiInferenceIds: done.evidence.aiInferenceIds,
          stopReason: done.evidence.stopReason,
          tokensInput: done.tokens.input,
          tokensOutput: done.tokens.output,
          costEstimateUsd: done.costUsd,
          latencyMs: done.latencyMs,
          refused: done.refused,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantTurn]);
        setActiveEvidenceId(assistantTurn.id);
        if (!conversationId) {
          setConversationId(done.conversationId);
          const qs = new URLSearchParams(window.location.search);
          qs.set('c', done.conversationId);
          window.history.replaceState(null, '', `?${qs}`);
          // Optimistically prepend a new entry to the sidebar so the
          // user doesn't have to wait for the next router.refresh().
          setConversations((prev) => {
            if (prev.some((c) => c.id === done.conversationId)) return prev;
            return [
              {
                id: done.conversationId,
                kind,
                title: trimmed.slice(0, 80),
                language: 'en',
                messageCount: 2,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              ...prev,
            ];
          });
          router.refresh();
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.';
      toast.error(message);
      setMessages((prev) => [
        ...prev,
        {
          ...tempUser,
          id: `err-${Date.now()}`,
          role: 'ASSISTANT',
          content: message,
          refused: true,
        },
      ]);
    } finally {
      setSending(false);
      setStreamingText('');
      setStatusPhase(null);
    }
  };

  const startNew = () => {
    setMessages([]);
    setConversationId(null);
    setActiveEvidenceId(null);
    setStreamingText('');
    setStatusPhase(null);
    const qs = new URLSearchParams(window.location.search);
    qs.delete('c');
    router.push(`${basePath}${qs.toString() ? '?' + qs : ''}`);
  };

  const deleteOne = async (id: string) => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      const res = await fetch(
        `/api/proxy/analyst/conversations/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === conversationId) {
        startNew();
      }
      toast.success('Conversation deleted');
      router.refresh();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const deleteAll = async () => {
    if (conversations.length === 0) return;
    if (
      !window.confirm(
        `Delete ALL ${conversations.length} conversation${conversations.length === 1 ? '' : 's'}? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/proxy/analyst/conversations', {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const env = await res.json();
      const count = (env?.data?.deletedCount as number) ?? 0;
      setConversations([]);
      startNew();
      toast.success(`Deleted ${count} conversation${count === 1 ? '' : 's'}`);
      router.refresh();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* Left column — History (top, capped) + Evidence (bottom, fills rest).
       *  Layout request: keep both on the same vertical column rather
       *  than side-by-side. History uses max-h + overflow-y-auto so long
       *  conversation lists don't push Evidence below the fold; Evidence
       *  card stretches to consume the remaining viewport via flex-1. */}
      <aside className="flex flex-col gap-3">
        {/* History — capped at 40vh, scrolls internally when long */}
        <Card padding="sm">
          <button
            type="button"
            onClick={startNew}
            className="w-full rounded-md bg-accent-default px-3 py-2 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          >
            + New conversation
          </button>
          <div className="mt-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              History
              {conversations.length > 0 && (
                <span className="ml-1.5 normal-case tracking-normal text-text-tertiary">
                  ({conversations.length})
                </span>
              )}
            </h3>
            {conversations.length > 0 && (
              <button
                type="button"
                onClick={deleteAll}
                className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-danger"
                title="Delete all conversations"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                Clear all
              </button>
            )}
          </div>
          <div className="mt-2 flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto pr-1">
            {conversations.length === 0 ? (
              <p className="text-xs text-text-tertiary">No conversations yet.</p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={
                    'group flex items-center gap-1 rounded-sm px-1.5 py-1 ' +
                    (c.id === conversationId
                      ? 'bg-surface-2'
                      : 'hover:bg-surface-2')
                  }
                >
                  <Link
                    href={`${basePath}?c=${c.id}`}
                    className={
                      'flex-1 truncate text-xs ' +
                      (c.id === conversationId
                        ? 'text-text-primary'
                        : 'text-text-secondary')
                    }
                    title={c.title}
                  >
                    {c.title}
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteOne(c.id);
                    }}
                    aria-label={`Delete conversation: ${c.title}`}
                    className="rounded-sm p-0.5 text-text-tertiary opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Evidence — flex-1 so it grows to fill the space left below
         *  the (capped) History card. Body scrolls internally so the
         *  outer page doesn't grow vertically when the evidence trace
         *  is long. */}
        <Card padding="md" className="flex flex-1 flex-col">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Evidence</h3>
          <div className="flex-1 overflow-y-auto pr-1">
            {activeEvidence ? (
              <EvidencePanel message={activeEvidence} />
            ) : (
              <p className="text-xs text-text-tertiary">
                Ask a question. The evidence panel will show tool calls, data
                retrieved, and AI inference ids.
              </p>
            )}
          </div>
        </Card>
      </aside>

      {/* Right — chat surface (takes the remaining width) */}
      <main className="flex min-h-[60vh] flex-col gap-4">
        <Card padding="md" className="flex flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.length === 0 && !sending ? (
              emptyState ?? <EmptyState />
            ) : (
              <>
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onInspect={() =>
                      m.role === 'ASSISTANT' && setActiveEvidenceId(m.id)
                    }
                    isActive={activeEvidenceId === m.id}
                  />
                ))}
                {sending && (
                  <StreamingBubble
                    text={streamingText}
                    statusLabel={statusPhase?.label ?? 'Working…'}
                    statusDetail={statusPhase?.detail}
                  />
                )}
              </>
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
              placeholder={
                placeholder ??
                'ถามเป็นภาษาไทยหรือ English. For example: โปรแกรมไหนที่มีความเสี่ยงทางการเงินสูงสุด 5 อันดับแรก'
              }
              disabled={sending}
              className="flex-1 rounded-md border border-default bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default disabled:opacity-50"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={sending || !input.trim()}
            >
              {sending ? 'Thinking…' : 'Send'}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}

// In-flight assistant bubble — shows the rolling status pill plus
// streamed text so far. Replaced by the persisted MessageBubble once
// the `done` event lands.
function StreamingBubble({
  text,
  statusLabel,
  statusDetail,
}: {
  text: string;
  statusLabel: string;
  statusDetail?: string;
}) {
  return (
    <div className="mr-12 rounded-lg border border-subtle bg-surface-1 px-4 py-3 text-sm leading-relaxed text-text-primary">
      <div
        className="mb-2 flex items-center gap-2 text-xs text-text-tertiary"
        aria-live="polite"
      >
        <Badge tone="outline">Analyst</Badge>
        <Loader2 className="h-3 w-3 animate-spin text-accent-default" aria-hidden />
        <span className="font-medium text-text-secondary" title={statusDetail}>
          {statusLabel}
        </span>
        {statusDetail ? (
          <span className="truncate font-mono text-[10px] opacity-70">
            {statusDetail}
          </span>
        ) : null}
      </div>
      {text ? (
        <div className="analyst-prose">
          <ReactMarkdown>{text}</ReactMarkdown>
          <span className="inline-block h-3 w-1.5 -mb-0.5 ml-0.5 animate-pulse bg-accent-default" />
        </div>
      ) : (
        <p className="text-xs text-text-tertiary italic">
          Waiting for the first chunk…
        </p>
      )}
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
        <span className="ml-auto font-mono">
          {new Date(message.createdAt).toISOString().slice(11, 19)}
        </span>
      </div>
      {isUser ? (
        <p className="whitespace-pre-wrap">{message.content}</p>
      ) : (
        <div className="analyst-prose">
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h2 className="mt-3 mb-1 text-base font-semibold text-text-primary first:mt-0">
                  {children}
                </h2>
              ),
              h2: ({ children }) => (
                <h3 className="mt-3 mb-1 text-sm font-semibold uppercase tracking-wide text-text-secondary first:mt-0">
                  {children}
                </h3>
              ),
              h3: ({ children }) => (
                <h4 className="mt-2 mb-1 text-sm font-semibold text-text-secondary first:mt-0">
                  {children}
                </h4>
              ),
              p: ({ children }) => (
                <p className="my-1.5 text-sm leading-relaxed">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="my-1.5 ml-5 list-disc space-y-1 text-sm leading-relaxed">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="my-1.5 ml-5 list-decimal space-y-1 text-sm leading-relaxed">
                  {children}
                </ol>
              ),
              li: ({ children }) => <li className="text-sm">{children}</li>,
              strong: ({ children }) => (
                <strong className="font-semibold text-text-primary">{children}</strong>
              ),
              em: ({ children }) => (
                <em className="italic text-text-secondary">{children}</em>
              ),
              code: ({ children }) => (
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-text-primary">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="my-2 overflow-x-auto rounded bg-surface-2 p-2 text-[12px] text-text-primary">
                  {children}
                </pre>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-default underline hover:text-accent-strong"
                >
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-2 border-l-2 border-border-default pl-3 text-sm italic text-text-secondary">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="my-2 overflow-x-auto">
                  <table className="w-full border-collapse text-xs">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border-b border-border-default px-2 py-1 text-left font-semibold text-text-primary">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border-b border-border-subtle px-2 py-1 text-text-secondary">
                  {children}
                </td>
              ),
              hr: () => <hr className="my-3 border-border-subtle" />,
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function EvidencePanel({ message }: { message: AnalystMessageDto }) {
  const evidence = message.evidenceJson as
    | {
        toolCalls?: Array<{
          name: string;
          input: Record<string, unknown>;
          result?: string;
        }>;
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
        <Stat
          label="Latency"
          value={message.latencyMs ? `${message.latencyMs}ms` : '—'}
        />
        <Stat
          label="Cost"
          value={
            message.costEstimateUsd
              ? `$${message.costEstimateUsd.toFixed(4)}`
              : '—'
          }
        />
      </div>

      {evidence?.toolCalls && evidence.toolCalls.length > 0 ? (
        <div>
          <h4 className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
            Tool calls ({evidence.toolCalls.length} · {evidence.iterations}{' '}
            iterations · {evidence.stopReason})
          </h4>
          <ul className="space-y-1.5">
            {evidence.toolCalls.map((tc, i) => (
              <li key={i} className="rounded-md border border-subtle bg-surface-2 p-2">
                <code className="font-mono text-[11px] text-accent-default">
                  {tc.name}
                </code>
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
          <h4 className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
            AI inferences
          </h4>
          <ul className="space-y-1">
            {message.aiInferenceIds.map((id) => (
              <li key={id}>
                <Link
                  href={`/admin/ai-logs/${id}`}
                  className="font-mono text-[10px] text-accent-default hover:underline"
                >
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {evidence?.refusalCategories && evidence.refusalCategories.length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-2">
          <h4 className="text-[10px] uppercase tracking-wide text-danger">
            Refusal categories
          </h4>
          <p className="mt-1 text-[11px] text-text-secondary">
            {evidence.refusalCategories.join(', ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-subtle bg-surface-2 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div className="font-mono text-xs text-text-primary">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <h3 className="text-sm font-semibold text-text-primary">
        Ask about the KKU portfolio
      </h3>
      <p className="max-w-md text-xs leading-relaxed text-text-secondary">
        The analyst only uses real data — it will say so when it doesn&apos;t
        know. Ask in Thai or English.
      </p>
      <div className="flex flex-col gap-1 text-xs text-text-tertiary">
        <span>• โปรแกรมไหนที่มีความเสี่ยงทางการเงินสูงสุด 5 อันดับแรก</span>
        <span>• Which programs have the largest skill-demand gap?</span>
        <span>• ถ้ายุบโปรแกรม X จะกระทบรายได้เท่าไหร่</span>
      </div>
    </div>
  );
}

// ── SSE reader ────────────────────────────────────────────────────────
// Minimal text/event-stream parser. We don't use `EventSource` because
// it only supports GET; the analyst stream is POST so we have to roll
// our own. Buffers between chunks; emits one `AnalystStreamEvent` per
// "event: ...\ndata: ...\n\n" block.

async function readSseEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: AnalystStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      try {
        const payload = JSON.parse(dataLines.join('\n')) as AnalystStreamEvent;
        onEvent(payload);
      } catch {
        // Malformed event — skip rather than failing the whole stream.
      }
    }
  }
}
