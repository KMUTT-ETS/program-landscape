// JobThai XLSX ingestion — pure parsing and normalisation.
//
// DELIBERATELY NOT on the root barrel, and `parse-sheet` is deliberately not
// re-exported here. parse-sheet depends on `xlsx`, a large server-only
// spreadsheet parser, and nothing client-reachable may pull it — the same
// rule and the same reasoning as `scholar/search-parse` and cheerio. The
// guarantee is the module staying out of every barrel, not the exports map.
export { JOBTHAI_COLUMNS, JOBTHAI_DATE_COLUMN, type JobThaiColumn } from './columns';
export {
  JOBTHAI_ANY_FIELD,
  normaliseJobThaiRow,
  extractFieldsOfStudy,
  extractMinEducationLevel,
  scrubPostingText,
  type JobRequiredEducationLevel,
  type NormalisedJobThaiRow,
} from './parse-row';
