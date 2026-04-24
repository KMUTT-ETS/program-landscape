import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────
// Per-extractor payload schemas. The review UI uses these to:
//   - validate extraction.payloadJson before save
//   - drive a typed form for the editable right-pane
//
// Prompt 04 fills the extractor implementations to produce these shapes.
// Today's stub extractors return the empty/default variant of each schema.
// ──────────────────────────────────────────────────────────────────────────

// POLICY_DOC — MHESI / NESDC / NXPO / BOI / EECO documents
export const PolicyDocPayloadSchema = z.object({
  titleTh: z.string(),
  titleEn: z.string().optional(),
  summaryTh: z.string(),
  summaryEn: z.string().optional(),
  publicationDate: z.string().optional(),          // ISO date
  issuingOrg: z.string(),
  policySource: z
    .enum(['MHESI', 'NESDC', 'NXPO', 'BOI', 'EECO', 'OTHER'])
    .default('OTHER'),
  keyDirectives: z.array(z.string()).default([]),
  mentionedSectors: z.array(z.string()).default([]),
  mentionedSkills: z.array(z.string()).default([]),
  estimatedImpact: z.enum(['low', 'medium', 'high', 'unknown']).default('unknown'),
});
export type PolicyDocPayload = z.infer<typeof PolicyDocPayloadSchema>;

// CURRICULUM_SPEC — มคอ.2 / มคอ.3
//
// The extractor populates everything it can from the Thai Section-1
// header; the apply-extraction endpoint materializes them onto the
// Program row. Every field is optional so partial-extractions
// still validate (the admin can fill gaps in the review UI).
export const ApprovalBodyExtSchema = z.enum([
  'FACULTY_COMMITTEE',
  'UNIVERSITY_SCREENING',
  'ACADEMIC_COUNCIL',
  'UNIVERSITY_COUNCIL',
  'GRADUATE_SCHOOL',
  'OTHER',
]);

export const ExtractedApprovalEntrySchema = z.object({
  body: ApprovalBodyExtSchema,
  meetingNo: z.string().optional(),
  meetingDate: z.string().optional(),
  decisionTh: z.string().optional(),
});

export const CurriculumPayloadSchema = z.object({
  programCode: z.string().optional(),
  programNameTh: z.string(),
  programNameEn: z.string().optional(),
  facultyNameTh: z.string().optional(),
  departmentNameTh: z.string().optional(),
  level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL']).optional(),
  totalCredits: z.number().int().positive().optional(),
  durationYears: z.number().positive().optional(),
  // CE year of the curriculum revision — extractor emits BE as-is when it
  // reads a Thai year (pattern "พ.ศ. 25xx"); the apply-extraction step
  // converts to BE correctly either way.
  curriculumYear: z.number().int().optional(),

  // Extended Section-1 fields (Thai มคอ.2)
  degreeNameTh: z.string().optional(),
  degreeNameEn: z.string().optional(),
  degreeAbbrTh: z.string().optional(),
  degreeAbbrEn: z.string().optional(),
  majors: z.array(z.string().min(1)).default([]),
  programPlans: z.array(z.string().min(1)).default([]),
  language: z.enum(['TH', 'EN', 'MIXED']).optional(),
  admissionScope: z.enum(['TH_ONLY', 'TH_AND_INTL', 'INTL_ONLY']).optional(),
  isRevision: z.boolean().optional(),
  previousCurriculumYearBE: z.number().int().optional(),
  openingYear: z.number().int().optional(),
  openingSemester: z.number().int().optional(),
  approvalHistory: z.array(ExtractedApprovalEntrySchema).default([]),
  careersTh: z.array(z.string().min(1)).default([]),

  courses: z
    .array(
      z.object({
        code: z.string(),
        nameTh: z.string(),
        nameEn: z.string().optional(),
        credits: z.number().int().nonnegative(),
        courseType: z.enum(['CORE', 'ELECTIVE', 'GENERAL']).default('CORE'),
        descriptionTh: z.string().optional(),
      }),
    )
    .default([]),
});
export type CurriculumPayload = z.infer<typeof CurriculumPayloadSchema>;

// PEER_PROGRAM — peer university brochure/page
export const PeerProgramPayloadSchema = z.object({
  university: z.string(),
  country: z.string().default('TH'),
  programNameTh: z.string().optional(),
  programNameEn: z.string(),
  level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL']).optional(),
  durationYears: z.number().positive().optional(),
  totalCredits: z.number().int().positive().optional(),
  descriptionEn: z.string().optional(),
  distinctiveFeatures: z.array(z.string()).default([]),
  catalogueUrl: z.string().url().optional(),
});
export type PeerProgramPayload = z.infer<typeof PeerProgramPayloadSchema>;

// LABOR_STAT — NSO statistical tables, sector reports, etc.
export const LaborStatPayloadSchema = z.object({
  region: z.string().optional(),
  year: z.number().int().optional(),
  indicator: z.string(),
  value: z.number().optional(),
  unit: z.string().optional(),
  tableRows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).default([]),
});
export type LaborStatPayload = z.infer<typeof LaborStatPayloadSchema>;

// SURVEY_RESULT — alumni / employer surveys
export const SurveyResultPayloadSchema = z.object({
  surveyName: z.string(),
  respondentType: z.enum(['alumni', 'employer', 'student', 'other']).default('other'),
  cohortLabel: z.string().optional(),       // e.g. "2023 graduates"
  sampleSize: z.number().int().nonnegative().optional(),
  aggregates: z.array(
    z.object({
      metric: z.string(),
      value: z.union([z.number(), z.string()]),
      note: z.string().optional(),
    }),
  ).default([]),
  openEndedThemes: z.array(z.string()).default([]),
});
export type SurveyResultPayload = z.infer<typeof SurveyResultPayloadSchema>;

// COMMITTEE_MINUTES — KKU Council / faculty / department minutes
export const CommitteeMinutesPayloadSchema = z.object({
  committeeName: z.string(),
  meetingDate: z.string().optional(),
  attendees: z.array(z.string()).default([]),
  decisions: z.array(
    z.object({
      title: z.string(),
      rationaleTh: z.string().optional(),
      decisionType: z
        .enum(['CLOSE', 'MERGE', 'LAUNCH', 'RESTRUCTURE', 'KEEP_AS_IS', 'OTHER'])
        .default('OTHER'),
    }),
  ).default([]),
  actionItems: z.array(
    z.object({
      title: z.string(),
      owner: z.string().optional(),
      dueDate: z.string().optional(),
    }),
  ).default([]),
});
export type CommitteeMinutesPayload = z.infer<typeof CommitteeMinutesPayloadSchema>;

// JOB_POSTING_BATCH — a single PDF containing multiple job postings
export const JobPostingsBatchPayloadSchema = z.object({
  batchSourceOrg: z.string().optional(),
  postings: z.array(
    z.object({
      title: z.string(),
      companyName: z.string().optional(),
      location: z.string().optional(),
      salaryMinThb: z.number().optional(),
      salaryMaxThb: z.number().optional(),
      descriptionTh: z.string().optional(),
      descriptionEn: z.string().optional(),
      skillsRaw: z.array(z.string()).default([]),
    }),
  ).default([]),
});
export type JobPostingsBatchPayload = z.infer<typeof JobPostingsBatchPayloadSchema>;

// Map from extractionType → its payload schema. The review UI uses this
// to validate edits before save.
export const PAYLOAD_SCHEMAS = {
  POLICY_DOC: PolicyDocPayloadSchema,
  CURRICULUM_SPEC: CurriculumPayloadSchema,
  PEER_PROGRAM: PeerProgramPayloadSchema,
  LABOR_STAT: LaborStatPayloadSchema,
  SURVEY_RESULT: SurveyResultPayloadSchema,
  COMMITTEE_MINUTES: CommitteeMinutesPayloadSchema,
  JOB_POSTING_BATCH: JobPostingsBatchPayloadSchema,
} as const;
