import Link from 'next/link';
import { resolveReleaseVersion } from '@/lib/release-version';
import { brandingForRequest } from '@/lib/branding';

// Sidebar footer credits. After the 2026-05-09 chrome consolidation
// (account/theme/sign-out moved into the top-bar dropdown) the only
// thing left in the sidebar footer is this signature block — kept
// intentionally always-visible at the bottom of the nav.

export async function NavCredits() {
  const branding = await brandingForRequest();
  const year = new Date().getFullYear();
  // Resolved at request time, not baked in — this is a server component.
  // In prod that is RELEASE_VERSION from the container environment; in dev
  // it is derived from git tags (the tag itself when HEAD sits on one, the
  // next patch when there is work after it). See lib/release-version.ts.
  const release = resolveReleaseVersion();
  return (
    <div className="px-1 py-0.5 text-[10px] leading-relaxed text-nav-fg-muted">
      {/* justify-between, not a gap: the year and the version are both
          numbers and read as one run when only whitespace separates them. */}
      <div className="flex items-baseline justify-between gap-2 font-medium text-nav-fg/80">
        <span>© {year} {branding?.nameEn ?? 'Program Landscape'}</span>
        {release && (
          <span className="font-tabular shrink-0 text-nav-fg-muted" title={`Release ${release}`}>
            v{release}
          </span>
        )}
      </div>
      <div>Conceived by Dr. Denpong Soodphakdee</div>
      <div>Vice President for Education and Digital</div>
      <div className="mt-1 opacity-80">
        Built in collaboration with Claude (Anthropic)
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 opacity-90">
        <Link href="/copyright" className="hover:text-nav-fg hover:underline">
          Copyright
        </Link>
        <span aria-hidden>·</span>
        <Link href="/terms" className="hover:text-nav-fg hover:underline">
          Terms
        </Link>
        <span aria-hidden>·</span>
        <Link href="/disclaimer" className="hover:text-nav-fg hover:underline">
          Disclaimer
        </Link>
      </div>
    </div>
  );
}
