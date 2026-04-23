import type { TemplateDefinition } from '@kku/shared';

import { Section } from '../../components/section';
import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import { DataQualityReportDataSchema, type DataQualityReportData } from './schema';

const VERSION = '0.1.0';

function DataQualityReportDoc({ data }: { data: DataQualityReportData }) {
  return (
    <>
      <Section title={`รายงานคุณภาพข้อมูล · ${data.dateLabel}`}>
        {data.author && <p className="muted">จัดทำโดย {data.author}</p>}
        <p>{data.summary}</p>
      </Section>
      <Section title="สถานะแหล่งข้อมูล">
        <table>
          <thead>
            <tr>
              <th>แหล่งข้อมูล</th>
              <th>ประเภท</th>
              <th>ซิงก์ล่าสุด</th>
              <th>สถานะ</th>
              <th className="numeric">ความครอบคลุม</th>
              <th>ปัญหา</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.kind}</td>
                <td>{s.lastSyncedAt ?? '—'}</td>
                <td>{s.status}</td>
                <td className="numeric">{s.coveragePercent !== undefined ? `${s.coveragePercent.toFixed(0)}%` : '—'}</td>
                <td>{s.issues.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

export const dataQualityReportTemplate: TemplateDefinition<DataQualityReportData> = {
  name: 'data-quality-report',
  version: VERSION,
  schema: DataQualityReportDataSchema,
  render(data) {
    return {
      html: renderTemplateToHtml(<DataQualityReportDoc data={data} />),
      css: baseCss,
      footerHtml: buildFooterHtml({ leftLabel: `KKU · Data Quality Report · ${data.dateLabel}` }),
    };
  },
};
