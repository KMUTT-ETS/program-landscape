import type { ReactNode } from 'react';

export interface CoverProps {
  titleTh: string;
  titleEn?: string;
  scope?: string;
  dateLabel: string;
  author?: string;
  version?: string;
  brandMark?: ReactNode;  // <img> or inline SVG
  // For Council-only docs. Kept as a bottom-of-cover ribbon so reviewers
  // don't miss the classification.
  confidentialityLabel?: string;
}

// The cover page is deliberately understated — one big Thai title, a
// small English translation under it, the scope + date in muted text.
// Matches the "graphic-heavy, minimal text density" direction from
// docs/design-system.md.
export function Cover(props: CoverProps) {
  return (
    <section className="cover-page">
      {props.brandMark && <div className="brand-mark">{props.brandMark}</div>}
      <div className="title-th">{props.titleTh}</div>
      {props.titleEn && <div className="title-en" lang="en">{props.titleEn}</div>}
      {props.scope && <div className="scope">ขอบเขต: {props.scope}</div>}
      <div className="date">{props.dateLabel}</div>
      {props.author && <div className="muted" style={{ marginTop: '10pt' }}>เรียบเรียงโดย {props.author}</div>}
      {props.version && <div className="muted" style={{ marginTop: '4pt' }}>เวอร์ชัน {props.version}</div>}
      {props.confidentialityLabel && (
        <div
          style={{
            marginTop: '36pt',
            padding: '6pt 14pt',
            border: '0.5pt solid #aaa',
            fontSize: '12pt',
            letterSpacing: '1pt',
            textTransform: 'uppercase',
          }}
        >
          {props.confidentialityLabel}
        </div>
      )}
    </section>
  );
}
