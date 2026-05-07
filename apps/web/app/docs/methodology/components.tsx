// Semantic blocks for the public methodology document. All styling
// flows through Tailwind utilities + design tokens — no hardcoded
// colours / fonts / spacing. Used by both `content-en.tsx` and
// `content-th.tsx` so visual rhythm is identical across languages.

import type { ReactNode } from 'react';

// ── Sectioning ───────────────────────────────────────────────────────────

export function DocSection({
  id,
  title,
  number,
  children,
}: {
  id: string;
  title: string;
  number?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 break-inside-avoid-page">
      <h2 className="mb-4 mt-2 border-b border-border-subtle pb-2 text-2xl font-semibold tracking-tight text-text-primary">
        {number && (
          <span className="mr-2 inline-block tabular-nums text-text-tertiary">{number}</span>
        )}
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function DocSubsection({
  id,
  title,
  number,
  children,
}: {
  id?: string;
  title: string;
  number?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h3 className="mb-2 mt-1 text-lg font-semibold text-text-primary">
        {number && (
          <span className="mr-2 inline-block tabular-nums text-text-tertiary">{number}</span>
        )}
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function DocSubSubsection({
  title,
  number,
  children,
}: {
  title: string;
  number?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-secondary">
        {number && (
          <span className="mr-2 inline-block tabular-nums text-text-tertiary">{number}</span>
        )}
        {title}
      </h4>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

// ── Body text ────────────────────────────────────────────────────────────

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="text-[15px] leading-7 text-text-primary [&>code]:bg-surface-2 [&>code]:px-1 [&>code]:py-0.5 [&>code]:rounded-sm [&>code]:font-mono [&>code]:text-[0.875em]">
      {children}
    </p>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-text-primary">{children}</strong>;
}

export function Em({ children }: { children: ReactNode }) {
  return <em className="italic">{children}</em>;
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[0.875em] text-text-primary">
      {children}
    </code>
  );
}

export function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-l-2 border-accent bg-surface-2/40 px-4 py-3 text-[14px] leading-6 text-text-secondary">
      {children}
    </blockquote>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'attribution';
  title?: string;
  children: ReactNode;
}) {
  const toneClass =
    tone === 'warning'
      ? 'border-warning bg-warning-subtle/40'
      : tone === 'attribution'
        ? 'border-accent bg-accent-subtle/30'
        : 'border-border-default bg-surface-2/40';
  return (
    <aside className={`rounded-md border-l-4 px-4 py-3 ${toneClass}`}>
      {title && <p className="mb-1 text-sm font-semibold text-text-primary">{title}</p>}
      <div className="text-[14px] leading-6 text-text-primary">{children}</div>
    </aside>
  );
}

// ── Lists ────────────────────────────────────────────────────────────────

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="ml-6 list-disc space-y-1.5 text-[15px] leading-7 text-text-primary marker:text-text-tertiary">
      {children}
    </ul>
  );
}

export function OL({ children }: { children: ReactNode }) {
  return (
    <ol className="ml-6 list-decimal space-y-1.5 text-[15px] leading-7 text-text-primary marker:text-text-tertiary">
      {children}
    </ol>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

// ── Tables ───────────────────────────────────────────────────────────────

export function Tbl({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <figure className="my-2 break-inside-avoid-page">
      {label && (
        <figcaption className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-tertiary">
          {label}
        </figcaption>
      )}
      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full border-collapse text-[13px] leading-5">{children}</table>
      </div>
    </figure>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-2 text-text-primary">{children}</thead>;
}

export function TR({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border-subtle last:border-0">{children}</tr>;
}

export function TH({
  children,
  width,
}: {
  children: ReactNode;
  width?: string;
}) {
  return (
    <th
      className="border-r border-border-subtle px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary last:border-r-0"
      style={width ? { width } : undefined}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  mono,
}: {
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`border-r border-border-subtle px-3 py-2 align-top text-text-primary last:border-r-0 ${
        mono ? 'font-mono text-[0.95em]' : ''
      }`}
    >
      {children}
    </td>
  );
}

// ── Code block ───────────────────────────────────────────────────────────

export function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border-subtle bg-surface-2 p-3 font-mono text-xs leading-5 text-text-primary">
      {children}
    </pre>
  );
}

// ── Definition table (meta box at the top of the doc) ────────────────────

export function MetaTable({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <Tbl>
      <tbody>
        {rows.map((r, i) => (
          <TR key={i}>
            <TH width="34%">{r.label}</TH>
            <TD>{r.value}</TD>
          </TR>
        ))}
      </tbody>
    </Tbl>
  );
}

export function HR() {
  return <hr className="my-2 border-t border-border-subtle" />;
}
