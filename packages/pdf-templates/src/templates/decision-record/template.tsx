import type { TemplateDefinition } from '@kku/shared';

import { Section } from '../../components/section';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { DecisionRecordDataSchema, type DecisionRecordData } from './schema';

const VERSION = '0.1.0';

const DECISION_LABEL: Record<DecisionRecordData['decisionType'], string> = {
  CLOSE: 'ยุติหลักสูตร',
  MERGE: 'ควบรวม',
  LAUNCH: 'เปิดใหม่',
  RESTRUCTURE: 'ปรับโครงสร้าง',
  KEEP_AS_IS: 'คงสภาพ',
  OTHER: 'อื่น ๆ',
};

function DecisionRecordDoc({ data }: { data: DecisionRecordData }) {
  return (
    <>
      <Section title={`บันทึกมติสภามหาวิทยาลัย เลขที่ ${data.recordNumber}`}>
        <div className="kv-grid">
          <div className="label">เรื่อง</div>
          <div className="value">{data.titleTh}</div>
          <div className="label">ประเภท</div>
          <div className="value">{DECISION_LABEL[data.decisionType]}</div>
          <div className="label">ขอบเขต</div>
          <div className="value">{data.scope}</div>
          <div className="label">วันที่ประชุมสภา</div>
          <div className="value">{data.councilMeetingDate}</div>
          {data.effectiveDate && (
            <>
              <div className="label">วันที่มีผล</div>
              <div className="value">{data.effectiveDate}</div>
            </>
          )}
        </div>
      </Section>

      <Section title="ที่มาของเรื่อง"><p>{data.context}</p></Section>
      <Section title="เหตุผลของการตัดสินใจ"><p>{data.rationale}</p></Section>

      <Section title="หลักฐานที่อ้างอิง">
        <ul>
          {data.evidence.map((e) => (
            <li key={e.id}>
              {e.label} · <span className="muted">{e.source}{e.freshnessDate ? ` · ณ ${e.freshnessDate}` : ''}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="มติ">
        <p><strong>{data.resolution}</strong></p>
      </Section>

      {data.dissentingNotes.length > 0 && (
        <Section title="ข้อสังเกตที่ไม่เห็นด้วย">
          <ul>{data.dissentingNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Section>
      )}

      {data.followUps.length > 0 && (
        <Section title="งานที่ต้องดำเนินการต่อ">
          <table>
            <thead>
              <tr><th>งาน</th><th>ผู้รับผิดชอบ</th><th>กำหนด</th></tr>
            </thead>
            <tbody>
              {data.followUps.map((f, i) => (
                <tr key={i}><td>{f.label}</td><td>{f.ownerNameTh}</td><td>{f.dueDate}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {data.signatories.length > 0 && (
        <Section title="ผู้ลงนาม">
          <ul>{data.signatories.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
    </>
  );
}

export const decisionRecordTemplate: TemplateDefinition<DecisionRecordData> = {
  name: 'decision-record',
  version: VERSION,
  schema: DecisionRecordDataSchema,
  render(data) {
    return {
      html: renderTemplateToHtml(<DecisionRecordDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({
        leftLabel: `KKU · บันทึกมติ ${data.recordNumber}`,
        rightLabel: 'เอกสารราชการ',
      }),
    };
  },
};
