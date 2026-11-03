'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@kku/ui';
import { ArrowLeft, ArrowRight, Building2, GraduationCap, ShieldCheck, X } from 'lucide-react';
import {
  getOwnScopesForImpersonationAction,
  listScopesForImpersonationAction,
  setImpersonationAction,
} from '@/lib/actions/impersonation';

// 5 v2 SSO roles. Mirrors @kku/shared/auth/roles.ts. Inlined to keep
// this file client-safe (the @kku/shared barrel imports node:crypto via
// pdf/hash; only `import type` from there).

type Role =
  | 'SUPER_ADMIN'
  | 'SYSTEM_ADMIN'
  | 'UNIVERSITY_USER'
  | 'FACULTY_USER'
  | 'PROGRAM_USER';

interface RoleEntry {
  value: Role;
  label: string;
  caption: string;
  needs: 'none' | 'faculty' | 'program';
}

const ROLES: ReadonlyArray<RoleEntry> = [
  { value: 'SUPER_ADMIN', label: 'Super admin', caption: 'Full access — including queue management.', needs: 'none' },
  { value: 'SYSTEM_ADMIN', label: 'System admin', caption: 'Admin-grade except queue management.', needs: 'none' },
  { value: 'UNIVERSITY_USER', label: 'University user', caption: 'Read-all at university scope.', needs: 'none' },
  { value: 'FACULTY_USER', label: 'Faculty user', caption: 'Read access scoped to one faculty.', needs: 'faculty' },
  { value: 'PROGRAM_USER', label: 'Program user', caption: 'Read access scoped to one specific program.', needs: 'program' },
];

type Step = 'pick-role' | 'pick-scope';

interface ScopeData {
  faculties: Array<{ id: string; nameEn: string; nameTh: string }>;
  programs: Array<{
    id: string;
    code: string;
    nameEn: string;
    nameTh: string;
    facultyId: string;
    facultyNameEn: string;
  }>;
}

// User's own assigned scopes — preferred over the global picker when
// the impersonator wants to "be" one of their own assigned roles. Lets
// a super-admin who's also assigned FACULTY_USER · Engineering pick
// "Faculty user" and land directly on Engineering with no second prompt.
interface OwnScope {
  id: string;
  role: string;
  facultyId: string | null;
  programId: string | null;
  facultyLabel: string | null;
  programLabel: string | null;
}

export function RoleSwitcherDialog({
  open,
  onOpenChange,
  currentRole,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRole: string;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>('pick-role');
  const [chosenRole, setChosenRole] = React.useState<RoleEntry | null>(null);
  const [scopeData, setScopeData] = React.useState<ScopeData | null>(null);
  const [ownScopes, setOwnScopes] = React.useState<OwnScope[] | null>(null);
  const [scopeLoading, setScopeLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [filter, setFilter] = React.useState('');

  // Reset state whenever the dialog re-opens.
  React.useEffect(() => {
    if (open) {
      setStep('pick-role');
      setChosenRole(null);
      setError(null);
      setFilter('');
      // Lazy-load the scope lists + own-scopes — small payload, cached after first open.
      if ((!scopeData || !ownScopes) && !scopeLoading) {
        setScopeLoading(true);
        Promise.all([
          listScopesForImpersonationAction(),
          getOwnScopesForImpersonationAction(),
        ])
          .then(([d, own]) => {
            setScopeData(d);
            setOwnScopes(own);
          })
          .catch(() => setError('Could not load faculty + program lists.'))
          .finally(() => setScopeLoading(false));
      }
    }
  }, [open, scopeData, ownScopes, scopeLoading]);

  async function applyImpersonation(args: {
    role: Role;
    facultyId?: string | null;
    programId?: string | null;
  }) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await setImpersonationAction({
        role: args.role,
        facultyId: args.facultyId ?? null,
        programId: args.programId ?? null,
      });
      if (!res.ok) {
        setError(res.error ?? 'Failed to switch role.');
        return;
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function selectRole(role: RoleEntry) {
    setChosenRole(role);
    setError(null);
    if (role.needs === 'none') {
      void applyImpersonation({ role: role.value });
      return;
    }
    // Auto-pick from the user's own UserScope rows when there's an
    // unambiguous match. A super-admin who already has
    // FACULTY_USER · Engineering as one of their assignments shouldn't
    // need to re-pick the faculty when switching to FACULTY_USER.
    const ownMatches = (ownScopes ?? []).filter((s) => s.role === role.value);
    if (ownMatches.length === 1) {
      const m = ownMatches[0]!;
      void applyImpersonation({
        role: role.value,
        facultyId: m.facultyId,
        programId: m.programId,
      });
      return;
    }
    setFilter('');
    setStep('pick-scope');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] p-0">
        <DialogHeader className="px-6 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-[18px]">
                <ShieldCheck className="size-icon-md text-accent-default" aria-hidden />
                {step === 'pick-role' ? 'Switch role' : 'Pick scope'}
              </DialogTitle>
              <DialogDescription className="text-[12px] text-text-tertiary">
                {step === 'pick-role'
                  ? 'Preview the app from any role. Your real account stays super-grade — this is a view-only override.'
                  : `Pick which ${chosenRole?.needs} the ${chosenRole?.label} should be scoped to.`}
              </DialogDescription>
            </div>
            <Badge tone="info" className="hidden items-center gap-1 sm:inline-flex">
              Currently {currentRole.replaceAll('_', ' ')}
            </Badge>
          </div>
        </DialogHeader>

        {error && (
          <div className="mx-6 mb-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}

        {step === 'pick-role' ? (
          <RolePicker disabled={submitting} onPick={selectRole} currentRole={currentRole} />
        ) : (
          <ScopePicker
            chosen={chosenRole!}
            scopeData={scopeData}
            ownScopes={ownScopes ?? []}
            loading={scopeLoading}
            filter={filter}
            setFilter={setFilter}
            disabled={submitting}
            onBack={() => setStep('pick-role')}
            onConfirm={(facultyId, programId) =>
              applyImpersonation({
                role: chosenRole!.value,
                facultyId,
                programId,
              })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Role picker — list of 12 roles, grouped sso vs legacy
// ─────────────────────────────────────────────────────────────────────────

function RolePicker({
  disabled,
  onPick,
  currentRole,
}: {
  disabled: boolean;
  onPick: (role: RoleEntry) => void;
  currentRole: string;
}) {
  return (
    <div className="max-h-[60vh] overflow-y-auto px-2 pb-4">
      <RoleGroup
        title="SSO roles"
        items={ROLES}
        disabled={disabled}
        onPick={onPick}
        currentRole={currentRole}
      />
    </div>
  );
}

function RoleGroup({
  title,
  caption,
  items,
  disabled,
  onPick,
  currentRole,
}: {
  title: string;
  caption?: string;
  items: ReadonlyArray<RoleEntry>;
  disabled: boolean;
  onPick: (role: RoleEntry) => void;
  currentRole: string;
}) {
  return (
    <div>
      <div className="mb-1 px-3 pt-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
          {title}
        </div>
        {caption && (
          <div className="mt-0.5 text-[11px] leading-relaxed text-text-tertiary/80">
            {caption}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {items.map((r) => {
          const isCurrent = r.value === currentRole;
          return (
            <button
              key={r.value}
              type="button"
              disabled={disabled}
              onClick={() => onPick(r)}
              className={[
                'group flex w-full items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left',
                'transition-colors disabled:opacity-50',
                isCurrent
                  ? 'bg-accent-subtle/60 border-accent/30'
                  : 'hover:bg-surface-2 hover:border-border-subtle',
              ].join(' ')}
            >
              <div
                className={[
                  'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border-subtle text-text-secondary',
                  r.needs === 'faculty'
                    ? 'bg-info-subtle/60 text-info'
                    : r.needs === 'program'
                      ? 'bg-warning-subtle/60 text-warning-default'
                      : 'bg-surface-2',
                ].join(' ')}
              >
                {r.needs === 'faculty' ? (
                  <Building2 className="size-icon-sm" />
                ) : r.needs === 'program' ? (
                  <GraduationCap className="size-icon-sm" />
                ) : (
                  <ShieldCheck className="size-icon-sm" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary">
                    {r.label}
                  </span>
                  {r.needs !== 'none' && (
                    <span className="rounded bg-surface-2 px-1.5 py-0 text-[9.5px] font-semibold uppercase tracking-wider text-text-tertiary">
                      needs {r.needs}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="rounded bg-accent-subtle px-1.5 py-0 text-[9.5px] font-semibold uppercase tracking-wider text-accent-default">
                      current
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-relaxed text-text-tertiary">
                  {r.caption}
                </div>
              </div>
              <ArrowRight className="mt-1.5 size-icon-sm flex-shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Scope picker — list of faculties or programs depending on role
// ─────────────────────────────────────────────────────────────────────────

function ScopePicker({
  chosen,
  scopeData,
  ownScopes,
  loading,
  filter,
  setFilter,
  disabled,
  onBack,
  onConfirm,
}: {
  chosen: RoleEntry;
  scopeData: ScopeData | null;
  ownScopes: OwnScope[];
  loading: boolean;
  filter: string;
  setFilter: (v: string) => void;
  disabled: boolean;
  onBack: () => void;
  onConfirm: (facultyId: string | null, programId: string | null) => void;
}) {
  // Set of (facultyId / programId) the impersonator is themselves
  // assigned for this role — used to mark them as "your scope" in the
  // picker so the operator can spot their own preferred scope quickly.
  const ownIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const s of ownScopes) {
      if (s.role !== chosen.value) continue;
      if (chosen.needs === 'faculty' && s.facultyId) set.add(s.facultyId);
      if (chosen.needs === 'program' && s.programId) set.add(s.programId);
    }
    return set;
  }, [ownScopes, chosen]);

  const items = React.useMemo(() => {
    if (!scopeData) return [] as Array<{ id: string; primary: string; secondary: string; facultyId: string; isOwn: boolean }>;
    if (chosen.needs === 'faculty') {
      return scopeData.faculties
        .map((f) => ({
          id: f.id,
          primary: f.nameEn,
          secondary: f.nameTh,
          facultyId: f.id,
          isOwn: ownIds.has(f.id),
        }))
        .filter(matchesFilter(filter))
        // Show user's own scopes first.
        .sort((a, b) => Number(b.isOwn) - Number(a.isOwn));
    }
    if (chosen.needs === 'program') {
      return scopeData.programs
        .map((p) => ({
          id: p.id,
          primary: `${p.code} — ${p.nameEn}`,
          secondary: `${p.facultyNameEn} · ${p.nameTh}`,
          facultyId: p.facultyId,
          isOwn: ownIds.has(p.id),
        }))
        .filter(matchesFilter(filter))
        .sort((a, b) => Number(b.isOwn) - Number(a.isOwn));
    }
    return [];
  }, [scopeData, chosen, filter, ownIds]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-2"
        >
          <ArrowLeft className="size-icon-xs" />
          Back
        </button>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={
            chosen.needs === 'faculty' ? 'Search faculty…' : 'Search program or faculty…'
          }
          className="flex-1 rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1 text-[12px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-default"
        />
      </div>

      <div className="max-h-[55vh] overflow-y-auto px-2 pb-4">
        {loading && (
          <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
            Loading scope list…
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
            {filter
              ? `No matches for "${filter}".`
              : `No ${chosen.needs === 'faculty' ? 'faculties' : 'programs'} available.`}
          </div>
        )}
        <div className="grid grid-cols-1 gap-1">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              disabled={disabled}
              onClick={() =>
                chosen.needs === 'faculty'
                  ? onConfirm(it.id, null)
                  : onConfirm(it.facultyId, it.id)
              }
              className={[
                'group flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50',
                it.isOwn
                  ? 'border-accent/30 bg-accent-subtle/40 hover:bg-accent-subtle/70'
                  : 'border-transparent hover:border-border-subtle hover:bg-surface-2',
              ].join(' ')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary">
                    {it.primary}
                  </span>
                  {it.isOwn && (
                    <span className="rounded bg-accent/15 px-1.5 py-0 text-[9.5px] font-semibold uppercase tracking-wider text-accent-default">
                      your scope
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-text-tertiary">
                  {it.secondary}
                </div>
              </div>
              <ArrowRight className="size-icon-sm flex-shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function matchesFilter(filter: string) {
  if (!filter.trim()) return () => true;
  const needle = filter.toLowerCase().trim();
  return (it: { primary: string; secondary: string }) =>
    it.primary.toLowerCase().includes(needle) ||
    it.secondary.toLowerCase().includes(needle);
}

// Re-export an unused icon so we don't drop it from the import list
// while wiring the dialog through nav. Keeps tree-shaking happy AND
// future maintainers from "ugh why does this file import X".
void X;
