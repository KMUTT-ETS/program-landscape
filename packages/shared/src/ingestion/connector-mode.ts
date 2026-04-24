// The catalog doesn't export a typed SourceSlug yet; strings are fine
// here and the runtime never misroutes because the registry keys on
// the connector's own `slug` field (which matches catalog entries).
type Slug = string;

// ─────────────────────────────────────────────────────────────────────
// Feature-flag for swapping mock connectors ↔ real connectors, per
// source.
//
// Resolution order (first match wins):
//
//   1. Per-connector env var — CONNECTOR_<SLUG>_MODE
//      Slug is uppercased with `-` → `_`. Examples:
//        CONNECTOR_KKU_REGISTRY_MODE=real
//        CONNECTOR_JOBTHAI_MODE=mocked
//   2. Global env var — CONNECTOR_MODE (default fallback)
//   3. Hard default — "mocked" until we've shipped real connectors.
//
// This lets a single deploy selectively flip one or two sources to
// real data while the rest stay on mocks during rollout. Matches the
// prompt-14 rollout pattern: "start with one integration at a time".
//
// The registry reads this at boot and routes to
// `Mocked<Name>Connector` or `<Name>Connector` accordingly. Each
// integration session is responsible for:
//   1. Renaming the current mock to `Mocked<Name>Connector`.
//   2. Adding the real `<Name>Connector`.
//   3. Flipping the env var in .env / .env.prod.
// ─────────────────────────────────────────────────────────────────────

export type ConnectorMode = 'mocked' | 'real';

const VALID_MODES: readonly ConnectorMode[] = ['mocked', 'real'];

function slugToEnvKey(slug: string): string {
  return `CONNECTOR_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_MODE`;
}

function parseMode(value: string | undefined): ConnectorMode | null {
  if (!value) return null;
  const normalised = value.trim().toLowerCase();
  return VALID_MODES.includes(normalised as ConnectorMode)
    ? (normalised as ConnectorMode)
    : null;
}

export interface ConnectorModeResolution {
  mode: ConnectorMode;
  source: 'per-connector-env' | 'global-env' | 'default';
  envKey?: string;
}

/**
 * Resolve the effective mode for a connector slug.
 *
 * @param slug — catalog slug (e.g. 'kku-registry')
 * @param env  — optional env object for testing; defaults to process.env
 */
export function resolveConnectorMode(
  slug: Slug,
  env: NodeJS.ProcessEnv = process.env,
): ConnectorModeResolution {
  const perConnectorKey = slugToEnvKey(slug);
  const perConnector = parseMode(env[perConnectorKey]);
  if (perConnector) {
    return { mode: perConnector, source: 'per-connector-env', envKey: perConnectorKey };
  }
  const global = parseMode(env.CONNECTOR_MODE);
  if (global) {
    return { mode: global, source: 'global-env', envKey: 'CONNECTOR_MODE' };
  }
  // Conservative default: until we've shipped real connectors for every
  // source, running with no env var set keeps everyone on mocks.
  return { mode: 'mocked', source: 'default' };
}

/**
 * Convenience — just the mode string.
 */
export function connectorMode(
  slug: Slug,
  env: NodeJS.ProcessEnv = process.env,
): ConnectorMode {
  return resolveConnectorMode(slug, env).mode;
}
