import {
  JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS,
  JOB108_ANNOUNCEMENT_VERSION,
  Job108AnnouncementOutputSchema,
  announcementPageToText,
  buildJob108AnnouncementMessages,
  extractStructuredWithParseRetry,
  type Job108Position,
  type StructuredExtractor,
} from '@kku/shared';
// scrubPostingText is NOT on the root barrel. Reach it the way job-fields.ts
// already does rather than widening the barrel: the barrel pulls node:crypto
// into anything that imports it, which has already broken a client build once.
import { scrubPostingText } from '@kku/shared/src/jobthai';
import type { Job108AnnouncementHeader } from '@kku/db';

export interface ExtractedAnnouncement {
  header: Job108AnnouncementHeader;
  applicationOpenDate: Date | null;
  /** Null, not the announcement id, when the page yields no positions to
   *  title itself from. The schema is nullable precisely so this can be
   *  recorded honestly rather than with an invented value. */
  title: string | null;
  positions: Job108Position[];
  confidence: number;
}

// The schema's IsoDate is .nullish(), not .nullable(): a model that omits a
// date key entirely means the same thing as an explicit null — the
// announcement did not state one — so both collapse to the same Date | null
// here rather than the caller having to distinguish "absent" from "null".
const toDate = (iso: string | null | undefined): Date | null =>
  iso === null || iso === undefined ? null : new Date(`${iso}T00:00:00Z`);

/**
 * One announcement page → its positions.
 *
 * Scrubbing runs BEFORE extraction, not after. Gender and age requirements
 * appear in government announcements as they do in private adverts; they are
 * not skills and must never reach a Council surface. Scrubbing first also
 * guarantees a stripped phrase cannot end up inside a captured field name —
 * the same ordering the JobThai parser uses and for the same reason.
 */
export async function extractAnnouncement(
  ai: StructuredExtractor,
  input: { announcementId: string; html: string },
): Promise<ExtractedAnnouncement> {
  const text = scrubPostingText(announcementPageToText(input.html));

  const r = await extractStructuredWithParseRetry(
    ai,
    {
      ctx: { module: 'gap-analysis', kind: 'job108-announcement' },
      methodVersion: JOB108_ANNOUNCEMENT_VERSION,
      messages: buildJob108AnnouncementMessages({ announcementId: input.announcementId, text }),
      maxOutputTokens: JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS,
    },
    Job108AnnouncementOutputSchema,
    'job108-announcement',
  );

  const out = r.parsed;
  return {
    header: {
      announcementId: input.announcementId,
      agencyName: out.agencyName,
      publishedDate: toDate(out.publishedDate),
      applicationCloseDate: toDate(out.applicationCloseDate),
    },
    applicationOpenDate: toDate(out.applicationOpenDate),
    title: out.positions[0]?.title ?? null,
    positions: out.positions,
    confidence: out.confidence,
  };
}
