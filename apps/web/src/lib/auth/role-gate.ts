// Tiny helper for the BFF / proxy route handlers under
// `apps/web/app/api/admin-*/route.ts`. Closes the V2 violation from the
// prompt-04 authorisation matrix: previously these routes ran `auth()`
// only and forwarded to NestJS regardless of role — defence-in-depth
// is now Next-side AND Nest-side.
//
// Usage:
//   const guard = await requireSession({ minRole: 'admin' });
//   if (guard.kind === 'deny') return guard.response;
//   const { user } = guard;
//   …forward to NestJS with user.userId etc.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isAdminGrade, isUniversityWide, type SessionUser } from '@kku/shared';

export type RoleGate = 'admin' | 'university';

type GateResult =
  | { kind: 'allow'; user: SessionUser }
  | { kind: 'deny'; response: NextResponse };

const UNAUTHORIZED = NextResponse.json(
  { data: null, error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
  { status: 401 },
);
const FORBIDDEN = NextResponse.json(
  { data: null, error: { code: 'FORBIDDEN', message: 'Insufficient role' } },
  { status: 403 },
);

export async function requireSession({
  minRole,
}: {
  minRole: RoleGate;
}): Promise<GateResult> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return { kind: 'deny', response: UNAUTHORIZED };

  const ok =
    minRole === 'admin' ? isAdminGrade(user.role) : isUniversityWide(user.role);
  if (!ok) return { kind: 'deny', response: FORBIDDEN };
  return { kind: 'allow', user };
}
