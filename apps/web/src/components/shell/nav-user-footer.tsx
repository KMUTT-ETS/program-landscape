import Link from 'next/link';

// Sidebar footer credits. After the 2026-05-09 chrome consolidation
// (account/theme/sign-out moved into the top-bar dropdown) the only
// thing left in the sidebar footer is this signature block — kept
// intentionally always-visible at the bottom of the nav.

export function NavCredits() {
  const year = new Date().getFullYear();
  return (
    <div className="px-1 py-0.5 text-[10px] leading-relaxed text-nav-fg-muted">
      <div className="font-medium text-nav-fg/80">
        © {year} Khon Kaen University
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
