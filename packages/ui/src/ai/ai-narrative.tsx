'use client';

import * as React from 'react';
import { Languages } from 'lucide-react';
import type { ApiMetaSource } from '@kku/shared';
import { cn } from '../lib/cn';
import { AiInsight } from './ai-insight';
import { Button } from '../primitives/button';

// Thai-primary narrative with on-demand EN translation. Translation comes
// in via `translator` prop (async fn) — prompt 04 wires to the LLM
// translation service. For now the styleguide stub shows the pattern.

export interface AiNarrativeProps {
  titleTh: string;
  bodyTh: string;
  confidence?: number | null;
  sources?: ApiMetaSource[];
  /** Async function that returns the EN body given Thai body. */
  translator?: (thai: string) => Promise<string>;
}

export function AiNarrative({
  titleTh,
  bodyTh,
  confidence,
  sources,
  translator,
}: AiNarrativeProps) {
  const [lang, setLang] = React.useState<'TH' | 'EN'>('TH');
  const [enBody, setEnBody] = React.useState<string | null>(null);
  const [translating, setTranslating] = React.useState(false);

  const toggle = async () => {
    if (lang === 'EN') {
      setLang('TH');
      return;
    }
    if (enBody) {
      setLang('EN');
      return;
    }
    if (!translator) {
      setLang('EN');
      setEnBody('(translator not wired — prompt 04 delivers the EN pass)');
      return;
    }
    setTranslating(true);
    try {
      const out = await translator(bodyTh);
      setEnBody(out);
      setLang('EN');
    } finally {
      setTranslating(false);
    }
  };

  return (
    <AiInsight
      title={titleTh}
      confidence={confidence}
      sources={sources}
      className="lang-th"
    >
      <div className="flex flex-col gap-3">
        <div className={cn(lang === 'TH' ? 'lang-th' : undefined)} lang={lang === 'TH' ? 'th' : 'en'}>
          {lang === 'TH' ? bodyTh : enBody ?? bodyTh}
        </div>
        <div>
          <Button
            variant="ghost"
            size="xs"
            onClick={toggle}
            disabled={translating}
          >
            <Languages className="mr-1 h-3 w-3" aria-hidden />
            {translating ? 'Translating…' : lang === 'TH' ? 'Show in English' : 'Show in Thai'}
          </Button>
        </div>
      </div>
    </AiInsight>
  );
}
