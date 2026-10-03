'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { MessageSquare, X, Send, ExternalLink, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type {
  AnalystStreamDoneEvent,
  AnalystStreamEvent,
} from '@kku/shared';

// ──────────────────────────────────────────────────────────────────────────
// Dashboard chat side panel.
//
// Floating FAB + slide-in drawer. Mounted from the Education + Staff
// layouts only — the bot's tool catalog covers those two surfaces, so
// surfacing the FAB elsewhere would invite questions the tools can't
// answer.
//
// Same SSE endpoint as /analyst/dashboards — `kind=DASHBOARD` so the
// server picks the dashboard system prompt + tool catalog. Conversation
// history is ephemeral within the panel; for a full thread + history
// list, the "Open full view" button deep-links to /analyst/dashboards.
//
// Keyboard:
//   Cmd/Ctrl + /  — toggle panel
//   Esc           — close panel (when open)
//
// The pathname is captured + sent as a context hint so the bot knows
// which sub-dashboard the user was looking at when they asked. This is
// hint text, not a tool-scope clamp — the server's spatial guards still
// apply to the underlying data tools.
// ──────────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  refused: boolean;
};

const SURFACE_LABELS: Record<string, string> = {
  '/education': 'Education hub',
  '/education/recruitment-campaigns': 'Recruitment dashboard',
  '/education/student-info': 'Student info dashboard',
  '/education/location': 'Student location dashboard',
  '/education/active-pivot': 'Active-students pivot',
  '/education/international': 'International students',
  '/education/tuition': 'Tuition dashboard',
  '/education/performance': 'Academic performance',
  '/education/class-offerings': 'Class offerings',
  '/education/program-overlap': 'Program overlap',
  '/staff': 'Staff hub',
  '/staff/workforce': 'Workforce dashboard',
  '/staff/faculty-by-program': 'Faculty by program',
  '/staff/research': 'Research dashboard',
  '/staff/compensation': 'Compensation dashboard',
  '/staff/teaching-workload': 'Teaching workload',
};

function labelForPath(pathname: string): string {
  // Exact match first, then prefix match (for cases like
  // /education/recruitment/something).
  const exact = SURFACE_LABELS[pathname];
  if (exact) return exact;
  const keys = Object.keys(SURFACE_LABELS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (pathname.startsWith(k)) {
      const v = SURFACE_LABELS[k];
      if (v) return v;
    }
  }
  return 'KKU dashboards';
}

export function DashboardChatPanel() {
  const pathname = usePathname() ?? '/education';
  const [open, setOpen] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [streamingText, setStreamingText] = React.useState('');
  const [statusLabel, setStatusLabel] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Toggle on Cmd/Ctrl + /
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        // Don't fight other modals — only close if the panel's input
        // isn't actively typed-in (e.g. user typing "Esc" via IME).
        if (document.activeElement?.tagName !== 'TEXTAREA') {
          setOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus input when panel opens.
  React.useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Autoscroll on new content.
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamingText]);

  const surfaceLabel = labelForPath(pathname);

  // ── Send a turn ───────────────────────────────────────────────────
  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setStreamingText('');
    setStatusLabel('Starting…');

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'USER',
      content: trimmed,
      refused: false,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    try {
      // On the FIRST turn of a conversation, prepend a small context
      // hint so the model knows which sub-dashboard the user was on.
      // Don't repeat on continuation turns (the server keeps history).
      const messageToSend =
        !conversationId
          ? `[Viewing: ${surfaceLabel} (${pathname})]\n\n${trimmed}`
          : trimmed;

      const res = await fetch('/api/proxy/analyst/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: messageToSend,
          kind: 'DASHBOARD',
        }),
      });
      if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);

      let acc = '';
      let doneEvent: AnalystStreamDoneEvent | null = null;
      await readSseEvents(res.body, (event) => {
        if (event.type === 'open') {
          if (event.conversationId && event.conversationId !== conversationId) {
            setConversationId(event.conversationId);
          }
        } else if (event.type === 'status') {
          setStatusLabel(event.label);
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
        setMessages((prev) => [
          ...prev,
          {
            id: done.messageId,
            role: 'ASSISTANT',
            content: done.text,
            refused: done.refused,
          },
        ]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Chat failed');
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'ASSISTANT',
          content: 'Sorry — something went wrong. Please try again.',
          refused: true,
        },
      ]);
    } finally {
      setSending(false);
      setStreamingText('');
      setStatusLabel(null);
    }
  };

  const newConversation = () => {
    setMessages([]);
    setConversationId(null);
    setStreamingText('');
    setStatusLabel(null);
    inputRef.current?.focus();
  };

  // The FAB stays mounted; the drawer transitions in. Don't conditionally
  // mount the drawer — animation looks worse and we'd lose the in-flight
  // state if the user closes mid-stream.
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open dashboard assistant (Cmd/Ctrl + /)"
          title="Ask the dashboards assistant — ⌘/Ctrl + /"
          className="fixed bottom-8 right-8 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-accent-default text-accent-fg shadow-lg transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent-default focus:ring-offset-2"
        >
          <MessageSquare className="h-8 w-8" aria-hidden />
        </button>
      )}

      {/* Backdrop — soft tint, click to close */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-overlay-default/40 backdrop-blur-[1px] transition-opacity"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Drawer */}
      <aside
        className={
          'fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-border-default bg-surface-1 shadow-xl transition-transform duration-200 ease-out ' +
          (open ? 'translate-x-0' : 'translate-x-full pointer-events-none')
        }
        role="dialog"
        aria-label="Dashboards assistant"
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border-default px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-icon-xl text-accent-default" aria-hidden />
              <h2 className="truncate text-base font-semibold text-text-primary">
                Dashboards Assistant
              </h2>
            </div>
            <p className="mt-1 truncate text-sm text-text-tertiary">
              Context: {surfaceLabel}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/analyst/dashboards"
              className="rounded-md p-2 text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
              title="Open full view"
              aria-label="Open full view"
            >
              <ExternalLink className="size-icon-lg" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close panel"
              className="rounded-md p-2 text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
            >
              <X className="size-icon-lg" aria-hidden />
            </button>
          </div>
        </div>

        {/* Conversation */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.length === 0 && !sending && (
            <div className="rounded-md border border-dashed border-border-default p-4 text-sm leading-relaxed text-text-secondary">
              <p className="font-medium text-text-primary">
                Ask about this dashboard&apos;s data.
              </p>
              <p className="mt-1.5 text-text-tertiary">
                Examples:
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-text-tertiary">
                <li>How many students at this faculty?</li>
                <li>Which region sends the most students?</li>
                <li>When was this data last refreshed?</li>
                <li>เปรียบเทียบจำนวนนักศึกษาตามคณะ</li>
              </ul>
              <p className="mt-3 text-xs text-text-tertiary">
                Strategic Council questions live in{' '}
                <Link href="/analyst" className="text-accent-default hover:underline">
                  /analyst
                </Link>
                .
              </p>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {sending && (
            <div className="rounded-md border border-border-default bg-surface-2 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 text-text-tertiary">
                <Loader2 className="size-icon-md animate-spin" aria-hidden />
                <span>{statusLabel ?? 'Working…'}</span>
              </div>
              {streamingText && (
                <div className="mt-2 whitespace-pre-wrap text-text-primary">
                  {streamingText}
                </div>
              )}
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-border-default px-4 py-4"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask in Thai or English…"
              rows={2}
              disabled={sending}
              className="flex-1 resize-none rounded-md border border-border-default bg-surface-1 px-3 py-2 text-base text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-accent-default px-4 text-sm font-medium text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="size-icon-lg" aria-hidden />
              Send
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-tertiary">
            <span>Enter to send · Shift+Enter for newline · ⌘/Ctrl+/ to toggle</span>
            <button
              type="button"
              onClick={newConversation}
              disabled={messages.length === 0 || sending}
              className="hover:text-text-primary disabled:opacity-40"
            >
              Reset thread
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

// ── Message bubble ────────────────────────────────────────────────────
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'USER';
  return (
    <div
      className={
        'flex ' + (isUser ? 'justify-end' : 'justify-start')
      }
    >
      <div
        className={
          'max-w-[90%] rounded-md px-4 py-2.5 text-sm leading-relaxed ' +
          (isUser
            ? 'bg-accent-default text-accent-fg'
            : message.refused
              ? 'border border-warning-default bg-warning-subtle text-text-primary'
              : 'border border-border-default bg-surface-2 text-text-primary')
        }
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="prose prose-sm max-w-none text-text-primary [&_a]:text-accent-default [&_code]:rounded [&_code]:bg-surface-1 [&_code]:px-1 [&_code]:py-0.5 [&_p]:my-1.5 [&_ul]:my-1.5">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SSE reader ────────────────────────────────────────────────────────
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
        // Malformed event — skip.
      }
    }
  }
}
