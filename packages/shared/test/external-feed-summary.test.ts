import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildExternalFeedSummaryMessages,
  EXTERNAL_FEED_SUMMARY_VERSION,
  ExternalFeedSummarySchema,
  type ExternalFeedSummaryInput,
} from '../src/ai/prompts/external-feed-summary';

const BASE_INPUT: ExternalFeedSummaryInput = {
  sourceName: 'MHESI announcements',
  sourceDefaultSignalType: 'POLICY',
  sourceDefaultImpact: 0.5,
  fetchedUrl: 'https://mhesi.go.th/announcement/123',
  fetchedAt: '2026-08-17T00:00:00.000Z',
  rawContent: 'The Ministry of Higher Education, Science, Research and Innovation announced new funding criteria for STEM programs.',
};

describe('external-feed-summary v2 builder', () => {
  const messages = buildExternalFeedSummaryMessages(BASE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 2', () => {
    expect(EXTERNAL_FEED_SUMMARY_VERSION).toBe('external-feed-summary.v2');
  });

  it('carries the confidence rubric verbatim and the tell ban', () => {
    expect(system).toContain('CONFIDENCE RUBRIC');
    expect(system).toContain(
      '0.90-1.00  every key input channel present and mutually consistent',
    );
    expect(system).toContain('below 0.50 best effort over sparse input — flag for human review');
    expect(system).toMatch(/BANNED PHRASES/i);
  });

  it('makes the title language deterministic — English, not "whichever fits"', () => {
    expect(system).not.toMatch(/whichever fits/);
    expect(system).toMatch(/`title` is English, always/);
  });

  it('carves out verbatim Thai quotes as a data-label exemption, not a language violation', () => {
    expect(system).toMatch(/quote that Thai headline VERBATIM/);
    expect(system).toMatch(/not a language violation/);
  });

  it('still instructs summaryTh to be natural Thai, not a translation (unchanged field)', () => {
    expect(system).toMatch(/summaryTh must be natural Thai/);
  });

  it('feeds source name, url, and raw content into the user snapshot', () => {
    expect(user).toContain('Source: MHESI announcements');
    expect(user).toContain(BASE_INPUT.fetchedUrl);
    expect(user).toContain(BASE_INPUT.rawContent);
  });
});

describe('CHANNEL MANIFEST', () => {
  it('is present as a file-level comment block', () => {
    const src = readFileSync(
      path.join(__dirname, '..', 'src', 'ai', 'prompts', 'external-feed-summary.ts'),
      'utf8',
    );
    expect(src).toMatch(/CHANNEL MANIFEST/);
  });
});

describe('ExternalFeedSummarySchema (unchanged shape)', () => {
  const validPayload = {
    title: 'MHESI raises funding thresholds for STEM programs',
    summaryTh: 'กระทรวง อว. ประกาศเกณฑ์เงินทุนใหม่สำหรับหลักสูตรสายวิทยาศาสตร์',
    summaryEn: 'MHESI announced new funding criteria for STEM programs.',
    impactScore: 0.6,
    signalType: 'POLICY' as const,
    topicKeywords: ['STEM funding', 'MHESI'],
    confidence: 0.75,
  };

  it('accepts a fully valid payload', () => {
    expect(ExternalFeedSummarySchema.safeParse(validPayload).success).toBe(true);
  });

  it('still requires both summaryTh and summaryEn (unchanged, out of scope this rewrite)', () => {
    const { summaryTh: _summaryTh, ...withoutTh } = validPayload;
    expect(ExternalFeedSummarySchema.safeParse(withoutTh).success).toBe(false);
  });

  it('defaults topicKeywords to an empty array', () => {
    const { topicKeywords: _topicKeywords, ...withoutKeywords } = validPayload;
    const result = ExternalFeedSummarySchema.safeParse(withoutKeywords);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.topicKeywords).toEqual([]);
  });
});
