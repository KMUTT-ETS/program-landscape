import { z } from 'zod';
import { RoleSchema } from '../auth/roles';
import { ThemePreferenceSchema } from '../auth/session';
import { ScopeLevelSchema } from '../auth/scope-level';

// ──────────────────────────────────────────────────────────────────────────
// Primitives
// ──────────────────────────────────────────────────────────────────────────

export const CuidSchema = z.string().min(1);
export const IsoDateSchema = z.string().datetime();

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Cap at 1000: KKU's portfolio is ~300 programs, but analytical views
  // legitimately request the full set in one round-trip (Cockpit, Deep-
  // Dive listing, Benchmarking). 200 was too tight and silently 400-ed
  // the /programs page (which fetches all 297 with pageSize=500).
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// ──────────────────────────────────────────────────────────────────────────
// Scope query params — accepted by every analytical endpoint
// ──────────────────────────────────────────────────────────────────────────

export const ScopeQueryParamsSchema = z
  .object({
    scope: ScopeLevelSchema.default('university'),
    scopeId: z.string().optional(),
  })
  .refine(
    (q) => q.scope === 'university' || q.scopeId !== undefined,
    { message: 'scopeId is required when scope is not "university"' },
  );
export type ScopeQueryParams = z.infer<typeof ScopeQueryParamsSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Entity DTO schemas (what the API returns — narrower than Prisma row)
// ──────────────────────────────────────────────────────────────────────────

export const FacultySchema = z.object({
  id: CuidSchema,
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type FacultyDto = z.infer<typeof FacultySchema>;

export const DepartmentSchema = z.object({
  id: CuidSchema,
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string(),
  facultyId: CuidSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type DepartmentDto = z.infer<typeof DepartmentSchema>;

export const ProgramLevelSchema = z.enum(['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']);
export const ProgramStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'SUNSET']);

export const ProgramSchema = z.object({
  id: CuidSchema,
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string(),
  facultyId: CuidSchema,
  departmentId: CuidSchema.nullable(),
  level: ProgramLevelSchema,
  status: ProgramStatusSchema,
  yearEstablished: z.number().int().nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type ProgramDto = z.infer<typeof ProgramSchema>;

export const ProgramListQuerySchema = ScopeQueryParamsSchema.and(
  z.object({
    status: ProgramStatusSchema.optional(),
    level: ProgramLevelSchema.optional(),
  }),
).and(PaginationQuerySchema);
export type ProgramListQuery = z.infer<typeof ProgramListQuerySchema>;

// ──────────────────────────────────────────────────────────────────────────
// /me + theme
// ──────────────────────────────────────────────────────────────────────────

export const ScopeAccessSchema = z.object({
  universityRead: z.boolean(),
  allFacultiesRead: z.boolean(),
  ownFacultyId: CuidSchema.nullable(),
  ownDepartmentId: CuidSchema.nullable(),
});
export type ScopeAccess = z.infer<typeof ScopeAccessSchema>;

export const MeResponseSchema = z.object({
  id: CuidSchema,
  email: z.string().email(),
  name: z.string().nullable(),
  role: RoleSchema,
  themePreference: ThemePreferenceSchema,
  permissions: z.array(z.string()),
  scopeAccess: ScopeAccessSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateThemeBodySchema = z.object({
  themePreference: ThemePreferenceSchema,
});
export type UpdateThemeBody = z.infer<typeof UpdateThemeBodySchema>;

// ──────────────────────────────────────────────────────────────────────────
// Data sources (admin)
// ──────────────────────────────────────────────────────────────────────────

export const DataSourceKindSchema = z.enum(['API', 'PDF', 'CSV', 'SCRAPE']);

export const DataSourceSchema = z.object({
  id: CuidSchema,
  name: z.string(),
  kind: DataSourceKindSchema,
  baseUrl: z.string().url().nullable(),
  acceptsPdfUploads: z.boolean(),
  lastSyncedAt: IsoDateSchema.nullable(),
  status: z.string(),
  notes: z.string().nullable(),
});
export type DataSourceDto = z.infer<typeof DataSourceSchema>;
