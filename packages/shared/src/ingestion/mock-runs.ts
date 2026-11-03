// Mock connectors return canned sample data. They must never run on a
// fresh install (they would write fabricated rows), so both the scheduler
// and the runner consult this single switch. Opt-in only.
export function mockRunsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALLOW_MOCK_CONNECTOR_RUNS === 'true';
}
