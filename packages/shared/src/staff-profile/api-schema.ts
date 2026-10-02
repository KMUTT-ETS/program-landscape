// Wire contract for POST /api/v1/external/staff-profile (staff-profile.v1).
// Additive changes keep v1; renaming or removing a field is v2.
//
// Browser-safe on purpose: the admin console imports STAFF_PROFILE_SECTIONS
// from a client component, so this file may import only `zod` and pure
// modules — never the package barrel.
import { z } from 'zod';
import { GRANT_PROJECT_TYPES } from './grants';
import { isValidThaiCitizenId, normaliseThaiCitizenId } from '../identity/thai-citizen-id';

export const STAFF_PROFILE_API_VERSION = 'staff-profile.v1';

/** Sections an admin can grant. `person` is always returned. */
export const STAFF_PROFILE_SECTIONS = [
  'affiliation',
  'education',
  'teaching',
  'research',
  'publications',
  // Performance data about the person: opt-in, never granted by default.
  'teachingEvaluation',
  // Funding records about the person: opt-in, never granted by default.
  'grants',
] as const;
export type StaffProfileSection = (typeof STAFF_PROFILE_SECTIONS)[number];

/** Human-readable names for the admin console; the wire keys stay as above. */
export const STAFF_PROFILE_SECTION_LABELS: Record<StaffProfileSection, string> = {
  affiliation: 'Affiliation',
  education: 'Education',
  teaching: 'Teaching load',
  research: 'Research summary',
  publications: 'Publications',
  teachingEvaluation: 'Teaching evaluation',
  grants: 'Research & academic service grants',
};

export const StaffProfileLookupSchema = z.union([
  z
    .object({
      citizenId: z
        .string()
        .refine(isValidThaiCitizenId, 'citizenId must be 13 digits with a valid check digit')
        .transform(normaliseThaiCitizenId),
    })
    .strict(),
  z.object({ email: z.string().trim().toLowerCase().email() }).strict(),
]);
export type StaffProfileLookup = z.infer<typeof StaffProfileLookupSchema>;

const Bilingual = z.object({ th: z.string().nullable(), en: z.string().nullable() });

export const StaffProfileResponseDataSchema = z.object({
  person: z.object({
    facultyMemberId: z.string(),
    isActive: z.boolean(),
    title: z.object({ th: z.string(), en: z.string(), abbrevTh: z.string(), abbrevEn: z.string() }),
    name: z.object({ th: z.string(), en: z.string() }),
    displayName: z.object({ th: z.string(), en: z.string() }),
    email: z.string().nullable(),
    identifiers: z.object({
      orcid: z.string().nullable(),
      scopusAuthorId: z.string().nullable(),
      openalexAuthorId: z.string().nullable(),
      scholarProfileId: z.string().nullable(),
    }),
  }),
  affiliation: z
    .object({
      faculty: Bilingual,
      department: Bilingual,
      programmes: z.array(
        z.object({
          code: z.string(),
          nameTh: z.string(),
          nameEn: z.string(),
          level: z.string(),
          role: z.enum(['COORDINATOR', 'CORE', 'SUPPORT']),
        }),
      ),
    })
    .optional(),
  education: z
    .array(
      z.object({
        qualification: z.string(),
        level: z.string().nullable(),
        major: z.string().nullable(),
        institute: z.string().nullable(),
        countryCode: z.string().nullable(),
        yearBE: z.number().nullable(),
        source: z.enum(['unicon-ds2003', 'fallback']),
      }),
    )
    .optional(),
  teaching: z
    .object({
      available: z.boolean(),
      windowYearsBE: z.object({ from: z.number(), to: z.number() }),
      totals: z.object({
        studentsTaught: z.number(),
        sections: z.number(),
        distinctCourses: z.number(),
        activeSemesters: z.number(),
        avgContactHrsPerWeek: z.number(),
      }),
      byYear: z.array(
        z.object({
          yearBE: z.number(),
          sections: z.number(),
          studentsTaught: z.number(),
          contactHrsPerWeek: z.number(),
        }),
      ),
      courses: z.array(
        z.object({
          code: z.string(),
          nameTh: z.string().nullable(),
          nameEn: z.string().nullable(),
          sections: z.number(),
          studentsTaught: z.number(),
          firstYearBE: z.number(),
          lastYearBE: z.number(),
        }),
      ),
    })
    .optional(),
  research: z
    .object({
      basis: z.enum(['google-scholar', 'library']),
      totalPapers: z.number(),
      totalCitations: z.number(),
      hIndex: z.number(),
      earliestYear: z.number().nullable(),
      latestYear: z.number().nullable(),
      yearsActive: z.number().nullable(),
      peakYear: z.number().nullable(),
      peakYearCount: z.number(),
      topVenues: z.array(z.object({ venue: z.string(), count: z.number() })),
    })
    .optional(),
  publications: z
    .array(
      z.object({
        year: z.number(),
        title: z.string(),
        venue: z.string().nullable(),
        type: z.string(),
        citations: z.number(),
        source: z.string().nullable(),
        doi: z.string().nullable(),
        scopusId: z.string().nullable(),
        pmid: z.string().nullable(),
        scholarPaperId: z.string().nullable(),
        authors: z.array(
          z.object({ family: z.string(), given: z.string().nullable(), initials: z.string().nullable() }),
        ),
        authorsComplete: z.boolean(),
        apa: z.string(),
      }),
    )
    .optional(),
  // null = granted, but no student evaluations on record (distinct from
  // withheld, where the key is absent and listed in sectionsWithheld).
  teachingEvaluation: z
    .object({
      scale: z.object({ min: z.literal(1), max: z.literal(5) }),
      overall: z.number(),
      /** Answers, one per question answered — not students. */
      totalAnswers: z.number(),
      courseCount: z.number(),
      /** Terms with answers. */
      termCount: z.number(),
      firstYearBE: z.number().nullable(),
      lastYearBE: z.number().nullable(),
      latestYearBE: z.number().nullable(),
      latestRating: z.number().nullable(),
      previousYearBE: z.number().nullable(),
      previousRating: z.number().nullable(),
      categories: z.array(
        z.object({
          tag: z.string(),
          labelEn: z.string(),
          labelTh: z.string(),
          questions: z.number(),
          latest: z.number().nullable(),
          allTime: z.number().nullable(),
        }),
      ),
      untaggedQuestions: z.number(),
      courses: z.array(
        z.object({
          code: z.string(),
          nameTh: z.string().nullable(),
          nameEn: z.string().nullable(),
          rating: z.number(),
          answers: z.number(),
          latestYearBE: z.number(),
          latestSemester: z.number(),
        }),
      ),
    })
    .nullable()
    .optional(),
  // Granted → always an object (empty lists when nothing is on record);
  // withheld → key absent and listed in sectionsWithheld.
  grants: z
    .object({
      led: z.number(),
      coInvestigator: z.number(),
      active: z.number(),
      byType: z.object({
        RESEARCH: z.number(),
        ACADEMIC_SERVICE: z.number(),
        CONSULTING: z.number(),
        OTHER: z.number(),
      }),
      projects: z.array(
        z
          .object({
            sourceProposalId: z.number(),
            titleTh: z.string(),
            titleEn: z.string().nullable(),
            type: z.enum(GRANT_PROJECT_TYPES),
            role: z.enum(['LEAD', 'CO_INVESTIGATOR']),
            fiscalYearBe: z.number(),
            startDate: z.string().nullable(),
            endDate: z.string().nullable(),
            funderName: z.string().nullable(),
            /** Whole-project budget, not this person's share. */
            budgetThb: z.number().nullable(),
            workflowStatus: z.string(),
            teamSize: z.number(),
          })
          .strict(),
      ),
    })
    .optional(),
});
export type StaffProfileResponseData = z.infer<typeof StaffProfileResponseDataSchema>;
