import { z } from 'zod';
import {
  CuidSchema,
  ProgramLevelSchema,
  ProgramStatusSchema,
} from '../api/schemas';

// ─────────────────────────────────────────────────────────────────────────
// Program management schemas (prompt: program manager)
//
// Mirrors the Thai มคอ.2 curriculum document Section-1 header. These are
// the fields an admin edits on /admin/programs/[id] and the shape the
// CURRICULUM_SPEC extraction materializes onto a Program row.
// ─────────────────────────────────────────────────────────────────────────

export const ApprovalBodySchema = z.enum([
  'FACULTY_COMMITTEE', // คณะกรรมการประจำคณะ
  'UNIVERSITY_SCREENING', // คณะกรรมการกลั่นกรองหลักสูตร
  'ACADEMIC_COUNCIL', // สภาวิชาการ
  'UNIVERSITY_COUNCIL', // สภามหาวิทยาลัย
  'GRADUATE_SCHOOL', // บัณฑิตวิทยาลัย (postgrad)
  'OTHER',
]);
export type ApprovalBody = z.infer<typeof ApprovalBodySchema>;

export const ApprovalEntrySchema = z.object({
  body: ApprovalBodySchema,
  meetingNo: z.string().optional(), // e.g. "2/2565"
  meetingDate: z.string().optional(), // ISO date or Thai-formatted string
  decisionTh: z.string().optional(), // "เห็นชอบ" / "อนุมัติ"
  note: z.string().optional(),
});
export type ApprovalEntry = z.infer<typeof ApprovalEntrySchema>;

export const ApprovalHistorySchema = z.array(ApprovalEntrySchema);

export const ProgramLanguageSchema = z.enum(['TH', 'EN', 'MIXED']);
export const AdmissionScopeSchema = z.enum([
  'TH_ONLY',
  'TH_AND_INTL',
  'INTL_ONLY',
]);

// ─────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────

export const CreateProgramSchema = z.object({
  code: z.string().min(1).max(64),
  nameTh: z.string().min(1).max(300),
  nameEn: z.string().min(1).max(300),
  facultyId: CuidSchema,
  departmentId: CuidSchema.nullable().optional(),
  level: ProgramLevelSchema,
  yearEstablished: z.number().int().min(1900).max(3000).nullable().optional(),

  // "Create from PDF" additions — all optional so the plain-shell path
  // (POST with no PDF) stays identical.
  //
  // When `attachPdfId` is set, the created program gets the PDF attached
  // with role=CURRENT_CURRICULUM atomically.
  //
  // When `applyExtractionId` is ALSO set, the CURRICULUM_SPEC payload is
  // materialized onto the new Program (degree fields, credits, etc.) in
  // the same transaction.
  //
  // `force` defaults false. When true, the service skips the SOFT
  // collision guard (same-name-same-faculty-same-level). The HARD guard
  // (unique code) is never skippable — that's a DB constraint.
  attachPdfId: CuidSchema.optional(),
  applyExtractionId: CuidSchema.optional(),
  force: z.boolean().optional(),
});
export type CreateProgramInput = z.infer<typeof CreateProgramSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Collision check — dry-run that returns a structured report the UI can
// surface before the admin commits to a create.
// ─────────────────────────────────────────────────────────────────────────

export const CheckCollisionSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  nameTh: z.string().min(1).max(300).optional(),
  nameEn: z.string().min(1).max(300).optional(),
  facultyId: CuidSchema.optional(),
  departmentId: CuidSchema.nullable().optional(),
  level: ProgramLevelSchema.optional(),
});
export type CheckCollisionInput = z.infer<typeof CheckCollisionSchema>;

export interface CollisionMatch {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  facultyId: string;
  departmentId: string | null;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  status: 'ACTIVE' | 'PAUSED' | 'SUNSET';
  reasons: Array<
    | 'same_code'
    | 'same_name_th'
    | 'same_name_en'
    | 'same_degree_same_department'
  >;
}

export interface CollisionReport {
  hasHard: boolean; // code collision — blocks create without rename
  hasSoft: boolean; // name/degree overlap — create allowed with force=true
  matches: CollisionMatch[];
}

// ─────────────────────────────────────────────────────────────────────────
// Patch — every field optional; server applies partial update
// ─────────────────────────────────────────────────────────────────────────

export const PatchProgramSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  nameTh: z.string().min(1).max(300).optional(),
  nameEn: z.string().min(1).max(300).optional(),
  facultyId: CuidSchema.optional(),
  departmentId: CuidSchema.nullable().optional(),
  level: ProgramLevelSchema.optional(),
  status: ProgramStatusSchema.optional(),
  yearEstablished: z.number().int().min(1900).max(3000).nullable().optional(),

  // มคอ.2 header fields
  degreeNameTh: z.string().max(300).nullable().optional(),
  degreeNameEn: z.string().max(300).nullable().optional(),
  degreeAbbrTh: z.string().max(50).nullable().optional(),
  degreeAbbrEn: z.string().max(50).nullable().optional(),
  majors: z.array(z.string().min(1).max(200)).optional(),
  totalCredits: z.number().int().min(0).max(500).nullable().optional(),
  durationYears: z.number().int().min(1).max(10).nullable().optional(),
  programPlans: z.array(z.string().min(1).max(200)).optional(),
  language: ProgramLanguageSchema.nullable().optional(),
  admissionScope: AdmissionScopeSchema.nullable().optional(),
  careersTh: z.array(z.string().min(1)).optional(),
  openingYear: z.number().int().min(2400).max(2700).nullable().optional(), // BE
  openingSemester: z.number().int().min(1).max(3).nullable().optional(),
  curriculumYearBE: z.number().int().min(2400).max(2700).nullable().optional(),
  isRevision: z.boolean().optional(),
  previousCurriculumYearBE: z
    .number()
    .int()
    .min(2400)
    .max(2700)
    .nullable()
    .optional(),
  approvalHistory: ApprovalHistorySchema.optional(),
});
export type PatchProgramInput = z.infer<typeof PatchProgramSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Admin list query — separate from read-only ProgramListQuerySchema so the
// admin view can filter by additional axes (has document, has pending
// extraction) and sort differently.
// ─────────────────────────────────────────────────────────────────────────

export const AdminProgramListQuerySchema = z.object({
  facultyId: CuidSchema.optional(),
  departmentId: CuidSchema.optional(),
  level: ProgramLevelSchema.optional(),
  status: ProgramStatusSchema.optional(),
  hasCurrentDocument: z.coerce.boolean().optional(),
  hasPendingExtraction: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(), // search nameTh/nameEn/code
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
});
export type AdminProgramListQuery = z.infer<typeof AdminProgramListQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Document attachment
// ─────────────────────────────────────────────────────────────────────────

export const ProgramDocumentRoleSchema = z.enum([
  'CURRENT_CURRICULUM',
  'PREVIOUS_CURRICULUM',
  'COMMITTEE_ORDER',
  'EVALUATION_REPORT',
  'SUPPLEMENTARY',
]);
export type ProgramDocumentRole = z.infer<typeof ProgramDocumentRoleSchema>;

export const AttachProgramDocumentSchema = z.object({
  pdfDocumentId: CuidSchema,
  role: ProgramDocumentRoleSchema,
  curriculumYearBE: z
    .number()
    .int()
    .min(2400)
    .max(2700)
    .nullable()
    .optional(),
  notes: z.string().max(1000).nullable().optional(),
  promoteToCurrent: z.boolean().optional(), // if role=CURRENT_CURRICULUM, auto-demote prior
});
export type AttachProgramDocumentInput = z.infer<
  typeof AttachProgramDocumentSchema
>;

export const PatchProgramDocumentSchema = z.object({
  role: ProgramDocumentRoleSchema.optional(),
  curriculumYearBE: z
    .number()
    .int()
    .min(2400)
    .max(2700)
    .nullable()
    .optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export type PatchProgramDocumentInput = z.infer<
  typeof PatchProgramDocumentSchema
>;

// ─────────────────────────────────────────────────────────────────────────
// Apply-extraction request body — optional overrides before materializing
// an APPROVED CURRICULUM_SPEC extraction onto the Program row.
// ─────────────────────────────────────────────────────────────────────────

export const ApplyExtractionSchema = z.object({
  // If the admin edits fields in the review UI before clicking Apply, send
  // them here — these override the extraction's payload before write.
  overrides: PatchProgramSchema.optional(),
  // When true, also attach the PdfDocument with role=CURRENT_CURRICULUM and
  // auto-demote any prior current doc. Defaults true (common case).
  attachAsCurrent: z.boolean().default(true),
});
export type ApplyExtractionInput = z.infer<typeof ApplyExtractionSchema>;
