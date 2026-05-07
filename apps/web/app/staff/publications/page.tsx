// Permanent redirect — /staff/publications was consolidated into
// /staff/research on 2026-05-07. Anyone with a bookmarked link gets
// forwarded to the unified view automatically.

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function PublicationsRedirect({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const item of values) params.append(k, item);
  }
  const target = `/staff/research${params.toString() ? `?${params.toString()}` : ''}`;
  redirect(target);
}
