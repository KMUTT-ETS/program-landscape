import { Injectable } from '@nestjs/common';
import {
  courseQuestionDetail,
  coursesByInstructor,
  EVALUATIONS_METHODOLOGY_VERSION,
  instructorPersonal,
  instructorRoster,
  instructorsByProgram,
  overallSatisfaction,
  questionCatalog,
  type EvaluationFilter,
} from '@kku/db';

// Thin DI wrapper over @kku/db evaluation helpers, tailored for the
// /staff/teaching endpoints. The instructor-personal endpoints take a
// pre-resolved facultyMemberId (caller is responsible for authz).
@Injectable()
export class StaffEvaluationsService {
  readonly methodologyVersion = EVALUATIONS_METHODOLOGY_VERSION;

  overall(filter: EvaluationFilter) {
    return overallSatisfaction(filter);
  }

  roster(filter: EvaluationFilter) {
    return instructorRoster(filter);
  }

  byProgram(filter: EvaluationFilter) {
    return instructorsByProgram(filter);
  }

  personal(args: { facultyMemberId: string; programId?: string; filter?: EvaluationFilter }) {
    return instructorPersonal(args);
  }

  questionCatalog() {
    return questionCatalog();
  }

  questionDetail(args: {
    facultyId?: string;
    programLevel?: string;
    programId?: string;
    courseCode?: string;
    facultyMemberId?: string;
    acadYearBE?: number;
    filter?: EvaluationFilter;
  }) {
    return courseQuestionDetail(args);
  }

  instructorCourses(args: {
    programId: string;
    facultyMemberId: string;
    filter?: EvaluationFilter;
  }) {
    return coursesByInstructor(args);
  }
}
