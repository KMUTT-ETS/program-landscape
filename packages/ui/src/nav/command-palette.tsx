'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  ArrowRight,
  Building2,
  GraduationCap,
  LayoutGrid,
  Search,
} from 'lucide-react';
import { cn } from '../lib/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../primitives/dialog';
import type { ScopeSelectorEntities } from './scope-selector';

// App-wide Cmd/Ctrl+K palette. Fuzzy-searches across:
//   - Faculties, Departments, Programs (navigate + set scope)
//   - Static actions (go home, go to styleguide, open docs, sign out)
//
// The palette is deliberately lean in this prompt; modules register
// their own commands in prompts 05–12 via the `actions` prop.

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  group?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  entities: ScopeSelectorEntities;
  actions?: PaletteAction[];
}

export function CommandPalette({ entities, actions = [] }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((x) => !x);
      }
    };
    // Custom event channel so the TopBar's visible search trigger can
    // open the palette without simulating a keyboard event (which is
    // fragile across browsers + triggers a11y focus weirdness).
    const onCustom = () => setOpen(true);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('kku:command-palette-open', onCustom);
    return () => {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('kku:command-palette-open', onCustom);
    };
  }, []);

  const setScopeUrl = (scope: string, id: string | null) => {
    const sp = new URLSearchParams(window.location.search);
    if (scope === 'university') {
      sp.delete('scope');
      sp.delete('scopeId');
    } else {
      sp.set('scope', scope);
      if (id) sp.set('scopeId', id);
    }
    router.push(window.location.pathname + (sp.size ? `?${sp.toString()}` : ''));
  };

  const withClose = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="!p-0 !w-[min(640px,92vw)]">
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Navigate or run an action.</DialogDescription>
        </DialogHeader>
        <Command className="flex flex-col">
          {/* Search input row — bigger search icon, generous padding,
              accent edge underline. */}
          <div className="relative flex items-center gap-3.5 border-b border-border-subtle px-5 py-4">
            <Search className="h-5 w-5 shrink-0 text-accent-default" aria-hidden strokeWidth={1.8} />
            <Command.Input
              autoFocus
              placeholder="Search faculties, departments, programs, actions…"
              className="w-full bg-transparent text-base font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            <kbd className="hidden shrink-0 items-center gap-1 rounded-full bg-accent-subtle px-2.5 py-1 font-mono text-[11px] font-semibold text-accent-default sm:inline-flex">
              ESC
            </kbd>
            {/* Accent underline echoing the EdgeGlow vocabulary. */}
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-default/40 to-transparent"
            />
          </div>

          <Command.List className="max-h-[480px] overflow-y-auto px-3 py-3">
            <Command.Empty className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <Search className="h-6 w-6 text-text-tertiary" aria-hidden strokeWidth={1.5} />
              <span className="text-sm font-medium text-text-secondary">Nothing matches.</span>
              <span className="text-xs text-text-tertiary">Try a different keyword or browse the sidebar.</span>
            </Command.Empty>

            <PaletteGroup heading="Navigate">
              <NavItem
                icon={<LayoutGrid className="h-4 w-4" />}
                label="Go to Home"
                onSelect={withClose(() => router.push('/'))}
              />
              <NavItem
                icon={<LayoutGrid className="h-4 w-4" />}
                label="Styleguide"
                onSelect={withClose(() => router.push('/styleguide'))}
              />
            </PaletteGroup>

            <PaletteGroup heading="Faculties">
              {entities.faculties.map((f) => (
                <NavItem
                  key={f.id}
                  icon={<Building2 className="h-4 w-4" />}
                  label={f.nameEn}
                  sub={`${f.code} · ${f.nameTh}`}
                  keywords={`${f.code} ${f.nameTh}`}
                  onSelect={withClose(() => setScopeUrl('faculty', f.id))}
                />
              ))}
            </PaletteGroup>

            <PaletteGroup heading="Departments">
              {entities.departments.map((d) => (
                <NavItem
                  key={d.id}
                  icon={<Building2 className="h-4 w-4" />}
                  label={d.nameEn}
                  sub={`${d.code} · ${d.nameTh}`}
                  keywords={`${d.code} ${d.nameTh}`}
                  onSelect={withClose(() => setScopeUrl('department', d.id))}
                />
              ))}
            </PaletteGroup>

            <PaletteGroup heading="Programs">
              {entities.programs.map((p) => (
                <NavItem
                  key={p.id}
                  icon={<GraduationCap className="h-4 w-4" />}
                  label={p.nameEn}
                  sub={`${p.code} · ${p.nameTh}`}
                  keywords={`${p.code} ${p.nameTh}`}
                  onSelect={withClose(() => setScopeUrl('program', p.id))}
                />
              ))}
            </PaletteGroup>

            {actions.length > 0 && (
              <PaletteGroup heading="Actions">
                {actions.map((a) => (
                  <NavItem
                    key={a.id}
                    label={a.label}
                    sub={a.hint}
                    keywords={a.keywords}
                    onSelect={withClose(a.run)}
                  />
                ))}
              </PaletteGroup>
            )}
          </Command.List>

          {/* Footer — coral-tinted hairline + tactile keyboard hints. */}
          <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3 text-[11px] text-text-tertiary">
            <span className="flex items-center gap-2">
              <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-secondary ring-1 ring-inset ring-border-subtle">?</kbd>
              for keyboard shortcuts
            </span>
            <span className="inline-flex items-center gap-2">
              <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-secondary ring-1 ring-inset ring-border-subtle">↵</kbd>
              <ArrowRight className="h-3 w-3" aria-hidden />
              to select
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// Group with a coral semibold heading echoing dropdown labels +
// sidebar section eyebrows. cmdk hides the heading via the `heading`
// prop API but renders it always; we wrap to also style the spacing.
function PaletteGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={heading}
      className={cn(
        '[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:gap-2',
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5',
        '[&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-bold',
        '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em]',
        '[&_[cmdk-group-heading]]:text-accent-default',
      )}
    >
      {children}
    </Command.Group>
  );
}

function NavItem({
  icon,
  label,
  sub,
  keywords,
  onSelect,
}: {
  icon?: React.ReactNode;
  label: string;
  sub?: string;
  keywords?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={`${label} ${sub ?? ''} ${keywords ?? ''}`}
      onSelect={onSelect}
      className={cn(
        // Pill items, generous icon-text gap, accent-tinted selected
        // state with a coral side-rail.
        'group relative flex cursor-pointer items-center gap-3.5 rounded-2xl px-3.5 py-2.5',
        'transition-[background-color,color] duration-fast',
        'aria-selected:bg-accent-subtle aria-selected:text-accent-default',
      )}
    >
      {icon && (
        <span
          aria-hidden
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-full',
            'bg-surface-2 text-text-tertiary ring-1 ring-inset ring-border-subtle',
            'transition-colors duration-fast',
            'group-aria-selected:bg-accent group-aria-selected:text-accent-fg group-aria-selected:ring-accent/30',
          )}
        >
          {icon}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-text-primary group-aria-selected:text-accent-default">
          {label}
        </span>
        {sub && <span className="mt-0.5 truncate text-xs text-text-tertiary">{sub}</span>}
      </div>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-transparent group-aria-selected:text-accent-default transition-colors"
        aria-hidden
      />
    </Command.Item>
  );
}
