// Sidebar footer credits. After the 2026-05-09 chrome consolidation
// (account/theme/sign-out moved into the top-bar dropdown) the only
// thing left in the sidebar footer is this signature block — kept
// intentionally always-visible at the bottom of the nav.

export function NavCredits() {
  return (
    <div className="px-1 py-0.5 text-[10px] leading-relaxed text-nav-fg-muted">
      <div className="font-medium text-nav-fg/80">
        Conceived by Dr. Denpong Soodphakdee
      </div>
      <div>Vice President for Education and Digital, KKU</div>
      <div className="mt-1 opacity-80">
        Built in collaboration with Claude (Anthropic)
      </div>
    </div>
  );
}
