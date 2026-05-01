import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, PageHeader } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Programs' };

interface ProgramRow {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  status: 'ACTIVE' | 'PAUSED' | 'SUNSET';
  facultyId: string;
  departmentId: string | null;
  yearEstablished: number | null;
}

// The API controller returns `{ data, meta }` which the envelope
// interceptor FLATTENS — the outer envelope's `.meta` carries the
// inner meta merged with provenance defaults. By the time `apiFetch`
// unwraps the outer envelope, we're left with the inner data array
// directly. Pagination would come through a separate accessor we
// don't surface here; for v1 we just request a big page and count
// what came back.
type ProgramsListResponse = ProgramRow[];

const STATUS_TONE: Record<
  ProgramRow['status'],
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  SUNSET: 'danger',
};

const LEVEL_LABEL: Record<ProgramRow['level'], string> = {
  BACHELOR: 'B.Sc.',
  MASTER: 'M.Sc.',
  DOCTORAL: 'Ph.D.',
  HIGHER_GRAD_DIPLOMA: 'H.Grad.Dip.',
};

export default async function ProgramsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; level?: string; q?: string; page?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));
  // Request a large page so we can get everything in one shot — KKU
  // has 297 programs, so pageSize=500 covers the whole portfolio.
  const qs = new URLSearchParams({ scope: 'university', pageSize: '500', page: String(page) });
  if (sp.status) qs.set('status', sp.status);
  if (sp.level) qs.set('level', sp.level);

  const rows = (await apiFetch<ProgramsListResponse>(`/programs?${qs}`).catch(() => [])) ?? [];
  const total = rows.length;

  // Client-side search filter (server filter wasn't in the API schema —
  // this stays fast for the 297-program scale).
  const search = (sp.q ?? '').trim().toLowerCase();
  const filtered = search
    ? rows.filter(
        (r) =>
          r.code.toLowerCase().includes(search) ||
          r.nameEn.toLowerCase().includes(search) ||
          r.nameTh.includes(search),
      )
    : rows;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Programs"
        subtitle={`${total} active curricula across KKU — click through for the full deep-dive on any program.`}
      />
      <div className="flex flex-col gap-4">
        <Card padding="sm">
          <form action="/programs" className="flex flex-wrap items-center gap-3">
            <Selector
              name="status"
              label="Status"
              value={sp.status ?? ''}
              options={[
                { value: '', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'PAUSED', label: 'Paused' },
                { value: 'SUNSET', label: 'Sunset' },
              ]}
            />
            <Selector
              name="level"
              label="Level"
              value={sp.level ?? ''}
              options={[
                { value: '', label: 'All' },
                { value: 'BACHELOR', label: "Bachelor's" },
                { value: 'MASTER', label: "Master's" },
                { value: 'DOCTORAL', label: 'Doctoral' },
              ]}
            />
            <div className="ml-auto flex items-center gap-2">
              <input
                type="search"
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Search code or name…"
                className="rounded-md border border-default bg-surface-1 px-3 py-1.5 text-sm text-text-primary"
              />
              <button
                type="submit"
                className="rounded-md bg-accent-default px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
              >
                Apply
              </button>
            </div>
          </form>
        </Card>

        {filtered.length === 0 ? (
          <Card padding="lg">
            <p className="text-center text-sm text-text-tertiary">
              {search
                ? `No programs match "${sp.q}".`
                : 'No programs match these filters.'}
            </p>
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-subtle bg-surface-2 text-left text-xs uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="py-3">Program</th>
                  <th className="py-3">Level</th>
                  <th className="py-3">Status</th>
                  <th className="py-3 pr-4 text-right">Est.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-subtle transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/programs/${p.id}`}
                        className="font-mono text-xs font-semibold text-accent-default hover:underline"
                      >
                        {p.code}
                      </Link>
                    </td>
                    <td className="py-3">
                      <Link href={`/programs/${p.id}`} className="font-medium text-text-primary hover:underline">
                        {p.nameEn}
                      </Link>
                      <div className="text-xs text-text-tertiary">{p.nameTh}</div>
                    </td>
                    <td className="py-3">
                      <Badge tone="outline">{LEVEL_LABEL[p.level]}</Badge>
                    </td>
                    <td className="py-3">
                      <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-right text-xs font-mono text-text-tertiary">
                      {p.yearEstablished ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <p className="text-xs text-text-tertiary">
          Showing {filtered.length} of {total} · scope-aware filters land in a follow-up pass.
        </p>
      </div>
    </AuthedAppShell>
  );
}

function Selector({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <span className="uppercase tracking-wide">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="rounded-md border border-default bg-surface-1 px-2 py-1.5 text-sm text-text-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
