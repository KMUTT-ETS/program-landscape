import Link from 'next/link';

// Copyright + legal-links footer. Used on every public-facing surface
// (signin, welcome home, /p/<slug>) and on every authenticated page
// via the app shell. Single source of truth for the copyright line so
// updates land everywhere from one edit.
//
// Per Thailand's Copyright Act B.E. 2537 §9, work created in the course
// of employment vests in the employer unless otherwise agreed in
// writing — so KKU holds the copyright as employer.
export function CopyrightFooter({ className }: { className?: string }) {
  const year = new Date().getFullYear();
  return (
    <div
      className={`flex flex-col items-center gap-1 text-[11px] text-text-tertiary ${className ?? ''}`}
    >
      <div>
        © {year} Khon Kaen University · Conceived by Asst. Prof. Dr. Denpong
        Soodphakdee, Vice President for Education and Digital
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <Link href="/copyright" className="hover:text-accent-default hover:underline">
          Copyright
        </Link>
        <span aria-hidden>·</span>
        <Link href="/terms" className="hover:text-accent-default hover:underline">
          Terms
        </Link>
        <span aria-hidden>·</span>
        <Link href="/disclaimer" className="hover:text-accent-default hover:underline">
          Disclaimer
        </Link>
      </div>
    </div>
  );
}
