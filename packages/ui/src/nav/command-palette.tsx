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
      <DialogContent className="p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Navigate or run an action.</DialogDescription>
        </DialogHeader>
        <Command className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
            <Search className="h-4 w-4 text-text-tertiary" aria-hidden />
            <Command.Input
              autoFocus
              placeholder="Search faculties, programs, actions…"
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            <kbd className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
              ⌘K
            </kbd>
          </div>
          <Command.List className="max-h-[420px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-xs text-text-tertiary">
              Nothing matches.
            </Command.Empty>

            <Command.Group heading="Navigate">
              <NavItem
                icon={<LayoutGrid className="h-3.5 w-3.5" />}
                label="Go to Home"
                onSelect={withClose(() => router.push('/'))}
              />
              <NavItem
                icon={<LayoutGrid className="h-3.5 w-3.5" />}
                label="Styleguide"
                onSelect={withClose(() => router.push('/styleguide'))}
              />
            </Command.Group>

            <Command.Group heading="Faculties">
              {entities.faculties.map((f) => (
                <NavItem
                  key={f.id}
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  label={f.nameEn}
                  sub={`${f.code} · ${f.nameTh}`}
                  keywords={`${f.code} ${f.nameTh}`}
                  onSelect={withClose(() => setScopeUrl('faculty', f.id))}
                />
              ))}
            </Command.Group>

            <Command.Group heading="Departments">
              {entities.departments.map((d) => (
                <NavItem
                  key={d.id}
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  label={d.nameEn}
                  sub={`${d.code} · ${d.nameTh}`}
                  keywords={`${d.code} ${d.nameTh}`}
                  onSelect={withClose(() => setScopeUrl('department', d.id))}
                />
              ))}
            </Command.Group>

            <Command.Group heading="Programs">
              {entities.programs.map((p) => (
                <NavItem
                  key={p.id}
                  icon={<GraduationCap className="h-3.5 w-3.5" />}
                  label={p.nameEn}
                  sub={`${p.code} · ${p.nameTh}`}
                  keywords={`${p.code} ${p.nameTh}`}
                  onSelect={withClose(() => setScopeUrl('program', p.id))}
                />
              ))}
            </Command.Group>

            {actions.length > 0 && (
              <Command.Group heading="Actions">
                {actions.map((a) => (
                  <NavItem
                    key={a.id}
                    label={a.label}
                    sub={a.hint}
                    keywords={a.keywords}
                    onSelect={withClose(a.run)}
                  />
                ))}
              </Command.Group>
            )}
          </Command.List>
          <div className="flex items-center justify-between border-t border-border-subtle bg-surface-2 px-3 py-1.5 text-[10px] text-text-tertiary">
            <span>Press ? for keyboard shortcuts</span>
            <span className="inline-flex items-center gap-1">
              <ArrowRight className="h-3 w-3" aria-hidden /> to select
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
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
        'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5',
        'aria-selected:bg-surface-2',
      )}
    >
      {icon && <span className="shrink-0 text-text-tertiary">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-text-primary">{label}</span>
        {sub && <span className="truncate text-xs text-text-tertiary">{sub}</span>}
      </div>
    </Command.Item>
  );
}
