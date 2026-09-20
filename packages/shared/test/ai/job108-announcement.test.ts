import { describe, expect, it } from 'vitest';
import {
  JOB108_ANNOUNCEMENT_VERSION,
  Job108AnnouncementOutputSchema,
  buildJob108AnnouncementMessages,
} from '../../src/ai/prompts/job108-announcement';

const validPosition = {
  title: 'เจ้าหน้าที่บริหารงานทั่วไป',
  positionCount: 3,
  salaryMin: 15000,
  salaryMax: null,
  minEducationLevel: 'BACHELOR' as const,
  requiredFieldsRaw: ['รัฐศาสตร์', 'บริหารธุรกิจ'],
  qualificationRaw: 'วุฒิการศึกษา ปริญญาตรี ในสาขาวิชา รัฐศาสตร์ บริหารธุรกิจ',
};

describe('job108-announcement schema', () => {
  it('is versioned', () => {
    expect(JOB108_ANNOUNCEMENT_VERSION).toBe('job108-announcement.v1');
  });

  it('accepts a well-formed announcement', () => {
    const parsed = Job108AnnouncementOutputSchema.parse({
      agencyName: 'กรมการข้าว',
      publishedDate: '2026-09-09',
      applicationOpenDate: null,
      applicationCloseDate: '2026-09-30',
      positions: [validPosition],
      confidence: 0.9,
    });
    expect(parsed.positions[0]?.requiredFieldsRaw).toEqual(['รัฐศาสตร์', 'บริหารธุรกิจ']);
  });

  it('accepts an announcement with no positions, which is a real outcome', () => {
    const parsed = Job108AnnouncementOutputSchema.parse({
      agencyName: null,
      publishedDate: null,
      applicationOpenDate: null,
      applicationCloseDate: null,
      positions: [],
      confidence: 0.2,
    });
    expect(parsed.positions).toEqual([]);
  });

  it('rejects an unknown education level rather than coercing it', () => {
    expect(() =>
      Job108AnnouncementOutputSchema.parse({
        agencyName: null,
        publishedDate: null,
        applicationOpenDate: null,
        applicationCloseDate: null,
        positions: [{ ...validPosition, minEducationLevel: 'DIPLOMA' }],
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it('rejects a negative seat count', () => {
    expect(() =>
      Job108AnnouncementOutputSchema.parse({
        agencyName: null,
        publishedDate: null,
        applicationOpenDate: null,
        applicationCloseDate: null,
        positions: [{ ...validPosition, positionCount: -1 }],
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it('rejects the any-field sentinel combined with named fields', () => {
    expect(() =>
      Job108AnnouncementOutputSchema.parse({
        agencyName: null,
        publishedDate: null,
        applicationOpenDate: null,
        applicationCloseDate: null,
        positions: [{ ...validPosition, requiredFieldsRaw: ['*ANY*', 'รัฐศาสตร์'] }],
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it('rejects high confidence on a zero-position extraction', () => {
    expect(() =>
      Job108AnnouncementOutputSchema.parse({
        agencyName: null,
        publishedDate: null,
        applicationOpenDate: null,
        applicationCloseDate: null,
        positions: [],
        confidence: 0.95,
      }),
    ).toThrow();
  });
});

describe('buildJob108AnnouncementMessages', () => {
  it('refuses empty text rather than paying for a call on nothing', () => {
    expect(() => buildJob108AnnouncementMessages({ announcementId: 'id1', text: '   ' })).toThrow();
  });

  it('instructs the model to take the LOWEST stated education level', () => {
    const [system] = buildJob108AnnouncementMessages({ announcementId: 'id1', text: 'ประกาศ' });
    expect(system?.content).toMatch(/lowest/i);
  });

  it('instructs the model to use the any-field sentinel', () => {
    const [system] = buildJob108AnnouncementMessages({ announcementId: 'id1', text: 'ประกาศ' });
    expect(system?.content).toContain('*ANY*');
  });

  it('carries the และ counter-example, so a future edit cannot quietly remove it', () => {
    const [system] = buildJob108AnnouncementMessages({ announcementId: 'id1', text: 'ประกาศ' });
    expect(system?.content).toContain('การจัดการโลจิสติกส์และโซ่อุปทาน');
    expect(system?.content).toMatch(/"และ".{0,20}NOT a separator/);
  });
});
