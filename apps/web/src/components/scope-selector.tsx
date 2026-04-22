// Placeholder. Full build (URL-synced, keyboard-navigable, RBAC-aware) is
// delivered in prompt 02b in packages/ui. This stub demonstrates the slot
// and maps to the URL param convention used everywhere else.

import Link from 'next/link';

export function ScopeSelector() {
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <span className="font-medium text-fg">Scope:</span>
      <span className="rounded-sm bg-surface-muted px-2 py-1 text-fg">
        University
      </span>
      <span className="text-fg-subtle">(full selector in prompt 02b)</span>
      <Link
        href="/?scope=faculty&scopeId=EN"
        className="hidden text-accent hover:underline md:inline"
      >
        try ?scope=faculty
      </Link>
    </div>
  );
}
