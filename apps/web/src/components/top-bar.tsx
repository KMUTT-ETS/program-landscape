import { LanguageToggle } from './language-toggle';
import { ScopeSelector } from './scope-selector';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import type { SessionUser } from '@kku/shared';

export function TopBar({ user }: { user: SessionUser }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-surface-raised px-6 py-3">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div
            aria-hidden
            className="h-6 w-6 rounded-sm bg-brand"
            title="KKU Cardinal — brand accent"
          />
          <span className="font-semibold text-fg">Curriculum Landscape</span>
        </div>
        <ScopeSelector />
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden rounded-sm border border-border bg-surface-muted px-2 py-1 font-mono text-xs text-fg-muted md:inline">
          ⌘K  Search
        </span>
        <LanguageToggle />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
