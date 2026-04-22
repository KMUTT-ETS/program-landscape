'use client';

import { signOut } from 'next-auth/react';
import type { SessionUser } from '@kku/shared';

export function UserMenu({ user }: { user: SessionUser }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right text-xs leading-tight">
        <div className="font-medium text-fg">{user.name ?? user.email}</div>
        <div className="text-fg-muted">{user.role.replaceAll('_', ' ')}</div>
      </div>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/signin' })}
        className="rounded-sm border border-border bg-surface-raised px-3 py-1 text-xs text-fg hover:border-border-strong"
      >
        Sign out
      </button>
    </div>
  );
}
