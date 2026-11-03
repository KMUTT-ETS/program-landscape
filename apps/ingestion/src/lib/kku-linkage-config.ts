// Phase 4 of the programme pipeline reads KKU's registrar (Oracle) and HR
// (MSSQL) warehouses. Installations without them must skip it, not fail.
// Keys mirror what the two clients' configFromEnv() require.
const REQUIRED_KEYS: readonly string[] = [
  'KKU_REGISTRY_DB_HOST',
  'KKU_REGISTRY_DB_PORT',
  'KKU_REGISTRY_DB_SERVICE',
  'KKU_REGISTRY_DB_USER',
  'KKU_REGISTRY_DB_PASSWORD',
  'KKU_HR_DB_HOST',
  'KKU_HR_DB_PORT',
  'KKU_HR_DB_DATABASE',
  'KKU_HR_DB_USER',
  'KKU_HR_DB_PASSWORD',
];

export function kkuLinkageConfigured(env: NodeJS.ProcessEnv = process.env): {
  ok: boolean;
  missing: string[];
} {
  const missing = REQUIRED_KEYS.filter((k) => {
    const v = env[k]?.trim();
    return !v || v.includes('REPLACE_ME');
  });
  return { ok: missing.length === 0, missing };
}
