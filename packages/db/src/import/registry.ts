import { ApiError } from '@kku/shared';

import { alumniCohortsDataset, studentCohortsDataset } from './datasets/cohorts';
import { budgetsDataset } from './datasets/budgets';
import { campaignsDataset } from './datasets/campaigns';
import { careerSkillDemandDataset } from './datasets/career-skill-demand';
import { classOfferingsDataset } from './datasets/class-offerings';
import { compensationDataset } from './datasets/compensation';
import { courseEvaluationsDataset } from './datasets/course-evaluations';
import {
  digitalCompetencyCohortsDataset,
  digitalCompetencyModulesDataset,
} from './datasets/digital-competency';
import { departmentsDataset } from './datasets/departments';
import { employerFeedbackDataset } from './datasets/employer-feedback';
import { populationProjectionsDataset } from './datasets/population-projections';
import { rankedUniversitiesDataset } from './datasets/ranked-universities';
import { enrollmentDataset } from './datasets/enrollment';
import { facultiesDataset } from './datasets/faculties';
import { externalGrantsDataset, externalGrantTeamDataset } from './datasets/external-grants';
import { financialsDataset } from './datasets/financials';
import { graduateOutcomesDataset } from './datasets/graduate-outcomes';
import { programFacultyDataset } from './datasets/program-faculty';
import { programmeCoursesDataset } from './datasets/programme-courses';
import { programmesDataset } from './datasets/programmes';
import { researchDataset } from './datasets/research';
import { staffDataset } from './datasets/staff';
import { staffSalaryByFundingDataset } from './datasets/staff-salary-by-funding';
import type { ImportDataset } from './types';

// The one place a dataset becomes importable. Adding a dataset is adding a
// declaration here; everything else — template, validation, guide sheet,
// provenance, start-over — is derived from it.

/**
 * Every importable dataset, in the order the admin screens should show them
 * — which is also the order an adopter must load them in, since each tier
 * references the one above.
 */
export const IMPORT_DATASETS: readonly ImportDataset[] = [
  facultiesDataset,
  departmentsDataset,
  programmesDataset,
  enrollmentDataset,
  financialsDataset,
  graduateOutcomesDataset,
  employerFeedbackDataset,
  populationProjectionsDataset,
  rankedUniversitiesDataset,
  studentCohortsDataset,
  digitalCompetencyCohortsDataset,
  digitalCompetencyModulesDataset,
  alumniCohortsDataset,
  staffDataset,
  compensationDataset,
  staffSalaryByFundingDataset,
  budgetsDataset,
  researchDataset,
  campaignsDataset,
  classOfferingsDataset,
  programFacultyDataset,
  externalGrantsDataset,
  externalGrantTeamDataset,
  programmeCoursesDataset,
  careerSkillDemandDataset,
  courseEvaluationsDataset,
];

export function listImportDatasets(): readonly ImportDataset[] {
  return IMPORT_DATASETS;
}

/** Throws NOT_FOUND naming the slug and the valid ones. */
export function getImportDataset(slug: string): ImportDataset {
  const found = IMPORT_DATASETS.find((d) => d.slug === slug);
  if (!found) {
    const known = IMPORT_DATASETS.map((d) => d.slug).join(', ') || '(none registered)';
    throw new ApiError('NOT_FOUND', `Unknown import dataset "${slug}". Known datasets: ${known}.`);
  }
  return found;
}

/** The DataSource slug an import run is attributed to. */
export function importDataSourceSlug(datasetSlug: string): string {
  return `xlsx-${datasetSlug}`;
}
