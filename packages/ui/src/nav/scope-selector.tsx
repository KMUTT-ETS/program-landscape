'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { ScopeLevel } from '@kku/shared';
import { cn } from '../lib/cn';
import { Button } from '../primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';

// ScopeSelector — the single source of truth for the app-wide scope.
// URL param convention: `?scope=<level>&scopeId=<id>` (omitted scopeId
// for university). Every analytical query in the app reads these.
//
// Compare mode (pick 2–4 scopes) is DEFERRED to a follow-up prompt.

export interface ScopeEntity {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  /** For departments, the parent faculty code — lets us render "EN · CPE". */
  parentCode?: string;
}

export interface ScopeSelectorEntities {
  faculties: ScopeEntity[];
  departments: ScopeEntity[];
  programs: ScopeEntity[];
}

export interface ScopeAccess {
  universityRead: boolean;
  allFacultiesRead: boolean;
  ownFacultyId: string | null;
  ownDepartmentId: string | null;
}

export interface ScopeSelectorProps {
  entities: ScopeSelectorEntities;
  /** Filters the picker list per RBAC; see docs/auth/rbac.md. */
  access: ScopeAccess;
  /** Called after the URL has been updated. Useful for analytics. */
  onChange?: (level: ScopeLevel, id: string | null) => void;
  /** The organisation's short name (from /admin/organization); roots the breadcrumb. */
  orgShortName?: string;
}

const LEVEL_LABEL: Record<ScopeLevel, string> = {
  university: 'University',
  faculty: 'Faculty',
  department: 'Department',
  program: 'Program',
};

export function ScopeSelector({
  entities,
  access,
  onChange,
  orgShortName = 'University',
}: ScopeSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const level = (searchParams.get('scope') as ScopeLevel) ?? 'university';
  const scopeId = searchParams.get('scopeId');
  const [open, setOpen] = React.useState(false);

  // Build breadcrumb for the current selection.
  const breadcrumb = React.useMemo(() => {
    if (level === 'university') return [orgShortName];
    if (level === 'faculty') {
      const f = entities.faculties.find((x) => x.id === scopeId);
      return f ? [orgShortName, f.nameEn] : [orgShortName, scopeId ?? '—'];
    }
    if (level === 'department') {
      const d = entities.departments.find((x) => x.id === scopeId);
      if (!d) return [orgShortName, scopeId ?? '—'];
      const f = entities.faculties.find(
        (x) => x.code === d.parentCode,
      );
      return [orgShortName, f?.nameEn ?? '—', d.nameEn];
    }
    if (level === 'program') {
      const p = entities.programs.find((x) => x.id === scopeId);
      if (!p) return [orgShortName, scopeId ?? '—'];
      return [orgShortName, p.parentCode ?? '—', p.nameEn];
    }
    return [orgShortName];
  }, [level, scopeId, entities, orgShortName]);

  const setScope = React.useCallback(
    (nextLevel: ScopeLevel, nextId: string | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (nextLevel === 'university') {
        sp.delete('scope');
        sp.delete('scopeId');
      } else {
        sp.set('scope', nextLevel);
        if (nextId) sp.set('scopeId', nextId);
        else sp.delete('scopeId');
      }
      const query = sp.toString();
      router.push(query ? `?${query}` : '?');
      onChange?.(nextLevel, nextId);
      setOpen(false);
    },
    [router, searchParams, onChange],
  );

  // Filter entities by RBAC.
  const visibleFaculties = React.useMemo(() => {
    if (access.allFacultiesRead) return entities.faculties;
    return entities.faculties.filter((f) => f.id === access.ownFacultyId);
  }, [entities.faculties, access]);

  const visibleDepartments = React.useMemo(() => {
    // DEPT_HEAD sees their own department only; DEAN sees own-faculty depts;
    // everyone else (with allFacultiesRead) sees all.
    if (access.allFacultiesRead) return entities.departments;
    if (access.ownDepartmentId) {
      return entities.departments.filter((d) => d.id === access.ownDepartmentId);
    }
    if (access.ownFacultyId) {
      const parentCode = entities.faculties.find((f) => f.id === access.ownFacultyId)?.code;
      return parentCode
        ? entities.departments.filter((d) => d.parentCode === parentCode)
        : [];
    }
    return [];
  }, [entities.departments, entities.faculties, access]);

  const visiblePrograms = React.useMemo(() => {
    if (access.allFacultiesRead) return entities.programs;
    // Programs are filtered by the visible faculty/department codes the
    // user has — a cheap proxy; apps/api enforces authoritatively.
    const facCodes = new Set(visibleFaculties.map((f) => f.code));
    return entities.programs.filter((p) => p.parentCode && facCodes.has(p.parentCode.split('-')[0] ?? ''));
  }, [entities.programs, visibleFaculties, access.allFacultiesRead]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Raw button (not the shared Button) so the scope pill can use
            the accent-on-cardinal treatment without clashing with the
            default surface-tinted Button variants. Max-width keeps long
            breadcrumbs (e.g. "Faculty of Agricultural Tech · Dept of
            Plant Science · Program of …") from running into the search
            trigger to the right — they truncate inside the pill. */}
        <button
          type="button"
          aria-label="Change scope"
          className="group flex h-9 min-w-0 max-w-[320px] items-center gap-2 rounded-md bg-surface-1 px-2.5 text-left ring-1 ring-inset ring-border-subtle transition-colors duration-fast hover:bg-surface-2 hover:ring-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/40"
        >
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
            Scope
          </span>
          <span className="truncate text-[13px] font-medium text-text-primary">
            {breadcrumb.slice(1).length > 0
              ? breadcrumb.slice(1).join(' · ')
              : 'University'}
          </span>
          <ChevronDown className="size-icon-sm shrink-0 text-text-tertiary transition-transform duration-fast group-data-[state=open]:rotate-180" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <Search className="size-icon-sm text-text-tertiary" aria-hidden />
            <Command.Input
              autoFocus
              placeholder="Search scope…"
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
          </div>
          <Command.List className="max-h-[360px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-xs text-text-tertiary">
              No matches.
            </Command.Empty>

            {access.universityRead && (
              <Command.Group heading={LEVEL_LABEL.university}>
                <ScopeItem
                  label={`${orgShortName} — All programs`}
                  sub="University-wide rollup"
                  active={level === 'university'}
                  onSelect={() => setScope('university', null)}
                />
              </Command.Group>
            )}

            {visibleFaculties.length > 0 && (
              <Command.Group heading={LEVEL_LABEL.faculty}>
                {visibleFaculties.map((f) => (
                  <ScopeItem
                    key={f.id}
                    label={f.nameEn}
                    sub={`${f.code} · ${f.nameTh}`}
                    keywords={`${f.code} ${f.nameTh}`}
                    active={level === 'faculty' && scopeId === f.id}
                    onSelect={() => setScope('faculty', f.id)}
                  />
                ))}
              </Command.Group>
            )}

            {visibleDepartments.length > 0 && (
              <Command.Group heading={LEVEL_LABEL.department}>
                {visibleDepartments.map((d) => (
                  <ScopeItem
                    key={d.id}
                    label={d.nameEn}
                    sub={`${d.code} · ${d.nameTh}`}
                    keywords={`${d.code} ${d.nameTh}`}
                    active={level === 'department' && scopeId === d.id}
                    onSelect={() => setScope('department', d.id)}
                  />
                ))}
              </Command.Group>
            )}

            {visiblePrograms.length > 0 && (
              <Command.Group heading={LEVEL_LABEL.program}>
                {visiblePrograms.map((p) => (
                  <ScopeItem
                    key={p.id}
                    label={p.nameEn}
                    sub={`${p.code} · ${p.nameTh}`}
                    keywords={`${p.code} ${p.nameTh}`}
                    active={level === 'program' && scopeId === p.id}
                    onSelect={() => setScope('program', p.id)}
                  />
                ))}
              </Command.Group>
            )}
          </Command.List>
          <div className="border-t border-border-subtle bg-surface-2 px-3 py-2 text-[10px] text-text-tertiary">
            Compare mode (2–4 scopes side-by-side) — next session.
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ScopeItem({
  label,
  sub,
  active,
  keywords,
  onSelect,
}: {
  label: string;
  sub: string;
  active: boolean;
  keywords?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={`${label} ${keywords ?? ''}`}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5',
        'aria-selected:bg-surface-2',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-text-primary">{label}</span>
        <span className="truncate text-xs text-text-tertiary">{sub}</span>
      </div>
      {active && <Check className="size-icon-sm text-accent-default" aria-hidden />}
    </Command.Item>
  );
}
