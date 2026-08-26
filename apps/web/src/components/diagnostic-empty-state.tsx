import Link from 'next/link';
import { AlertTriangle, LogIn, Lock, Search, ServerCrash, WifiOff } from 'lucide-react';
import { Button } from '@kku/ui';
import type { ApiFetchError } from '@/lib/api-client';

// ─────────────────────────────────────────────────────────────────────────
// Server-renderable diagnostic empty state for pages that previously
// used the `.catch(() => null)` swallow-everything pattern. Renders a
// specific cause + actionable next step so an operator-facing bug report
// can immediately tell us which class of failure they hit.
//
// Used initially by the /risks pages (single-role UNIVERSITY_USER bug
// report 2026-05-12). Generalisable to every server-component page
// with an apiFetch — apply liberally.
// ─────────────────────────────────────────────────────────────────────────

export function DiagnosticEmptyState({
  surface,
  error,
  emptyMessage,
}: {
  /** What the user was trying to view — used in the headline. */
  surface: string;
  /** The structured error from apiFetchSafe(). Null = "loaded OK but
   *  the response contained zero rows" (a different kind of empty). */
  error: ApiFetchError | null;
  /** Optional override for the "genuinely empty" message when error=null. */
  emptyMessage?: string;
}) {
  if (!error) {
    return (
      <div className="rounded-md border border-border-default bg-surface-1 p-8 text-center text-sm text-text-secondary">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">
          <Search className="size-icon-lg text-text-tertiary" aria-hidden />
        </div>
        <p className="font-medium text-text-primary">No {surface} data yet</p>
        <p className="mt-1 text-xs text-text-tertiary">
          {emptyMessage ?? 'The query ran successfully but returned no rows.'}
        </p>
      </div>
    );
  }

  const view = renderForCategory(error, surface);
  return (
    <div className="rounded-md border border-border-default bg-surface-1 p-6 text-sm text-text-secondary">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${view.iconBg}`}
        >
          {view.icon}
        </div>
        <div className="flex-1">
          <p className="text-base font-medium text-text-primary">{view.title}</p>
          <p className="mt-1 text-xs text-text-tertiary">{view.body}</p>
          {view.action ? <div className="mt-3">{view.action}</div> : null}
          <details className="mt-3 text-[11px] text-text-tertiary">
            <summary className="cursor-pointer select-none hover:text-text-secondary">
              Technical details
            </summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface-0 p-2 font-mono text-[11px] leading-relaxed text-text-tertiary">
              {`category: ${error.category}\nstatus:   ${error.status ?? '—'}\ncode:     ${error.code ?? '—'}\nmessage:  ${error.message}`}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

function renderForCategory(error: ApiFetchError, surface: string): {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  body: string;
  action?: React.ReactNode;
} {
  switch (error.category) {
    case 'auth':
      return {
        icon: <LogIn className="size-icon-lg text-warning-default" aria-hidden />,
        iconBg: 'bg-warning-default/15',
        title: 'Your sign-in session has expired',
        body:
          'The API rejected your session token. This usually happens when the app was upgraded since you last signed in. Sign out and sign in again to refresh your session.',
        action: (
          <Button asChild variant="outline" size="sm">
            <Link href="/signout">
              <LogIn className="size-icon-sm" aria-hidden /> Sign out + sign in again
            </Link>
          </Button>
        ),
      };
    case 'permission':
      return {
        icon: <Lock className="size-icon-lg text-danger-default" aria-hidden />,
        iconBg: 'bg-danger-default/15',
        title: `You don't have permission to view ${surface}`,
        body:
          'Your account role doesn\'t carry the permission this page requires. If you believe this is wrong, contact an admin — include the technical details below in your message.',
      };
    case 'notFound':
      return {
        icon: <Search className="size-icon-lg text-text-tertiary" aria-hidden />,
        iconBg: 'bg-surface-2',
        title: `${surface} not found`,
        body: 'The resource referenced by this URL does not exist (or has been removed).',
      };
    case 'server':
      return {
        icon: <ServerCrash className="size-icon-lg text-danger-default" aria-hidden />,
        iconBg: 'bg-danger-default/15',
        title: 'API server error',
        body:
          'The backend returned a 5xx response. This is likely a transient issue — try refreshing in a few seconds. If it persists, contact an admin with the technical details below.',
      };
    case 'network':
      return {
        icon: <WifiOff className="size-icon-lg text-warning-default" aria-hidden />,
        iconBg: 'bg-warning-default/15',
        title: 'Network problem reaching the API',
        body:
          'The server could not contact the API. Check your network connection and try refreshing.',
      };
    case 'data':
      return {
        icon: <AlertTriangle className="size-icon-lg text-warning-default" aria-hidden />,
        iconBg: 'bg-warning-default/15',
        title: 'API returned an unexpected response',
        body:
          'The response did not match the expected shape. This is a programming error — please report the technical details below.',
      };
    default:
      return {
        icon: <AlertTriangle className="size-icon-lg text-text-tertiary" aria-hidden />,
        iconBg: 'bg-surface-2',
        title: `Could not load ${surface}`,
        body: 'The page hit an error it couldn\'t classify. Technical details are below.',
      };
  }
}
