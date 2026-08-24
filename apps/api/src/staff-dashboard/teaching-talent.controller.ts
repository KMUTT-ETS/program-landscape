import { Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  clampFacultyNameFilter,
  resolveOwnFacultyMember,
  seesAllScopes,
} from '../common';
import { ALLOWED_TALENT_THRESHOLDS, TeachingTalentService } from './teaching-talent.service';

// Express coerces query strings differently for single vs repeated params.
// Normalise to string[] at the schema layer.
//
// Deliberately duplicated from staff-evaluations.controller.ts rather than
// extracted into ../common: extraction would mean editing that working file,
// and CI here lints CHANGED files only — touching an old file detonates its
// pre-existing lint backlog. Extract when that file is being edited anyway.
const StringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v.filter((x) => x.length > 0);
    return v.length > 0 ? [v] : [];
  });

const TalentQuerySchema = z.object({ facultyName: StringArray });
type TalentQuery = z.infer<typeof TalentQuerySchema>;

const TalentExportSchema = z.object({
  facultyName: z.array(z.string()).default([]),
  // Constrained to the published options — a crafted `threshold: 0` would
  // otherwise export the entire roster as "talent".
  threshold: z.number().refine((n) => ALLOWED_TALENT_THRESHOLDS.includes(n), {
    message: 'threshold must be one of 4, 4.25, 4.5, 4.75',
  }),
});
type TalentExportBody = z.infer<typeof TalentExportSchema>;

// ────────────────────────────────────────────────────────────────────
// /staff/teaching-talent — sustained student-evaluation quality.
//
// Visibility tiers (UserRole enum — see schema.prisma):
//   PROGRAM_USER                    → own row only, no unmatched panel
//   FACULTY_USER                    → instructors in their granted
//                                     faculties + unmatched teachers whose
//                                     CLASS faculty is granted
//   UNIVERSITY_USER / SYSTEM_ADMIN /
//   SUPER_ADMIN                     → everyone + the unmatched panel
//
// Unlike /staff/teaching this endpoint does NOT go through
// program_courses, so instructors whose courses are unmapped are
// included. That is the point of the dashboard — see the @kku/db module
// header for the measured 33% gap. /staff/teaching also has no unmatched
// panel, so the two surfaces are not interchangeable.
//
// Staff email, precisely:
//   - MATCHED instructors: withheld. `includeContact` stays false on this
//     route; only the export path sets it.
//   - UNMATCHED teachers: returned, deliberately. They have no HR record,
//     so the registrar's email is the ONLY identifier the reconciliation
//     panel can key on — the panel exists to get them onto the roster.
//     Anyone above PROGRAM_USER therefore does receive those addresses.
// ────────────────────────────────────────────────────────────────────

@Controller('/staff/teaching-talent')
export class TeachingTalentController {
  constructor(private readonly talent: TeachingTalentService) {}

  @Get()
  @Authorized('institution:read:dashboard')
  async roster(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TalentQuerySchema)) q: TalentQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);

    if (user.role === 'PROGRAM_USER') {
      // Own row only. No unmatched panel — a program user cannot action a
      // roster gap, and the panel names people outside their scope.
      const me = await resolveOwnFacultyMember(user);
      if (!me) {
        // Short-circuit BEFORE the query. Their isolation must not depend on
        // a downstream .filter() surviving a future refactor — and there is
        // nothing to run a university-wide roster query for.
        return {
          methodologyVersion: this.talent.methodologyVersion,
          years: [],
          windowComplete: false,
          rows: [],
          unmatched: { teachers: [], unattributableRowCount: 0 },
          scope: 'own' as const,
        };
      }
      const result = await this.talent.roster(undefined, { includeUnmatched: false });
      return {
        ...result,
        rows: result.rows.filter((r) => r.facultyMemberId === me.id),
        scope: 'own' as const,
      };
    }

    // `scope` labels what the reader is actually looking at — a dean's
    // clamped roster must never be labelled university-wide on a
    // Council-facing surface. 'all' only when the clamp was a genuine
    // pass-through.
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) {
      // No grants resolve — return an honest empty rather than everything.
      return {
        ...(await this.talent.roster({ facultyName: ['__none__'] }, { includeUnmatched: true })),
        scope: 'none' as const,
      };
    }
    const result = await this.talent.roster(
      { facultyName: clamped.facultyName },
      { includeUnmatched: true },
    );
    // Pass-through = unclamped. Either the role sees everything, or
    // clampFacultyNameFilter handed back the very object it was given
    // (its 'all' branch is `return filter`; every clamped branch builds a
    // new object). The role check alone would mislabel a FACULTY_USER who
    // holds a UNIVERSITY_USER UserScope grant as clamped.
    const unclamped = seesAllScopes(user.role) || clamped === q;
    return { ...result, scope: unclamped ? ('all' as const) : ('scoped' as const) };
  }

  // POST, not GET: the AuditLogInterceptor records request.body, so the
  // audit row captures exactly which filter and threshold produced the
  // file. Same posture as POST /programs/:id/export-detail-pdf.
  @Post('export')
  @Authorized('institution:read:dashboard')
  @AuditLog({ action: 'export.teaching_talent', entityType: 'StaffExport' })
  async exportXlsx(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(TalentExportSchema)) body: TalentExportBody,
  ) {
    await assertCanSeeFacultyDashboards(user);
    if (user.role === 'PROGRAM_USER') {
      // A single-row talent export has no use, and the button is hidden.
      throw new ForbiddenException('Talent export requires faculty scope');
    }
    const clamped = await clampFacultyNameFilter({ facultyName: body.facultyName }, user);
    const facultyName = clamped === null ? ['__none__'] : clamped.facultyName;
    return this.talent.export({ facultyName, threshold: body.threshold });
  }
}
