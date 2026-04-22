// Refuses to load the Credentials provider in production. Imported by
// auth.ts; the check runs at module load time so any deploy that leaves
// ENABLE_LOCAL_AUTH=true crashes before serving traffic.

export function assertLocalAuthSafe(): void {
  const enabled = process.env.ENABLE_LOCAL_AUTH === 'true';
  const isProd = process.env.NODE_ENV === 'production';
  if (enabled && isProd) {
    throw new Error(
      'ENABLE_LOCAL_AUTH=true is not permitted when NODE_ENV=production. ' +
        'Unset ENABLE_LOCAL_AUTH (or set to false) before deploying.',
    );
  }
}

export function isLocalAuthEnabled(): boolean {
  assertLocalAuthSafe();
  return process.env.ENABLE_LOCAL_AUTH === 'true';
}
