// Client-safe profile types. The shared shapes and the APA helpers live in
// @kku/shared/src/staff-profile/types (imported by DEEP PATH — the
// @kku/shared barrel pulls node:crypto, which webpack cannot bundle for the
// browser). Only ProfileData lives here, because it references a type from
// @kku/db. `import type` is erased at compile time, so neither barrel ever
// reaches the browser bundle.
import type { TeachingTalentStamp } from '@kku/db';
import type {
  CachedExpertiseNarrative,
  CurriculumProgram,
  EducationEntry,
  ProfileBasicInfo,
  PublicationEntry,
  ResearchSummary,
  TeachingProfile,
} from '@kku/shared/src/staff-profile/types';

export * from '@kku/shared/src/staff-profile/types';
export type { TeachingTalentStamp };

export interface ProfileData {
  hasFacultyMemberRecord: boolean;
  basic: ProfileBasicInfo;
  education: EducationEntry[];
  research: ResearchSummary;
  curriculum: CurriculumProgram[];
  publications: PublicationEntry[];
  /** Teaching summary from the registrar's class-offerings cube. Null
   *  when the user is unmatched to a FacultyMember — same posture as
   *  research/curriculum. */
  teaching: TeachingProfile | null;
  /** Teaching and Learning Talent verdict — drives the rubber stamp on the
   *  name panel. Null when the user has no FacultyMember record or no
   *  evaluations in the assessment window at all ("no evidence" is not the
   *  same claim as "assessed and did not qualify"). `isTalent` false means
   *  assessed but not qualifying; the stamp renders for neither. */
  talent: TeachingTalentStamp | null;
  /** Pre-computed AI expertise summary, when one has been generated.
   *  Null when never generated — the client component auto-fires the
   *  generation request on first mount in that case. */
  cachedNarrative: CachedExpertiseNarrative | null;
}
