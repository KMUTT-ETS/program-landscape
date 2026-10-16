// Next.js boot hook (experimental.instrumentationHook, Next 14.2). Runs once
// per server process before the first request.
//
// The web server reads the organisation identity on some server paths
// (faculty-scoped dashboards, the /profile narrative and Scopus lookup), so it
// loads the profile at boot and polls for edits like the api and ingestion
// processes do. See instrumentation-node.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { loadOrganizationAtBoot } = await import('./instrumentation-node');
    await loadOrganizationAtBoot();
  }
}
