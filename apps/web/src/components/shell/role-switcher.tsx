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
  listScopesForImpersonationAction,
  setImpersonationAction,
} from '@/lib/actions/impersonation';

// All 12 roles, grouped by purpose. Mirrors @kku/shared/auth/roles.ts.
// Inlined to keep this file client-safe (the @kku/shared barrel imports
// node:crypto via pdf/hash; only `import type` from there).

type Role =
  | 'VIEWER'
  | 'COUNCIL'
  | 'EXECUTIVE'
  | 'DEAN'
  | 'DEPT_HEAD'
  | 'ANALYST'
  | 'ADMIN'
  | 'SUPER_ADMIN'
  | 'SYSTEM_ADMIN'
  | 'UNIVERSITY_USER'
  | 'FACULTY_USER'
  | 'PROGRAM_USER';

interface RoleEntry {
  value: Role;
  label: string;
  caption: string;
  needs: 'none' | 'faculty' | 'department';
  group: 'sso' | 'legacy';
}

const ROLES: ReadonlyArray<RoleEntry> = [
  // Canonical SSO taxonomy (v2)
  { value: 'SUPER_ADMIN', label: 'Super admin', caption: 'Full access — including queue management.', needs: 'none', group: 'sso' },
  { value: 'SYSTEM_ADMIN', label: 'System admin', caption: 'Admin-grade except queue management.', needs: 'none', group: 'sso' },
  { value: 'UNIVERSITY_USER', label: 'University user', caption: 'Read-all at university scope.', needs: 'none', group: 'sso' },
  { value: 'FACULTY_USER', label: 'Faculty user', caption: 'Read access scoped to one faculty.', needs: 'faculty', group: 'sso' },
  { value: 'PROGRAM_USER', label: 'Program user', caption: 'Read access scoped to one department.', needs: 'department', group: 'sso' },
  // Legacy taxonomy
  { value: 'COUNCIL', label: 'Council', caption: 'Council-level read; can edit decision measures.', needs: 'none', group: 'legacy' },
  { value: 'EXECUTIVE', label: 'Executive', caption: 'Council + scenario create/edit + decisions edit.', needs: 'none', group: 'legacy' },
  { value: 'DEAN', label: 'Dean', caption: 'Faculty-scoped manage + create scenarios.', needs: 'faculty', group: 'legacy' },
  { value: 'DEPT_HEAD', label: 'Department head', caption: 'Department-scoped read + manage own faculty.', needs: 'department', group: 'legacy' },
  { value: 'ANALYST', label: 'Analyst', caption: 'Cross-faculty edit + uploads + extraction approve.', needs: 'none', group: 'legacy' },
  { value: 'ADMIN', label: 'Admin (legacy)', caption: 'Equivalent to Super admin.', needs: 'none', group: 'legacy' },
  { value: 'VIEWER', label: 'Viewer', caption: 'Aggregate read-only — the floor.', needs: 'none', group: 'legacy' },
];

type Step = 'pick-role' | 'pick-scope';

interface ScopeData {
  faculties: Array<{ id: string; nameEn: string; nameTh: string }>;
  departments: Array<{
    id: string;
    nameEn: string;
    nameTh: string;
    facultyId: string;
    facultyNameEn: string;
  }>;
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
      // Lazy-load the scope lists — small payload, but cached after first open.
      if (!scopeData && !scopeLoading) {
        setScopeLoading(true);
        listScopesForImpersonationAction()
          .then((d) => setScopeData(d))
          .catch(() => setError('Could not load faculty + department lists.'))
          .finally(() => setScopeLoading(false));
      }
    }
  }, [open, scopeData, scopeLoading]);

  async function applyImpersonation(args: {
    role: Role;
    facultyId?: string | null;
    departmentId?: string | null;
  }) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await setImpersonationAction({
        role: args.role,
        facultyId: args.facultyId ?? null,
        departmentId: args.departmentId ?? null,
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
    } else {
      setFilter('');
      setStep('pick-scope');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] p-0">
        <DialogHeader className="px-6 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-[18px]">
                <ShieldCheck className="h-4 w-4 text-accent-default" aria-hidden />
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
            loading={scopeLoading}
            filter={filter}
            setFilter={setFilter}
            disabled={submitting}
            onBack={() => setStep('pick-role')}
            onConfirm={(facultyId, departmentId) =>
              applyImpersonation({
                role: chosenRole!.value,
                facultyId,
                departmentId,
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
        title="Canonical (KKU SSO v2)"
        items={ROLES.filter((r) => r.group === 'sso')}
        disabled={disabled}
        onPick={onPick}
        currentRole={currentRole}
      />
      <div className="mx-3 my-2 border-t border-border-subtle" />
      <RoleGroup
        title="Legacy"
        caption="Pre-v2 taxonomy retained for back-compat with seeded users + scenarios."
        items={ROLES.filter((r) => r.group === 'legacy')}
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
                    : r.needs === 'department'
                      ? 'bg-warning-subtle/60 text-warning-default'
                      : 'bg-surface-2',
                ].join(' ')}
              >
                {r.needs === 'faculty' ? (
                  <Building2 className="h-3.5 w-3.5" />
                ) : r.needs === 'department' ? (
                  <GraduationCap className="h-3.5 w-3.5" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
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
              <ArrowRight className="mt-1.5 h-3.5 w-3.5 flex-shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Scope picker — list of faculties or departments depending on role
// ─────────────────────────────────────────────────────────────────────────

function ScopePicker({
  chosen,
  scopeData,
  loading,
  filter,
  setFilter,
  disabled,
  onBack,
  onConfirm,
}: {
  chosen: RoleEntry;
  scopeData: ScopeData | null;
  loading: boolean;
  filter: string;
  setFilter: (v: string) => void;
  disabled: boolean;
  onBack: () => void;
  onConfirm: (facultyId: string | null, departmentId: string | null) => void;
}) {
  const items = React.useMemo(() => {
    if (!scopeData) return [] as Array<{ id: string; primary: string; secondary: string; facultyId: string }>;
    if (chosen.needs === 'faculty') {
      return scopeData.faculties
        .map((f) => ({ id: f.id, primary: f.nameEn, secondary: f.nameTh, facultyId: f.id }))
        .filter(matchesFilter(filter));
    }
    if (chosen.needs === 'department') {
      return scopeData.departments
        .map((d) => ({
          id: d.id,
          primary: d.nameEn,
          secondary: `${d.facultyNameEn} · ${d.nameTh}`,
          facultyId: d.facultyId,
        }))
        .filter(matchesFilter(filter));
    }
    return [];
  }, [scopeData, chosen, filter]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-2"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={
            chosen.needs === 'faculty' ? 'Search faculty…' : 'Search department or faculty…'
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
              : `No ${chosen.needs === 'faculty' ? 'faculties' : 'departments'} available.`}
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
              className="group flex w-full items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:border-border-subtle hover:bg-surface-2 disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text-primary">
                  {it.primary}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-text-tertiary">
                  {it.secondary}
                </div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
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
