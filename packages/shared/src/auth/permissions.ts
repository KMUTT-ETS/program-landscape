import type { Role } from './roles';

// ──────────────────────────────────────────────────────────────────────────
// Permission catalog
//
// Format: "<resource>:<action>:<scope-suffix>"
//
// Scope suffix semantics:
//   :all                 — across every faculty/program
//   :own_faculty         — only within the user's own faculty (+ its
//                          programs)
//   :own_program         — only within the user's specific assigned
//                          program (PROGRAM_USER scope; departmentId
//                          axis dropped 2026-05-09)
//   :aggregated_only     — can see rolled-up numbers but not per-faculty-
//                          member or per-individual drill-in (e.g. salary
//                          line items)
//
// Keep this list sorted by resource for readability. Every new permission
// must be added both to PERMISSIONS and to at least one role below.
// ──────────────────────────────────────────────────────────────────────────

export const PERMISSIONS = [
  // Organization
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'programs:read:own_faculty',
  'programs:read:own_program',

  // Program management (admin-facing CRUD + curriculum-PDF attachment).
  // Separate from :read because mutation risk is much higher — every Program
  // row is a strategic line item in the Council's view.
  'programs:manage:all',
  'programs:manage:own_faculty',

  // Financial data — separate from programs:read because FinancialMetric is
  // the most sensitive resource in the system.
  'financials:read:all',
  'financials:read:own_faculty',
  'financials:read:own_program',
  'financials:read:aggregated_only',

  // Individual faculty-member detail (salary line items, retirement dates).
  // COUNCIL cannot see individual salaries but CAN see aggregated cost.
  'faculty_members:read:all',
  'faculty_members:read:own_faculty',
  'faculty_members:read:own_program',

  // Outcomes — GraduateOutcome, EmployerFeedback
  'outcomes:read:all',
  'outcomes:read:own_faculty',
  'outcomes:read:own_program',

  // Scenarios
  'scenarios:read:all',
  'scenarios:create:any',
  'scenarios:create:own_faculty',
  'scenarios:edit:any',

  // Council decisions
  'decisions:read:all',
  'decisions:approve',
  'decisions:edit',

  // PDF intake
  'pdf:upload',
  'pdf:approve_extraction',

  // PDF generation (Gotenberg-backed). Modules that need to export PDFs
  // (Council Pack, briefs, scenario packs, decision records) require this.
  // pdf:admin is the admin dashboard + template listing.
  'pdf:generate',
  'pdf:admin',

  // Ingestion
  'ingestion:configure',
  'ingestion:trigger',

  // Admin
  'users:manage',
  'kku_sso_mapping:manage',
  'data_sources:read',
  'data_sources:configure',
  // BullMQ queue inspection + management (ai-jobs / ingestion / pdf-intake
  // / trend-monitors). Read = look at counts and job payloads; manage =
  // retry / remove / clean / pause / resume.
  'queues:read',
  'queues:manage',

  // Risk Management module — read = view assessments + indicators;
  // assess = trigger AI per-program assessment (idempotent within rate
  // limits); measures:edit = accept/reject/in_progress/completed status
  // transitions on a recommended measure.
  'risks:read:all',
  'risks:assess:any',
  'risks:measures:edit',

  // AI model dispatch — gates the admin AI-settings page where the
  // per-method model picker lives. Super-admin only because model
  // choice has direct cost + reliability + Council-defensibility
  // impact; same posture as `queues:manage`.
  'ai_models:configure',

  // University-wide dashboards (Education, Staff, System status). These
  // surfaces read every faculty's data by design — they're for Council
  // and university-management roles, not for FACULTY_USER / PROGRAM_USER
  // who must stay scoped to their own faculty/program. See
  // docs/hardening/04-authz-matrix.report.md V8 + V10.
  'institution:read:university',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ──────────────────────────────────────────────────────────────────────────
// Role → permissions (KKU SSO v2 — legacy roles removed 2026-05-09)
// ──────────────────────────────────────────────────────────────────────────

// SUPER_ADMIN — full access surface (everything including queue mgmt).
const SUPER_ADMIN_PERMS: Permission[] = [...PERMISSIONS];

// SYSTEM_ADMIN — admin-grade; can manage users + sources + ingestion +
// PDF + extractions. The "can-only-promote-up-to-SYSTEM_ADMIN" guard
// lives in the admin-users service layer (role assignment validation),
// not here. Queue management is super-only.
const SYSTEM_ADMIN_PERMS: Permission[] = [
  ...PERMISSIONS.filter((p) => p !== 'queues:manage' && p !== 'ai_models:configure'),
];

// UNIVERSITY_USER — read-all at university scope. Inherits the legacy
// COUNCIL signal value (risks:measures:edit) so council-level users
// migrated from COUNCIL keep their measures-approval surface.
const UNIVERSITY_USER_PERMS: Permission[] = [
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'financials:read:all',
  'faculty_members:read:all',
  'outcomes:read:all',
  'scenarios:read:all',
  'decisions:read:all',
  'pdf:generate',
  'risks:read:all',
  'risks:measures:edit',
  'institution:read:university',
];

// FACULTY_USER — read-only scoped to user's own faculty.
const FACULTY_USER_PERMS: Permission[] = [
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'programs:read:own_faculty',
  'financials:read:own_faculty',
  'financials:read:aggregated_only',
  'faculty_members:read:own_faculty',
  'outcomes:read:own_faculty',
  'outcomes:read:all',
  'scenarios:read:all',
  'decisions:read:all',
  'pdf:generate',
  'risks:read:all',
];

// PROGRAM_USER — read-only at the user's specific program. Coarse
// university-aggregate visibility for context, but everything detailed
// is scoped to own_program (which is the program's department).
const PROGRAM_USER_PERMS: Permission[] = [
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'programs:read:own_program',
  'financials:read:own_program',
  'financials:read:aggregated_only',
  'faculty_members:read:own_program',
  'outcomes:read:own_program',
  'outcomes:read:all',
  'scenarios:read:all',
  'decisions:read:all',
  'pdf:generate',
  'risks:read:all',
];

// Copy the arrays into readonly sets so callers can't mutate them.
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(SUPER_ADMIN_PERMS),
  SYSTEM_ADMIN: new Set(SYSTEM_ADMIN_PERMS),
  UNIVERSITY_USER: new Set(UNIVERSITY_USER_PERMS),
  FACULTY_USER: new Set(FACULTY_USER_PERMS),
  PROGRAM_USER: new Set(PROGRAM_USER_PERMS),
};
