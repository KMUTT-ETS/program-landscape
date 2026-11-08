import { redirect } from 'next/navigation';
import { isSetupAvailable } from '@kku/db';

import { ProductMark } from '@/components/brand/product-mark-component';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up' };

// First-run wizard.
//
// Public by design — a fresh installation has no account to authenticate
// against, so there is nothing to put in front of this. It is the only
// anonymous route in the product that creates a SUPER_ADMIN, and it shuts
// permanently the moment it is used; isSetupAvailable() is the whole
// story, and the redirect below is enforced again inside the transaction
// the submit runs in.
export default async function SetupPage() {
  if (!(await isSetupAvailable())) redirect('/signin');

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-1 px-6 py-16">
      <div className="w-full max-w-[420px]">
        <ProductMark className="h-8 w-auto text-text-primary" />

        <h1 className="mt-8 text-[22px] font-semibold leading-tight text-text-primary">
          Set up Program Landscape
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          This installation has no administrator yet. The account you create here is
          the first one, and it can create every other.
        </p>

        <div className="mt-7">
          <SetupForm />
        </div>

        <p className="mt-8 text-[11px] leading-relaxed text-text-tertiary">
          This page is reachable by anyone who can reach this address, and it closes
          for good once an account exists. Do it now rather than later.
        </p>
      </div>
    </main>
  );
}
