import { describe, expect, it, vi } from 'vitest';
import { extractAnnouncement } from '../../src/job108/extract';

const okResponse = {
  parsed: {
    agencyName: 'กรมการข้าว',
    publishedDate: '2026-09-09',
    applicationOpenDate: null,
    applicationCloseDate: '2026-09-30',
    positions: [
      {
        title: 'เจ้าหน้าที่การเงิน',
        positionCount: 1,
        salaryMin: 30000,
        salaryMax: null,
        minEducationLevel: 'BACHELOR',
        requiredFieldsRaw: ['การบัญชี', 'บริหารธุรกิจ'],
        qualificationRaw: 'วุฒิการศึกษา ปริญญาตรี',
      },
    ],
    confidence: 0.9,
  },
};

describe('extractAnnouncement', () => {
  it('returns a header and rows from the model output', async () => {
    const ai = { extractStructured: vi.fn().mockResolvedValue(okResponse) };
    const result = await extractAnnouncement(ai as never, {
      announcementId: 'id20256',
      html: '<html><body>ประกาศ จำนวน 1 ตำแหน่ง</body></html>',
    });
    expect(result.header.agencyName).toBe('กรมการข้าว');
    expect(result.header.publishedDate?.toISOString().slice(0, 10)).toBe('2026-09-09');
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]?.requiredFieldsRaw).toEqual(['การบัญชี', 'บริหารธุรกิจ']);
    expect(result.title).toBe('เจ้าหน้าที่การเงิน');
  });

  it('scrubs gender, age and contact details before the model sees the text', async () => {
    const ai = { extractStructured: vi.fn().mockResolvedValue(okResponse) };
    await extractAnnouncement(ai as never, {
      announcementId: 'id1',
      html: '<p>เพศชาย อายุไม่เกิน 35 ปี ติดต่อ hr@example.com 081-234-5678</p>',
    });
    const sent = ai.extractStructured.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    const user = sent.messages[1]?.content ?? '';
    expect(user).not.toContain('hr@example.com');
    expect(user).not.toContain('081-234-5678');
    expect(user).not.toContain('เพศชาย');
  });

  it('stamps the prompt version so a bump is traceable', async () => {
    const ai = { extractStructured: vi.fn().mockResolvedValue(okResponse) };
    await extractAnnouncement(ai as never, { announcementId: 'id1', html: '<p>ประกาศ</p>' });
    const sent = ai.extractStructured.mock.calls[0]?.[0] as { methodVersion: string };
    expect(sent.methodVersion).toBe('job108-announcement.v1');
  });

  it('records a null title when the page yields no positions, never the announcement id', async () => {
    const ai = {
      extractStructured: vi.fn().mockResolvedValue({
        parsed: {
          agencyName: null,
          publishedDate: null,
          applicationOpenDate: null,
          applicationCloseDate: null,
          positions: [],
          confidence: 0.2,
        },
      }),
    };
    const result = await extractAnnouncement(ai as never, { announcementId: 'id999', html: '<p>news item</p>' });
    expect(result.title).toBeNull();
    expect(result.positions).toHaveLength(0);
  });
});
