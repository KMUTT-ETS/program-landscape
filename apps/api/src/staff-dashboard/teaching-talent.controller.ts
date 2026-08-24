import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  clampFacultyNameFilter,
  resolveOwnFacultyMember,
} from '../common';
import { TeachingTalentService } from './teaching-talent.service';

// Express coerces query strings differently for single vs repeated params.
// Normalise to string[] at the schema layer (same helper shape as
// staff-evaluations.controller.ts).
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

// ────────────────────────────────────────────────────────────────────
// /staff/teaching-talent — sustained student-evaluation quality.
//
// Visibility tiers match /staff/teaching exactly:
//   PROGRAM_USER    → own row only, no unmatched panel
//   FACULTY_USER    → their faculty's instructors + unmatched teachers
//                     whose CLASS faculty is granted
//   UNIVERSITY_USER / EXECUTIVE / COUNCIL / ADMIN → everyone
//
// Unlike /staff/teaching this endpoint does NOT go through
// program_courses, so instructors whose courses are unmapped are
// included. That is the point of the dashboard — see the @kku/db module
// header for the measured 33% gap.
//
// `includeContact` is never set here: staff email is export-only and
// must not travel to the browser on this path.
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
      const result = await this.talent.roster(undefined, { includeUnmatched: false });
      return {
        ...result,
        rows: me ? result.rows.filter((r) => r.facultyMemberId === me.id) : [],
        scope: 'own' as const,
      };
    }

    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) {
      // No grants resolve — return an honest empty rather than everything.
      return {
        ...(await this.talent.roster({ facultyName: ['__none__'] }, { includeUnmatched: true })),
        scope: 'scoped' as const,
      };
    }
    const result = await this.talent.roster(
      { facultyName: clamped.facultyName },
      { includeUnmatched: true },
    );
    return { ...result, scope: 'full' as const };
  }
}
