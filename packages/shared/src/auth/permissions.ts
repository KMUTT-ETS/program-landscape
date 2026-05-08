import type { Role } from './roles';

// ──────────────────────────────────────────────────────────────────────────
// Permission catalog
//
// Format: "<resource>:<action>:<scope-suffix>"
//
// Scope suffix semantics:
//   :all                 — across every faculty/department/program
//   :own_faculty         — only within the user's own faculty (+ its
//                          departments/programs)
//   :own_department      — only within the user's own department
//                          (+ its programs)
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
  'programs:read:own_department',

  // Program management (admin-facing CRUD + curriculum-PDF attachment).
  // Separate from :read because mutation risk is much higher — every Program
  // row is a strategic line item in the Council's view.
  'programs:manage:all',
  'programs:manage:own_faculty',

  // Financial data — separate from programs:read because FinancialMetric is
  // the most sensitive resource in the system.
  'financials:read:all',
  'financials:read:own_faculty',
  'financials:read:own_department',
  'financials:read:aggregated_only',

  // Individual faculty-member detail (salary line items, retirement dates).
  // COUNCIL cannot see individual salaries but CAN see aggregated cost.
  'faculty_members:read:all',
  'faculty_members:read:own_faculty',
  'faculty_members:read:own_department',

  // Outcomes — GraduateOutcome, EmployerFeedback
  'outcomes:read:all',
  'outcomes:read:own_faculty',
  'outcomes:read:own_department',

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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ──────────────────────────────────────────────────────────────────────────
// Role → permissions
// ──────────────────────────────────────────────────────────────────────────

const VIEWER_PERMS: Permission[] = [
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'financials:read:aggregated_only',
  'outcomes:read:all',
];

const COUNCIL_PERMS: Permission[] = [
  ...VIEWER_PERMS,
  'financials:read:all',
  'scenarios:read:all',
  'decisions:read:all',
  'pdf:generate',
  'risks:read:all',
  'risks:measures:edit',
];

const EXECUTIVE_PERMS: Permission[] = [
  ...COUNCIL_PERMS,
  'scenarios:create:any',
  'scenarios:edit:any',
  'decisions:edit',
];

const DEAN_PERMS: Permission[] = [
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'programs:read:own_faculty',
  'programs:manage:own_faculty',
  'financials:read:own_faculty',
  'financials:read:aggregated_only', // other faculties
  'faculty_members:read:own_faculty',
  'outcomes:read:own_faculty',
  'outcomes:read:all',
  'scenarios:read:all',
  'scenarios:create:own_faculty',
  'decisions:read:all',
  'pdf:upload',
  'pdf:generate',
  'risks:read:all',
  'risks:measures:edit',
];

const DEPT_HEAD_PERMS: Permission[] = [
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'programs:read:own_department',
  'programs:manage:own_faculty',
  'financials:read:own_department',
  'financials:read:aggregated_only',
  'faculty_members:read:own_department',
  'outcomes:read:own_department',
  'outcomes:read:all',
  'scenarios:read:all',
  'pdf:upload',
  'pdf:generate',
  'risks:read:all',
];

const ANALYST_PERMS: Permission[] = [
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'programs:manage:all',
  'financials:read:all',
  'faculty_members:read:all',
  'outcomes:read:all',
  'scenarios:read:all',
  'scenarios:create:any',
  'scenarios:edit:any',
  'decisions:read:all',
  'pdf:upload',
  'pdf:approve_extraction',
  'pdf:generate',
  'ingestion:configure',
  'ingestion:trigger',
  'data_sources:read',
  // Analyst can see what's in the queues (job payloads, counts, failures)
  // but mutation actions stay with ADMIN.
  'queues:read',
  'risks:read:all',
  'risks:assess:any',
  'risks:measures:edit',
];

const ADMIN_PERMS: Permission[] = [
  ...PERMISSIONS, // everything
];

// ── KKU SSO v2 taxonomy (added 2026-05-07) ─────────────────────────────
// SUPER_ADMIN — same surface as ADMIN: everything.
const SUPER_ADMIN_PERMS: Permission[] = [...PERMISSIONS];

// SYSTEM_ADMIN — admin-grade; can manage users + sources + ingestion +
// PDF + queues. The "can-only-promote-up-to-SYSTEM_ADMIN" guard lives in
// the admin-users service layer (role assignment validation), not here.
const SYSTEM_ADMIN_PERMS: Permission[] = [
  ...PERMISSIONS.filter((p) => p !== 'queues:manage'), // queue mgmt → super only
];

// UNIVERSITY_USER — read-all at university scope. Mirrors COUNCIL's
// posture: see everything, mutate nothing.
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
// is scoped to own_department (which is the program's department).
const PROGRAM_USER_PERMS: Permission[] = [
  'faculties:read:all',
  'departments:read:all',
  'programs:read:all',
  'programs:read:own_department',
  'financials:read:own_department',
  'financials:read:aggregated_only',
  'faculty_members:read:own_department',
  'outcomes:read:own_department',
  'outcomes:read:all',
  'scenarios:read:all',
  'decisions:read:all',
  'pdf:generate',
  'risks:read:all',
];

// Copy the arrays into readonly sets so callers can't mutate them.
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  // Legacy
  VIEWER: new Set(VIEWER_PERMS),
  COUNCIL: new Set(COUNCIL_PERMS),
  EXECUTIVE: new Set(EXECUTIVE_PERMS),
  DEAN: new Set(DEAN_PERMS),
  DEPT_HEAD: new Set(DEPT_HEAD_PERMS),
  ANALYST: new Set(ANALYST_PERMS),
  ADMIN: new Set(ADMIN_PERMS),
  // KKU SSO v2
  SUPER_ADMIN: new Set(SUPER_ADMIN_PERMS),
  SYSTEM_ADMIN: new Set(SYSTEM_ADMIN_PERMS),
  UNIVERSITY_USER: new Set(UNIVERSITY_USER_PERMS),
  FACULTY_USER: new Set(FACULTY_USER_PERMS),
  PROGRAM_USER: new Set(PROGRAM_USER_PERMS),
};
