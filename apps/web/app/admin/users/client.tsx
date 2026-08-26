'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Input, Button } from '@kku/ui';
import { Search, Plus, Trash2, Key, Check, Pencil, X, Layers, ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight } from 'lucide-react';
import {
  FilterField,
  FilterRail,
  FilterSearch,
  FilterSelect,
} from '@/components/filter-rail';
import { toast } from 'sonner';
import { type Role } from '@kku/shared';
import {
  searchKkuEmployeeAction,
  provisionUserAction,
  deleteUserAction,
  setUserPasswordAction,
  addUserScopeAction,
  removeUserScopeAction,
} from '@/lib/actions/admin-users';

// Inlined from packages/shared/src/auth/roles.ts. These two arrays are
// runtime values (not types), so importing them from the @kku/shared
// barrel would force Webpack to evaluate the barrel — which re-exports
// './pdf', './ai', './identity', './ingestion', each of which imports
// node:crypto. The client bundler can't handle node:crypto and crashes
// with 'UnhandledSchemeError'. Other client files in this app only
// `import type` from @kku/shared, so they don't trigger the trap. If
// either array drifts from roles.ts, the roles.test.ts unit test in
// packages/shared catches the divergence.
const SSO_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER',
] as const;

const SYSTEM_ADMIN_ASSIGNABLE_ROLES: readonly Role[] = [
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER',
] as const;

// Inlined client-side copy of deriveDisplayName from the server-only
// kku/employee-api.ts. Keeping it here avoids pulling the API client
// (with its env reads + secret_key handling) into the client bundle.
// Field names mirror the live KKU /v3/hr/employee/filter/email/{email}
// response — Thai title + firstname + lastname preferred, English
// fallback. PII fields (`identification`, `pass`) are scrubbed
// server-side before this function ever sees the record.
function deriveDisplayName(emp: Record<string, unknown>): string {
  const t = (k: string): string | null => {
    const v = emp[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const titleTh = t('title');
  const fnTh = t('firstname');
  const lnTh = t('lastname');
  if (fnTh && lnTh) return [titleTh, fnTh, lnTh].filter(Boolean).join(' ');
  const titleEn = t('title_eng');
  const fnEn = t('firstname_eng');
  const lnEn = t('lastname_eng');
  if (fnEn && lnEn) return [titleEn, fnEn, lnEn].filter(Boolean).join(' ');
  return t('email') ?? '(unnamed)';
}

// Mirrors the role-scope axis declared in the impersonation helper.
// Inlined here because client.tsx is `'use client'` and pulling
// `roleNeedsFaculty` from @/lib/auth/impersonation drags an unrelated
// barrel (and node:crypto via the @kku/shared barrel).
const FACULTY_SCOPED_ROLES = new Set<Role>(['FACULTY_USER']);
const DEPARTMENT_SCOPED_ROLES = new Set<Role>(['PROGRAM_USER']);

interface ScopeRow {
  id: string;
  role: Role;
  facultyId: string | null;
  programId: string | null;
  /** MANUAL = admin-assigned (this UI's writes). ACADEMIC_STAFF =
   *  auto-synced on every SSO login from FacultyMember ↔ ProgramFaculty. */
  source: 'MANUAL' | 'ACADEMIC_STAFF';
  facultyLabel: string | null;
  programLabel: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  linkedToSso: boolean;
  facultyId: string | null;
  departmentId: string | null;
  programId: string | null;
  facultyLabel: string | null;
  programLabel: string | null;
  createdAtIso: string;
  scopes: ScopeRow[];
}

interface FacultyOption {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
}

interface ProgramOption {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  facultyId: string;
}

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  SYSTEM_ADMIN: 'System Admin',
  UNIVERSITY_USER: 'University User',
  FACULTY_USER: 'Faculty User',
  PROGRAM_USER: 'Program User',
};

interface FilterState {
  q: string;
  role: string;
  facultyId: string;
  page: number;
  pageSize: number;
  total: number;
}

interface Props {
  users: UserRow[];
  faculties: FacultyOption[];
  programs: ProgramOption[];
  actorIsSuper: boolean;
  filters: FilterState;
}

export function UsersClient({ users, faculties, programs, actorIsSuper, filters }: Props) {
  const assignable = (
    actorIsSuper ? SSO_ROLES : SYSTEM_ADMIN_ASSIGNABLE_ROLES
  ) as readonly Role[];

  return (
    <div className="flex flex-col gap-4">
      <PreProvisionPanel
        faculties={faculties}
        programs={programs}
        assignable={assignable}
      />
      <ExistingUsersPanel
        users={users}
        faculties={faculties}
        programs={programs}
        assignable={assignable}
        actorIsSuper={actorIsSuper}
        filters={filters}
      />
    </div>
  );
}

// URL-driven filter bar — search + role + faculty.
// Each control updates `?q=&role=&facultyId=&page=1` via router.push,
// so the page server-renders the filtered slice. Search is debounced
// 300ms to avoid hammering the server on every keystroke.
function FilterBar({
  filters,
  faculties,
}: {
  filters: FilterState;
  faculties: FacultyOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localQ, setLocalQ] = React.useState(filters.q);
  React.useEffect(() => setLocalQ(filters.q), [filters.q]);

  // Debounced URL push for the search box. Each control resets page to 1.
  const push = React.useCallback(
    (next: Partial<{ q: string; role: string; facultyId: string; page: number }>) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.q !== undefined) {
        if (next.q) params.set('q', next.q);
        else params.delete('q');
      }
      if (next.role !== undefined) {
        if (next.role) params.set('role', next.role);
        else params.delete('role');
      }
      if (next.facultyId !== undefined) {
        if (next.facultyId) params.set('facultyId', next.facultyId);
        else params.delete('facultyId');
      }
      if (next.page !== undefined) {
        if (next.page > 1) params.set('page', String(next.page));
        else params.delete('page');
      } else {
        // Filter changes always reset pagination — surfacing page 1
        // results for the new filter set.
        params.delete('page');
      }
      router.push(`/admin/users?${params.toString()}`);
    },
    [router, searchParams],
  );

  React.useEffect(() => {
    if (localQ === filters.q) return;
    const id = setTimeout(() => push({ q: localQ }), 300);
    return () => clearTimeout(id);
  }, [localQ, filters.q, push]);

  return (
    <div className="mb-3 flex flex-col gap-2">
      <FilterRail cols={4}>
        <FilterField label="Search" span={2}>
          <FilterSearch
            value={localQ}
            onChange={setLocalQ}
            placeholder="Email or name…"
          />
        </FilterField>
        <FilterField label="Role">
          <FilterSelect
            value={filters.role}
            onChange={(e) => push({ role: e.currentTarget.value })}
          >
            <option value="">All roles</option>
            <option value="SUPER_ADMIN">Super Admin</option>
            <option value="SYSTEM_ADMIN">System Admin</option>
            <option value="UNIVERSITY_USER">University User</option>
            <option value="FACULTY_USER">Faculty User</option>
            <option value="PROGRAM_USER">Program User</option>
          </FilterSelect>
        </FilterField>
        <FilterField label="Faculty">
          <FilterSelect
            value={filters.facultyId}
            onChange={(e) => push({ facultyId: e.currentTarget.value })}
          >
            <option value="">All faculties</option>
            {faculties.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} · {f.nameEn}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
      </FilterRail>
      {(filters.q || filters.role || filters.facultyId) && (
        <div>
          <button
            type="button"
            onClick={() => {
              setLocalQ('');
              router.push('/admin/users');
            }}
            className="text-[11px] text-text-tertiary underline hover:text-text-primary"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

function Pagination({ filters }: { filters: FilterState }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(filters.total / filters.pageSize));
  if (totalPages <= 1) return null;

  const goto = (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next > 1) params.set('page', String(next));
    else params.delete('page');
    router.push(`/admin/users?${params.toString()}`);
  };

  const start = (filters.page - 1) * filters.pageSize + 1;
  const end = Math.min(filters.total, filters.page * filters.pageSize);

  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-text-secondary">
      <span>
        Showing {start.toLocaleString()}–{end.toLocaleString()} of{' '}
        {filters.total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => goto(1)}
          disabled={filters.page === 1}
          aria-label="First page"
        >
          <ChevronsLeft className="size-icon-sm" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => goto(filters.page - 1)}
          disabled={filters.page === 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-icon-sm" />
        </Button>
        <span className="px-2 font-mono">
          {filters.page} / {totalPages}
        </span>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => goto(filters.page + 1)}
          disabled={filters.page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="size-icon-sm" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => goto(totalPages)}
          disabled={filters.page >= totalPages}
          aria-label="Last page"
        >
          <ChevronsRight className="size-icon-sm" />
        </Button>
      </div>
    </div>
  );
}

function PreProvisionPanel({
  faculties,
  programs,
  assignable,
}: {
  faculties: FacultyOption[];
  programs: ProgramOption[];
  assignable: readonly Role[];
}) {
  const [email, setEmail] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [result, setResult] = React.useState<
    | null
    | {
        kind: 'found-employee' | 'not-found' | 'already-exists' | 'error';
        message?: string;
        employee?: { name: string; emp: Record<string, unknown> } | null;
        existingUserId?: string;
      }
  >(null);

  const [role, setRole] = React.useState<Role>('PROGRAM_USER');
  const [facultyId, setFacultyId] = React.useState<string>('');
  const [programId, setProgramId] = React.useState<string>('');
  const [name, setName] = React.useState<string>('');
  const [overrideName, setOverrideName] = React.useState(false);
  const [overrideFaculty, setOverrideFaculty] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  // Whether the faculty was auto-matched from the KKU directory hit.
  // Drives the "✓ matched" indicator + the "change" affordance.
  const [autoMatchedFacultyId, setAutoMatchedFacultyId] = React.useState<string | null>(null);

  const onSearch = async () => {
    if (!email.trim()) return;
    setSearching(true);
    setResult(null);
    const r = await searchKkuEmployeeAction(email);
    setSearching(false);
    if (!r.ok) {
      setResult({ kind: 'error', message: r.message });
      return;
    }
    if (r.existingUser) {
      setResult({
        kind: 'already-exists',
        existingUserId: r.existingUser.id,
        message: `Already in DB as ${r.existingUser.role}`,
      });
      return;
    }
    if (r.employee) {
      const empRecord = r.employee as unknown as Record<string, unknown>;
      const display = deriveDisplayName(empRecord);
      setName(display);
      setOverrideName(false);

      // Auto-match faculty by Thai name (exact). KKU API returns
      // e.g. 'คณะวิศวกรรมศาสตร์' which matches Faculty.nameTh exactly
      // for seeded faculties.
      const empFacultyTh =
        typeof empRecord.faculty === 'string' ? empRecord.faculty.trim() : '';
      const matchedFaculty = empFacultyTh
        ? faculties.find((f) => f.nameTh.trim() === empFacultyTh) ?? null
        : null;
      setFacultyId(matchedFaculty ? matchedFaculty.id : '');
      setAutoMatchedFacultyId(matchedFaculty ? matchedFaculty.id : null);
      setOverrideFaculty(false);

      // Role inference from `workline`: 'วิชาการ' = academic line.
      // Auto-pick FACULTY_USER only when both academic AND a matched
      // faculty exist; otherwise the form is unsubmittable.
      const workline =
        typeof empRecord.workline === 'string' ? empRecord.workline : '';
      const isAcademic = workline.includes('วิชาการ');
      setRole(matchedFaculty && isAcademic ? 'FACULTY_USER' : 'PROGRAM_USER');
      setProgramId('');

      setResult({
        kind: 'found-employee',
        employee: { name: display, emp: empRecord },
      });
      return;
    }
    setResult({ kind: 'not-found' });
    setName(email.split('@')[0] ?? '');
    setFacultyId('');
    setAutoMatchedFacultyId(null);
    setOverrideName(true);
    setOverrideFaculty(true);
    setRole('PROGRAM_USER');
    setProgramId('');
  };

  const onSubmit = async () => {
    setSubmitting(true);
    const r = await provisionUserAction({
      email,
      name: name || null,
      role,
      facultyId: role === 'FACULTY_USER' ? facultyId || null : null,
      departmentId: null,
      programId: role === 'PROGRAM_USER' ? programId || null : null,
    });
    setSubmitting(false);
    if (r.ok) {
      toast.success(`Provisioned ${email} — sign-in via KKU SSO`);
      setEmail('');
      setName('');
      setOverrideName(false);
      setOverrideFaculty(false);
      setAutoMatchedFacultyId(null);
      setResult(null);
      setFacultyId('');
      setProgramId('');
    } else {
      toast.error(r.message);
    }
  };

  const filteredPrograms = React.useMemo(
    () =>
      facultyId
        ? programs.filter((p) => p.facultyId === facultyId)
        : programs,
    [facultyId, programs],
  );

  return (
    <Card padding="md">
      <h3 className="mb-2 text-sm font-semibold">Pre-provision a KKU staff member</h3>
      <p className="mb-3 text-xs text-text-tertiary">
        Search by KKU email → assign role + scope. The user becomes active on their first SSO login (the system links the SSO subject to this row by email match).
      </p>

      <div className="flex gap-2 items-end mb-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-text-tertiary">KKU email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch();
            }}
            placeholder="firstname.l@kku.ac.th"
          />
        </div>
        <Button onClick={onSearch} disabled={searching || !email.trim()} size="sm" variant="outline">
          <Search className="size-icon-md" /> {searching ? 'Searching…' : 'Search'}
        </Button>
      </div>

      {result?.kind === 'error' && (
        <div className="rounded-md bg-danger-subtle p-2 text-xs text-danger">{result.message}</div>
      )}
      {result?.kind === 'already-exists' && (
        <div className="rounded-md bg-warning-subtle p-2 text-xs text-warning">
          User already exists. {result.message}. Use the table below to update their role.
        </div>
      )}

      {(result?.kind === 'found-employee' || result?.kind === 'not-found') && (
        <div className="flex flex-col gap-4">

          {/* ── KKU directory snapshot (read-only) ───────────────── */}
          {result.kind === 'found-employee' && result.employee && (
            <section className="rounded-md border border-border-subtle bg-surface-1 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-tertiary">
                <Check className="size-icon-xs text-success" />
                From KKU directory
              </div>
              <DirectoryNamePair emp={result.employee.emp} />
              <DirectoryFacts emp={result.employee.emp} />
            </section>
          )}
          {result.kind === 'not-found' && (
            <div className="rounded-md bg-warning-subtle p-2 text-xs text-warning">
              No match in the KKU directory (or the KKU Employee API isn&apos;t
              reachable from this environment). You can still pre-provision
              this user manually.
            </div>
          )}

          {/* ── App-side decisions (editable) ───────────────────── */}
          <section className="rounded-md border border-border-subtle bg-surface-1 p-3">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-text-tertiary">
              Provision in this app
            </div>
            <p className="mb-3 text-[11px] text-text-tertiary leading-relaxed">
              Sign-in is via KKU SSO; the directory link binds on first SSO
              login by email. Pick the in-app role + scope below.
            </p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Display name — auto-derived, override on click */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs text-text-tertiary">Display name</label>
                  {!overrideName && result.kind === 'found-employee' && (
                    <button
                      type="button"
                      onClick={() => setOverrideName(true)}
                      className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                    >
                      <Pencil className="size-icon-xs" /> override
                    </button>
                  )}
                </div>
                {overrideName || result.kind === 'not-found' ? (
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                ) : (
                  <div className="rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5 text-sm">
                    {name}
                  </div>
                )}
              </div>

              {/* Role */}
              <div>
                <label className="mb-1 block text-xs text-text-tertiary">Role</label>
                <select
                  className="kku-select w-full"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {assignable.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Faculty — auto-matched indicator + change affordance */}
              {role === 'FACULTY_USER' && (
                <div className="md:col-span-2">
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs text-text-tertiary">Faculty</label>
                    {!overrideFaculty && autoMatchedFacultyId && (
                      <button
                        type="button"
                        onClick={() => setOverrideFaculty(true)}
                        className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                      >
                        <Pencil className="size-icon-xs" /> change
                      </button>
                    )}
                  </div>
                  {!overrideFaculty && autoMatchedFacultyId ? (
                    <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5 text-sm">
                      <Check className="size-icon-sm text-success shrink-0" />
                      {(() => {
                        const f = faculties.find((x) => x.id === autoMatchedFacultyId);
                        return f ? `${f.nameTh} · ${f.nameEn}` : '(matched)';
                      })()}
                    </div>
                  ) : (
                    <select
                      className="kku-select w-full"
                      value={facultyId}
                      onChange={(e) => setFacultyId(e.target.value)}
                    >
                      <option value="">— select —</option>
                      {faculties.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nameTh} · {f.nameEn}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Program — only for PROGRAM_USER */}
              {role === 'PROGRAM_USER' && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-text-tertiary">
                      Faculty (filter)
                    </label>
                    <select
                      className="kku-select w-full"
                      value={facultyId}
                      onChange={(e) => {
                        setFacultyId(e.target.value);
                        setProgramId('');
                      }}
                    >
                      <option value="">all faculties</option>
                      {faculties.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nameTh} · {f.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-tertiary">Program</label>
                    <select
                      className="kku-select w-full"
                      value={programId}
                      onChange={(e) => setProgramId(e.target.value)}
                    >
                      <option value="">— select —</option>
                      {filteredPrograms.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} · {p.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                onClick={onSubmit}
                disabled={
                  submitting ||
                  (role === 'FACULTY_USER' && !facultyId) ||
                  (role === 'PROGRAM_USER' && !programId)
                }
                size="sm"
                variant="primary"
              >
                <Plus className="size-icon-md" /> {submitting ? 'Creating…' : 'Provision user'}
              </Button>
            </div>
          </section>
        </div>
      )}
    </Card>
  );
}

// Big TH + EN names side-by-side at the top of the directory snapshot.
// Reads `title + firstname + lastname` and the `_eng` triplet directly
// from the KKU API response shape.
function DirectoryNamePair({ emp }: { emp: Record<string, unknown> }) {
  const s = (k: string): string => {
    const v = emp[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const thai = [s('title'), s('firstname'), s('lastname')].filter(Boolean).join(' ');
  const eng = [s('title_eng'), s('firstname_eng'), s('lastname_eng')].filter(Boolean).join(' ');
  return (
    <div className="mb-2 flex flex-col">
      {thai && <div className="text-base font-medium text-text-primary">{thai}</div>}
      {eng && <div className="text-sm text-text-secondary">{eng}</div>}
    </div>
  );
}

// Compact directory snapshot — shows only the public-safe fields
// from the KKU API response that are meaningful for provisioning.
// PII fields (`identification`, `pass`) are stripped server-side
// before this component ever receives the record.
function DirectoryFacts({ emp }: { emp: Record<string, unknown> }) {
  const fields: Array<[string, string]> = [];
  const push = (label: string, key: string) => {
    const v = emp[key];
    if (typeof v === 'string' && v.trim()) fields.push([label, v]);
    else if (typeof v === 'number') fields.push([label, String(v)]);
  };
  push('Email', 'email');
  push('Faculty', 'faculty');
  push('Division', 'division');
  push('Position', 'posi');
  push('Position type', 'positype');
  push('Level', 'level');
  push('Workline', 'workline');
  push('Status', 'statuslist');
  push('Unit', 'unit');
  push('Subunit', 'subunit');
  if (fields.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded bg-surface-2 p-2 text-[11px] text-text-secondary">
      {fields.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-text-tertiary">{label}</dt>
          <dd className="font-medium text-text-primary">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function ExistingUsersPanel({
  users,
  faculties,
  programs,
  assignable,
  actorIsSuper,
  filters,
}: {
  users: UserRow[];
  faculties: FacultyOption[];
  programs: ProgramOption[];
  assignable: readonly Role[];
  actorIsSuper: boolean;
  filters: FilterState;
}) {
  return (
    <Card padding="md">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">
          Existing users · {filters.total.toLocaleString()}
        </h3>
        {(filters.q || filters.role || filters.facultyId) && (
          <span className="text-[11px] text-text-tertiary">filtered</span>
        )}
      </div>
      <FilterBar filters={filters} faculties={faculties} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
              <th className="px-2 py-1 w-6"></th>
              <th className="px-2 py-1 text-left">Email</th>
              <th className="px-2 py-1 text-left">Name</th>
              <th className="px-2 py-1 text-left">Roles &amp; scopes</th>
              <th className="px-2 py-1 text-left">SSO</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-text-tertiary">
                  No users match the current filter.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <UserRowEditor
                key={u.id}
                user={u}
                faculties={faculties}
                programs={programs}
                assignable={assignable}
                actorIsSuper={actorIsSuper}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination filters={filters} />
    </Card>
  );
}

function UserRowEditor({
  user,
  faculties,
  programs,
  assignable,
  actorIsSuper,
}: {
  user: UserRow;
  faculties: FacultyOption[];
  programs: ProgramOption[];
  assignable: readonly Role[];
  actorIsSuper: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const remove = async () => {
    if (!confirm(`Delete user ${user.email}? This cannot be undone.`)) return;
    setBusy(true);
    const r = await deleteUserAction(user.id);
    setBusy(false);
    if (r.ok) toast.success('Deleted');
    else toast.error(r.message);
  };

  const setOrClearPassword = async () => {
    const next = prompt(
      `Set dev password for ${user.email}?\n\nLeave blank and click OK to clear (user falls back to shared DEV_AUTH_PASSWORD).\nClick Cancel to abort.`,
      '',
    );
    if (next === null) return;
    setBusy(true);
    const r = await setUserPasswordAction({
      userId: user.id,
      password: next.trim() ? next : null,
    });
    setBusy(false);
    if (r.ok) {
      toast.success(next.trim() ? 'Password set' : 'Password cleared');
    } else toast.error(r.message);
  };

  return (
    <>
      <tr className="border-t border-border-subtle">
        <td className="px-2 py-1.5 align-top">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-text-tertiary hover:text-text-primary"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? (
              <ChevronDown className="size-icon-xs" />
            ) : (
              <ChevronRight className="size-icon-xs" />
            )}
          </button>
        </td>
        <td className="px-2 py-1.5 align-top font-mono text-[11px]">{user.email}</td>
        <td className="px-2 py-1.5 align-top">{user.name ?? '—'}</td>
        <td className="px-2 py-1.5 align-top">
          <ScopePillStack scopes={user.scopes} />
        </td>
        <td className="px-2 py-1.5 align-top">
          {user.linkedToSso ? (
            <span className="text-success">linked</span>
          ) : (
            <span className="text-text-tertiary">awaiting first login</span>
          )}
        </td>
        <td className="px-2 py-1.5 align-top">
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => setExpanded(true)}>
              <Layers className="size-icon-xs" /> Scopes
            </Button>
            {/* Password reset only applies to local credentials. SSO-linked
                users authenticate via KKU SSO and have no local passwordHash —
                hide the affordance to avoid operator confusion. */}
            {!user.linkedToSso && (
              <Button size="xs" variant="ghost" onClick={setOrClearPassword} disabled={busy}>
                <Key className="size-icon-xs" /> Pwd
              </Button>
            )}
            {actorIsSuper && (
              <Button size="xs" variant="ghost" onClick={remove} disabled={busy}>
                <Trash2 className="size-icon-xs" />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="border-t border-border-subtle bg-surface-1 px-2 py-3">
            <ScopeManager
              user={user}
              faculties={faculties}
              programs={programs}
              assignable={assignable}
              onClose={() => setExpanded(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// Compact pill stack. Strategy:
//   - PROGRAM_USER scopes (the noisy case for academic staff with many
//     programs) collapse into a single "Program User (N)" pill with
//     the program list in a hover tooltip — readable at a glance.
//   - Other scope kinds (FACULTY_USER · <faculty>, SYSTEM_ADMIN, etc.)
//     render individually — they're always low-cardinality.
//   - Click any pill to expand the row (parent's expander).
function ScopePillStack({ scopes }: { scopes: ScopeRow[] }) {
  if (scopes.length === 0) {
    return <span className="text-text-tertiary">—</span>;
  }
  const programScopes = scopes.filter((s) => s.role === 'PROGRAM_USER');
  const otherScopes = scopes.filter((s) => s.role !== 'PROGRAM_USER');
  return (
    <div className="flex flex-wrap gap-1">
      {otherScopes.map((s) => (
        <ScopePill key={s.id} scope={s} />
      ))}
      {programScopes.length > 0 && (
        <ProgramScopeGroupPill scopes={programScopes} />
      )}
    </div>
  );
}

function ProgramScopeGroupPill({ scopes }: { scopes: ScopeRow[] }) {
  // Tooltip lists every program label, one per line. `title` attribute
  // wraps on \n in modern browsers; readable inside KKU's Chrome/Edge.
  // ACADEMIC_STAFF rows (auto-synced) are flagged inline so admins
  // know which assignments were derived vs manually granted.
  const lines = scopes.map((s) => {
    const label = s.programLabel ?? s.facultyLabel ?? '(unscoped)';
    return s.source === 'ACADEMIC_STAFF' ? `${label}  · auto` : label;
  });
  const hasAuto = scopes.some((s) => s.source === 'ACADEMIC_STAFF');
  const tooltip = `Program User · ${scopes.length} program${scopes.length === 1 ? '' : 's'}\n────────────\n${lines.join('\n')}`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        hasAuto
          ? 'border-info/30 bg-info-subtle text-info'
          : 'border-border-subtle bg-surface-2 text-text-secondary'
      }`}
      title={tooltip}
    >
      <span className="font-semibold">Program User</span>
      <span className="opacity-80">({scopes.length})</span>
      {hasAuto && (
        <span className="rounded bg-info/15 px-1 py-0 text-[8.5px] font-semibold uppercase tracking-wider text-info">
          auto
        </span>
      )}
    </span>
  );
}

function ScopePill({ scope }: { scope: ScopeRow }) {
  const isAdmin = scope.role === 'SUPER_ADMIN' || scope.role === 'SYSTEM_ADMIN';
  const isAuto = scope.source === 'ACADEMIC_STAFF';
  const target = scope.programLabel ?? scope.facultyLabel ?? null;
  const tooltip = isAuto
    ? `${ROLE_LABEL[scope.role]} · auto-synced from FacultyMember ↔ ProgramFaculty on every SSO login. Manual changes are reverted next login.`
    : target ?? ROLE_LABEL[scope.role];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        isAdmin
          ? 'border-accent/30 bg-accent/10 text-accent'
          : isAuto
            ? 'border-info/30 bg-info-subtle text-info'
            : 'border-border-subtle bg-surface-2 text-text-secondary'
      }`}
      title={tooltip}
    >
      <span className="font-semibold">{ROLE_LABEL[scope.role]}</span>
      {target && <span className="opacity-80">· {target}</span>}
      {isAuto && (
        <span className="rounded bg-info/15 px-1 py-0 text-[8.5px] font-semibold uppercase tracking-wider text-info">
          auto
        </span>
      )}
    </span>
  );
}

// Inline scope-management panel that expands below a user row. Shows
// the existing scope rows with remove buttons + an "add scope" form.
// Refuses to remove the last scope (server-side enforced + UI hint).
function ScopeManager({
  user,
  faculties,
  programs,
  assignable,
  onClose,
}: {
  user: UserRow;
  faculties: FacultyOption[];
  programs: ProgramOption[];
  assignable: readonly Role[];
  onClose: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [newRole, setNewRole] = React.useState<Role>('FACULTY_USER');
  const [newFacultyId, setNewFacultyId] = React.useState('');
  const [newProgramId, setNewProgramId] = React.useState('');
  // Local optimistic copy so removes/adds reflect immediately without
  // waiting for the server-side revalidatePath round-trip.
  const [localScopes, setLocalScopes] = React.useState(user.scopes);
  React.useEffect(() => setLocalScopes(user.scopes), [user.scopes]);

  const onRemove = async (scope: ScopeRow) => {
    if (scope.source === 'ACADEMIC_STAFF') {
      toast.error(
        'This scope is auto-synced from the academic-staff register. To remove it, drop the staffer from the program in HR — the next login will prune it automatically.',
      );
      return;
    }
    if (localScopes.length <= 1) {
      toast.error('Cannot remove the last scope. Add another scope first.');
      return;
    }
    setBusy(true);
    const r = await removeUserScopeAction(scope.id);
    setBusy(false);
    if (r.ok) {
      toast.success('Scope removed');
      setLocalScopes(localScopes.filter((s) => s.id !== scope.id));
    } else {
      toast.error(r.message);
    }
  };

  const onAdd = async () => {
    if (newRole === 'FACULTY_USER' && !newFacultyId) {
      toast.error('Pick a faculty');
      return;
    }
    if (newRole === 'PROGRAM_USER' && !newProgramId) {
      toast.error('Pick a program');
      return;
    }
    // Pre-validate: server enforces uniqueness too, but a clean toast
    // beats a 500 round-trip. Non-spatial roles (SUPER_ADMIN /
    // SYSTEM_ADMIN / UNIVERSITY_USER) are duplicates if the role
    // appears at all; spatial roles match on the (role, faculty/
    // program) tuple.
    const duplicate = localScopes.some((s) => {
      if (s.role !== newRole) return false;
      if (newRole === 'FACULTY_USER') return s.facultyId === newFacultyId;
      if (newRole === 'PROGRAM_USER') return s.programId === newProgramId;
      return true; // SUPER_ADMIN / SYSTEM_ADMIN / UNIVERSITY_USER — one per user
    });
    if (duplicate) {
      const target =
        newRole === 'FACULTY_USER'
          ? faculties.find((f) => f.id === newFacultyId)?.nameTh
          : newRole === 'PROGRAM_USER'
            ? programs.find((p) => p.id === newProgramId)?.code
            : null;
      toast.error(
        target
          ? `${ROLE_LABEL[newRole]} for ${target} is already assigned.`
          : `${ROLE_LABEL[newRole]} is already assigned.`,
      );
      return;
    }
    setBusy(true);
    const r = await addUserScopeAction({
      userId: user.id,
      role: newRole,
      facultyId: newRole === 'FACULTY_USER' ? newFacultyId || null : null,
      programId: newRole === 'PROGRAM_USER' ? newProgramId || null : null,
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    toast.success('Scope added');
    // Optimistic insert — the server-side revalidatePath will refresh
    // the prop on next render, so we'll get the canonical row in shortly.
    const facLabel =
      newRole === 'FACULTY_USER'
        ? faculties.find((f) => f.id === newFacultyId)?.nameTh ?? null
        : null;
    const progFromId = programs.find((p) => p.id === newProgramId);
    const facLabelFromProgram = progFromId
      ? faculties.find((f) => f.id === progFromId.facultyId)?.nameTh ?? null
      : null;
    setLocalScopes([
      ...localScopes,
      {
        id: r.scopeId,
        role: newRole,
        // Manually-added rows are MANUAL by definition; the SSO sync
        // never reclaims them.
        source: 'MANUAL',
        facultyId:
          newRole === 'FACULTY_USER'
            ? newFacultyId || null
            : progFromId?.facultyId ?? null,
        programId: newRole === 'PROGRAM_USER' ? newProgramId || null : null,
        facultyLabel:
          facLabel ??
          (facLabelFromProgram
            ? `${facLabelFromProgram} · ${
                faculties.find((f) => f.id === progFromId?.facultyId)?.nameEn ?? ''
              }`
            : null),
        programLabel: progFromId
          ? `${progFromId.code} ${progFromId.nameEn}`
          : null,
      },
    ]);
    setNewFacultyId('');
    setNewProgramId('');
  };

  const filteredPrograms = newFacultyId
    ? programs.filter((p) => p.facultyId === newFacultyId)
    : programs;

  // Roles already at the user-wide cap (SUPER_ADMIN / SYSTEM_ADMIN /
  // UNIVERSITY_USER are limited to one row per user). Used to grey out
  // the Add scope button + selectable options.
  const exhaustedNonSpatial = new Set(
    localScopes
      .filter((s) => !FACULTY_SCOPED_ROLES.has(s.role) && !DEPARTMENT_SCOPED_ROLES.has(s.role))
      .map((s) => s.role),
  );
  const wouldDuplicate =
    (exhaustedNonSpatial.has(newRole)) ||
    (newRole === 'FACULTY_USER' &&
      !!newFacultyId &&
      localScopes.some(
        (s) => s.role === 'FACULTY_USER' && s.facultyId === newFacultyId,
      )) ||
    (newRole === 'PROGRAM_USER' &&
      !!newProgramId &&
      localScopes.some(
        (s) => s.role === 'PROGRAM_USER' && s.programId === newProgramId,
      ));

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-0 p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold text-text-primary">
          Scopes for {user.email}
        </h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-tertiary">
            {localScopes.length} {localScopes.length === 1 ? 'scope' : 'scopes'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
            aria-label="Close scope manager"
          >
            <X className="size-icon-sm" />
          </button>
        </div>
      </div>

      {/* Existing scopes — list with remove buttons */}
      <ul className="flex flex-col gap-1.5">
        {localScopes.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-2 rounded border border-border-subtle bg-surface-1 px-2.5 py-1.5"
          >
            <div className="flex flex-1 items-center gap-2 min-w-0">
              <ScopePill scope={s} />
              {s.programLabel && (
                <span className="truncate text-[11px] text-text-tertiary">
                  {s.facultyLabel}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onRemove(s)}
              disabled={busy || localScopes.length <= 1 || s.source === 'ACADEMIC_STAFF'}
              title={
                s.source === 'ACADEMIC_STAFF'
                  ? 'Auto-synced from FacultyMember ↔ ProgramFaculty — remove the staffer from the program in HR to clear this scope'
                  : localScopes.length <= 1
                    ? 'Cannot remove the last scope'
                    : 'Remove this scope'
              }
              className="text-text-tertiary hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Remove scope"
            >
              <X className="size-icon-sm" />
            </button>
          </li>
        ))}
      </ul>

      {/* Add scope form */}
      <div className="flex flex-col gap-2 rounded border border-dashed border-border-subtle bg-surface-1 p-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
          Add scope
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] text-text-tertiary">Role</label>
            <select
              className="kku-select w-full"
              value={newRole}
              onChange={(e) => {
                setNewRole(e.target.value as Role);
                setNewFacultyId('');
                setNewProgramId('');
              }}
            >
              {assignable.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          {newRole === 'FACULTY_USER' && (
            <div>
              <label className="mb-1 block text-[10px] text-text-tertiary">Faculty</label>
              <select
                className="kku-select w-full"
                value={newFacultyId}
                onChange={(e) => setNewFacultyId(e.target.value)}
              >
                <option value="">— select —</option>
                {faculties.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nameTh} · {f.nameEn}
                  </option>
                ))}
              </select>
            </div>
          )}

          {newRole === 'PROGRAM_USER' && (
            <>
              <div>
                <label className="mb-1 block text-[10px] text-text-tertiary">
                  Faculty (filter)
                </label>
                <select
                  className="kku-select w-full"
                  value={newFacultyId}
                  onChange={(e) => {
                    setNewFacultyId(e.target.value);
                    setNewProgramId('');
                  }}
                >
                  <option value="">all faculties</option>
                  {faculties.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nameTh} · {f.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-[10px] text-text-tertiary">Program</label>
                <select
                  className="kku-select w-full"
                  value={newProgramId}
                  onChange={(e) => setNewProgramId(e.target.value)}
                >
                  <option value="">— select —</option>
                  {filteredPrograms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.nameEn}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            size="xs"
            variant="primary"
            onClick={onAdd}
            disabled={
              busy ||
              wouldDuplicate ||
              (newRole === 'FACULTY_USER' && !newFacultyId) ||
              (newRole === 'PROGRAM_USER' && !newProgramId)
            }
            title={wouldDuplicate ? 'Already assigned' : undefined}
          >
            <Plus className="size-icon-xs" /> Add scope
          </Button>
        </div>
      </div>

      <div className="border-t border-border-subtle pt-2 text-[10px] text-text-tertiary leading-relaxed">
        Multi-scope assignments. A user can hold any number of (role,
        faculty/program) tuples. Permission decisions today still consult
        the user&apos;s primary role + scope; the runtime will fold the full
        list in once Phase 2 lands.
      </div>
    </div>
  );
}
