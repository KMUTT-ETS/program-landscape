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

interface ResolvedFacultyScope {
  facultyName: string[];
  /** True only when the clamp was a genuine pass-through. */
  unclamped: boolean;
}

@Controller('/staff/teaching-talent')
export class TeachingTalentController {
  constructor(private readonly talent: TeachingTalentService) {}

  /**
   * Clamp to the caller's grants, then honour their own faculty pick
   * WITHIN that clamp.
   *
   * `clampFacultyNameFilter` REPLACES the requested list with every
   * faculty the caller is granted. For a dean with a single grant that is
   * invisible, but for anyone holding two or more it silently disables the
   * page's faculty multi-select: they pick one faculty, the URL changes,
   * and the table does not. Intersecting the request with the clamp
   * restores the control.
   *
   * Safe by construction: every element of the intersection is taken from
   * the CLAMPED set, so this can only ever narrow it, never widen it — no
   * posted value can reach a faculty the caller was not already granted.
   *
   * An empty intersection means they asked for a faculty they cannot see.
   * That falls back to the full clamped set rather than blanking the page:
   * showing what they CAN see is the honest answer to an out-of-scope
   * request, and the `scope: 'scoped'` label already says it is clamped.
   *
   * Used by BOTH routes so the page and the exported file always describe
   * the same population.
   */
  private async resolveFacultyScope(
    requested: string[],
    user: SessionUser,
  ): Promise<ResolvedFacultyScope | null> {
    const filter = { facultyName: requested };
    const clamped = await clampFacultyNameFilter(filter, user);
    if (clamped === null) return null;
    // Pass-through = unclamped. clampFacultyNameFilter's 'all' branch is
    // `return filter`; every clamped branch builds a new object. The role
    // check alone would mislabel a FACULTY_USER holding a UNIVERSITY_USER
    // UserScope grant as clamped.
    if (clamped === filter) return { facultyName: requested, unclamped: true };
    if (requested.length === 0) {
      return { facultyName: clamped.facultyName, unclamped: false };
    }
    const granted = new Set(clamped.facultyName);
    const intersection = requested.filter((name) => granted.has(name));
    return {
      facultyName: intersection.length > 0 ? intersection : clamped.facultyName,
      unclamped: false,
    };
  }

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
    const scope = await this.resolveFacultyScope(q.facultyName, user);
    if (scope === null) {
      // No grants resolve — return an honest empty rather than everything.
      return {
        ...(await this.talent.roster({ facultyName: ['__none__'] }, { includeUnmatched: true })),
        scope: 'none' as const,
      };
    }
    const result = await this.talent.roster(
      { facultyName: scope.facultyName },
      { includeUnmatched: true },
    );
    const unclamped = seesAllScopes(user.role) || scope.unclamped;
    return { ...result, scope: unclamped ? ('all' as const) : ('scoped' as const) };
  }

  // POST, not GET: AuditLogInterceptor persists the redacted request BODY,
  // so the audit row records the faculty filter and threshold the caller
  // REQUESTED. Same posture as POST /programs/:id/export-detail-pdf.
  //
  // Precisely what that row does and does not prove: it does not record
  // the EFFECTIVE scope. A FACULTY_USER posts `facultyName: []`, gets
  // clamped to their grants, and the row still reads `[]` — indistinguishable
  // from an unrestricted export by a university-wide account. The effective
  // scope is the caller's grants at the time of the request; reconstructing
  // it means reading their UserScope rows alongside this row. Logging it
  // directly would mean re-plumbing the shared interceptor to see handler
  // output, which is out of scope here.
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
    // Same resolution as the GET route, so the file describes exactly the
    // population the page showed.
    const scope = await this.resolveFacultyScope(body.facultyName, user);
    const facultyName = scope === null ? ['__none__'] : scope.facultyName;
    return this.talent.export({ facultyName, threshold: body.threshold });
  }
}
