import Link from 'next/link';

export function SetupBanner({ canConfigure }: { canConfigure: boolean }) {
  return (
    <div role="status" className="mb-4 rounded-md border border-[oklch(var(--color-warning-default)/0.4)] bg-warning/10 p-3 text-sm">
      Organisation not configured — AI features and data connectors stay unavailable until it is.{' '}
      {canConfigure ? (
        <Link href="/admin/organization" className="font-medium underline">Set it up</Link>
      ) : (
        <span>Ask an administrator to set it up.</span>
      )}
    </div>
  );
}
