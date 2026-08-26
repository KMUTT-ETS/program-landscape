'use client';

import * as React from 'react';
import { ExternalLink, RefreshCw, Sparkles, ThumbsDown } from 'lucide-react';
import type { ApiMetaSource } from '@kku/shared';
import { cn } from '../lib/cn';
import { Button } from '../primitives/button';
import { Card } from '../primitives/card';
import { ConfidenceBadge } from '../feedback/confidence-badge';

// Wraps any AI-generated block with the four things every AI output
// must expose (see CLAUDE.md → Council-readiness):
//   - Confidence badge (with rationale tooltip)
//   - Source list (clickable)
//   - "Show reasoning" expandable
//   - Regenerate + Disagree feedback buttons

export interface AiInsightProps {
  title?: string;
  /** 0–1 inclusive. */
  confidence?: number | null;
  /** Source list from the AI call. */
  sources?: ApiMetaSource[];
  /** Model's chain-of-thought or rationale. Collapsed by default. */
  reasoning?: string;
  onRegenerate?: () => void;
  onDisagree?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function AiInsight({
  title,
  confidence,
  sources,
  reasoning,
  onRegenerate,
  onDisagree,
  children,
  className,
}: AiInsightProps) {
  const [reasoningOpen, setReasoningOpen] = React.useState(false);
  return (
    <Card
      padding="md"
      elevation="sm"
      className={cn(
        'flex flex-col gap-3 border-l-2 border-l-accent-subtle',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-icon-sm text-accent-default" aria-hidden />
          <h3 className="text-sm font-semibold text-text-primary">
            {title ?? 'AI insight'}
          </h3>
          {confidence != null && <ConfidenceBadge value={confidence} />}
        </div>
      </header>

      <div className="text-sm leading-relaxed text-text-primary">{children}</div>

      {sources && sources.length > 0 && (
        <section>
          <h4 className="mb-1 text-[11px] uppercase tracking-wide text-text-tertiary">
            Sources
          </h4>
          <ul className="flex flex-col gap-1 text-xs">
            {sources.map((s) => (
              <li key={s.id}>
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent-default hover:underline"
                  >
                    {s.name}
                    <ExternalLink className="size-icon-xs" aria-hidden />
                  </a>
                ) : (
                  <span className="text-text-secondary">{s.name}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {reasoning && (
        <section>
          <button
            type="button"
            onClick={() => setReasoningOpen((x) => !x)}
            className="text-xs text-text-tertiary hover:text-text-primary"
            aria-expanded={reasoningOpen}
          >
            {reasoningOpen ? 'Hide reasoning' : 'Show reasoning'}
          </button>
          {reasoningOpen && (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-xs text-text-secondary">
              {reasoning}
            </p>
          )}
        </section>
      )}

      {(onRegenerate || onDisagree) && (
        <footer className="flex items-center gap-2 pt-1">
          {onRegenerate && (
            <Button variant="ghost" size="xs" onClick={onRegenerate}>
              <RefreshCw className="mr-1 size-icon-xs" aria-hidden />
              Regenerate
            </Button>
          )}
          {onDisagree && (
            <Button variant="ghost" size="xs" onClick={onDisagree}>
              <ThumbsDown className="mr-1 size-icon-xs" aria-hidden />
              Disagree
            </Button>
          )}
        </footer>
      )}
    </Card>
  );
}
