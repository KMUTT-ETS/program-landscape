import { redirect } from 'next/navigation';

// Opportunities are the white-space chip of the gap map: a field employers
// ask for that no KKU programme is assigned to. The separate page is gone;
// the bookmark still works.
export default async function OpportunitiesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ verdict: 'white-space' });
  if (sp.scope) q.set('scope', sp.scope);
  if (sp.scopeId) q.set('scopeId', sp.scopeId);
  redirect(`/gap-analysis?${q}`);
}
