import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { Mail, ShieldOff, Home } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access required — Program Landscape' };

// Polite landing for users who are signed in but lack the role/scope
// for the page they tried to reach. Used by route gates that previously
// redirected to "/" (where the user might land on something else they
// also can't see). Showing a clear message + their current role + a
// contact mailto is friendlier than a silent redirect or a 403.
//
// Query params:
//   ?from=<originalPath> — where they tried to go (best-effort, only
//                          honoured for same-origin paths)
//   ?need=<role|permission> — optional human label of what's missing

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; need?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  // Not signed in at all → send to signin. The intent of /no-access is
  // "you ARE signed in but the page is gated" — anonymous visitors
  // belong on /signin instead.
  if (!user?.userId) redirect('/signin');

  const params = await searchParams;
  const from = sanitiseFrom(params.from);
  const need = params.need;

  const friendlyRole = humaniseRole(user.role);

  return (
    <main className="min-h-screen w-full bg-surface-1">
      <div className="relative overflow-hidden">
        {/* Soft gradient backdrop — same warm cream / coral language as
            the signin page, dialled down. Reads as "calm" rather than
            "error". */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-90"
          style={{
            background:
              'linear-gradient(135deg, oklch(var(--color-surface-1)) 0%, oklch(var(--color-surface-1)) 60%, oklch(var(--color-accent-default) / 0.07) 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute -top-32 right-1/4 h-[420px] w-[420px] rounded-full blur-[120px] opacity-20"
          style={{ background: 'oklch(var(--color-accent-default))' }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, oklch(var(--color-text-primary)) 1.2px, transparent 1.2px)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative z-10 mx-auto flex min-h-screen max-w-[640px] flex-col items-center justify-center px-6 py-16 sm:px-10">
          <div className="relative mb-7">
            <div
              aria-hidden
              className="absolute inset-0 rounded-3xl blur-md opacity-40"
              style={{ background: 'oklch(var(--color-accent-default))' }}
            />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl border border-accent-default/30 bg-accent-default/10 text-accent-default">
              <ShieldOff className="h-7 w-7" aria-hidden />
            </div>
          </div>

          <h1 className="text-center text-[28px] font-medium tracking-tight text-text-primary sm:text-[32px]">
            You don&apos;t have access to that page yet
          </h1>
          <p className="mx-auto mt-3 max-w-[480px] text-center text-[14px] leading-relaxed text-text-secondary">
            You&apos;re signed in as <span className="font-medium text-text-primary">{user.email}</span>,
            with the role <span className="font-medium text-text-primary">{friendlyRole}</span>.
            That role doesn&apos;t include access to this area of Program Landscape.
            {from && (
              <>
                {' '}
                The page you tried to reach was{' '}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-text-secondary">
                  {from}
                </code>
                .
              </>
            )}
          </p>

          {need && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-0 px-3 py-1 text-[12px] text-text-tertiary">
              Required: <span className="font-medium text-text-secondary">{need}</span>
            </p>
          )}

          {/* Soft "what to do" card — avoids the "denied!" tone in
              favour of next steps. Two paths: try a page they can
              probably see, or write to the Office for access. */}
          <div className="mt-8 w-full rounded-2xl border border-border-subtle bg-surface-0 p-5 shadow-elevation-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
              What to do
            </div>
            <ul className="mt-3 flex flex-col gap-3 text-[13px] leading-relaxed text-text-secondary">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[11px] font-semibold text-accent-default">
                  1
                </span>
                <span>
                  Head back to the <Link href="/" className="font-medium text-accent-default underline-offset-4 hover:underline">home page</Link>
                  {' '}— most modules are open to your role and you can drill into anything you have permission for from there.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[11px] font-semibold text-accent-default">
                  2
                </span>
                <span>
                  If you should have access, contact the{' '}
                  <a
                    href={`mailto:denpong@kku.ac.th?subject=${encodeURIComponent(
                      `Program Landscape access request — ${user.email}`,
                    )}&body=${encodeURIComponent(
                      `Hi,\n\nI'm signed in as ${user.email} (current role: ${friendlyRole}) and would like access to:\n\n${from ? `  ${from}\n\n` : ''}Please let me know what's needed.\n\nThank you.`,
                    )}`}
                    className="inline-flex items-center gap-1 font-medium text-accent-default underline-offset-4 hover:underline"
                  >
                    <Mail className="size-icon-sm" aria-hidden />
                    Office of the Vice President for Education and Digital
                  </a>
                  {' '}with a short note about what you need to see.
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border-default bg-surface-0 px-4 py-2 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 hover:border-border-strong"
            >
              <Home className="size-icon-sm" aria-hidden />
              Home
            </Link>
            <Link
              href="/signin"
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
            >
              Sign in as someone else
            </Link>
          </div>

          <p className="mt-8 text-center text-[11px] leading-relaxed text-text-tertiary">
            This isn&apos;t an error — every program in the platform has its own
            visibility rules so faculty data stays where it should.
            {user.role === 'PROGRAM_USER' && (
              <>
                {' '}
                Your access is scoped to your assigned programs; ask your
                department head if you should also be listed on others.
              </>
            )}
          </p>
        </div>
      </div>
    </main>
  );
}

function sanitiseFrom(from: string | undefined): string | null {
  if (!from) return null;
  // Only honour same-origin paths — don't render an arbitrary off-site URL.
  if (!from.startsWith('/') || from.startsWith('//')) return null;
  // Trim any obviously malicious payload — show at most 96 chars.
  return from.length > 96 ? from.slice(0, 93) + '…' : from;
}

function humaniseRole(role: SessionUser['role']): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Super Admin';
    case 'SYSTEM_ADMIN':
      return 'System Admin';
    case 'UNIVERSITY_USER':
      return 'University User';
    case 'FACULTY_USER':
      return 'Faculty User';
    case 'PROGRAM_USER':
      return 'Program User';
    default:
      return role;
  }
}
