import * as React from 'react';

import { formatPct } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Strategic narrative. Prose shape per the section-shape decision — no
// chart leads this section. `contentMarkdown` is an AI-authored brief using
// a small, known markdown subset (##/### headings, -/* bullets, 1./2.
// numbered lists, **bold**, plain paragraphs) — see
// `program-strategic-narrative.v3`'s prompt template
// (packages/shared/src/ai/prompts/). This package has no markdown-library
// dependency (see package.json — `zod` is the only runtime dep), so this is
// a small hand-rolled parser.
//
// NOT a verbatim port of the pre-rebuild template.tsx's
// `renderMarkdownInline`: that renderer split on BLANK-LINE-separated
// blocks, then treated a block starting with `#` as *entirely* a heading,
// discarding every line after the heading line within that block. The real
// AI output (see the fixture) always puts a heading and its very next
// paragraph/list on ADJACENT lines with no blank line between them — e.g.
// "## Executive summary\nThe Bachelor of Engineering...\n\n## Strategic
// position\n- ..." — so that old parser would have silently dropped nearly
// every paragraph and list in this exact payload shape. This version walks
// line-by-line instead of block-by-block, so a heading never swallows the
// content that follows it.
//
// The content is NOT reliably Thai despite the CLAUDE.md Thai-primary
// convention for AI narratives — the real fixture (KKU-SEQ-0065) carries
// English prose. This component renders whatever language the payload
// contains verbatim; it does not translate or assume a language. Only the
// one-sentence lede below (this section's own editorial framing, not the
// AI's output) is guaranteed Thai, per every other section's convention.
const LEDE_TH =
  'บทวิเคราะห์เชิงกลยุทธ์ฉบับนี้จัดทำโดยปัญญาประดิษฐ์ สรุปสถานะ ความเสี่ยง และโอกาสของหลักสูตรจากข้อมูลทุกมิติในรายงานนี้';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFmt(text: string): string {
  // Bold (**x**) → <strong>; italic (*x*) → <em>. Runs on already
  // HTML-escaped input so these markers survive escaping.
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?:^|\s)\*([^*\n]+?)\*(?=\s|$|[.,;:!?])/g, (m, g: string) =>
      m.startsWith(' ') ? ` <em>${g}</em>` : `<em>${g}</em>`,
    );
}

type BlockMode = 'none' | 'p' | 'ul' | 'ol';

/**
 * Minimal markdown → HTML for the AI-authored strategic brief. Not a
 * general-purpose parser — matches exactly the subset
 * program-strategic-narrative.v3 is prompted to produce. Walks line by
 * line, accumulating consecutive paragraph/bullet/numbered lines into one
 * buffer and flushing it (a) on a blank line, (b) on a heading line — which
 * is emitted immediately, on its own, never absorbing subsequent lines —
 * or (c) on a switch between paragraph/bullet/numbered mode.
 */
function renderMarkdown(md: string): string {
  const parts: string[] = [];
  let mode: BlockMode = 'none';
  let buffer: string[] = [];

  const flush = (): void => {
    if (mode === 'p' && buffer.length > 0) {
      parts.push(`<p>${inlineFmt(buffer.join(' '))}</p>`);
    } else if (mode === 'ul' && buffer.length > 0) {
      parts.push(`<ul>${buffer.map((item) => `<li>${inlineFmt(item)}</li>`).join('')}</ul>`);
    } else if (mode === 'ol' && buffer.length > 0) {
      parts.push(`<ol>${buffer.map((item) => `<li>${inlineFmt(item)}</li>`).join('')}</ol>`);
    }
    buffer = [];
    mode = 'none';
  };

  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      const tag = level <= 2 ? 'h2' : 'h3';
      parts.push(`<${tag}>${inlineFmt((heading[2] ?? '').trim())}</${tag}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (mode !== 'ul') flush();
      mode = 'ul';
      buffer.push((bullet[1] ?? '').trim());
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      if (mode !== 'ol') flush();
      mode = 'ol';
      buffer.push((numbered[1] ?? '').trim());
      continue;
    }

    if (mode !== 'p') flush();
    mode = 'p';
    buffer.push(line);
  }
  flush();

  return parts.join('\n');
}

export function renderStrategicNarrativeSection(data: ProgramDetailData): React.ReactElement | null {
  const { strategicNarrative } = data;
  if (!strategicNarrative) return null;

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">AI strategic brief</span>
          <h2 className="section-title">Strategic narrative</h2>
        </div>
      </div>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>
      <p className="caption">
        {strategicNarrative.methodVersion} · confidence {formatPct(strategicNarrative.confidencePct)} ·
        generated {strategicNarrative.generatedAt}
      </p>
      <article
        className="magazine-columns"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(strategicNarrative.contentMarkdown) }}
      />
    </section>
  );
}
