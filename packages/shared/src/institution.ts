/**
 * Institution identity — who this deployment is.
 *
 * The platform was built for Khon Kaen University and its name was
 * hardcoded wherever data is matched against "our" rows (TCAS admission
 * statistics, peer rankings, Scopus affiliation) and in the User-Agent
 * every outbound fetch sends. An adopting university sets these keys in
 * `.env`; unset, they fall back to KKU's values so the upstream
 * deployment behaves exactly as before.
 *
 *   INSTITUTION_NAME_TH        must equal the `สถาบัน` column of the TCAS
 *                              sheets character for character (trimmed)
 *   INSTITUTION_NAME_EN        must equal the institution's name in the
 *                              ranking tables and its Scopus affiliation
 *   INSTITUTION_SHORT_NAME_EN  abbreviation used in AI prompts ("KKU")
 *   INSTITUTION_SHORT_NAME_TH  Thai abbreviation used in AI prompts ("มข.")
 *   INSTITUTION_CONTACT_EMAIL  sent in outbound User-Agents so a site
 *                              operator can reach us; falls back to
 *                              OPENALEX_MAILTO, else omitted
 *   APP_PUBLIC_URL             the deployment's public URL, also sent in
 *                              outbound User-Agents
 *
 * Same injectable-`env` shape as `resolveConnectorMode()` so tests never
 * touch process.env.
 */

export const DEFAULT_INSTITUTION_NAME_TH = 'มหาวิทยาลัยขอนแก่น';
export const DEFAULT_INSTITUTION_NAME_EN = 'Khon Kaen University';
export const DEFAULT_INSTITUTION_SHORT_NAME_EN = 'KKU';
export const DEFAULT_INSTITUTION_SHORT_NAME_TH = 'มข.';
export const DEFAULT_APP_PUBLIC_URL = 'https://program-landscape.kku.ac.th';

export interface Institution {
  nameTh: string;
  nameEn: string;
  shortNameEn: string;
  shortNameTh: string;
  /** null when neither INSTITUTION_CONTACT_EMAIL nor OPENALEX_MAILTO is set. */
  contactEmail: string | null;
  appUrl: string;
}

function readTrimmed(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function getInstitution(env: NodeJS.ProcessEnv = process.env): Institution {
  return {
    nameTh: readTrimmed(env, 'INSTITUTION_NAME_TH') ?? DEFAULT_INSTITUTION_NAME_TH,
    nameEn: readTrimmed(env, 'INSTITUTION_NAME_EN') ?? DEFAULT_INSTITUTION_NAME_EN,
    shortNameEn: readTrimmed(env, 'INSTITUTION_SHORT_NAME_EN') ?? DEFAULT_INSTITUTION_SHORT_NAME_EN,
    shortNameTh: readTrimmed(env, 'INSTITUTION_SHORT_NAME_TH') ?? DEFAULT_INSTITUTION_SHORT_NAME_TH,
    contactEmail:
      readTrimmed(env, 'INSTITUTION_CONTACT_EMAIL') ?? readTrimmed(env, 'OPENALEX_MAILTO'),
    appUrl: readTrimmed(env, 'APP_PUBLIC_URL') ?? DEFAULT_APP_PUBLIC_URL,
  };
}

/**
 * The honest identifying User-Agent for outbound fetches:
 * `Program-Landscape/1.0 (+<appUrl>; <contactEmail>)`, with an optional
 * purpose suffix on the product token (`Program-Landscape/1.0 bulk-pdf-load`).
 * Sites that refuse bot User-Agents (the curated report feeds) use a
 * browser string instead and do not call this.
 */
export function outboundUserAgent(
  purpose?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const { appUrl, contactEmail } = getInstitution(env);
  const product = purpose ? `Program-Landscape/1.0 ${purpose}` : 'Program-Landscape/1.0';
  const comment = contactEmail ? `+${appUrl}; ${contactEmail}` : `+${appUrl}`;
  return `${product} (${comment})`;
}

/** True when a source row's institution name is this deployment's (trimmed compare). */
export function isOwnInstitution(
  institutionName: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return institutionName?.trim() === getInstitution(env).nameTh;
}
