import { ApiError } from '@kku/shared';

import { alumniCohortsDataset, studentCohortsDataset } from './datasets/cohorts';
import { budgetsDataset } from './datasets/budgets';
import { campaignsDataset } from './datasets/campaigns';
import { classOfferingsDataset } from './datasets/class-offerings';
import { compensationDataset } from './datasets/compensation';
import { departmentsDataset } from './datasets/departments';
import { enrollmentDataset } from './datasets/enrollment';
import { facultiesDataset } from './datasets/faculties';
import { financialsDataset } from './datasets/financials';
import { graduateOutcomesDataset } from './datasets/graduate-outcomes';
import { programFacultyDataset } from './datasets/program-faculty';
import { programmesDataset } from './datasets/programmes';
import { researchDataset } from './datasets/research';
import { staffDataset } from './datasets/staff';
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
  studentCohortsDataset,
  alumniCohortsDataset,
  staffDataset,
  compensationDataset,
  budgetsDataset,
  researchDataset,
  campaignsDataset,
  classOfferingsDataset,
  programFacultyDataset,
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
