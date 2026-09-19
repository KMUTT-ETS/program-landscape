import { redirect } from 'next/navigation';

// The DQ attainment lens is a measured-attainment axis, not a gap figure —
// it now lives under /education beside the other student dashboards.
export default async function DigitalCompetencyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.scope) q.set('scope', sp.scope);
  if (sp.scopeId) q.set('scopeId', sp.scopeId);
  const qs = q.toString();
  redirect(`/education/digital-competency${qs ? `?${qs}` : ''}`);
}
