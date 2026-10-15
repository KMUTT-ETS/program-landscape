import { z } from 'zod';
import { prisma, type SignalType } from '@kku/db';
import {
  outboundUserAgent,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';
import { ApiConnector } from '../../base/api-connector';

// ─────────────────────────────────────────────────────────────────────────────
// World Bank — World Development Indicators (WDI) live API connector.
//
// Endpoint: https://api.worldbank.org/v2/country/THA/indicator/<code>?format=json
// No API key required; rate-limit is generous for low-volume use.
//
// Per indicator we fetch the last 10 years of Thai observations. Each
// observation lands as a TrendSignal row tagged 'MARKET' so the Trends
// Radar surfaces it alongside other macro-economic intelligence. The
// signal title encodes (indicator-name + year + value) for at-a-glance
// readability; sourceUrl deep-links to the indicator's WB landing page
// so analysts can dive into the full methodology.
//
// Indicator selection focuses on KKU's strategic-planning needs:
//   - SE.TER.ENRR — Tertiary enrolment ratio (demand-side ceiling)
//   - SL.UEM.1524.ZS — Youth unemployment 15-24 (labour market state)
//   - SL.UEM.TOTL.ZS — Unemployment, total
//   - GB.XPD.RSDV.GD.ZS — R&D expenditure (% of GDP)
//   - SL.TLF.ACTI.ZS — Labour force participation rate
//   - NY.GDP.PCAP.CD — GDP per capita (income context)
//
// Idempotent: TrendSignal rows are upserted on (sourceUrl, detectedDate,
// signalType). Re-runs update the value if the WB has revised it.
// ─────────────────────────────────────────────────────────────────────────────

const COUNTRY_CODE = 'THA';
const FETCH_TIMEOUT_MS = 30_000;
const YEARS_BACK = 10;

interface WbIndicator {
  code: string;
  name: string;
  /** Higher = more strategic for KKU planning. Drives Radar dot size. */
  impactScore: number;
  /** Optional unit suffix for display ('%' / 'USD' / etc.). */
  unit?: string;
}

const INDICATORS: WbIndicator[] = [
  { code: 'SE.TER.ENRR',      name: 'Tertiary enrolment ratio',          impactScore: 0.85, unit: '%' },
  { code: 'SL.UEM.1524.ZS',   name: 'Youth unemployment (15-24)',        impactScore: 0.78, unit: '%' },
  { code: 'SL.UEM.TOTL.ZS',   name: 'Unemployment, total',               impactScore: 0.65, unit: '%' },
  { code: 'GB.XPD.RSDV.GD.ZS', name: 'R&D expenditure',                  impactScore: 0.80, unit: '% of GDP' },
  { code: 'SL.TLF.ACTI.ZS',   name: 'Labour force participation rate',   impactScore: 0.55, unit: '%' },
  { code: 'NY.GDP.PCAP.CD',   name: 'GDP per capita',                    impactScore: 0.60, unit: 'USD' },
];

const WbObservationSchema = z.object({
  indicator: z.object({ id: z.string(), value: z.string() }),
  country: z.object({ id: z.string(), value: z.string() }),
  date: z.string(),
  value: z.union([z.number(), z.null()]),
  decimal: z.number().optional(),
});
type WbObservation = z.infer<typeof WbObservationSchema>;

const WbResponseSchema = z.tuple([
  z.object({
    page: z.number().optional(),
    pages: z.number().optional(),
    per_page: z.union([z.number(), z.string()]).optional(),
    total: z.number().optional(),
    sourceid: z.string().optional(),
    lastupdated: z.string().optional(),
  }),
  z.array(WbObservationSchema),
]);

interface WbRawData {
  indicator: WbIndicator;
  observation: WbObservation;
}

export class WorldBankRealConnector extends ApiConnector {
  readonly slug = 'world-bank';
  readonly mocked = false;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const url = `https://api.worldbank.org/v2/country/${COUNTRY_CODE}?format=json`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': outboundUserAgent(), accept: 'application/json' },
      });
      clearTimeout(timer);
      return {
        ok: res.ok,
        message: res.ok ? 'WDI API reachable' : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const records: RawRecord[] = [];
    for (const indicator of INDICATORS) {
      const url =
        `https://api.worldbank.org/v2/country/${COUNTRY_CODE}/indicator/${indicator.code}` +
        `?format=json&per_page=${YEARS_BACK}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'user-agent': outboundUserAgent(), accept: 'application/json' },
        });
        clearTimeout(timer);
        if (!res.ok) {
          ctx.log.warn(`WB indicator fetch failed`, {
            indicator: indicator.code,
            status: res.status,
          });
          continue;
        }
        const json = await res.json();
        const parsed = WbResponseSchema.safeParse(json);
        if (!parsed.success) {
          ctx.log.warn(`WB response schema mismatch`, {
            indicator: indicator.code,
            issues: parsed.error.issues.slice(0, 3),
          });
          continue;
        }
        const [, observations] = parsed.data;
        for (const observation of observations) {
          if (observation.value === null) continue; // missing values are common in WDI
          records.push({
            externalId: `wb-${indicator.code}-${observation.date}`,
            sourceTimestamp: new Date(`${observation.date}-12-31`),
            data: { indicator, observation } satisfies WbRawData,
          });
        }
      } catch (err) {
        ctx.log.warn(`WB indicator fetch errored`, {
          indicator: indicator.code,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return records;
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const { indicator, observation } = raw.data as WbRawData;
    const formattedValue = formatValue(observation.value!, indicator.unit);
    const title = `Thailand · ${indicator.name} (${observation.date}): ${formattedValue}`;
    return [
      {
        target: 'trend_signals',
        externalId: raw.externalId,
        payload: {
          title,
          summaryEn: `${indicator.name} for Thailand in ${observation.date}: ${formattedValue}. World Bank WDI ${indicator.code}.`,
          summaryTh: `${indicator.name} (ประเทศไทย, ปี ${observation.date}): ${formattedValue} — World Bank WDI ${indicator.code}`,
          sourceUrl: `https://data.worldbank.org/indicator/${indicator.code}?locations=TH`,
          signalType: 'MARKET' as SignalType,
          impactScore: indicator.impactScore,
          publishedDate: `${observation.date}-12-31`,
          tags: ['world-bank', 'wdi', indicator.code],
        },
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    let loaded = 0;
    let failed = 0;
    for (const n of normalized) {
      try {
        const p = n.payload as Record<string, unknown>;
        const detectedDate = new Date(String(p.publishedDate));
        const sourceUrl = String(p.sourceUrl);
        const signalType = p.signalType as SignalType;
        // Dedup on (sourceUrl, detectedDate, signalType) only — WDI has
        // exactly one observation per (indicator, year, country), so a
        // re-run with the same indicator + year must update in place.
        // We must NOT include `title` in the criteria because WB
        // occasionally revises observation values, which would change
        // the formatted title and break idempotency.
        const existing = await prisma.trendSignal.findFirst({
          where: { sourceUrl, detectedDate, signalType },
          select: { id: true },
        });
        if (existing) {
          await prisma.trendSignal.update({
            where: { id: existing.id },
            data: {
              title: String(p.title),
              summaryEn: (p.summaryEn ?? null) as string | null,
              summaryTh: (p.summaryTh ?? null) as string | null,
              impactScore: Number(p.impactScore),
            },
          });
        } else {
          await prisma.trendSignal.create({
            data: {
              signalType,
              title: String(p.title),
              summaryEn: (p.summaryEn ?? null) as string | null,
              summaryTh: (p.summaryTh ?? null) as string | null,
              sourceUrl,
              detectedDate,
              impactScore: Number(p.impactScore),
              affectedProgramIds: [],
              affectedSkillIds: [],
            },
          });
        }
        loaded++;
      } catch (err) {
        ctx.log.error(`WB load failed`, {
          externalId: n.externalId,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }
    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: {
        indicators: INDICATORS.length,
        country: COUNTRY_CODE,
        api: 'WDI v2',
      },
    };
  }
}

function formatValue(value: number, unit?: string): string {
  if (unit === 'USD') return `$${Math.round(value).toLocaleString()}`;
  if (unit === '%') return `${value.toFixed(2)}%`;
  if (unit === '% of GDP') return `${value.toFixed(2)}% GDP`;
  return value.toFixed(2);
}
