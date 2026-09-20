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

  // 2026-09-20 live run: the model's retry response omitted all three date
  // keys rather than sending them as explicit null, and .nullable() rejected
  // that with a bare "Required" error on every one of the four failures. An
  // omitted date and an explicit null mean the same thing here — the
  // announcement did not state one — so both must parse without throwing.
  it('accepts an object with the three date keys entirely absent, not just explicit null', () => {
    const parsed = Job108AnnouncementOutputSchema.parse({
      agencyName: 'กรมการข้าว',
      // publishedDate, applicationOpenDate, applicationCloseDate: omitted.
      positions: [validPosition],
      confidence: 0.7,
    });
    expect(parsed.publishedDate ?? null).toBeNull();
    expect(parsed.applicationOpenDate ?? null).toBeNull();
    expect(parsed.applicationCloseDate ?? null).toBeNull();
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

  // 4 of 25 live announcements (2026-09-20) made the model invent a
  // "DIPLOMA" value outside the enum for อนุปริญญา — a real Thai
  // qualification tier the schema has no slot for. Fixed by mapping it to
  // HIGHER_VOCATIONAL_CERT and telling the model never to invent a value.
  // This test guards the rule surviving a future prompt edit; it costs no
  // model call.
  it('instructs the model to map อนุปริญญา to HIGHER_VOCATIONAL_CERT and never invent a value', () => {
    const [system] = buildJob108AnnouncementMessages({ announcementId: 'id1', text: 'ประกาศ' });
    expect(system?.content).toContain('อนุปริญญา');
    expect(system?.content).toMatch(/อนุปริญญา[\s\S]{0,120}HIGHER_VOCATIONAL_CERT/);
    expect(system?.content).toMatch(/never invent a value/i);
  });
});
