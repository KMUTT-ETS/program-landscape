import { z } from 'zod';

// Weekly Trend Digest — Trends Radar export (prompt 07). Curated list
// of new external signals (policy docs, research, market moves) with
// AI-written Thai commentary.
export const WeeklyTrendDigestDataSchema = z.object({
  weekLabel: z.string(),                // "สัปดาห์ที่ 15 ปี 2569"
  dateLabel: z.string(),
  overview: z.string(),
  signals: z.array(
    z.object({
      id: z.string(),
      titleTh: z.string(),
      source: z.string(),
      signalType: z.enum(['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS']),
      summary: z.string(),
      implicationForKku: z.string().optional(),
      url: z.string().url().optional(),
    }),
  ),
});
export type WeeklyTrendDigestData = z.infer<typeof WeeklyTrendDigestDataSchema>;
