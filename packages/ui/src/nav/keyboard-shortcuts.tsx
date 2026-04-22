'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../primitives/dialog';

// Pressing "?" (when not in an input) opens this sheet. Every module
// registers its own shortcuts by passing entries to `shortcuts`.

export interface Shortcut {
  keys: string[];
  description: string;
  group?: string;
}

export interface KeyboardShortcutsProps {
  shortcuts: Shortcut[];
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function KeyboardShortcuts({ shortcuts }: KeyboardShortcutsProps) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === '?' && !isTyping(e) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((x) => !x);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [open]);

  const grouped = React.useMemo(() => {
    const out: Record<string, Shortcut[]> = {};
    for (const s of shortcuts) {
      const g = s.group ?? 'General';
      (out[g] ??= []).push(s);
    }
    return out;
  }, [shortcuts]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press <kbd className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">?</kbd>{' '}
            any time to open this sheet.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([group, items]) => (
            <section key={group} className="flex flex-col gap-1.5">
              <h3 className="text-xs uppercase tracking-wide text-text-tertiary">
                {group}
              </h3>
              <ul className="flex flex-col gap-1">
                {items.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="text-text-primary">{s.description}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
