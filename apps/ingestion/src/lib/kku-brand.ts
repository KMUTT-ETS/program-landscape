import { deriveBrandTokens, oklchToHex, type BrandAssetKind, type BrandTokens } from '@kku/shared';

// KKU's brand, exactly as the app looked before white-labelling: the coral
// accent and the cardinal from tokens.css, and the official logo set copied to
// apps/ingestion/assets/kku/. Used only by org-seed-kku on KKU's deployment.

export const KKU_BRAND_COLOURS = {
  primary: oklchToHex({ l: 0.7, c: 0.15, h: 45 }),
  secondary: oklchToHex({ l: 0.44, c: 0.165, h: 20 }),
};

export const KKU_ASSET_FILES: Record<BrandAssetKind, string> = {
  'logo-light': 'kku-logo-light.png',
  'logo-dark': 'kku-logo-dark.png',
  favicon: 'favicon.png',
};

export function planKkuBrandFill(row: {
  logoLightKey: string | null;
  logoDarkKey: string | null;
  faviconKey: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}): { assets: BrandAssetKind[]; colours: boolean } {
  const assets: BrandAssetKind[] = [];
  if (!row.logoLightKey) assets.push('logo-light');
  if (!row.logoDarkKey) assets.push('logo-dark');
  if (!row.faviconKey) assets.push('favicon');
  return { assets, colours: row.primaryColor === null && row.secondaryColor === null };
}

export interface KkuBrandRow {
  version: number;
  logoLightKey: string | null;
  logoDarkKey: string | null;
  faviconKey: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}

export interface KkuBrandFillDeps {
  /** Reads a bundled KKU asset; null when the file cannot be found. */
  readFile: (fileName: string) => Buffer | null;
  /** Uploads to object storage and returns the key; null when storage is not configured. */
  putObject: ((kind: BrandAssetKind, bytes: Buffer) => Promise<string>) | null;
  setAsset: (kind: BrandAssetKind, key: string) => Promise<{ version: number }>;
  saveColours: (
    input: { primaryColor: string; secondaryColor: string; expectedVersion: number },
    tokens: BrandTokens,
  ) => Promise<{ version: number }>;
  log: (line: string) => void;
}

/**
 * Fills only the null brand fields of the profile, logging one line per step.
 * A failing asset (unreadable, storage error) is logged and skipped so a
 * storage outage never aborts the deploy; the colours are still set.
 */
export async function fillKkuBrand(row: KkuBrandRow, deps: KkuBrandFillDeps): Promise<void> {
  const plan = planKkuBrandFill(row);
  let version = row.version;

  if (plan.assets.length > 0 && !deps.putObject) {
    deps.log('brand: object storage not configured — logos skipped');
  } else if (deps.putObject) {
    for (const kind of plan.assets) {
      try {
        const bytes = deps.readFile(KKU_ASSET_FILES[kind]);
        if (!bytes) {
          deps.log(`brand: ${kind} file not found — skipped`);
          continue;
        }
        const key = await deps.putObject(kind, bytes);
        version = (await deps.setAsset(kind, key)).version;
        deps.log(`brand: ${kind} uploaded`);
      } catch (e) {
        deps.log(`brand: ${kind} upload failed — skipped (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }

  if (plan.colours) {
    const derived = deriveBrandTokens(KKU_BRAND_COLOURS.primary, KKU_BRAND_COLOURS.secondary);
    if (!derived.ok) {
      deps.log('brand: KKU colours failed the contrast gate — colours skipped');
    } else {
      await deps.saveColours(
        {
          primaryColor: KKU_BRAND_COLOURS.primary,
          secondaryColor: KKU_BRAND_COLOURS.secondary,
          expectedVersion: version,
        },
        derived.tokens,
      );
      deps.log('brand: colours set');
    }
  }

  if (plan.assets.length === 0 && !plan.colours) deps.log('brand: nothing to fill');
}
