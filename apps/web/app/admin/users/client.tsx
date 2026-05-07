'use client';

import * as React from 'react';
import { Card, Input, Button } from '@kku/ui';
import { Search, Plus, Trash2, RefreshCw, Key, Check, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { type Role } from '@kku/shared';
import {
  searchKkuEmployeeAction,
  provisionUserAction,
  updateUserRoleAction,
  deleteUserAction,
  setUserPasswordAction,
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
  // legacy
  ADMIN: '(legacy) ADMIN',
  ANALYST: '(legacy) ANALYST',
  VIEWER: '(legacy) VIEWER',
  COUNCIL: '(legacy) COUNCIL',
  EXECUTIVE: '(legacy) EXECUTIVE',
  DEAN: '(legacy) DEAN',
  DEPT_HEAD: '(legacy) DEPT_HEAD',
};

interface Props {
  users: UserRow[];
  faculties: FacultyOption[];
  programs: ProgramOption[];
  actorIsSuper: boolean;
}

export function UsersClient({ users, faculties, programs, actorIsSuper }: Props) {
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
      />
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
          <Search className="h-4 w-4" /> {searching ? 'Searching…' : 'Search'}
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
                <Check className="h-3 w-3 text-success" />
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
                      <Pencil className="h-3 w-3" /> override
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
                        <Pencil className="h-3 w-3" /> change
                      </button>
                    )}
                  </div>
                  {!overrideFaculty && autoMatchedFacultyId ? (
                    <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5 text-sm">
                      <Check className="h-3.5 w-3.5 text-success shrink-0" />
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
                <Plus className="h-4 w-4" /> {submitting ? 'Creating…' : 'Provision user'}
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
}: {
  users: UserRow[];
  faculties: FacultyOption[];
  programs: ProgramOption[];
  assignable: readonly Role[];
  actorIsSuper: boolean;
}) {
  return (
    <Card padding="md">
      <h3 className="mb-2 text-sm font-semibold">Existing users · {users.length}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
              <th className="px-2 py-1 text-left">Email</th>
              <th className="px-2 py-1 text-left">Name</th>
              <th className="px-2 py-1 text-left">Role</th>
              <th className="px-2 py-1 text-left">Scope</th>
              <th className="px-2 py-1 text-left">SSO</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
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
  const [editing, setEditing] = React.useState(false);
  const [role, setRole] = React.useState<Role>(user.role);
  const [facultyId, setFacultyId] = React.useState(user.facultyId ?? '');
  const [programId, setProgramId] = React.useState(user.programId ?? '');
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    const r = await updateUserRoleAction({
      userId: user.id,
      role,
      facultyId: role === 'FACULTY_USER' ? facultyId || null : null,
      departmentId: null,
      programId: role === 'PROGRAM_USER' ? programId || null : null,
    });
    setBusy(false);
    if (r.ok) {
      toast.success('Updated');
      setEditing(false);
    } else {
      toast.error(r.message);
    }
  };

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
    if (next === null) return; // cancelled
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

  const filteredPrograms = facultyId
    ? programs.filter((p) => p.facultyId === facultyId)
    : programs;

  return (
    <tr className="border-t border-border-subtle">
      <td className="px-2 py-1 font-mono text-[11px]">{user.email}</td>
      <td className="px-2 py-1">{user.name ?? '—'}</td>
      <td className="px-2 py-1">
        {editing ? (
          <select
            className="kku-select"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {assignable.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={
              user.role.startsWith('SUPER') || user.role.startsWith('SYSTEM') || user.role === 'ADMIN'
                ? 'font-semibold text-accent'
                : ''
            }
          >
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
        )}
      </td>
      <td className="px-2 py-1 text-text-secondary">
        {editing && role === 'FACULTY_USER' && (
          <select
            className="kku-select"
            value={facultyId}
            onChange={(e) => setFacultyId(e.target.value)}
          >
            <option value="">— faculty —</option>
            {faculties.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code}
              </option>
            ))}
          </select>
        )}
        {editing && role === 'PROGRAM_USER' && (
          <div className="flex flex-col gap-1">
            <select
              className="kku-select"
              value={facultyId}
              onChange={(e) => {
                setFacultyId(e.target.value);
                setProgramId('');
              }}
            >
              <option value="">all faculties</option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code}
                </option>
              ))}
            </select>
            <select
              className="kku-select"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
            >
              <option value="">— program —</option>
              {filteredPrograms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          </div>
        )}
        {!editing && (user.programLabel ?? user.facultyLabel ?? '—')}
      </td>
      <td className="px-2 py-1">
        {user.linkedToSso ? (
          <span className="text-success">linked</span>
        ) : (
          <span className="text-text-tertiary">awaiting first login</span>
        )}
      </td>
      <td className="px-2 py-1">
        <div className="flex justify-end gap-1">
          {editing ? (
            <>
              <Button size="xs" variant="primary" onClick={save} disabled={busy}>
                Save
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                <RefreshCw className="h-3 w-3" /> Edit
              </Button>
              <Button size="xs" variant="ghost" onClick={setOrClearPassword} disabled={busy}>
                <Key className="h-3 w-3" /> Pwd
              </Button>
              {actorIsSuper && (
                <Button size="xs" variant="ghost" onClick={remove} disabled={busy}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
