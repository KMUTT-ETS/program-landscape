'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { Card } from '../primitives/card';
import { AiInsight } from './ai-insight';
import type { ApiMetaSource } from '@kku/shared';

// Multi-section AI brief layout. Each section is an AiInsight. Printable
// via the "print" stylesheet added in prompt 02c (PDF generation).

export interface AiBriefSection {
  title: string;
  body: React.ReactNode;
  confidence?: number | null;
  sources?: ApiMetaSource[];
  reasoning?: string;
}

export interface AiBriefProps {
  title: string;
  description?: string;
  sections: AiBriefSection[];
  className?: string;
}

export function AiBrief({ title, description, sections, className }: AiBriefProps) {
  return (
    <Card padding="lg" elevation="md" className={cn('flex flex-col gap-6', className)}>
      <header>
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-text-tertiary">{description}</p>
        )}
      </header>
      <div className="flex flex-col gap-4">
        {sections.map((s, i) => (
          <AiInsight
            key={i}
            title={s.title}
            confidence={s.confidence}
            sources={s.sources}
            reasoning={s.reasoning}
          >
            {s.body}
          </AiInsight>
        ))}
      </div>
    </Card>
  );
}
