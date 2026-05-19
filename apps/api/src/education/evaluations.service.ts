import { Injectable } from '@nestjs/common';
import {
  courseDetail,
  courseQuestionDetail,
  coursesByProgram,
  coursesByYear,
  EVALUATIONS_METHODOLOGY_VERSION,
  instructorPersonal,
  instructorRoster,
  overallSatisfaction,
  questionCatalog,
  questionGaps,
  trend,
  type EvaluationFilter,
} from '@kku/db';

// Thin wrapper for DI so other modules (Analyst, Admin) can inject the
// service without re-importing the @kku/db helpers directly.
@Injectable()
export class EvaluationsService {
  readonly methodologyVersion = EVALUATIONS_METHODOLOGY_VERSION;

  overall(filter: EvaluationFilter) {
    return overallSatisfaction(filter);
  }

  coursesByYear(filter: EvaluationFilter) {
    return coursesByYear(filter);
  }

  coursesByProgram(filter: EvaluationFilter) {
    return coursesByProgram(filter);
  }

  trend(filter: EvaluationFilter) {
    return trend(filter);
  }

  questionGaps(filter: EvaluationFilter) {
    return questionGaps(filter);
  }

  questionCatalog() {
    return questionCatalog();
  }

  instructorRoster(filter: EvaluationFilter) {
    return instructorRoster(filter);
  }

  instructorPersonal(facultyMemberId: string, filter: EvaluationFilter) {
    return instructorPersonal({ facultyMemberId, filter });
  }

  courseQuestionDetail(args: {
    facultyId?: string;
    programLevel?: string;
    programId?: string;
    courseCode?: string;
    acadYearBE?: number;
    filter?: EvaluationFilter;
  }) {
    return courseQuestionDetail(args);
  }

  courseDetail(args: {
    programId: string;
    courseCode: string;
    filter?: EvaluationFilter;
  }) {
    return courseDetail(args);
  }
}
