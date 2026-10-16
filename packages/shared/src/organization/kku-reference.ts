import type { Institution } from '../institution';

/**
 * Khon Kaen University's identity, exactly as the platform used it before
 * white-labelling. Used ONLY by `org-seed-kku` (to seed KKU's own
 * deployment) and by test setup files. It is never a runtime fallback —
 * getInstitution() throws rather than reach for this.
 */
export const KKU_REFERENCE_ORGANIZATION: Institution = {
  nameTh: 'มหาวิทยาลัยขอนแก่น',
  nameEn: 'Khon Kaen University',
  shortNameEn: 'KKU',
  shortNameTh: 'มข.',
  regionTh: 'ภาคตะวันออกเฉียงเหนือ',
  regionEn: 'Northeast',
  contactEmail: null,
  appUrl: 'https://program-landscape.kku.ac.th',
};
