import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';

// Tiny breadcrumb-style nav for /admin/* sub-pages. Every admin page
// should render one near the top so the operator can:
//   - jump back to /admin in one click (matches the home pattern)
//   - see where they are inside the admin tree (the `current` label)
//   - optionally see an intermediate group label (e.g. "Programs" when
//     viewing /admin/programs/[id])
//
// Intentionally lightweight — pure server-renderable, no client state.
// Sits ABOVE the page's PageHeader so the eyebrow / title / actions
// block can stay focused on the page's own concern.

export function AdminBackNav({
  current,
  group,
  groupHref,
}: {
  /** The current page's label, e.g. "Risk profile" or "AI extraction review". */
  current: string;
  /** Optional intermediate group (e.g. "Programs" when viewing /admin/programs/[id]). */
  group?: string;
  /** Where the intermediate group label links to. Required when `group` is set. */
  groupHref?: string;
}) {
  return (
    <nav
      aria-label="Admin breadcrumb"
      className="mb-3 flex items-center gap-2 text-xs text-text-tertiary"
    >
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        <span>Admin console</span>
      </Link>
      {group && groupHref ? (
        <>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <Link
            href={groupHref}
            className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
          >
            {group}
          </Link>
        </>
      ) : null}
      <ChevronRight className="h-3 w-3" aria-hidden />
      <span className="rounded px-1.5 py-0.5 text-text-primary">{current}</span>
    </nav>
  );
}
