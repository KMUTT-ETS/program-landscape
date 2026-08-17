import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTrendDocumentIngestMessages,
  TREND_DOCUMENT_INGEST_VERSION,
  TrendDocumentIngestSchema,
  type TrendDocumentIngestInput,
} from '../src/ai/prompts/trend-document-ingest';

const BASE_INPUT: TrendDocumentIngestInput = {
  documentText:
    'Northeast Thailand manpower report: EV battery manufacturers project a 30% increase in demand for process engineers over the next 3 years.',
  sourceLabel: 'manpower-report-2026-q3.pdf',
  signalTypeHint: 'MARKET',
};

describe('trend-document-ingest v2 builder', () => {
  const messages = buildTrendDocumentIngestMessages(BASE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 2', () => {
    expect(TREND_DOCUMENT_INGEST_VERSION).toBe('trend-document-ingest.v2');
  });

  it('carries the confidence rubric verbatim and the tell ban', () => {
    expect(system).toContain('CONFIDENCE RUBRIC');
    expect(system).toContain(
      '0.90-1.00  every key input channel present and mutually consistent',
    );
    expect(system).toContain('below 0.50 best effort over sparse input — flag for human review');
    expect(system).toMatch(/BANNED PHRASES/i);
  });

  it('states the English-output rule for `rationale`', () => {
    expect(system).toMatch(/`rationale` is English-only/);
  });

  it('feeds the document text and source label into the user snapshot', () => {
    expect(user).toContain('SOURCE: manpower-report-2026-q3.pdf');
    expect(user).toContain(BASE_INPUT.documentText);
  });

  it('includes the operator hint when present', () => {
    expect(user).toContain('Operator hint for the signal type: MARKET');
  });

  it('omits the hint line when not provided', () => {
    const noHint = buildTrendDocumentIngestMessages({ ...BASE_INPUT, signalTypeHint: null });
    const noHintUser = noHint.find((m) => m.role === 'user')!.content;
    expect(noHintUser).not.toContain('Operator hint');
  });

  it('references the JSON output shape with `rationale`, not `rationaleTh`', () => {
    expect(system).toContain('"rationale": "<1-2 sentence English rationale>"');
    expect(system).not.toContain('"rationaleTh"');
  });
});

describe('CHANNEL MANIFEST', () => {
  it('is present as a file-level comment block', () => {
    const src = readFileSync(
      path.join(__dirname, '..', 'src', 'ai', 'prompts', 'trend-document-ingest.ts'),
      'utf8',
    );
    expect(src).toMatch(/CHANNEL MANIFEST/);
  });
});

describe('TrendDocumentIngestSchema', () => {
  const validPayload = {
    signalType: 'MARKET' as const,
    titleEn: 'EV battery makers report process-engineer shortage in the Northeast',
    titleTh: 'ผู้ผลิตแบตเตอรี่ EV รายงานขาดแคลนวิศวกรกระบวนการในภาคอีสาน',
    summaryTh: 'รายงานระบุความต้องการวิศวกรกระบวนการเพิ่มขึ้น 30% ในช่วง 3 ปีข้างหน้า จากการขยายตัวของอุตสาหกรรมแบตเตอรี่ EV ในภาคตะวันออกเฉียงเหนือ',
    summaryEn: 'The report projects a 30% increase in demand for process engineers over 3 years as the EV battery industry expands in the Northeast.',
    impactScore: 0.75,
    rationale: 'A near-term, quantified demand shift in a sector KKU already trains for warrants curriculum attention.',
    confidence: 0.8,
  };

  it('accepts a fully valid payload', () => {
    expect(TrendDocumentIngestSchema.safeParse(validPayload).success).toBe(true);
  });

  it('requires `rationale` (English) rather than `rationaleTh`', () => {
    const { rationale: _rationale, ...withoutRationale } = validPayload;
    expect(TrendDocumentIngestSchema.safeParse(withoutRationale).success).toBe(false);
    const withOldField = { ...withoutRationale, rationaleTh: 'เหตุผลภาษาไทย' };
    expect(TrendDocumentIngestSchema.safeParse(withOldField).success).toBe(false);
  });

  it('still requires both titleTh and titleEn (unchanged bilingual pair)', () => {
    const { titleTh: _titleTh, ...withoutTh } = validPayload;
    expect(TrendDocumentIngestSchema.safeParse(withoutTh).success).toBe(false);
  });
});
