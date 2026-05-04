import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// "Back to Education hub" affordance shown above the page header on
// every sub-dashboard. Plain server component — no client state.
export function EducationBackLink() {
  return (
    <Link
      href="/education"
      className="mb-2 inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary"
    >
      <ArrowLeft className="h-3 w-3" />
      <span>Back to Education hub</span>
    </Link>
  );
}
