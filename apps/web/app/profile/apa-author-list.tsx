// APA-7 author block for the /profile citation list, as React nodes so the
// profile owner's name can be wrapped in <strong>. Lives outside
// profile-view.tsx so it can be rendered in a test without the whole page.
import * as React from 'react';
import type { AuthorName } from '@/lib/profile-types';
import { formatAuthorApa } from '@/lib/profile-types';

export function isOwnerAuthor(a: AuthorName, ownerSurname: string | null): boolean {
  if (!ownerSurname) return false;
  const normalised = (a.family ?? '').trim().toLocaleLowerCase();
  return normalised.length > 0 && normalised === ownerSurname;
}

/**
 * Commas, serial "&", and APA 7 §9.8 truncation (21+ authors → first 19,
 * "...", last) — but only when `complete` is true. The "&" before the final
 * name asserts the list is whole; a list we know is partial (Google Scholar
 * shortened it, or only the KKU authors are known) instead lists every name
 * it has and ends with ", …", so the byline never claims more than it knows.
 */
export function buildAuthorListJsx(
  authors: AuthorName[],
  ownerSurname: string | null,
  complete: boolean,
): React.ReactNode {
  if (authors.length === 0) return null;
  const items = authors
    .map((a) => ({ text: formatAuthorApa(a), isOwner: isOwnerAuthor(a, ownerSurname) }))
    .filter((it) => it.text.length > 0);
  if (items.length === 0) return null;

  const useEllipsis = complete && items.length > 20;
  const display = useEllipsis ? [...items.slice(0, 19), items[items.length - 1]!] : items;

  const parts: React.ReactNode[] = [];
  display.forEach((item, i) => {
    parts.push(
      item.isOwner ? (
        <strong key={`a${i}`} className="font-semibold">
          {item.text}
        </strong>
      ) : (
        <React.Fragment key={`a${i}`}>{item.text}</React.Fragment>
      ),
    );
    if (i < display.length - 1) {
      const isSecondToLast = i === display.length - 2;
      const sep = !complete || !isSecondToLast ? ', ' : useEllipsis ? ', ... ' : ', & ';
      parts.push(<React.Fragment key={`s${i}`}>{sep}</React.Fragment>);
    }
  });
  if (!complete) {
    parts.push(<React.Fragment key="trail">{', … '}</React.Fragment>);
  } else {
    // One period before "(Year)" — an author ending in an initial already has it.
    const last = display[display.length - 1]!.text;
    parts.push(<React.Fragment key="trail">{last.endsWith('.') ? ' ' : '. '}</React.Fragment>);
  }
  return parts;
}
