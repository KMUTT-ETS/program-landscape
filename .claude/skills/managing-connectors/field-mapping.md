# Mapping API fields to a dataset

## Read the declaration

`packages/db/src/import/datasets/<file>.ts` (find the file by `slug: '<dataset>'`). What matters:

- `columns[].header` — the exact key `toRows` must use (spaces and capitals included).
- `columns[].required`, `type` (`text`, `integer`, `decimal`, `date`, `boolean`, `enum`) and `enumValues`.
- `rowRules` — cross-column checks (e.g. admitted ≤ applied).
- `strategy` — `upsert`, `term-scoped` or `programme-scoped`: how a load replaces stored rows. It decides what a partial fetch does to existing data and how the shrink guard counts.
- Code columns (`Programme Code`, `Faculty Code`, …) must match rows already loaded in `programmes` / `faculties`; unknown codes are refused.

The scaffolded `connector.ts` contains a typed row interface per dataset generated from the declaration — use it.

## Mapping table

Write it before coding and put it in the connector's data-source page:

| API field | Dataset column | Transform | Notes |
|---|---|---|---|
| `programme_code` | Programme Code | trim | must exist in Programmes |
| `year` | Academic Year | `year - 543` | API is Buddhist Era |
| `applied` | Applications | — | |
| `officer_phone` | — | dropped | personal data |

## Traps

- **Year basis.** Thai systems often use Buddhist Era (CE + 543). Datasets declare which they want; convert in `toRows`.
- **Academic vs fiscal year** — different calendars; check which the dataset column means.
- **Codes.** Leading zeros, case, campus prefixes. Load `programmes`/`faculties` first; a code mismatch loads nothing (`VALIDATION`) or links rows to nothing (`connector:verify` warns on `reaches-programme`).
- **Thai and English names** — map both `nameTh`/`nameEn` columns where the dataset has them; never translate.
- **Optional columns.** Omit a key rather than sending `0` when the API has no value — blank and zero mean different things.
- **Dependency order.** `IMPORT_DATASETS` order is load order; one connector filling several datasets is loaded in that order regardless of `toRows`.
- **Several connectors on one dataset** load as separate sources; the last load of the same term/programme wins.
