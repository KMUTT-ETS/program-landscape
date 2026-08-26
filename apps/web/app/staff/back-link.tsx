import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export function StaffBackLink() {
  return (
    <Link
      href="/staff"
      className="mb-2 inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
    >
      <ChevronLeft className="size-icon-xs" />
      Back to Staff dashboard
    </Link>
  );
}
