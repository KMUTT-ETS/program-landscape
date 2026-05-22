import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import {
  DashEducationStudentInfoInputSchema,
  DashEducationByLocationInputSchema,
  DashEducationActivePivotInputSchema,
  DashEducationInternationalInputSchema,
  DashEducationTuitionInputSchema,
  DashEducationPerformanceInputSchema,
  DashEducationRecruitmentInputSchema,
  DashEducationClassOfferingsInputSchema,
  DashStaffWorkforceInputSchema,
  DashStaffCompensationInputSchema,
  DashStaffTeachingWorkloadInputSchema,
  DashStaffResearchInputSchema,
  DashStaffFacultyByProgramInputSchema,
  DashFilterOptionsInputSchema,
  DashDataFreshnessInputSchema,
  DashComputeInputSchema,
  CiteSourceInputSchema,
  type ToolCall,
} from '@kku/shared';
import { EducationService } from '../education/education.service';
import { RecruitmentService } from '../education/recruitment.service';
import { ClassOfferingsService } from '../education/class-offerings.service';
import { StaffService } from '../staff-dashboard/staff.service';
import { TeachingWorkloadService } from '../staff-dashboard/teaching-workload.service';
import { resolveOfferingScope } from '../common/scope-guards';

// ═════════════════════════════════════════════════════════════════════
// Dashboard-scoped analyst tool executor.
//
// Each handler calls into the same service the dashboard UI uses, so the
// numbers the bot quotes always match what's on screen. NO independent
// SQL — that would create a second source of truth that quietly drifts.
//
// The strategic AnalystToolExecutor still handles cross-cutting tools
// like cite_source + the operational connector lookups. This executor
// is a parallel registry; AnalystService picks one or the other based
// on the conversation's `kind`.
//
// Single-value LLM inputs are normalised into the multi-value array
// shapes the underlying services expect.
// ═════════════════════════════════════════════════════════════════════

const SCOPED_SURFACES = new Set(['class_offerings', 'teaching_workload']);

@Injectable()
export class DashboardToolExecutor {
  private readonly logger = new Logger(DashboardToolExecutor.name);

  constructor(
    private readonly education: EducationService,
    private readonly recruitment: RecruitmentService,
    private readonly classOfferings: ClassOfferingsService,
    private readonly staff: StaffService,
    private readonly teaching: TeachingWorkloadService,
  ) {}

  async execute(call: ToolCall, caller: SessionUser): Promise<string> {
    const handler = this.handlers[call.name];
    if (!handler) {
      return JSON.stringify({ error: `Unknown tool: ${call.name}` });
    }
    const t0 = Date.now();
    try {
      const result = await handler(call.input, caller);
      this.logger.debug(`dash tool ${call.name} ok in ${Date.now() - t0}ms`);
      return JSON.stringify(clip(result));
    } catch (err) {
      this.logger.warn(`dash tool ${call.name} failed: ${(err as Error).message}`);
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  private handlers: Record<
    string,
    (input: unknown, caller: SessionUser) => Promise<unknown>
  > = {
    // ── Education ─────────────────────────────────────────────────
    dash_education_student_info: async (input) => {
      const q = DashEducationStudentInfoInputSchema.parse(input);
      const res = await this.education.studentInfo({
        facultyName: arr(q.facultyName),
        programLevel: arr(q.programLevel),
        programName: arr(q.programName),
      });
      // Pick the headline fields. Drop the heavy `filters` payload — the
      // LLM doesn't need 297 program rows to answer "how many active
      // students in Engineering". Discoverability lives on dash_filter_options.
      return {
        totalActive: res.totalActive,
        byProgramLevel: res.byProgramLevel,
        byEntryType: res.byEntryType,
        byGender: res.byGender,
        byNationality: res.byNationality.slice(0, 10),
        thaiVsNonThai: res.thaiVsNonThai,
        averageAge: res.averageAge,
        ageSampleCount: res.ageSampleCount,
        byStatusGroup: res.byStatusGroup,
      };
    },

    dash_education_by_location: async (input) => {
      const q = DashEducationByLocationInputSchema.parse(input);
      const res = await this.education.byLocation({
        facultyName: arr(q.facultyName),
        programLevel: arr(q.programLevel),
        programName: arr(q.programName),
        region: q.region ? [q.region] : undefined,
        cohortYearBe: q.cohortYearBe ? [q.cohortYearBe] : undefined,
        schoolFilter: q.schoolFilter,
      });

      // schoolFilter — case-insensitive substring lookup that bypasses
      // the top-50 cap. Required for "students from <specific school>"
      // when the school isn't in the by-count top-50. Forces view to
      // 'schools' regardless of the view arg so the response shape is
      // predictable for the bot. The filter is applied at the SQL
      // layer (see EducationService.byLocation) so bucket()'s
      // built-in 30-school cap doesn't truncate matches.
      if (q.schoolFilter) {
        return {
          view: 'schools',
          region: q.region ?? null,
          schoolFilter: q.schoolFilter,
          totalActive: res.totalActive,
          schools: res.bySchool.slice(0, 25),
          matchedCount: res.bySchool.length,
          note:
            res.bySchool.length === 0
              ? 'No school in the active-student dataset matches that substring. The dataset only carries schools that have sent at least one student to KKU in the cohort window; if the school exists but appears empty, the bot should phrase: "we have no record of students from <name>".'
              : undefined,
        };
      }

      if (q.view === 'provinces') {
        return {
          view: 'provinces',
          region: q.region ?? null,
          totalActive: res.totalActive,
          provinces: res.byProvince.slice(0, 40),
          provinceCount: res.byProvince.length,
        };
      }
      if (q.view === 'schools') {
        return {
          view: 'schools',
          region: q.region ?? null,
          totalActive: res.totalActive,
          schools: res.bySchool.slice(0, 50),
          schoolCount: res.bySchool.length,
        };
      }
      return {
        view: 'overview',
        totalActive: res.totalActive,
        byRegion: res.byRegion,
        unknownRegionCount: res.unknownRegionCount,
        topProvinces: res.byProvince.slice(0, 15),
        topSchools: res.bySchool.slice(0, 15),
        cohortYears: res.cohortYears,
      };
    },

    dash_education_active_pivot: async (input) => {
      const q = DashEducationActivePivotInputSchema.parse(input);
      const res = await this.education.activePivot({ facultyName: q.facultyName });
      // active_pivot is INHERENTLY multi-cohort by design — it shows
      // how many active students each cohort year produced. `total`
      // sums across ALL cohort years; `byYear` is the per-cohort
      // breakdown. Echo so the bot phrases correctly.
      const appliedFilter = {
        entryYears: res.entryYears,
        cohortYearsSpanned: res.entryYears.length,
        note:
          res.entryYears.length > 1
            ? `Result spans ${res.entryYears.length} cohort years (${res.entryYears.slice(0, 3).join(', ')}${res.entryYears.length > 3 ? '…' : ''}). The 'total' field is the SUM across ALL cohort years (currently-active students from every cohort). Per-year counts are in 'byYear'.`
            : `Single-cohort-year result for BE ${res.entryYears[0]}.`,
      };

      if (q.view === 'university') {
        // Faculty-level rollup — full 297-program tree won't fit; the
        // bot should call again with facultyName + view='faculty' to
        // drill in.
        return {
          view: 'university',
          appliedFilter,
          entryYears: res.entryYears,
          faculties: res.rows.map((r) => ({
            facultyName: r.facultyName,
            total: r.total,
            byYear: r.cells,
          })),
          totals: res.totals,
        };
      }

      // view = 'faculty' — return Program Level → Program drill rows
      // for the requested faculty. activePivot() already scoped to that
      // faculty via the service-level facultyName arg.
      if (!q.facultyName) {
        return {
          error: 'view=faculty requires facultyName. Call dash_filter_options(surface=education) to discover faculty names, then pass one here.',
        };
      }
      const row = res.rows.find((r) => r.facultyName === q.facultyName);
      if (!row) {
        return {
          view: 'faculty',
          facultyName: q.facultyName,
          appliedFilter,
          entryYears: res.entryYears,
          levels: [],
          note: 'No active-student data for this faculty.',
        };
      }
      return {
        view: 'faculty',
        facultyName: q.facultyName,
        appliedFilter,
        entryYears: res.entryYears,
        total: row.total,
        byYear: row.cells,
        levels: row.children.map((lvl) => ({
          programLevel: lvl.programLevel,
          total: lvl.total,
          byYear: lvl.cells,
          programs: lvl.children.map((p) => ({
            programName: p.programName,
            total: p.total,
            byYear: p.cells,
          })),
        })),
      };
    },

    dash_education_international: async (input) => {
      const q = DashEducationInternationalInputSchema.parse(input);
      const res = await this.education.international({ facultyName: q.facultyName });

      if (q.view === 'overview') {
        return {
          view: 'overview',
          totalNonThai: res.totalNonThai,
          byCountry: res.byCountry.slice(0, 25),
          byFaculty: res.rows.map((r) => ({
            facultyName: r.facultyName,
            total: r.total,
          })),
        };
      }

      // view = 'faculty_drill' — Program × Country breakdown for one faculty.
      if (!q.facultyName) {
        return {
          error: 'view=faculty_drill requires facultyName.',
        };
      }
      const row = res.rows.find((r) => r.facultyName === q.facultyName);
      if (!row) {
        return {
          view: 'faculty_drill',
          facultyName: q.facultyName,
          totalNonThai: 0,
          programs: [],
          note: 'No international students for this faculty.',
        };
      }
      return {
        view: 'faculty_drill',
        facultyName: q.facultyName,
        totalNonThai: row.total,
        countries: Object.keys(row.cells),
        // Each program row carries a country → count cell map.
        programs: row.children.map((p) => ({
          programName: p.programName,
          total: p.total,
          byCountry: p.cells,
        })),
      };
    },

    dash_education_tuition: async (input) => {
      const q = DashEducationTuitionInputSchema.parse(input);
      const res = await this.education.tuition({
        facultyName: arr(q.facultyName),
        semester: q.semester !== undefined ? [String(q.semester)] : undefined,
      });
      // Tuition spans all academic years in the cube unless the bot
      // narrowed by semester. Echo what the result actually covers so
      // the bot phrases "across all years" or "in 2569" correctly.
      const appliedFilter = {
        semester: q.semester ?? null,
        academicYears: res.academicYears,
        spansMultipleYears: res.academicYears.length > 1,
        note:
          res.academicYears.length > 1
            ? `Result covers ${res.academicYears.length} academic years (${res.academicYears.join(', ')}). For a single-year number, ask about a specific year; the byAcademicYear array carries per-year totals.`
            : `Single-year result for BE ${res.academicYears[0]}.`,
      };

      if (q.view === 'overview') {
        return {
          view: 'overview',
          appliedFilter,
          totalRevenueThb: res.totalRevenueThb,
          byAcademicYear: res.byAcademicYear,
          byFaculty: res.byFaculty,
          academicYears: res.academicYears,
          semesters: res.semesters,
        };
      }

      if (q.view === 'by_year') {
        return {
          view: 'by_year',
          appliedFilter,
          totalRevenueThb: res.totalRevenueThb,
          byAcademicYear: res.byAcademicYear,
        };
      }

      // view = 'faculty_drill' — Program Level → Program × year grid.
      if (!q.facultyName) {
        return {
          error: 'view=faculty_drill requires facultyName.',
        };
      }
      const row = res.rows.find((r) => r.facultyName === q.facultyName);
      if (!row) {
        return {
          view: 'faculty_drill',
          facultyName: q.facultyName,
          appliedFilter,
          totalRevenueThb: 0,
          academicYears: res.academicYears,
          levels: [],
          note: 'No tuition revenue rows for this faculty.',
        };
      }
      return {
        view: 'faculty_drill',
        facultyName: q.facultyName,
        appliedFilter,
        academicYears: res.academicYears,
        totalRevenueThb: row.total,
        byYear: row.cells,
        levels: row.children.map((lvl) => ({
          programLevel: lvl.programLevel,
          totalRevenueThb: lvl.total,
          byYear: lvl.cells,
          programs: lvl.children.map((p) => ({
            programName: p.programName,
            totalRevenueThb: p.total,
            byYear: p.cells,
          })),
        })),
      };
    },

    dash_education_performance: async (input) => {
      const q = DashEducationPerformanceInputSchema.parse(input);
      const filters = {
        facultyName: arr(q.facultyName),
        programLevel: arr(q.programLevel),
        programName: arr(q.programName),
        region: q.region ? [q.region] : undefined,
      };

      // Wrap every return with a GPA sanity check. Any reported GPA > 4.0
      // would be a data error or unit mix-up; we surface a
      // dataQualityWarning the bot is forbidden from ignoring.
      const withGpaGuard = <T extends object>(payload: T): T & { dataQualityWarnings?: string[] } => {
        const warnings: string[] = [];
        applyPerformanceSanityChecks(
          payload as unknown as Record<string, unknown>,
          warnings,
        );
        return {
          ...payload,
          ...(warnings.length > 0 ? { dataQualityWarnings: warnings } : {}),
        };
      };

      // ── view = overall ────────────────────────────────────────────
      if (q.view === 'overall') {
        const res = await this.education.performanceOverall(filters);
        return withGpaGuard({
          view: 'overall',
          totalStudents: res.totalStudents,
          averageEntryGpa: res.averageEntryGpa,
          averageGpa: res.averageGpa,
          averageEnglishGpa: res.averageEnglishGpa,
          facultyCount: res.facultyCount,
          programCount: res.programCount,
          schoolCount: res.schoolCount,
        });
      }

      // ── view = by_program ─────────────────────────────────────────
      if (q.view === 'by_program') {
        const res = await this.education.performanceByProgram(filters);
        // Flatten Faculty → Program into a single rankable list.
        const flat: Array<{
          facultyName: string;
          programName: string;
          studentCount: number;
          averageGpa: number | null;
          averageEntryGpa: number | null;
        }> = [];
        for (const r of res.rows) {
          for (const c of r.children) {
            flat.push({
              facultyName: r.facultyName,
              programName: c.programName,
              studentCount: c.studentCount,
              averageGpa: c.averageGpa,
              averageEntryGpa: c.averageEntryGpa,
            });
          }
        }
        return withGpaGuard({
          view: 'by_program',
          sortBy: q.sortBy,
          minStudentCount: q.minStudentCount,
          totals: res.totals,
          topPrograms: rankPerformanceRows(flat, q.sortBy, q.minStudentCount).slice(0, 25),
          // Faculty-level rollup is useful when the bot wants both
          // dimensions in one tool call.
          byFaculty: res.rows.map((r) => ({
            facultyName: r.facultyName,
            studentCount: r.studentCount,
            averageGpa: r.averageGpa,
            averageEntryGpa: r.averageEntryGpa,
          })),
        });
      }

      // ── view = by_location ────────────────────────────────────────
      if (q.view === 'by_location') {
        const res = await this.education.performanceByLocation(filters);
        // Flatten Region → Province → School → Faculty → Program tree to
        // school-level rows. The LLM gets a sortable list; it can call
        // again with a tighter filter (e.g. region + facultyName) to
        // re-rank under a different cut.
        const flatSchools: Array<{
          region: string;
          provinceName: string;
          schoolName: string;
          studentCount: number;
          averageGpa: number | null;
          averageEntryGpa: number | null;
          facultyCount: number;
          programCount: number;
        }> = [];
        for (const region of res.rows) {
          for (const province of region.children) {
            for (const school of province.children) {
              flatSchools.push({
                region: region.label,
                provinceName: province.provinceName,
                schoolName: school.schoolName,
                studentCount: school.studentCount,
                averageGpa: school.averageGpa,
                averageEntryGpa: school.averageEntryGpa,
                facultyCount: school.children.length,
                programCount: school.children.reduce(
                  (sum, f) => sum + f.children.length,
                  0,
                ),
              });
            }
          }
        }
        // schoolFilter — case-insensitive substring match on schoolName.
        // When set, return ALL matching schools (no top-20 cap) and
        // IGNORE minStudentCount (the user named the school; show what
        // we have, even if it's a 2-student cohort). Empty match means
        // the school has no GPA rows — bot phrases "no GPA records".
        if (q.schoolFilter) {
          const needle = q.schoolFilter.toLowerCase();
          const matches = flatSchools.filter((r) =>
            r.schoolName.toLowerCase().includes(needle),
          );
          return withGpaGuard({
            view: 'by_location',
            schoolFilter: q.schoolFilter,
            sortBy: q.sortBy,
            minStudentCountIgnored: true,
            totals: res.totals,
            matchedSchools: rankPerformanceRows(matches, q.sortBy, 1).slice(0, 25),
            matchedCount: matches.length,
            note:
              matches.length === 0
                ? 'No school in the GPA dataset matches that substring. The performance dataset only carries schools whose alumni have GPA records in our cube; if the school exists in the by-location origin set but appears empty here, phrase: "we have origin data but no GPA records yet for <name>".'
                : undefined,
          });
        }
        const ranked = rankPerformanceRows(flatSchools, q.sortBy, q.minStudentCount);
        // Region-level summary helps the bot phrase "average GPA in the
        // South is X" alongside the per-school top-20.
        const byRegion = res.rows.map((r) => ({
          region: r.label,
          studentCount: r.studentCount,
          averageGpa: r.averageGpa,
          averageEntryGpa: r.averageEntryGpa,
          schoolCount: r.children.reduce(
            (sum, p) => sum + p.children.length,
            0,
          ),
        }));
        return withGpaGuard({
          view: 'by_location',
          sortBy: q.sortBy,
          minStudentCount: q.minStudentCount,
          totals: res.totals,
          byRegion,
          topSchools: ranked.slice(0, 20),
          rankedCount: ranked.length,
        });
      }

      // ── view = entry_scores ───────────────────────────────────────
      const res = await this.education.entryScores(filters);
      // Surface the subjects list + faculty-level rollup. The full
      // (Faculty × Program × Subject) cube is too large; the bot can
      // re-call with a programName filter to drill into one row.
      return {
        view: 'entry_scores',
        subjects: res.subjects,
        totals: res.totals,
        byFaculty: res.rows.map((r) => ({
          facultyName: r.facultyName,
          studentCount: r.studentCount,
          cells: r.cells,
        })),
      };
    },

    dash_education_recruitment: async (input) => {
      const q = DashEducationRecruitmentInputSchema.parse(input);
      const res = await this.recruitment.getDashboard({
        entryYearBE: q.entryYearBe ?? null,
        facultyId: q.facultyId ?? null,
        level: q.level ?? null,
      });

      if (q.view === 'kpis') {
        return {
          view: 'kpis',
          entryYearBE: res.meta.selectedYear,
          latestCompleteYear: res.meta.latestCompleteYear,
          selectedYearIsComplete: res.meta.selectedYearIsComplete,
          kpis: res.kpis,
          byFaculty: res.byFaculty.slice(0, 25),
          byRound: res.byRound,
          byYear: res.byYear,
          topPrograms: res.programs.slice(0, 10),
        };
      }
      if (q.view === 'by_round') {
        return {
          view: 'by_round',
          entryYearBE: res.meta.selectedYear,
          byRound: res.byRound,
        };
      }
      if (q.view === 'by_year') {
        return { view: 'by_year', byYear: res.byYear };
      }

      // view = 'programs' — sortable per-program drill. The dashboard's
      // own `programs` array is already shaped per-program; we just
      // re-sort by sortBy and clip to top 50.
      type ProgramRow = (typeof res.programs)[number];
      const sortKey = (r: ProgramRow): number => {
        // The dashboard's program rows already carry pre-computed
        // competitionRatio + fillRate where available. Fall back to
        // -Infinity so null-keyed rows sink to the bottom of the sort.
        const v = (r as unknown as Record<string, unknown>)[q.sortBy];
        return typeof v === 'number' ? v : -Infinity;
      };
      const ranked = res.programs
        .slice()
        .sort((a, b) => sortKey(b) - sortKey(a))
        .slice(0, 50);
      return {
        view: 'programs',
        entryYearBE: res.meta.selectedYear,
        sortBy: q.sortBy,
        programs: ranked,
        programCount: res.programs.length,
      };
    },

    dash_education_class_offerings: async (input, caller) => {
      const q = DashEducationClassOfferingsInputSchema.parse(input);
      const scope = await resolveOfferingScope(caller);
      if (scope.mode === 'none') {
        return { error: 'forbidden: caller has no class-offerings scope' };
      }
      const filter = {
        scope,
        acadYearBE: q.acadYearBE,
        semester: q.semester,
        levelName: undefined,
      };
      // Echo what term(s) the result covers. Without acadYearBE+semester,
      // summary/distribution/deep_dive aggregate sections across every
      // term — fine for counts ("total sections KKU ever opened") but
      // misleading for "this term".
      const appliedFilter = {
        acadYearBE: q.acadYearBE ?? null,
        semester: q.semester ?? null,
        spansAllTerms: q.acadYearBE === undefined || q.semester === undefined,
        note:
          q.acadYearBE === undefined && q.semester === undefined
            ? 'WARNING: result spans EVERY academic term in the cube. Section counts are cumulative across years. For "this term" answers, pass acadYearBE + semester.'
            : q.acadYearBE === undefined
              ? 'Spans all years for the requested semester.'
              : q.semester === undefined
                ? 'Spans both semesters of the requested year.'
                : `Single-term result for ${q.acadYearBE}/${q.semester}.`,
      };
      const withFilter = <T extends object>(payload: T): T & { appliedFilter: typeof appliedFilter } => ({
        ...payload,
        appliedFilter,
      });
      if (q.view === 'summary')
        return withFilter(await this.classOfferings.summary(filter));
      if (q.view === 'distribution')
        return withFilter(await this.classOfferings.distribution(filter));
      if (q.view === 'heatmap') {
        // heatmap method ignores acadYearBE + semester (it spans all of
        // them). Reuse the same scope-bound filter.
        return withFilter(await this.classOfferings.heatmap(filter));
      }
      if (q.view === 'deep_dive') {
        const res = await this.classOfferings.deepDiveDrillDown(filter);
        // Clip the tree so the LLM context survives. Keep the top-30
        // faculties by section count; the bot can re-call with a tighter
        // filter (faculty-scoped or single-year) for deeper digs.
        const r = res as unknown as {
          rows: Array<{
            facultyName: string;
            sections?: number;
            children: unknown[];
            [k: string]: unknown;
          }>;
          totals?: unknown;
        };
        const rows = Array.isArray(r.rows) ? r.rows : [];
        return withFilter({
          view: 'deep_dive',
          totals: r.totals,
          faculties: rows.slice(0, 30),
          facultyCount: rows.length,
        });
      }
      // GE doesn't accept year/semester filters in v1.
      return withFilter(await this.classOfferings.geBreakdown(scope));
    },

    // ── Staff ─────────────────────────────────────────────────────
    dash_staff_workforce: async (input) => {
      const q = DashStaffWorkforceInputSchema.parse(input);
      const res = await this.staff.workforce({
        facultyName: arr(q.facultyName),
        track: q.track ? [q.track] : undefined,
      });
      // Workforce response is rich (overview + demographics). Pick the
      // most-useful headline rollups so the LLM context stays sane.
      const r = res as Record<string, unknown>;
      return {
        totalHeadcount: r.totalHeadcount ?? r.total ?? null,
        byTrack: r.byTrack ?? null,
        byAcademicStanding: r.byAcademicStanding ?? null,
        agePyramidAcademic: r.agePyramidAcademic ?? null,
        agePyramidSupport: r.agePyramidSupport ?? null,
        retirementCliff5Y: r.retirementCliff5Y ?? r.retirementCliff ?? null,
        retirementProjection: r.retirementProjection ?? null,
        flow12m: r.flow12m ?? null,
        facultyMosaic: r.facultyMosaic ?? r.byFaculty ?? null,
        tenureDistribution: r.tenureDistribution ?? null,
      };
    },

    dash_staff_compensation: async (input) => {
      const q = DashStaffCompensationInputSchema.parse(input);
      const res = await this.staff.compensation({
        facultyName: arr(q.facultyName),
        track: q.track ? [q.track] : undefined,
      });
      // Compensation includes <5-person masking; the service already
      // collapses small buckets. Pass through as-is, capped for LLM
      // context.
      return res;
    },

    dash_staff_teaching_workload: async (input, caller) => {
      const q = DashStaffTeachingWorkloadInputSchema.parse(input);
      const scope = await resolveOfferingScope(caller);
      if (scope.mode === 'none') {
        return { error: 'forbidden: caller has no teaching-workload scope' };
      }
      // CRITICAL: without (acadYearBE, semester), all 4 SQL aggregators
      // sum contact_hrs across EVERY term in the database — but each
      // section's contact_hrs is expressed per-WEEK. Summing them across
      // multiple terms produces meaningless "per week" numbers (a faculty
      // with 3 teachers × 6 terms × ~30 sections gives a fake "1,249
      // hrs/week/teacher"). Match the dashboard UI: default to the
      // latest snapshot when none is supplied. Bot still gets a clearly-
      // labelled `appliedFilter` echo so it reports the right term.
      let acadYearBE = q.acadYearBE;
      let semester = q.semester;
      let defaultedFromLatest = false;
      if (acadYearBE === undefined || semester === undefined) {
        const latest = await this.teaching.resolveLatestSnapshot(scope);
        if (latest) {
          acadYearBE = acadYearBE ?? latest.acadYearBE;
          semester = semester ?? latest.semester;
          defaultedFromLatest = true;
        }
      }
      const filter = {
        scope,
        acadYearBE,
        semester,
        levelName: undefined,
      };
      const appliedFilter = {
        acadYearBE: filter.acadYearBE ?? null,
        semester: filter.semester ?? null,
        defaultedFromLatest,
        note: defaultedFromLatest
          ? 'No (acadYearBE, semester) supplied — defaulted to the latest active term. Contact hours are PER WEEK within this single term.'
          : filter.acadYearBE === undefined
            ? 'WARNING: filter spans multiple terms. Contact hours summed across terms; do NOT report as "per week".'
            : 'Contact hours are PER WEEK within the requested term.',
      };
      const withGuards = <T extends object>(
        payload: T,
      ): T & { appliedFilter: typeof appliedFilter; dataQualityWarnings?: string[] } => {
        const warnings: string[] = [];
        applyTeachingWorkloadSanityChecks(
          payload as unknown as Record<string, unknown>,
          warnings,
        );
        return {
          ...payload,
          appliedFilter,
          ...(warnings.length > 0 ? { dataQualityWarnings: warnings } : {}),
        };
      };

      if (q.view === 'summary') {
        return withGuards(await this.teaching.summary(filter));
      }
      if (q.view === 'histogram')
        return withGuards(await this.teaching.histogram(filter));
      if (q.view === 'by_faculty')
        return withGuards(await this.teaching.byFaculty(filter));
      if (q.view === 'students_by_faculty')
        return withGuards(await this.teaching.studentsByFaculty(filter));

      // view = 'teachers' — Faculty → Program Level → Program → Teacher
      // drill. The full payload at university scope is huge. Clip per
      // faculty group: top 15 programs (flattened across levels) + top 30
      // distinct teachers by contact hours, at most 10 faculty groups. A
      // teacher in several of the faculty's programs is deduped before the
      // top-30 cut so the list isn't padded.
      const res = await this.teaching.teachersDrillDown(filter);
      return withGuards({
        view: 'teachers',
        acadYearBE: res.acadYearBE,
        semester: res.semester,
        totals: res.totals,
        faculties: res.rows.slice(0, 10).map((f) => {
          const allPrograms = f.levels.flatMap((l) => l.programs);
          const seen = new Set<string>();
          const topTeachers: (typeof res.rows)[number]['levels'][number]['programs'][number]['children'] =
            [];
          for (const p of allPrograms) {
            for (const t of p.children) {
              const k = t.facultyMemberId ?? t.displayName;
              if (seen.has(k)) continue;
              seen.add(k);
              topTeachers.push(t);
            }
          }
          topTeachers.sort(
            (a, b) => b.totalContactHrsPerWeek - a.totalContactHrsPerWeek,
          );
          return {
            facultyName: f.facultyName,
            teachers: f.teachers,
            sections: f.sections,
            lectureHrsPerWeek: f.lectureHrsPerWeek,
            labHrsPerWeek: f.labHrsPerWeek,
            totalContactHrsPerWeek: f.totalContactHrsPerWeek,
            avgContactHrsPerTeacher: f.avgContactHrsPerTeacher,
            studentsTaught: f.studentsTaught,
            teamTaughtSections: f.teamTaughtSections,
            levels: f.levels.map((l) => ({
              level: l.level,
              teachers: l.teachers,
              totalContactHrsPerWeek: l.totalContactHrsPerWeek,
              avgContactHrsPerTeacher: l.avgContactHrsPerTeacher,
              programCount: l.programs.filter((p) => p.programId !== null)
                .length,
            })),
            programs: allPrograms.slice(0, 15).map((p) => ({
              programName: p.programName,
              programCode: p.programCode,
              programLevel: p.programLevel,
              teachers: p.teachers,
              sections: p.sections,
              totalContactHrsPerWeek: p.totalContactHrsPerWeek,
              avgContactHrsPerTeacher: p.avgContactHrsPerTeacher,
              studentsTaught: p.studentsTaught,
            })),
            topTeachers: topTeachers.slice(0, 30),
          };
        }),
        facultyCount: res.rows.length,
      });
    },

    dash_staff_research: async (input) => {
      const q = DashStaffResearchInputSchema.parse(input);
      const res = await this.staff.researchOutput({
        facultyName: arr(q.facultyName),
        sources: q.sources,
        yearFrom: q.yearFrom,
      });
      // researchOutput returns a rich composite payload. Route by `view`
      // and slice the heavy arrays so the LLM context stays sane.
      const r = res as Record<string, unknown>;
      const headline = {
        yearFrom: r.yearFrom,
        yearTo: r.yearTo,
        totalStaff: r.totalStaff,
        publishingStaff: r.publishingStaff,
        totalPapers: r.totalPapers,
        totalCitations: r.totalCitations,
      };

      const topAuthors = Array.isArray(r.topAuthors) ? r.topAuthors : [];
      const topVenues = Array.isArray(r.topVenues) ? r.topVenues : [];
      const byFaculty = Array.isArray(r.byFaculty) ? r.byFaculty : [];
      const heatmap = Array.isArray(r.heatmap) ? r.heatmap : [];

      if (q.view === 'top_authors') {
        // Re-rank by sortBy. The service's topAuthors is already
        // pre-sorted by papers desc; for citations we resort.
        const sorted =
          q.sortBy === 'citations'
            ? topAuthors
                .slice()
                .sort(
                  (a, b) =>
                    ((b as { citations?: number }).citations ?? 0) -
                    ((a as { citations?: number }).citations ?? 0),
                )
            : topAuthors;
        return {
          view: 'top_authors',
          sortBy: q.sortBy,
          ...headline,
          authors: sorted.slice(0, 30),
        };
      }
      if (q.view === 'top_venues') {
        return { view: 'top_venues', ...headline, venues: topVenues.slice(0, 25) };
      }
      if (q.view === 'by_faculty') {
        return {
          view: 'by_faculty',
          ...headline,
          faculties: byFaculty.slice(0, 30),
        };
      }
      if (q.view === 'heatmap') {
        return {
          view: 'heatmap',
          ...headline,
          heatmap: heatmap.slice(0, 30),
        };
      }
      if (q.view === 'by_rank') {
        return { view: 'by_rank', ...headline, byRank: r.byRank ?? null };
      }
      if (q.view === 'by_year') {
        return { view: 'by_year', ...headline, byYear: r.byYear ?? null };
      }

      // view = 'overview'
      return {
        view: 'overview',
        ...headline,
        bySource: r.bySource ?? null,
        byType: r.byType ?? null,
        byYear: r.byYear ?? null,
        topVenues: topVenues.slice(0, 10),
        topAuthors: topAuthors.slice(0, 10),
        byRank: r.byRank ?? null,
      };
    },

    dash_staff_faculty_by_program: async (input) => {
      const q = DashStaffFacultyByProgramInputSchema.parse(input);
      const res = await this.staff.facultyByProgram({ facultyId: q.facultyId });
      const r = res as {
        thresholds?: unknown;
        faculties?: Array<{
          facultyName: string;
          levels?: Array<unknown>;
          teachType2?: number;
          teachType3?: number;
          distinctStaff?: number;
          studentCount?: number;
          studentsPerStaff?: number | null;
          programCount?: number;
          programsBelowMin?: number;
        }>;
      };
      const faculties = Array.isArray(r.faculties) ? r.faculties : [];

      if (q.view === 'overview') {
        // Drop the nested `levels` payload to keep the LLM context lean
        // — the bot calls again with view='faculty_drill' to drill in.
        return {
          view: 'overview',
          thresholds: r.thresholds,
          faculties: faculties.slice(0, 30).map((f) => ({
            facultyName: f.facultyName,
            teachType2: f.teachType2,
            teachType3: f.teachType3,
            distinctStaff: f.distinctStaff,
            studentCount: f.studentCount,
            studentsPerStaff: f.studentsPerStaff,
            programCount: f.programCount,
            programsBelowMin: f.programsBelowMin,
          })),
          facultyCount: faculties.length,
        };
      }

      // view = 'faculty_drill' — return full tree for the requested
      // faculty. If facultyId was supplied, the service already scoped
      // to one row.
      if (!q.facultyId) {
        return {
          error: 'view=faculty_drill requires facultyId. Call view=overview first or pass facultyId from an earlier tool result.',
        };
      }
      const target = faculties[0]; // service-scoped: at most one row
      if (!target) {
        return {
          view: 'faculty_drill',
          facultyId: q.facultyId,
          thresholds: r.thresholds,
          note: 'No program/teach data for this faculty.',
        };
      }
      return {
        view: 'faculty_drill',
        facultyId: q.facultyId,
        thresholds: r.thresholds,
        faculty: target,
      };
    },

    // ── Helpers ───────────────────────────────────────────────────
    dash_filter_options: async (input, caller) => {
      const q = DashFilterOptionsInputSchema.parse(input);
      if (q.surface === 'education') {
        // Return a slim summary of available filter values — student
        // info is the only education surface that returns the full
        // (faculty × programLevel × program) tree.
        const res = await this.education.studentInfo({});
        return {
          faculties: res.filters.faculties,
          programLevels: res.filters.programLevels,
          programCount: res.filters.programs.length,
          statusGroups: res.filters.statusGroups,
        };
      }
      if (q.surface === 'staff') {
        const res = await this.staff.filterOptions({});
        return res;
      }
      if (SCOPED_SURFACES.has(q.surface)) {
        const scope = await resolveOfferingScope(caller);
        if (scope.mode === 'none') {
          return { error: 'forbidden: caller has no scope on this surface' };
        }
        if (q.surface === 'class_offerings') {
          return await this.classOfferings.filterOptions(scope);
        }
        return await this.teaching.filterOptions(scope);
      }
      return { error: `unknown surface: ${q.surface}` };
    },

    dash_compute: async (input) => {
      const q = DashComputeInputSchema.parse(input);
      const warn = (
        val: number,
        label: string,
      ): { result: number; dataQualityWarning?: string } => {
        if (q.sanityMax !== undefined && val > q.sanityMax) {
          return {
            result: val,
            dataQualityWarning: `${label}=${val} exceeds sanityMax=${q.sanityMax}. The inputs may include cross-period aggregation or a unit mix-up. Re-check the source filter; do NOT report this value.`,
          };
        }
        if (q.sanityMin !== undefined && val < q.sanityMin) {
          return {
            result: val,
            dataQualityWarning: `${label}=${val} is below sanityMin=${q.sanityMin}. Re-check the source data; do NOT report this value.`,
          };
        }
        return { result: val };
      };
      switch (q.op) {
        case 'sum': {
          if (!q.values || q.values.length === 0)
            return { error: 'op=sum requires non-empty `values`' };
          const s = q.values.reduce((acc, v) => acc + v, 0);
          return { op: 'sum', n: q.values.length, ...warn(s, 'sum') };
        }
        case 'min': {
          if (!q.values || q.values.length === 0)
            return { error: 'op=min requires non-empty `values`' };
          return { op: 'min', n: q.values.length, ...warn(Math.min(...q.values), 'min') };
        }
        case 'max': {
          if (!q.values || q.values.length === 0)
            return { error: 'op=max requires non-empty `values`' };
          return { op: 'max', n: q.values.length, ...warn(Math.max(...q.values), 'max') };
        }
        case 'average': {
          if (!q.values || q.values.length === 0)
            return { error: 'op=average requires non-empty `values`' };
          const s = q.values.reduce((acc, v) => acc + v, 0);
          const avg = s / q.values.length;
          return { op: 'average', n: q.values.length, sum: s, ...warn(avg, 'average') };
        }
        case 'weighted_average': {
          if (!q.values || !q.weights || q.values.length !== q.weights.length || q.values.length === 0) {
            return {
              error:
                'op=weighted_average requires equal-length non-empty `values` + `weights`',
            };
          }
          const wsum = q.weights.reduce((a, b) => a + b, 0);
          if (wsum === 0) return { error: 'op=weighted_average requires non-zero total weight' };
          const num = q.values.reduce((acc, v, i) => acc + v * (q.weights as number[])[i]!, 0);
          const avg = num / wsum;
          return {
            op: 'weighted_average',
            n: q.values.length,
            totalWeight: wsum,
            ...warn(avg, 'weighted_average'),
          };
        }
        case 'ratio': {
          if (q.numerator === undefined || q.denominator === undefined)
            return { error: 'op=ratio requires `numerator` + `denominator`' };
          if (q.denominator === 0)
            return {
              op: 'ratio',
              numerator: q.numerator,
              denominator: 0,
              result: null,
              note: 'denominator is zero',
            };
          const r = q.numerator / q.denominator;
          return {
            op: 'ratio',
            numerator: q.numerator,
            denominator: q.denominator,
            ...warn(r, 'ratio'),
          };
        }
        case 'rank_top':
        case 'rank_bottom': {
          if (!q.items || q.items.length === 0)
            return { error: `op=${q.op} requires non-empty \`items\`` };
          const sorted = q.items.slice().sort((a, b) =>
            q.op === 'rank_top' ? b.value - a.value : a.value - b.value,
          );
          const ranked = sorted.slice(0, q.topN);
          const warnings: string[] = [];
          for (const r of ranked) {
            if (q.sanityMax !== undefined && r.value > q.sanityMax) {
              warnings.push(
                `"${r.label}" value=${r.value} exceeds sanityMax=${q.sanityMax} — do NOT report.`,
              );
            }
            if (q.sanityMin !== undefined && r.value < q.sanityMin) {
              warnings.push(
                `"${r.label}" value=${r.value} is below sanityMin=${q.sanityMin} — do NOT report.`,
              );
            }
          }
          return {
            op: q.op,
            topN: q.topN,
            ranked,
            ...(warnings.length > 0 ? { dataQualityWarnings: warnings } : {}),
          };
        }
        case 'year_over_year': {
          if (!q.series || q.series.length < 2)
            return {
              error: 'op=year_over_year requires `series` with at least 2 periods',
            };
          // Pair up consecutive entries → return Δ + %Δ. Bot keeps the
          // series-order it passed (no auto-sort) so it controls the
          // direction (oldest→newest is conventional).
          const deltas: Array<{
            fromPeriod: string;
            toPeriod: string;
            from: number;
            to: number;
            delta: number;
            deltaPct: number | null;
          }> = [];
          for (let i = 1; i < q.series.length; i += 1) {
            const a = q.series[i - 1]!;
            const b = q.series[i]!;
            const delta = b.value - a.value;
            const deltaPct = a.value !== 0 ? (delta / a.value) * 100 : null;
            deltas.push({
              fromPeriod: a.period,
              toPeriod: b.period,
              from: a.value,
              to: b.value,
              delta,
              deltaPct,
            });
          }
          // Aggregate stats over the series — useful for "average growth".
          const total = q.series[q.series.length - 1]!.value - q.series[0]!.value;
          const totalPct =
            q.series[0]!.value !== 0
              ? (total / q.series[0]!.value) * 100
              : null;
          // CAGR over (n-1) periods if all values > 0.
          const allPositive = q.series.every((s) => s.value > 0);
          const periods = q.series.length - 1;
          const cagrPct =
            allPositive && periods > 0
              ? (Math.pow(
                  q.series[q.series.length - 1]!.value / q.series[0]!.value,
                  1 / periods,
                ) -
                  1) *
                100
              : null;
          return {
            op: 'year_over_year',
            n: q.series.length,
            deltas,
            totalDelta: total,
            totalDeltaPct: totalPct,
            cagrPct,
          };
        }
      }
    },

    dash_data_freshness: async (input) => {
      const q = DashDataFreshnessInputSchema.parse(input);
      if (q.surface === 'education') {
        // Each education cube carries `refreshedAt` (filled by
        // EducationRefreshService). Latest refresh across rows is the
        // surface's freshness.
        const [student, location, tuition, performance] = await Promise.all([
          prisma.educationStudentCube.aggregate({ _max: { refreshedAt: true } }),
          prisma.educationStudentLocationCube.aggregate({ _max: { refreshedAt: true } }),
          prisma.educationTuitionCube.aggregate({ _max: { refreshedAt: true } }),
          prisma.educationPerformanceCube.aggregate({ _max: { refreshedAt: true } }),
        ]);
        return {
          surface: 'education',
          cubes: {
            student: student._max?.refreshedAt ?? null,
            location: location._max?.refreshedAt ?? null,
            tuition: tuition._max?.refreshedAt ?? null,
            performance: performance._max?.refreshedAt ?? null,
          },
        };
      }
      // Staff: latest StaffMasterRecord.ingestedAt is the best proxy.
      // ResearchOutput has an updatedAt — separate ingestion path.
      const staff = await prisma.staffMasterRecord.aggregate({
        _max: { ingestedAt: true },
      });
      const research = await prisma.researchOutput.aggregate({
        _max: { updatedAt: true },
      });
      return {
        surface: 'staff',
        staffMasterIngestedAt: staff._max?.ingestedAt ?? null,
        researchOutputUpdatedAt: research._max?.updatedAt ?? null,
      };
    },

    // Reused from the strategic catalog — programs + faculties are the
    // entity types the dashboard chatbot is likely to cite.
    cite_source: async (input) => {
      const q = CiteSourceInputSchema.parse(input);
      switch (q.entityType) {
        case 'program': {
          const p = await prisma.program.findUnique({
            where: { id: q.entityId },
            select: { code: true, nameEn: true, nameTh: true },
          });
          if (!p) return { citation: `[Program ${q.entityId} — not found]` };
          return { citation: `Program ${p.code} — ${p.nameEn} / ${p.nameTh}` };
        }
        case 'faculty': {
          const f = await prisma.faculty.findUnique({
            where: { id: q.entityId },
            select: { code: true, nameEn: true, nameTh: true },
          });
          if (!f) return { citation: `[Faculty ${q.entityId} — not found]` };
          return { citation: `Faculty ${f.code} — ${f.nameEn} / ${f.nameTh}` };
        }
        default:
          return {
            citation: `[unsupported entityType for dashboard chat: ${q.entityType}]`,
          };
      }
    },
  };
}

// Normalise single → array. The LLM produces single values; the services
// accept multi-value arrays. `undefined` stays undefined so the service's
// own "no filter" semantics apply.
function arr<T>(v: T | undefined): T[] | undefined {
  if (v === undefined || v === null) return undefined;
  return [v];
}

// Sanity-check performance / GPA payloads. Thai GPA scale tops at 4.0.
// Anything above is either a data bug or a unit mix-up.
const HARD_MAX_GPA = 4.0;

function applyPerformanceSanityChecks(
  payload: Record<string, unknown>,
  warnings: string[],
): void {
  const probe = (val: unknown, label: string): void => {
    const v = numericOrNull(val);
    if (v !== null && v > HARD_MAX_GPA) {
      warnings.push(
        `${label}=${v.toFixed(2)} exceeds 4.0 (Thai GPA scale). Likely data error or unit mix-up.`,
      );
    }
    if (v !== null && v < 0) {
      warnings.push(`${label}=${v} is negative.`);
    }
  };
  // Top-level scalars
  probe(payload.averageGpa, 'averageGpa');
  probe(payload.averageEntryGpa, 'averageEntryGpa');
  probe(payload.averageEnglishGpa, 'averageEnglishGpa');

  // by_program top list
  if (Array.isArray(payload.topPrograms)) {
    for (const r of payload.topPrograms as Array<Record<string, unknown>>) {
      probe(r.averageGpa, `program "${r.programName ?? '(unknown)'}" averageGpa`);
      probe(
        r.averageEntryGpa,
        `program "${r.programName ?? '(unknown)'}" averageEntryGpa`,
      );
    }
  }
  // by_location top schools
  if (Array.isArray(payload.topSchools)) {
    for (const r of payload.topSchools as Array<Record<string, unknown>>) {
      probe(r.averageGpa, `school "${r.schoolName ?? '(unknown)'}" averageGpa`);
      probe(
        r.averageEntryGpa,
        `school "${r.schoolName ?? '(unknown)'}" averageEntryGpa`,
      );
    }
  }
  // by_faculty rollup
  if (Array.isArray(payload.byFaculty)) {
    for (const r of payload.byFaculty as Array<Record<string, unknown>>) {
      probe(r.averageGpa, `faculty "${r.facultyName ?? '(unknown)'}" averageGpa`);
      probe(
        r.averageEntryGpa,
        `faculty "${r.facultyName ?? '(unknown)'}" averageEntryGpa`,
      );
    }
  }
}

// Sanity-check teaching-workload payloads for impossible values. A week
// has 168 hours; an academic regulation cap on teaching is ~30 hrs/week.
// Anything above HARD_MAX_HRS_PER_WEEK = 168 is physically impossible,
// anything above SOFT_MAX_HRS_PER_WEEK = 40 is suspicious. We push the
// warning into a `dataQualityWarnings` array so the LLM surfaces it
// instead of confidently reporting an absurd number. The system prompt
// is updated to require the bot to refuse to report values when a
// warning is present.
const HARD_MAX_HRS_PER_WEEK = 168;
const SOFT_MAX_HRS_PER_WEEK = 40;

function applyTeachingWorkloadSanityChecks(
  payload: Record<string, unknown>,
  warnings: string[],
): void {
  // Top-level scalars (summary, histogram-totals etc.)
  const topAvg = numericOrNull(payload.avgContactHrsPerTeacher);
  if (topAvg !== null && topAvg > HARD_MAX_HRS_PER_WEEK) {
    warnings.push(
      `avgContactHrsPerTeacher=${topAvg.toFixed(1)} exceeds 168 hrs/week (physically impossible). Treat as cross-term sum, not per-week. Re-run with acadYearBE + semester set.`,
    );
  } else if (topAvg !== null && topAvg > SOFT_MAX_HRS_PER_WEEK) {
    warnings.push(
      `avgContactHrsPerTeacher=${topAvg.toFixed(1)} exceeds 40 hrs/week (high). Verify by drilling into individual teachers.`,
    );
  }

  // Per-faculty rows (by_faculty + teachers + students_by_faculty views)
  const rows = Array.isArray(payload.rows) ? payload.rows : null;
  if (rows) {
    for (const r of rows as Array<Record<string, unknown>>) {
      const v = numericOrNull(r.avgContactHrsPerTeacher);
      if (v !== null && v > HARD_MAX_HRS_PER_WEEK) {
        warnings.push(
          `Faculty "${r.facultyName ?? '(unknown)'}" avgContactHrsPerTeacher=${v.toFixed(1)} exceeds 168 hrs/week — impossible per week. Likely cross-term aggregation.`,
        );
      }
    }
  }

  // Per-faculty rows under view=teachers
  const faculties = Array.isArray(payload.faculties) ? payload.faculties : null;
  if (faculties) {
    for (const f of faculties as Array<Record<string, unknown>>) {
      const v = numericOrNull(f.avgContactHrsPerTeacher);
      if (v !== null && v > HARD_MAX_HRS_PER_WEEK) {
        warnings.push(
          `Faculty "${f.facultyName ?? '(unknown)'}" avgContactHrsPerTeacher=${v.toFixed(1)} exceeds 168 hrs/week — impossible per week.`,
        );
      }
      const topT = Array.isArray(f.topTeachers) ? f.topTeachers : [];
      for (const t of topT as Array<Record<string, unknown>>) {
        const tv = numericOrNull(t.totalContactHrsPerWeek);
        if (tv !== null && tv > HARD_MAX_HRS_PER_WEEK) {
          warnings.push(
            `Teacher in "${f.facultyName ?? '(unknown)'}" totalContactHrsPerWeek=${tv.toFixed(1)} exceeds 168 — impossible per week.`,
          );
        }
      }
    }
  }
}

function numericOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

// Rank performance rows by the requested metric, descending. Rows whose
// metric is null or whose studentCount is below the minimum are dropped
// from the ranking — they'd otherwise either crash the comparator or
// dominate the top of the list as 1-student outliers. The minimum-cohort
// gate mirrors the staff/compensation <5-person mask: small samples
// don't trustworthily describe a population.
function rankPerformanceRows<
  T extends {
    studentCount: number;
    averageGpa: number | null;
    averageEntryGpa: number | null;
  },
>(
  rows: T[],
  sortBy: 'averageGpa' | 'averageEntryGpa' | 'studentCount',
  minStudentCount: number,
): T[] {
  const filtered = rows.filter((r) => {
    if (r.studentCount < minStudentCount) return false;
    if (sortBy === 'averageGpa') return r.averageGpa !== null;
    if (sortBy === 'averageEntryGpa') return r.averageEntryGpa !== null;
    return true;
  });
  return filtered.sort((a, b) => {
    if (sortBy === 'studentCount') return b.studentCount - a.studentCount;
    const aV = (sortBy === 'averageGpa' ? a.averageGpa : a.averageEntryGpa) ?? -Infinity;
    const bV = (sortBy === 'averageGpa' ? b.averageGpa : b.averageEntryGpa) ?? -Infinity;
    return bV - aV;
  });
}

// Same byte budget as the strategic executor — 8 KB per tool result.
function clip<T>(value: T): T {
  const serialised = JSON.stringify(value);
  if (serialised.length <= 8_000) return value;
  return clipRecursive(value as unknown, 8_000) as T;
}

function clipRecursive(v: unknown, budget: number): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    let remaining = budget;
    for (const item of v) {
      if (remaining <= 0) {
        out.push({ truncated: `${v.length - out.length} items elided` });
        break;
      }
      out.push(item);
      remaining -= JSON.stringify(item).length;
    }
    return out;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = clipRecursive(val, Math.max(1000, budget));
    }
    return out;
  }
  return v;
}
