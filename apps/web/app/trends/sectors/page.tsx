import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader, Section } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sectoral Trends' };

// Sector filter presets. Each card deep-links into /trends with a
// search query that narrows to that sector. Real sector-tagged signals
// (with a TrendSignal.tags column) land with prompt 14's real connectors;
// for now we search on title keywords.

const SECTORS = [
  { slug: 'bcg', label: 'BCG economy', search: 'BCG' },
  { slug: 'bio-economy', label: 'Bio-economy', search: 'bio' },
  { slug: 'digital-economy', label: 'Digital economy', search: 'digital' },
  { slug: 'agriculture', label: 'Agriculture', search: 'agri' },
  { slug: 'healthcare', label: 'Healthcare', search: 'health' },
  { slug: 'engineering', label: 'Engineering + manufacturing', search: 'engineering' },
  { slug: 's-curve', label: 'S-curve industries', search: 'S-curve' },
  { slug: 'ev', label: 'EV / automotive', search: 'EV' },
];

export default async function SectorsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Sectoral trends"
        subtitle="Sector-filtered boards. Real sector tagging arrives with prompt 14; for now each card filters the feed by keyword."
      />
      <Section title="Sectors">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {SECTORS.map((s) => (
            <Link key={s.slug} href={`/trends?search=${encodeURIComponent(s.search)}`}>
              <Card className="transition-shadow hover:shadow-elevation-2">
                <h3 className="text-sm font-semibold">{s.label}</h3>
                <p className="mt-1 text-xs text-text-tertiary">keyword: {s.search}</p>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
    </AuthedAppShell>
  );
}
