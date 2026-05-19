import { Controller, ForbiddenException, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  assertInstructorAccessible,
  assertProgramAccessible,
  clampFacultyNameFilter,
  resolveOwnFacultyMember,
} from '../common';
import { StaffEvaluationsService } from './staff-evaluations.service';

// Express coerces query strings differently for single vs repeated params.
// Normalise both shapes to string[] / number[] at the schema layer.
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
    return arr.map((s) => Number(s)).filter((n) => Number.isFinite(n));
  });

const EvalQuerySchema = z.object({
  facultyName: StringArray,
  acadYearBE: NumberArray,
  semester: NumberArray,
});
type EvalQuery = z.infer<typeof EvalQuerySchema>;

// ────────────────────────────────────────────────────────────────────
// /staff/teaching — instructor-individual student-evaluation dashboard
//
// Visibility tiers (NOT the same as other staff dashboards):
//   - PROGRAM_USER  → own only (no roster, no per-instructor drill)
//   - FACULTY_USER  → all individuals in their faculty (full roster + drill)
//   - UNIVERSITY_USER / EXECUTIVE / COUNCIL / ADMIN → all individuals
//
// Course-aggregated views live on /education/satisfaction (no instructor
// names). Per-instructor data ONLY lives here.
//
// Per-instructor endpoint uses assertInstructorAccessible() which enforces
// the tiered visibility based on the FacultyMember.facultyId and the
// caller's User.employeeId / email mapping.
// ────────────────────────────────────────────────────────────────────

@Controller('/staff/teaching')
export class StaffEvaluationsController {
  constructor(private readonly evaluations: StaffEvaluationsService) {}

  @Get('overall')
  @Authorized('institution:read:dashboard')
  async overall(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(EvalQuerySchema)) q: EvalQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    if (user.role === 'PROGRAM_USER') {
      // PROGRAM_USER can ONLY see their own. Resolve their FacultyMember
      // and project the personal summary as the "overall" KPI.
      const me = await resolveOwnFacultyMember(user);
      if (!me) return { ratingAvg: null, totalRespondents: 0, cellCount: 0, courseCount: 0, instructorCount: 0, questionCount: 0, bucketCount: 0, ratingMin: null, ratingMax: null, freshness: null, methodologyVersion: this.evaluations.methodologyVersion, scope: 'own', noData: true };
      const result = await this.evaluations.personal({ facultyMemberId: me.id, filter: q });
      return {
        methodologyVersion: result.methodologyVersion,
        ratingAvg: result.summary.ratingAvg || null,
        totalRespondents: result.summary.totalRespondents,
        cellCount: result.summary.cellCount,
        courseCount: result.summary.courseCount,
        instructorCount: 1,
        questionCount: result.summary.questionCount,
        bucketCount: result.summary.semestersObserved,
        ratingMin: null,
        ratingMax: null,
        freshness: null,
        scope: 'own' as const,
      };
    }
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.evaluations.overall({ ...q, facultyName: ['__none__'] });
    return this.evaluations.overall(clamped);
  }

  @Get('roster')
  @Authorized('institution:read:dashboard')
  async roster(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(EvalQuerySchema)) q: EvalQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    // PROGRAM_USER does not get a roster — they get a single-row response
    // for themselves only.
    if (user.role === 'PROGRAM_USER') {
      const me = await resolveOwnFacultyMember(user);
      if (!me) return { methodologyVersion: this.evaluations.methodologyVersion, rows: [] };
      const roster = await this.evaluations.roster({ ...q, facultyName: undefined });
      return {
        methodologyVersion: roster.methodologyVersion,
        rows: roster.rows.filter((r) => r.facultyMemberId === me.id),
      };
    }
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.evaluations.roster({ ...q, facultyName: ['__none__'] });
    return this.evaluations.roster(clamped);
  }

  @Get('me')
  @Authorized('institution:read:dashboard')
  async me(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(EvalQuerySchema)) q: EvalQuery,
  ) {
    // /profile → "My teaching evaluations". No faculty / role gate beyond
    // login — every authenticated user can see THEIR own data. Returns a
    // polite empty state when the user can't be matched to a FacultyMember.
    const me = await resolveOwnFacultyMember(user);
    if (!me) {
      return {
        methodologyVersion: this.evaluations.methodologyVersion,
        notMatched: true,
        summary: { ratingAvg: 0, totalRespondents: 0, cellCount: 0, courseCount: 0, questionCount: 0, semestersObserved: 0 },
        trend: [],
        byQuestion: [],
        byCourse: [],
      };
    }
    const result = await this.evaluations.personal({ facultyMemberId: me.id, filter: q });
    return { ...result, notMatched: false };
  }

  @Get('instructor/:facultyMemberId')
  @Authorized('institution:read:dashboard')
  async instructor(
    @AuthSession() user: SessionUser,
    @Param('facultyMemberId') facultyMemberId: string,
    @Query('programId') programId: string | undefined,
    @Query(new ZodValidationPipe(EvalQuerySchema)) q: EvalQuery,
  ) {
    // Tiered visibility: PROGRAM_USER → own only; FACULTY_USER → roster
    // of their faculty; UNIVERSITY_USER → everyone. assertInstructorAccessible
    // throws 403/404 as appropriate.
    //
    // When `programId` is supplied, the drill is narrowed to courses
    // the instructor taught in that program — used by the
    // /staff/teaching pivot so clicking a teacher row only shows their
    // courses in the program-of-context. Per-program access is checked
    // too so a crafted URL with a cross-faculty programId 403s.
    await assertInstructorAccessible(facultyMemberId, user);
    if (programId) await assertProgramAccessible(programId, user);
    return this.evaluations.personal({ facultyMemberId, programId, filter: q });
  }

  // 4-level pivot: Faculty → Program Level → Program → Instructor.
  // Each instructor's cells get attributed to the program(s) that teach
  // the courses they taught (mirrors /education/satisfaction's
  // courseByProgram shape). PROGRAM_USER → own row filtered in TS.
  @Get('by-program')
  @Authorized('institution:read:dashboard')
  async byProgram(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(EvalQuerySchema)) q: EvalQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    if (user.role === 'PROGRAM_USER') {
      const me = await resolveOwnFacultyMember(user);
      if (!me) return { methodologyVersion: this.evaluations.methodologyVersion, rows: [], yearsObserved: [] };
      const result = await this.evaluations.byProgram({ ...q, facultyName: undefined });
      return {
        methodologyVersion: result.methodologyVersion,
        rows: result.rows.filter((r) => r.facultyMemberId === me.id),
        yearsObserved: result.yearsObserved,
      };
    }
    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null)
      return this.evaluations.byProgram({ ...q, facultyName: ['__none__'] });
    return this.evaluations.byProgram(clamped);
  }

  // GET /staff/teaching/question-detail?...scope&...filter
  //
  // Per-question detail at any scope for the hover tooltip on the
  // /staff/teaching pivot. Scope params: facultyId, programLevel,
  // programId, facultyMemberId, acadYearBE. When facultyMemberId is set,
  // visibility runs through assertInstructorAccessible (PROGRAM_USER → own
  // only; FACULTY_USER → roster; UNIVERSITY_USER → all). Otherwise the
  // page-level dashboards gate applies + facultyName is clamped to the
  // user's grants.
  @Get('question-detail')
  @Authorized('institution:read:dashboard')
  async questionDetail(
    @AuthSession() user: SessionUser,
    @Query('facultyId') facultyId: string | undefined,
    @Query('programLevel') programLevel: string | undefined,
    @Query('programId') programId: string | undefined,
    @Query('courseCode') courseCode: string | undefined,
    @Query('facultyMemberId') facultyMemberId: string | undefined,
    @Query('acadYearBE') acadYearBEStr: string | undefined,
    @Query(new ZodValidationPipe(EvalQuerySchema)) q: EvalQuery,
  ) {
    if (facultyMemberId) {
      // Per-instructor scope — strict access check. Also verify the
      // program is accessible when a programId is supplied — both must
      // be in scope for the (instructor × program) intersection to
      // make sense.
      await assertInstructorAccessible(facultyMemberId, user);
      if (programId) await assertProgramAccessible(programId, user);
      const acadYearBE = acadYearBEStr ? Number(acadYearBEStr) : undefined;
      return this.evaluations.questionDetail({
        facultyId,
        programLevel,
        programId,
        courseCode,
        facultyMemberId,
        acadYearBE: Number.isFinite(acadYearBE) ? acadYearBE : undefined,
        filter: q,
      });
    }
    // Aggregate scope — coarse visibility gate. When a programId is
    // supplied without facultyMemberId, verify program access too — a
    // FACULTY_USER asking for a program in another faculty should 403
    // (cleaner UX than getting back zero rows from the SQL clamp).
    await assertCanSeeFacultyDashboards(user);
    if (programId) await assertProgramAccessible(programId, user);
    const clamped = await clampFacultyNameFilter(q, user);
    const filter = clamped === null ? { ...q, facultyName: ['__none__'] } : clamped;
    const acadYearBE = acadYearBEStr ? Number(acadYearBEStr) : undefined;
    return this.evaluations.questionDetail({
      facultyId,
      programLevel,
      programId,
      courseCode,
      acadYearBE: Number.isFinite(acadYearBE) ? acadYearBE : undefined,
      filter,
    });
  }

  // GET /staff/teaching/instructor-courses?programId=X&facultyMemberId=Y
  //
  // The 5th-level drill — courses taught by ONE instructor within ONE
  // program. Both scope checks apply: assertProgramAccessible (the
  // program's faculty must be granted) AND assertInstructorAccessible
  // (PROGRAM_USER → own only). General-ed courses the instructor taught
  // for other programs are excluded by the SQL join.
  @Get('instructor-courses')
  @Authorized('institution:read:dashboard')
  async instructorCourses(
    @AuthSession() user: SessionUser,
    @Query('programId') programId: string,
    @Query('facultyMemberId') facultyMemberId: string,
    @Query(new ZodValidationPipe(EvalQuerySchema)) q: EvalQuery,
  ) {
    if (!programId || !facultyMemberId) {
      throw new NotFoundException();
    }
    await assertCanSeeFacultyDashboards(user);
    await assertProgramAccessible(programId, user);
    await assertInstructorAccessible(facultyMemberId, user);
    return this.evaluations.instructorCourses({
      programId,
      facultyMemberId,
      filter: q,
    });
  }

  @Get('questions')
  @Authorized('institution:read:dashboard')
  async questions(@AuthSession() user: SessionUser) {
    await assertCanSeeFacultyDashboards(user);
    return this.evaluations.questionCatalog();
  }

  @Get('me/exists')
  @Authorized('institution:read:dashboard')
  async meExists(@AuthSession() user: SessionUser) {
    // Lightweight probe for /profile's "My teaching evaluations" CTA —
    // returns whether the user has any matched FacultyMember at all,
    // so the UI hides the link for non-faculty admin users.
    const me = await resolveOwnFacultyMember(user);
    return { hasFacultyMember: me !== null, facultyMemberId: me?.id ?? null };
  }
}
