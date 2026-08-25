import { Injectable } from '@nestjs/common';
import {
  dqDrill,
  dqFacultyRows,
  dqOverview,
  dqRadar,
  STUDENT_DQ_METHODOLOGY_VERSION,
  type DqDrillRow,
  type DqFilter,
  type DqOverview,
  type DqRadarResult,
  type DqRadarScope,
} from '@kku/db';

/** The radar's comparison series is the whole institution, every cohort —
 *  see `radar()` below for why it stays unclamped and why it is labelled. */
const COMPARISON_LABEL = 'University (all faculties, all cohorts)';

export interface DqDrillResult {
  methodologyVersion: string;
  faculties: DqDrillRow[];
  programs: DqDrillRow[];
}

export interface DqRadarResponse extends DqRadarResult {
  /** What the `university` series actually covers, so the chart legend
   *  can state it rather than implying it matches the caller's scope. */
  comparisonLabel: string;
}

// Thin wrapper for DI so other modules (Analyst, Admin) can inject the
// service without re-importing the @kku/db helpers directly.
@Injectable()
export class StudentDqService {
  readonly methodologyVersion = STUDENT_DQ_METHODOLOGY_VERSION;

  overview(filter: DqFilter): Promise<DqOverview> {
    return dqOverview(filter);
  }

  /**
   * Both levels of the drill-down tree, each aggregated from the cubes
   * directly.
   *
   * The faculty rows come from `dqFacultyRows`, never from folding the
   * program rows together: small-cell suppression blanks the means on
   * programs with fewer than five scored students, so summing children
   * would drop those students out of their faculty's mean without
   * saying so. The page composes the tree from these two arrays and
   * recomputes nothing.
   */
  async drill(filter: DqFilter): Promise<DqDrillResult> {
    const [faculties, programs] = await Promise.all([dqFacultyRows(filter), dqDrill(filter)]);
    return {
      methodologyVersion: faculties.methodologyVersion,
      faculties: faculties.rows,
      programs: programs.rows,
    };
  }

  /**
   * One scope's module profile beside an explicitly-named comparison.
   *
   * DECISION (of the two the plan offered): the comparison series stays
   * computed over the whole university — unclamped, all cohorts, exactly
   * as `dqRadar` builds it — and we ship the label that says so, rather
   * than narrowing it to the caller's clamp.
   *
   * Why this way round: the point of the second ring is "how does my
   * faculty sit against the institution". Recomputing it inside a
   * FACULTY_USER's clamp would make it identical to their own series —
   * a flat, useless comparison that still reads as a benchmark. And it
   * discloses nothing: an institution-wide mean over thousands of
   * students is not attributable to any faculty, program or person, so
   * the clamp (which exists to gate faculty-level detail) has nothing to
   * bite on here. What was NOT acceptable was leaving a line labelled
   * "University" that silently meant something else, so the label is
   * part of the payload instead of hardcoded in the chart.
   */
  async radar(scope: DqRadarScope): Promise<DqRadarResponse> {
    const result = await dqRadar(scope);
    return { ...result, comparisonLabel: COMPARISON_LABEL };
  }
}
