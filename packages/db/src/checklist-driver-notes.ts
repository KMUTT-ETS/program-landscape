// Short human reasons for a health-score driver that read null, for the
// programme setup checklist. A small map from driver key + raw shape to one
// sentence; anything not covered returns null and the caller keeps the
// scorer's own text.

export interface DriverNoteContext {
  /** Rows in kmitl_career_skill_demands, and how many carry a skill link.
   *  Null when the counts could not be read: no note is guessed then. */
  kmitlRows: number | null;
  kmitlLinked: number | null;
}

export const SKILL_LINK_HINT =
  'Skill-demand data is loaded but none of its skill names is linked to this installation’s skill taxonomy. Run pnpm skills:normalise --auto-promote, then re-run the pipeline.';

type Raw = Record<string, unknown> | null;

function asRaw(raw: unknown): Raw {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const PUBLIC_BASIS_NOTE =
  'Computed from public TCAS round-3 figures (admission campaigns have no seats)';

const ADMITTED_NOT_PUBLISHED =
  'The public TCAS round-3 data states no admitted counts for this programme and year, so the fill rate is not scored.';

const NO_SEATS =
  'No planned seats for the latest complete year, and no public TCAS round-3 figures for this programme.';

const NO_ADMISSION_DATA =
  'No admission data for a complete recruitment year yet: no admission-campaigns rows and no public TCAS round-3 rows for this programme.';

const YIELD_NOT_STATED =
  'The Confirmed figure is filled but the Reported column of the admission-campaigns sheet is empty, so the registration yield is not scored (an absent figure is not a zero).';

function seatsInOtherYearsNote(year: number | null): string {
  return `The latest complete recruitment year${year ? ` (${year})` : ''} states no planned seats although other years do, so it is not scored; add Planned Seats for that year in the admission-campaigns sheet.`;
}

/** True when a driver's raw says it was computed on the public TCAS basis. */
export function usesPublicTcasBasis(rawIn: unknown): boolean {
  return asRaw(rawIn)?.basis === 'public-tcas-round3';
}

export function driverNullNote(label: string, rawIn: unknown, ctx: DriverNoteContext): string | null {
  const raw = asRaw(rawIn);
  switch (label) {
    case 'tcas_fill_rate':
    case 'tcas_competition_ratio':
      if (label === 'tcas_fill_rate' && raw?.reason === 'admitted-not-published') return ADMITTED_NOT_PUBLISHED;
      if (rawIn === null || rawIn === undefined) return NO_ADMISSION_DATA;
      if (raw?.seatsStatedInOtherYears === true) return seatsInOtherYearsNote(num(raw?.year));
      return NO_SEATS;
    case 'tcas_competition_vs_peers': {
      if (raw && raw.kkuRatio === null && raw.year === null) return NO_ADMISSION_DATA;
      if (raw && raw.kkuRatio === null && raw.seatsStatedInOtherYears === true) return seatsInOtherYearsNote(num(raw?.year));
      if (raw && raw.kkuRatio === null) return `${NO_SEATS} The peer comparison needs a ratio for this programme.`;
      const year = num(raw?.year);
      return `No other institution runs a comparable subject in public TCAS${year ? ` for ${year}` : ''}.`;
    }
    case 'tcas_registration_yield':
      if (rawIn === null || rawIn === undefined) return NO_ADMISSION_DATA;
      if (raw?.reason === 'reported-not-stated') return YIELD_NOT_STATED;
      return 'Needs the Confirmed and Reported columns of the admission-campaigns sheet (registered students divided by confirmed places). Public TCAS data has no registration counts.';
    case 'jobthai_demand_alignment': {
      const reason = raw?.reason;
      if (reason === 'no-links') {
        return 'No JobThai field of study is linked to this programme (postgraduate programmes are not matched).';
      }
      if (reason === 'below-floor') {
        const floor = num(raw?.floor);
        return `Fewer than ${floor ?? 'the minimum number of'} JobThai postings sit behind this programme’s links.`;
      }
      return null;
    }
    case 'labour_market_alignment':
      if (ctx.kmitlRows === null || ctx.kmitlLinked === null) return null;
      if (ctx.kmitlRows === 0) return 'No skill-demand data is loaded (KMITL feed or the career skill-demand spreadsheet).';
      if (ctx.kmitlLinked === 0) return SKILL_LINK_HINT;
      return 'None of this programme’s skills appear in the demanded-skill set.';
    case 'demand_match_filled':
      if (ctx.kmitlRows === null || ctx.kmitlLinked === null) return null;
      if (ctx.kmitlRows > 0 && ctx.kmitlLinked === 0) return SKILL_LINK_HINT;
      if (ctx.kmitlRows === 0) return 'No skill-demand data is loaded, so there is nothing to match the curriculum against.';
      return 'The curriculum demand match has not run for this programme (pipeline phase 3).';
    case 'demographic_resilience': {
      const reason = raw?.reason;
      if (typeof reason === 'string' && reason.startsWith('region-not-set')) return 'Set the organisation region (Admin, Organization) to one of the projection regions.';
      if (reason === 'no-projection') return 'No population projection covers this region; upload a Population Projections sheet.';
      if (reason === 'no-enrollment') return 'No enrolment figures for this programme to compare against the cohort.';
      return null;
    }
    default:
      return null;
  }
}
