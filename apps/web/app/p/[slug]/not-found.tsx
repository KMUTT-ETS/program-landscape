import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-text-tertiary">
        404
      </p>
      <h1 className="mt-4 text-2xl font-semibold text-text-primary">
        Profile not available
      </h1>
      <p className="mt-3 max-w-md text-sm text-text-secondary">
        This profile is private, or the link has been changed by its owner.
      </p>
      <Link
        href="/"
        className="mt-8 text-sm font-medium text-accent-default hover:underline"
      >
        Go to Program Landscape →
      </Link>
    </div>
  );
}
