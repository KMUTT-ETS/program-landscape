import type { ProgramDetailData } from '@kku/pdf-templates';
import {
  grantAwardCaveat,
  grantAwardLine,
  type HealthAwardLike,
} from '@kku/shared/src/health/grant-award-note';

type PdfHealthAward = ProgramDetailData['healthDimensions'][number]['award'];

/**
 * The Financial dimension's external-grant award (health-score.v5.4), worded
 * for the Program Detail PDF. Uses the same helper as the Deep-Dive and print
 * pages so the PDF states the award in identical words; the lower-bound caveat
 * is attached to every computed award (spec §4.4). Null when there is nothing
 * the reader should be told (no award, or a null award with no stated reason).
 */
export function healthAwardForPdf(award: HealthAwardLike | null | undefined): PdfHealthAward {
  const line = grantAwardLine(award);
  if (!award || line === null) return null;
  return {
    points: award.points,
    baseScore: award.baseScore,
    line,
    caveat: grantAwardCaveat(award),
  };
}
