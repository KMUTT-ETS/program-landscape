import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  clampFacultyNameFilter,
} from '../common';
import { StudentDqService } from './student-dq.service';

// Express coerces query strings differently for single vs repeated
// params; normalise both shapes at the schema layer (same helper shape
// as staff-evaluations.controller.ts).
const StringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v.filter((x) => x.length > 0);
    return v.length > 0 ? [v] : [];
  });
const NumberArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): number[] => {
    const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return arr.map(Number).filter(Number.isFinite);
  });

const DqQuerySchema = z.object({ facultyName: StringArray, cohortYearBE: NumberArray });
type DqQuery = z.infer<typeof DqQuerySchema>;

const RadarQuerySchema = DqQuerySchema.extend({
  programId: z.string().optional(),
  kind: z.enum(['THEORY', 'WORKSHOP']).default('THEORY'),
});
type RadarQuery = z.infer<typeof RadarQuerySchema>;

// /education/student-dq — KKU Digital Intelligence competency results.
// Scope clamping matches the sibling /education/student-info route
// exactly: a FACULTY_USER sees their faculty, and a user whose grants
// resolve to nothing (clamp === null) gets the '__none__' sentinel — a
// faculty name no cube row carries — so they receive an empty result
// rather than the whole university. Reversing that test would serve the
// institution to precisely the users entitled to none of it.
@Controller('/education/student-dq')
export class StudentDqController {
  constructor(private readonly dq: StudentDqService) {}

  @Get('overview')
  @Authorized('institution:read:dashboard')
  async overview(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(DqQuerySchema)) q: DqQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) return this.dq.overview({ ...q, facultyName: ['__none__'] });
    return this.dq.overview(clamped);
  }

  @Get('filter-options')
  @Authorized('institution:read:dashboard')
  async filterOptions(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(DqQuerySchema)) q: DqQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    // Faculty selection cascades into the cohort list; the cohort
    // selection deliberately does NOT travel, or choosing a cohort would
    // shrink the list it was chosen from and there would be no way back.
    const facultyName = clamped === null ? ['__none__'] : clamped.facultyName;
    return this.dq.filterOptions({ facultyName });
  }

  @Get('drill')
  @Authorized('institution:read:dashboard')
  async drill(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(DqQuerySchema)) q: DqQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) return this.dq.drill({ ...q, facultyName: ['__none__'] });
    return this.dq.drill(clamped);
  }

  @Get('radar')
  @Authorized('institution:read:dashboard')
  async radar(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(RadarQuerySchema)) q: RadarQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    // dqRadar's scope takes a single faculty. An unclamped caller sends
    // one explicitly (or none, for the university profile); a clamped
    // caller is pinned to the first faculty they hold — and to
    // '__none__', which matches no cube row, when they hold none.
    const facultyName = clamped === null ? ['__none__'] : clamped.facultyName;
    // The comparison ring is computed over the WHOLE university (see
    // StudentDqService.radar for the reasoning) and travels with a
    // `comparisonLabel` that says so — it is not the caller's clamp
    // wearing the word "University".
    return this.dq.radar({
      facultyName: facultyName[0],
      programId: q.programId,
      cohortYearBE: q.cohortYearBE,
      kind: q.kind,
    });
  }
}
