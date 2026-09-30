// Public surface only — the fetchers and helpers behind it stay internal.
export {
  buildStaffProfile,
  emptyResearchSummary,
  getStaffPublicationsSnapshot,
  resolveFacultyMemberForUser,
  stripTitlePrefixes,
  type StaffBasicInfo,
  type StaffProfile,
  type StaffProfileOptions,
  type StaffPublicationsSnapshot,
} from './profile';
export { resolveStaffForLookup, type StaffLookup } from './lookup';
