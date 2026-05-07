'use client';

import * as React from 'react';
import { Card, Input, Button } from '@kku/ui';
import { Search, Plus, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  SSO_ROLES,
  SYSTEM_ADMIN_ASSIGNABLE_ROLES,
  type Role,
} from '@kku/shared';
import {
  searchKkuEmployeeAction,
  provisionUserAction,
  updateUserRoleAction,
  deleteUserAction,
  deriveDisplayName,
} from '@/lib/actions/admin-users';

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
      const display = deriveDisplayName(r.employee);
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
    });
    setSubmitting(false);
    if (r.ok) {
      toast.success(`Provisioned ${email}`);
      setEmail('');
      setName('');
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
              Not found in KKU directory. You can still pre-provision by typing a display name manually below.
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

          <div className="flex justify-end">
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
