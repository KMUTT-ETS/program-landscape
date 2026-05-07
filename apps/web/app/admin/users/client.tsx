'use client';

import * as React from 'react';
import { Card, Input, Button } from '@kku/ui';
import { Search, Plus, Trash2, RefreshCw, Key, Eye, EyeOff } from 'lucide-react';
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
  const [password, setPassword] = React.useState<string>('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

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
      const display = deriveDisplayName(r.employee as unknown as Record<string, unknown>);
      setName(display);
      setResult({ kind: 'found-employee', employee: { name: display, emp: r.employee as Record<string, unknown> } });
      return;
    }
    setResult({ kind: 'not-found' });
    setName(email.split('@')[0] ?? '');
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
      password: password.trim() ? password : null,
    });
    setSubmitting(false);
    if (r.ok) {
      const credLine = password.trim()
        ? ` · password set`
        : ` · uses shared dev password`;
      toast.success(`Provisioned ${email}${credLine}`);
      setEmail('');
      setName('');
      setPassword('');
      setShowPassword(false);
      setResult(null);
      setFacultyId('');
      setProgramId('');
    } else {
      toast.error(r.message);
    }
  };

  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    const buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    for (let i = 0; i < 12; i++) out += chars[buf[i]! % chars.length];
    setPassword(out);
    setShowPassword(true);
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
        <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-1 p-3">
          {result.kind === 'found-employee' && result.employee && (
            <div className="text-xs">
              <div className="text-text-tertiary mb-1">Found in KKU directory:</div>
              <div className="font-medium">{result.employee.name}</div>
              <pre className="mt-1 rounded bg-surface-2 p-2 text-[11px] text-text-secondary overflow-x-auto">
                {JSON.stringify(result.employee.emp, null, 2)}
              </pre>
            </div>
          )}
          {result.kind === 'not-found' && (
            <div className="text-xs text-warning">
              KKU directory lookup returned no match (or the KKU Employee API isn&apos;t configured in this environment).
              You can still pre-provision by typing a display name manually below.
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-text-tertiary">Display name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
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
            {role === 'FACULTY_USER' && (
              <div>
                <label className="mb-1 block text-xs text-text-tertiary">Faculty</label>
                <select
                  className="kku-select w-full"
                  value={facultyId}
                  onChange={(e) => setFacultyId(e.target.value)}
                >
                  <option value="">— select —</option>
                  {faculties.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} · {f.nameEn} · {f.nameTh}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {role === 'PROGRAM_USER' && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-text-tertiary">Faculty (filter)</label>
                  <select
                    className="kku-select w-full"
                    value={facultyId}
                    onChange={(e) => {
                      setFacultyId(e.target.value);
                      setProgramId('');
                    }}
                  >
                    <option value="">all</option>
                    {faculties.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} · {f.nameEn}
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

          <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs text-text-tertiary">
                Password (optional)
              </label>
              <button
                type="button"
                onClick={generatePassword}
                className="text-[11px] text-accent hover:underline"
              >
                Generate
              </button>
            </div>
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to use the shared dev password"
                  autoComplete="new-password"
                  className="pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {password && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(password);
                    toast.success('Password copied');
                  }}
                >
                  Copy
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-text-tertiary leading-relaxed">
              When set, this user signs in via{' '}
              <code className="font-mono">/signin → Developer credentials</code>{' '}
              with their email + this password. Leave blank and the user uses
              the shared <code className="font-mono">DEV_AUTH_PASSWORD</code>.
              Once KKU SSO is wired up, SSO supersedes this on first login.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={onSubmit}
              disabled={
                submitting ||
                (role === 'FACULTY_USER' && !facultyId) ||
                (role === 'PROGRAM_USER' && !programId) ||
                (password.trim().length > 0 && password.trim().length < 4)
              }
              size="sm"
              variant="primary"
            >
              <Plus className="h-4 w-4" /> {submitting ? 'Creating…' : 'Provision user'}
            </Button>
          </div>
        </div>
      )}
    </Card>
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
