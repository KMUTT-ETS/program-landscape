import type { ReactNode } from 'react';

export interface SectionProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  // Forces the section onto a fresh page. Used for major divisions of
  // the Council Pack.
  breakBefore?: boolean;
}

export function Section(props: SectionProps) {
  const classes = ['section', 'no-orphans'];
  if (props.breakBefore) classes.push('page-break-before');
  return (
    <section className={classes.join(' ')}>
      <h2>{props.title}</h2>
      {props.subtitle && <p className="muted" style={{ marginTop: '-4pt' }}>{props.subtitle}</p>}
      {props.children}
    </section>
  );
}
