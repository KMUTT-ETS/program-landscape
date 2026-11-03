/** The organisation's short names, as the chrome shows them. */
export interface OrgShortNames {
  en: string;
  th: string;
}

/** Shown when the install has no organisation profile yet. */
export const DEFAULT_ORG_SHORT_NAMES: OrgShortNames = { en: 'University', th: 'มหาวิทยาลัย' };
